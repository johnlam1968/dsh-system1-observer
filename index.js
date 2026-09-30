// THE ROW. What it does: call a System One model at the configured points of the agent loop, and write the
// call -- request and response -- to a trace. What it must never do: change anything the loop decided.
//
// THE DECISION RUNTIME IS LOCAL SOURCE -- it lives under `lib/`, in the same commit as this file, rather
// than arriving as a fetched dependency. So a renamed or removed export is refused by ESM resolution BEFORE
// `apply`, and the argument shapes this file calls are held by the tests that execute `apply`. There is no
// interface version to compare: pinned across a repository boundary a version integer has a job, but here it
// could only ever fire when the person who broke the shape also volunteered to bump it.
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Schema from '@deepseek-ai/schemastery'
import { PROBE_SEAMS, TEXTLESS_SEAMS, seamCallsEnabled } from './lib/seams.js'
import { probeFingerprint } from './lib/probe-score.js'
import { configuredQuestionIds } from './lib/questions.js'
import { readSessions, sessionObserved } from './lib/sessions.js'
import { egressFacts } from './lib/egress.js'
import { attachRedactionRule } from './lib/telemetry.js'
import { minimisePaths, redactPolicy, sanitizeJson } from './lib/redact.js'
import { describeSubject, subjectOfAgent } from './lib/subject.js'
import { createEvidence } from './lib/evidence.js'
import { createModel } from './lib/model/client.js'
import { createServiceModel } from './lib/model/service.js'
import { plainConfig, readConfigValue } from './lib/config-value.js'
import { createObserver } from './lib/observe.js'
import { createTraceTool } from './lib/tool.js'
import { readTraceWindow, runIds } from './lib/trace-report.js'
import { createObserverService, OBSERVER_SERVICE } from './lib/service.js'
import { createDecideTool } from './lib/decide-tool.js'
import { createConfigTool } from './lib/config-tool.js'
import { createConfigWriter } from './lib/config-writer.js'
import { createTurnObserver } from './lib/turn-observer.js'
import { createTurnListener } from './lib/turn-listener.js'
import { registerListeners, readHooks, isSubagent, SUBAGENT_SKIP_REASON } from './lib/register.js'

const name = 'system1-observer'

// `agents` is a HARD dependency because the observer reads `ctx.agents.currentInitiator()` inside listeners,
// and Cordis's context proxy throws on an undeclared service property. `system1` is deliberately NOT here:
// a profile without it would leave the row PENDING and inert instead of falling back to the wire, which is
// what `ctx.inject` below is for.
const inject = ['agents']

/**
 * Where the trace goes when nothing overrides it.
 *
 * `<DSH_HOME>/logs/…` first, so a trace is discoverable beside the harness's own logs; with no `DSH_HOME` the
 * HARNESS'S OWN DEFAULT HOME (`~/.dsh`, the directory the profiles live under) stands in for it, because the
 * alternative was the package's own directory and that is wrong for anyone who installed this normally.
 *
 * THE PACKAGE DIRECTORY IS DELIBERATELY NEVER USED. It was the last resort, and for a published plugin that
 * path is inside `node_modules` -- read-only on a global install, wiped by the next `npm install` otherwise,
 * and never what a person means by "the logs". Worse, a write there that fails is swallowed by the
 * best-effort evidence sink, so the failure mode was a plugin that silently produced no trace at all. A bare
 * `node` run with no home directory falls back to the OS temporary directory, which is at least writable.
 *
 * `tracePath` wins over both, and `SYSTEM1_OBSERVER_TRACE` is applied by the evidence sink on top of whatever
 * this returns.
 */
export function resolveTracePath(config, packageDir, env = process.env) {
  const configured = readConfigValue(config?.tracePath)
  const given = typeof configured === 'string' ? configured.trim() : ''
  if (given !== '') return given
  const configuredHome = typeof env?.DSH_HOME === 'string' && env.DSH_HOME !== '' ? env.DSH_HOME : undefined
  const home = configuredHome ?? defaultDshHome()
  const base = home === undefined || home === '' ? join(tmpdir(), 'dsh-logs') : join(home, 'logs')
  return join(base, 'system1-observer.jsonl')
}

/** The harness's own default home, so an unset `DSH_HOME` still lands beside the profiles. */
function defaultDshHome() {
  try {
    return join(homedir(), '.dsh')
  } catch {
    return undefined
  }
}

const Config = Schema.object({
  hooks: Schema.array(Schema.string())
    .description(`Points of the loop to call, from: ${PROBE_SEAMS.join(', ')}. Read once, at mount, so this is YAML-only.`),
  provider: Schema.string().description('The system1 provider id, for example `typesafe` for Jev or `laya`. Read once, at mount, so this is YAML-only.'),
  model: Schema.string().description('The model id to pass to that provider, for example `jev-latest`. Read once, at mount, so this is YAML-only.'),
  timeoutMs: Schema.number().min(0).description('Per-call bound in milliseconds. Read once, at mount, so this is YAML-only.'),
  wireUrl: Schema.string().description('Base URL used only when the profile mounts no system1 service. Read once, at mount, so this is YAML-only.'),
  question: Schema.string().description('The question asked at every seam until a per-seam question is configured: `noul` built from this text, or the runtime probe question when empty. Read once, at mount, so this is YAML-only.'),
  tracePath: Schema.string().description('Where the JSONL trace is written. Empty uses SYSTEM1_OBSERVER_TRACE, else `<DSH_HOME>/logs/`, else the package’s data directory. Read once, at mount, so this is YAML-only.'),
  // THE SCHEDULED TURN MEASUREMENT. Undeclared at first, which made the wiring inert: a field the schema does not
  // know is not a field a profile can set, so the trigger read `undefined`, computed an interval of 0 and never
  // fired. A knob that cannot be configured is not a knob.
  //
  // VOLATILE, so the settings card can edit it live. The ON/OFF is read at every turn boundary and the INTERVAL at
  // mount -- a deliberate split: switching a measurement off is a statement about what is being observed now, while
  // changing how often it fires is a different experiment and belongs with the other mount-time fields.
  turnEveryNTurns: Schema.number()
    .min(0)
    .step(1)
    .default(0)
    .description('Fire the scheduled turn measurement every Nth turn boundary. 0, the default, switches it off. The on/off is read at every boundary; the interval itself is read at mount.')
    .volatile(),
  // THE PER-SEAM QUESTIONS, and the one field whose SHAPE matters to the host rather than to us.
  //
  // A volatile OBJECT rather than nine flat fields, because the settings host projects a form onto the
  // schema: `isVolatilePath` treats every path BENEATH a volatile node as writable (so
  // `['questions','admit',0,'instructions']` is accepted) and `projectForm` on an ARRAY returns the array
  // whole -- so a question object keeps its `options`/`criteria`/`levels` verbatim, while an undeclared
  // key under an OBJECT would be silently dropped. Every seam is therefore declared here, and a tenth seam
  // would need a line here as well as in `PROBE_SEAMS` -- which is what `test/schema.test.js` asserts, so
  // the two lists cannot drift apart.
  //
  // MEASURED against the installed `dsh-settings` (0.1.7-rc.2) before this was written: every path beneath
  // `questions` answers `isVolatilePath` true, a nine-key map round-trips through `projectForm` verbatim,
  // and an undeclared tenth seam comes back `undefined`.
  questions: Schema.object(
    Object.fromEntries(PROBE_SEAMS.map(seam => [seam, Schema.array(Schema.any())])),
  ).volatile().description('Per-seam questions, keyed by seam name. An array of `{id, type, instructions}` where `type` is `noul` (optional `criteria`), `choice` (`options`: `{label, criterion, abstain}`) or `score` (`levels`). A seam left empty asks nothing. Legacy mode -- the probe question, or `question` -- applies until at least one seam carries a question.'),
  // THE KILL SWITCH. `!= false` in `lib/observe.js`, NOT `=== true`: an absent field has to leave the
  // observer ON, because a switch that turns itself off when nobody set it is worse than no switch. There
  // is deliberately no `.default(true)` -- a VOLATILE field does not arrive as its value, and the schema
  // default is not what `.get()` answers for a field nobody has written.
  callsEnabled: Schema.boolean().volatile().description('Master switch for the model calls. Off records a `skip` at every seam with reason `calls disabled` and makes no request; the questions are kept, so turning it back on resumes where it left off. Read at the point of use, so it is live.'),
  // PER SEAM, and the defaults are the point. MEASURED: a plain boolean inside a volatile object
  // materialises to an ABSENT KEY (`{}`), unlike an array which materialises to `[]` -- so an unset seam
  // reads `undefined`, and `.default(true)` makes the resolved config say `true` rather than nothing at
  // all. Either way an absent key means ON; `lib/seams.js` is what enforces that, not this schema.
  //
  // Declared per seam for the same reason as `questions`: `projectForm` DROPS a key this schema does not
  // declare, so a tenth seam would need a line here too. `test/schema.test.js` holds the two lists equal.
  seamEnabled: Schema.object(
    Object.fromEntries(PROBE_SEAMS.map(seam => [seam, Schema.boolean().default(true)])),
  ).volatile().description('Per-seam switch for the model calls, keyed by seam name. Off records a `skip` at that seam with reason `calls disabled at this seam`; its questions are kept. The master `callsEnabled` overrides all of them while it is off.'),
  // TWO WAYS TO OBSERVE EVERYTHING, AND ONE TO OBSERVE NOTHING -- see `lib/sessions.js`:
  //   unset          -> `['*']` by the DEFAULT below, so a row nobody configured observes every session
  //   `['*']`        -> the same thing, written down and visible in the card, and removable
  //   `[]`           -> observe NOTHING, which is the one state that has to be explicit
  // The wildcard exists BECAUSE an array MATERIALISES to `[]`: without it, "nobody has configured this" and
  // "configured to observe nothing" would be the same value, and one of the two would have to be wrong.
  //
  // ITEMS ARE `any`, NOT `string`, because an entry may be `{ id, title }`: the title is the headline the
  // session menu was handed, kept for display only. A `string` item schema would REFUSE that object at
  // resolution, which would make the row fail to load the moment the menu wrote one.
  sessions: Schema.array(Schema.any()).default(['*']).volatile().description('Observe only these sessions, matched by id or id prefix. `*` means EVERY session and is the default; an EMPTY list observes nothing. The “...” menu on a session in the sidebar is the way in, and it can also narrow to one session. An entry may be a bare id string or `{ id, title }` — the title is a display cache and is never matched on. A firing in any other session records a `skip` with reason `session not observed` and its text never reaches the model or the trace.'),
  includeNonOperatorFacing: Schema.boolean().volatile().description('Also call the model for the harness’s own purpose-tagged streaming calls, for example session titles and compaction. A stream the harness does not tag with a purpose, including a subagent’s, is observed either way. Off keeps the trace to what an operator would read.'),
  observeSubagents: Schema.boolean().volatile().description('Observe subagent sessions too. Off (the default) records a subagent’s streams and tool calls as `skip` lines with reason `subagent session`, and their text never reaches the model. On observes a subagent like any other agent.'),
  maxFieldChars: Schema.number().min(1).volatile().description('Longest state field recorded in one trace line. Longer values are cut and the line is marked truncated.'),
  // THE RECORD'S OWN SWITCHES, all three volatile because all three must be live: a trace that had to be
  // restarted to stop leaking is a trace that leaks until somebody notices.
  redactEnabled: Schema.boolean().default(true).volatile().description('Redact the trace copy. ON by default, and it NEVER touches what the model is asked: `state` stays raw, because a model asked to classify `[REDACTED]` measures the scrubber. Off lets credential shapes through on purpose — truncation still applies, because a kill switch that also removed the size cap would be a foot-gun.'),
  redactKeys: Schema.array(Schema.string()).default([]).volatile().description('Extra field names to redact, beside the six built in (key, token, secret, password, authorization, credential). Matched by the tokenizer, so `apiKey`, `api_key` and `API-KEY` all match `key` — and `monkey`, `keyboard` and `turkey` do not, because containment is deliberately not part of the rule.'),
  // THE RATE IS CONFIGURABLE, AND NAMED, AND DATED. Four sibling plugins hard-code the same number, and the one
  // that says why puts it best: two copies of a price drift. This is the fifth copy -- one, and named.
  // THE QUESTION TEXT WAS UNBOUNDED UNTIL THIS EXISTED. `maxFieldChars` bounds `state.text` alone; the
  // instructions, every option label, every criterion and every level went verbatim -- an unbounded per-call
  // spend. Refused rather than truncated: the answer map is keyed by question.
  // EXPORT LESS RATHER THAN SCRUB MORE, where the trade is the operator's to make. The reference this is ported
  // from defaults to `omit`, and this one defaults to `full` for a reason the switch itself cannot carry: a
  // telemetry exporter ships records OFF THE MACHINE, while this trace is local evidence whose purpose is that a
  // wrong judgement is diagnosable -- and 56% of its call lines carry a path. The record is minimised; the model
  // still receives the raw text.
  pathMode: Schema.union(['full', 'basename', 'omit']).default('full').volatile().description('How much of an absolute path the TRACE keeps: `full`, `basename`, or `omit` (replaced with [PATH]). It never touches what the model is asked. Default `full`, because this trace is local evidence and a path is often the diagnosis; set `basename` or `omit` if you share the file.'),
  redactSessionTelemetry: Schema.boolean().volatile().description('Scrub the harness’s own outbound session-telemetry records, which otherwise leave the process unredacted. Unrelated to this plugin’s own JSONL trace, which is local and redacts its copy. Off by default: a plugin whose contract is “it decides nothing” must not silently rewrite a user’s telemetry the moment it mounts.'),
  maxQuestionChars: Schema.number().default(4000).volatile().description('Longest the configured question text may serialize to, at one firing. Over it, the seam asks NOTHING and records the reason as a `problem` — refused rather than truncated, because the answer map is keyed by question and a shortened question returns answers that cannot be matched to what was asked. Defaults to 4000.'),
  pricePerMTokInput: Schema.number().default(0.042).volatile().description('USD per million input tokens for the COST OF THE JUDGEMENT only. The subject model’s tokens are never captured, so a session cost is not computable from this trace. Output tokens are free on this model; the input term is the whole cost. Defaults to the rate transcribed 2026-09-28.'),
  maxTraceBytes: Schema.number().default(33554432).volatile().description('Rotate the trace when the next line would cross this many bytes. 0 disables rotation. Rotation renames the full file aside as `<name>.<run>.<n>.jsonl` and starts a fresh one at the same path, so every reader keeps following the live file; each rotation writes a `rotate` line naming both, and the count is on the mount line.'),
})

async function apply(ctx, config) {
  const here = dirname(fileURLToPath(import.meta.url))
  // THE MOUNT-BOUND FIELDS, READ ONCE. `hooks` decides which listeners exist, and a transport binds
  // when its client is built, so neither can change under a running row; unwrapping them once is
  // correct. The VOLATILE fields are deliberately NOT taken from here -- see `readConfig` below.
  const mount = plainConfig(config)
  const hooks = readHooks(mount)                        // a typo refuses the mount, naming the seam
  // THE POLICY IS A GETTER because it is live config, read per line; the path is captured because the test suite
  // depends on that ordering. See `lib/evidence.js`.
  const liveConfig = () => plainConfig(config)
  const evidence = createEvidence({
    defaultPath: resolveTracePath(mount, here),
    envVar: 'SYSTEM1_OBSERVER_TRACE',
    policy: liveConfig,
    maxBytes: () => readConfigValue(liveConfig().maxTraceBytes),
  })
  const transport = { kind: 'wire', provider: mount.provider ?? null, model: mount.model ?? null }
  const wire = createModel({ baseUrl: mount.wireUrl || 'http://127.0.0.1:8766', timeoutMs: mount.timeoutMs ?? 8000 })
  // BOTH FACTORIES RETURN A CLIENT `{decide, health}`, NOT A FUNCTION. This indirection is what keeps one call
  // site working across the two transports; assigning the client itself to `decide` made every call throw
  // "decide is not a function", which no unit test saw because `apply` was never executed.
  let decide = (request) => wire.decide(request)

  // THE MOUNT LINE IS WRITTEN WHEN THE TRANSPORT IS KNOWN -- NOT WHEN `apply` RETURNS. `ctx.inject`'s
  // callback runs through a cordis fiber, so at the end of `apply` the transport is still `wire`: measured
  // live, the mount line read `"transport":"wire"` at 17:20:41.319Z while every `call` line and the real
  // transport were `service`, and the swap landed 355 ms later. A microtask does not fix that (it fires
  // within microseconds and would write `wire` again). This writer is idempotent and is called by whichever
  // comes first: the service arriving, or the first observation (so a profile with no service still gets a
  // mount line, in `wire`, before the first call or skip it belongs to). It reads `config` directly because
  // the accessors above are unwrapped whatever order these run in.
  let mountTraced = false
  function writeMount() {
    if (mountTraced) return
    mountTraced = true
    evidence.trace('mount', () => {
      // THE SCOPE THIS RUN STARTED WITH, and it belongs on this line because a trace is otherwise unreadable as
      // a whole: without it, a run that recorded nothing looks identical to a run that was never asked to --
      // and the first question anyone asks of a quiet trace is "was it scoped, paused, or broken?".
      //
      // READ LIVE, not from the apply-time `mount` snapshot above, because these three fields are volatile: a
      // setting saved while the row runs changes them without re-applying, so the snapshot would be the one
      // thing in this line that was never true. IT IS STILL A SNAPSHOT OF THE MOMENT — the line is written once,
      // at mount or at the first observation — and the per-event `reason` remains the authority on any firing.
      const live = plainConfig(config)
      return {
        hooks,
        transport: transport.kind,
        provider: mount.provider ?? null,
        model: mount.model ?? null,
        // THE IDS ARE READ FROM THE CONFIG, not restated. This line said `['probe']` while the row asked
        // whatever the config said, so the moment a per-seam question existed the mount line would have
        // named a question the row never asked. It is an apply-time snapshot, like `hooks` beside it: the
        // mount line is written once, and a later save is deliberately not re-applied.
        questionIds: configuredQuestionIds(mount),
        // THE INSTRUMENT'S IDENTITY. The probe's question text was authored by intuition, so a run with edited
        // instructions is a NEW MEASUREMENT and not a comparison. Without this, two runs are silently averaged
        // as though one instrument produced both.
        probeHash: probeFingerprint(),
        callsEnabled: readConfigValue(live.callsEnabled) !== false,
        // The DEVIANT set, because "nothing is off" is the common case and a list of nine booleans buries it --
        // and the two seams that carry no text are excluded, because they are not switched off, they are
        // inapplicable, and a line that cannot tell those apart reports a decision nobody made.
        seamsOff: PROBE_SEAMS.filter(seam => !TEXTLESS_SEAMS.includes(seam) && !seamCallsEnabled(live, seam)),
        // A BOUND NOBODY CAN READ IS NOT A BOUND. The cap that rotates this file is only auditable if the
        // record says how often it fired and how much moved, and the mount line is where a run's scope lives.
        rotated: evidence.rotations(),
        // WHAT LEAVES AND WHERE IT GOES, as data so it can be asserted -- the mount line is already the answer to
        // "was it scoped, paused, or broken?", and this is the answer to "and what did that send?".
        egress: egressFacts({
          transport: transport.kind,
          endpoint: transport.kind === 'service' ? `provider:${mount.provider ?? '(unset)'}` : (mount.wireUrl || 'http://127.0.0.1:8766'),
          model: mount.model ?? null,
          callsEnabled: readConfigValue(live.callsEnabled) !== false,
          maxFieldChars: readConfigValue(live.maxFieldChars),
          maxQuestionChars: readConfigValue(live.maxQuestionChars),
          redactEnabled: readConfigValue(live.redactEnabled) !== false,
          pathMode: readConfigValue(live.pathMode),
          observeSubagents: readConfigValue(live.observeSubagents) === true,
          includeNonOperatorFacing: readConfigValue(live.includeNonOperatorFacing) === true,
          sessions: readSessions(live),
          hooks,
          seamsOff: PROBE_SEAMS.filter(seam => !TEXTLESS_SEAMS.includes(seam) && !seamCallsEnabled(live, seam)),
        }),
        // The list as written: `['*']` is every session and `[]` is none, so REWRITING it would destroy the
        // only distinction this field has.
        sessions: readSessions(live),        // MINIMISED LIKE EVERY OTHER PATH IN THE RECORD. The reader already knows where the file is -- it opened
        // it -- so this field costs nothing to reduce and is the one place a deployment path is recorded verbatim.
        tracePath: minimisePaths(evidence.path, readConfigValue(live.pathMode)),
      }
    })
  }

  // THE TRACE TOOL, so an agent can read what the questions actually did instead of being told a path it
  // has no reason to know. Through `ctx.inject` for the same reason as `system1`: a hard dependency on
  // `tools` would leave the row PENDING -- running nothing at all, listeners included -- on a deployment
  // without it, and losing the observation to gain a reader would be a bad trade. The path is captured
  // here because it is mount-bound, and the run id so the default answer is "what is happening now".
  // THE MODEL EACH LIVE SESSION IS ON, because "which model is this session using" is the question the subject
  // field answers per line and this answers right now -- and because it is the only way to see whether
  // `Agent.options` is populated at all without waiting for a seam to fire. Shared by the tool and the tab, so
  // the two cannot report different answers for the same question.
  function liveAgentRoutes() {
    try {
      const list = ctx.agents.list()
      if (!Array.isArray(list)) return []
      return list
        .filter(agent => typeof agent?.id === 'string')
        .map(agent => {
          const route = describeSubject(subjectOfAgent(agent))
          return route === '(unknown)' ? agent.id : `${agent.id} (${route})`
        })
    } catch {
      return []
    }
  }

  ctx.inject(['tools'], (child) => {
    const tools = child.get('tools')
    if (tools === undefined || typeof tools.register !== 'function') return
    tools.register(createTraceTool({
      path: evidence.path,
      runId: evidence.runId(),
      liveAgents: liveAgentRoutes,
      price: () => readConfigValue(liveConfig().pricePerMTokInput),
    }))
    // THE REPOSITORY'S OWN DECISION TOOL, over the SAME `decide` the observer uses. The closure is deliberate:
    // `decide` is assigned by the transports below, which may arrive after this callback runs, so the tool reads
    // it at call time. Reaching for a model here would freeze whichever transport happened to be ready first and
    // would let the tool and the instrument drift apart -- the exact failure the thin-tool design exists to
    // prevent. `mount` supplies the defaults the row was configured with, so the tool's own description names the
    // backend it will actually reach.
    tools.register(createDecideTool({
      decide: (request) => decide(request),
      provider: mount.provider ?? null,
      model: mount.model ?? null,
      // The line goes to the same sink as every other one, so a reader finds it where it already looks.
      record: (line) => {
        const { event, ...fields } = line
        evidence.trace(event, fields)
      },
    }))
    // THE SETTINGS TOOL. `record` writes a config line BEFORE the change -- that ordering is the tool's contract,
    // and `evidence.trace` is the same sink every other line goes to, so a reader finds it where it looks.
    // `write` goes through the harness's configEditor rather than editing the profile file, and NO knob list is
    // passed: the editor validates and reconciles a plugin's next config itself, so an unknown field is refused
    // by the thing that owns the schema instead of by a copy of it that would drift.
    tools.register(createConfigTool({
      read: () => plainConfig(liveConfig()),
      record: (line) => {
        const { event, ...fields } = line
        evidence.trace(event, fields)
      },
      // AND THE RECORD OF A MOVE LANDS IN THE SINK BEING LEFT, which the plan's section 4 requires. It holds by
      // MECHANISM rather than by intent: `evidence` is built at MOUNT with `resolveTracePath(mount, here)`, and the
      // live reads above are for `maxTraceBytes`, price and the knobs -- not the path. So a `tracePath` change is
      // recorded through the evidence that still points at the OLD file, and the new path takes effect when the row
      // re-mounts. That is the property the constraint wanted. IT IS NOT TESTED, and it is the kind of property a
      // refactor could remove without noticing -- making `evidence` read its path live would move the record of the
      // move into the sink the move created, which is exactly the hole the constraint exists to close.
      write: async (change) => {
        if (configEditor === null) {
          throw new Error('system1_observe_config: the configEditor service is not available in this profile, so no change can be persisted.')
        }
        return createConfigWriter({ editor: configEditor, rowId: 'system1-observer' })(change)
      },
    }))
  })


  // THE OBSERVER AS A SERVICE, so another plugin can read what this row recorded instead of re-implementing the
  // readers. Registered with `ctx.provide` -- NOT `ctx.set`, which only replaces an already-provided value and
  // throws otherwise -- and needing no import of cordis, so it costs no dependency. Every method closes over a
  // reader and returns its result, so there is no mutator here by construction; the test asserts the freeze.
  ctx.provide(OBSERVER_SERVICE, createObserverService({
    read: (options) => readTraceWindow(evidence.path, options?.maxBytes),
    runs: () => runIds(readTraceWindow(evidence.path).events),
    sessions: () => ({ live: liveAgentRoutes(), configured: mount.sessions ?? null }),
    config: () => ({
      hooks,
      // WHICH QUESTIONS, WHICH IS WHAT `config()` IS FOR. The first version reported hooks, provider and model and
      // left this out, so a consumer could see that calls were recorded but not WHAT was asked -- and a count of
      // answers is not interpretable without the questions they answer. Read through the same reader the mount line
      // uses, so the two cannot disagree about what the row is configured to ask.
      questionIds: configuredQuestionIds(liveConfig()),
      provider: mount.provider ?? null,
      model: mount.model ?? null,
      turnEveryNTurns: readConfigValue(liveConfig().turnEveryNTurns) ?? 0,
      pricePerMTokInput: readConfigValue(liveConfig().pricePerMTokInput) ?? null,
    }),
  }))

  // THE SERVICE, IF THE PROFILE MOUNTS ONE. Read through `ctx.inject` and never captured: the callback runs
  // when the service arrives, which may be after this row mounts. Everything it needs is read from `config` and
  // `evidence` and the `mount` snapshot directly, which is safe whatever order the callback runs in.
  // THE HARNESS'S OWN OUTBOUND TELEMETRY, off unless asked. Reached by STRING -- the service key and the event
  // name are verified against the installed declarations, and both were wrong in shipped documentation: the event
  // is `session-telemetry/record`, not the `sessionTelemetry/record` three READMEs spell, and the service key is
  // `sessionTelemetry`, not the `telemetry` its own doc comment claims.
  const detachTelemetryRule = attachRedactionRule(ctx, {
    readEnabled: () => readConfigValue(liveConfig().redactSessionTelemetry) === true,
    // THE WHOLE RECORD, NOT ONLY ITS `body`. The record is `{channel, time, severity, attributes, body}`, and
    // `attributes` is a string map that can carry a path or a credential shape as easily as the body can --
    // `sanitizeJson` also redacts by KEY, so an attribute NAMED `token` loses its value too. It deep-clones, which
    // is what the waterfall requires: the record handed over must not be mutated.
    scrub: (record) => sanitizeJson(record, redactPolicy(liveConfig())),
  })

  // THE CONFIG EDITOR, captured rather than reached for, for the same reason as the service: it may arrive after
  // this row mounts. `write` REFUSES while it is absent -- a settings tool that silently did nothing would report
  // success for a change that never happened, which is worse than an error.
  let configEditor = null
  ctx.inject(['configEditor'], (child) => {
    configEditor = child.get('configEditor') ?? null
  })

  ctx.inject(['system1'], (child) => {
    const service = child.get('system1')
    if (service === undefined) return
    const viaService = createServiceModel({
      service,
      provider: mount.provider ?? undefined,
      model: mount.model ?? undefined,
    })
    decide = (request) => viaService.decide(request)
    transport.kind = 'service'
    writeMount()
  })

  const provider = mount.provider ?? null
  const model = mount.model ?? null
  // THE VOLATILE FIELDS ARE READ FRESH ON EVERY CALL. `plainConfig` unwraps each `Volatile` with
  // `.get()` at this moment, which is what lets a saved setting reach a RUNNING row: the harness does
  // not re-apply the plugin -- instance identity is unchanged by design -- so a value captured in
  // `apply` would never move. Reading that captured object instead made every settings save a no-op
  // that the card still reported as "Saved."
  const readConfig = () => ({
    ...plainConfig(config),
    transport: transport.kind,
    provider,
    model,
  })
  const observer = createObserver({ decide: (request) => decide(request), trace: evidence.trace, readConfig })

  // THE TURN TRIGGER. It fires on `agent/pre-step` -- the event the `admit` seam maps to -- because an admit ENDS
  // the turn before it, so the exchange being judged has closed by the time this runs.
  //
  // THE INTERVAL IS READ AT MOUNT and the on/off knob at every boundary. That split is deliberate: the agent may
  // switch the scheduled measurement off and on again (the operator's decision -- every knob is the agent's), while
  // changing HOW OFTEN it fires is a different statement about the experiment and takes effect on a re-mount.
  //
  // A THROW HERE MUST NOT FAIL THE TURN -- the one thing this plugin must never do -- but it must not vanish
  // either, so a failure is recorded as a skip line with its reason rather than swallowed.
  const everyNTurns = Number(readConfigValue(liveConfig().turnEveryNTurns) ?? 0)
  const turnObserver = createTurnObserver({
    listener: createTurnListener({
      everyNTurns,
      isEnabled: () => Number(readConfigValue(liveConfig().turnEveryNTurns) ?? 0) > 0,
      readConfig: () => liveConfig(),
    }),
    // The session's events, obtained the way the peer bridge does: the agents service by session id, then the
    // agent's own session. A missing service or session yields no events, which `composeTurnState` refuses on.
    readEvents: (sessionId) => {
      try {
        const agents = typeof ctx.get === 'function' ? ctx.get('agents') : undefined
        const direct = agents !== undefined && typeof agents.get === 'function' ? agents.get(sessionId) : undefined
        const agent = direct ?? (agents !== undefined && typeof agents.list === 'function' ? agents.list().find((one) => one?.id === sessionId) : undefined)
        const session = agent !== undefined && agent !== null ? agent.session : undefined
        return session !== undefined && typeof session.snapshotEvents === 'function' ? session.snapshotEvents(0) : []
      } catch {
        return []
      }
    },
    ask: (request) => decide(request),
    record: (line) => {
      const { event, ...fields } = line
      evidence.trace(event, fields)
    },
  })
  // A WATERFALL LISTENER, so it MUST call `next()`. `agent/pre-step` is declared `mode: 'waterfall'` with the
  // signature `(payload, next) => Promise<PreStepDecision>`, and a listener that ignores `next` does not merely skip
  // its own turn -- it hands the listener BEHIND it a payload where the continuation should be, which broke the
  // observer's own admit handling. Found by driving the wiring rather than the modules: every unit test passed while
  // this would have failed in a live process, on the seam the whole plugin depends on.
  ctx.on('agent/pre-step', (payload, next) => {
    const sessionId = payload?.agent?.id
    // THE SAME SESSION GATE THE OBSERVATION PATH APPLIES, and the schema's own description depends on it: a firing
    // in a session this row was not pointed at "never reaches the model or the trace". Without this, the scheduled
    // measurement would send an EXCLUDED conversation to the judge -- the documented promise, broken, and broken by
    // the one code path that was added last. The reason string is the same one, so a reader can group them.
    if (!sessionObserved(liveConfig(), sessionId)) {
      evidence.trace('skip', { hook: 'turn', agentId: sessionId ?? null, reason: 'session not observed' })
      return next()
    }
    // AND THE SUBAGENT GATE, from the same module and with the same reason string the observation path uses. It is
    // off unless the config says exactly `true`, so a scheduled measurement does not silently start watching the
    // worker sessions an operator never asked about.
    if (isSubagent(payload?.agent) && readConfigValue(liveConfig().observeSubagents) !== true) {
      evidence.trace('skip', { hook: 'turn', agentId: sessionId ?? null, reason: SUBAGENT_SKIP_REASON })
      return next()
    }
    // The payload's own messages, taken as they stand: `composeTurnState` accepts text or a message-like object, so
    // this does not need to know the UserMessage shape -- and must not, since guessing it is what this fix avoids.
    const messages = Array.isArray(payload?.messages) ? payload.messages : []
    // EVERY OUTCOME THAT ASKS NOTHING IS RECORDED, not only the ones that throw. A REFUSAL WROTE NOTHING AT ALL --
    // no boundary yet, no set configured under `turn`, and a malformed set were all indistinguishable from silence,
    // and an operator could not tell a schedule that has not come round from one that will never fire. Measured:
    // with a set configured and the interval at 1, this handler produced ZERO trace lines, which is the same
    // evidence as a node that was never reached.
    Promise.resolve(turnObserver.onAdmit({ sessionId, nextMessage: messages[messages.length - 1] }))
      .then((outcome) => {
        if (outcome !== undefined && (outcome.refused === true || outcome.failed === true)) {
          evidence.trace('skip', { hook: 'turn', agentId: sessionId ?? null, reason: `the turn measurement did not run: ${outcome.reason ?? 'no reason given'}` })
        }
      })
      .catch((error) => {
        evidence.trace('skip', { hook: 'turn', agentId: sessionId ?? null, reason: `the turn measurement failed: ${error instanceof Error ? error.message : String(error)}` })
      })
    // THE CHAIN CONTINUES. Everything above is bookkeeping around the seam; the seam's own decision is not ours.
    return next()
  })

  registerListeners(ctx, hooks, {
    // THE MOUNT LINE PRECEDES THE FIRST OBSERVATION when no service ever appeared. Calling the writer here
    // rather than at the end of `apply` is what keeps "no service" from being recorded before it is known --
    // including when the first event of a run is a subagent's `skip`.
    observe: (hook, text, meta) => { writeMount(); return observer.observe(hook, text, meta) },
    skip: (hook, meta, reason) => { writeMount(); return observer.skip(hook, meta, reason) },
    readConfig,
    // THE AGENT, NOT ITS ID: the `draft` seam reads both `agent.id` and the session origin from this one
    // object, and `isSubagent` needs the latter.
    captureAgent: () => ctx.agents.currentInitiator(),
    // THE SUBJECT COMES FROM THE AGENT on every seam whose payload carries no LLM request -- see
    // `lib/subject.js`. The `draft` listener does not come through here: it builds its own meta from the
    // `GenerateOptions` it is handed, which is the request as actually sent.
    meta: (payload, agent) => ({
      agentId: payload?.agent?.id ?? agent?.id,
      turn: payload?.turn,
      step: payload?.step,
      subject: subjectOfAgent(agent ?? payload?.agent),
      // THE TOOL'S NAME, which the payload of every tool seam already carries. `post_execute` and `result` are
      // asked about the RESULT text alone, so without this a matrix of results cannot say which tool produced
      // one.
      toolName: typeof payload?.name === 'string' && payload.name !== '' ? payload.name : undefined,
    }),
  })
}

export { apply, name, inject, Config }
export default { apply, name, inject, Config }
