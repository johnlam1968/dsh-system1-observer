import { createFsJournal, DEFAULT_MAX_PATHS, DEFAULT_MAX_PER_PATH } from './lib/host/fs-journal.js'
import { surfaceEvents } from './lib/host/surface.js'
import { createEventFeed, DEFAULT_MAX_PER_SESSION } from './lib/host/feed.js'
// THE ROW. What it does: call a System One model at the configured points of the agent loop, and write the
// call -- request and response -- to a trace. What it must never do: change anything the loop decided.
//
// THE DECISION RUNTIME IS LOCAL SOURCE -- it lives under `lib/`, in the same commit as this file, rather
// than arriving as a fetched dependency. So a renamed or removed export is refused by ESM resolution BEFORE
// `apply`, and the argument shapes this file calls are held by the tests that execute `apply`. There is no
// interface version to compare: pinned across a repository boundary a version integer has a job, but here it
// could only ever fire when the person who broke the shape also volunteered to bump it.
import { readFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Schema from '@deepseek-ai/schemastery'
import { PROBE_SEAMS, TEXTLESS_SEAMS, seamCallsEnabled } from './lib/seams.js'
import { DEFAULT_TIMEOUT_MS } from './lib/model/wire.js'
import { probeFingerprint } from './lib/probe-score.js'
import { MAX_QUESTION_CHARS_DEFAULT, QUESTION_SCOPES, SESSION_HOOK, TURN_HOOK, buildQuestions, configuredQuestionIds, probeOf } from './lib/questions.js'
import { SUBJECT_KINDS, listStoredSessions, readStoredSubject, subjectSettings } from './lib/session-subject.js'
import { DEFAULT_SESSION_SET, listSets, readSelectedSet, setSettings } from './lib/question-sets.js'
import { readSessions, scopeNotLiveNote, sessionObserved } from './lib/sessions.js'
import { egressFacts } from './lib/egress.js'
import { attachRedactionRule } from './lib/telemetry.js'
import { TAIL_CHARS, minimisePaths, redactPolicy, sanitizeJson } from './lib/redact.js'
import { describeSubject, subjectOfAgent } from './lib/subject.js'
import { composeTurnState } from './lib/turn-state.js'
import { createEvaluateTool } from './lib/evaluate-tool.js'
import { createResultsTool } from './lib/results-tool.js'
import { labelHash } from './lib/label-hash.js'
import { createQuestionsTool } from './lib/questions-tool.js'
import { createBatteryTool } from './lib/battery-tool.js'
import { createSessionsTool } from './lib/sessions-tool.js'
import { createEvidence } from './lib/evidence.js'
// The idle gap's default is the module's own constant: a second copy of `60000` here is the kind of number that
// drifts from the one the cost line actually uses.
import { IDLE_GAP_MS } from './lib/cost.js'
import { MAX_LANES } from './lib/compare.js'
import { BINS } from './lib/calibrate.js'
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

/**
 * This package's own version, read from its manifest rather than restated -- a constant would drift from it.
 *
 * EXPORTED SO IT CAN BE TESTED, and that is not decoration. The first version of this function used `readFileSync`
 * without importing it, and its own `try/catch` turned the ReferenceError into `null` -- so every package recorded
 * `version: null` and nothing anywhere said why. A catch-all around a name that does not exist converts "this is
 * broken" into "this is empty", which is the failure class this repository keeps recording.
 */
export function packageVersion() {
  try {
    return JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version ?? null
  } catch {
    return null
  }
}

/** The harness version this row is running inside, when it can be resolved. Recorded on a package, never asserted. */
const DSH_VERSION = (() => {
  try {
    return JSON.parse(readFileSync(new URL('./node_modules/@deepseek-ai/dsh/package.json', import.meta.url), 'utf8')).version ?? null
  } catch {
    return null
  }
})()

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
    // VOLATILE, AND READ AT EVERY FIRING rather than at mount: a seam added or removed here takes effect on the
    // next event, with no restart and no lost in-memory state. Removing a seam does NOT unregister its listener --
    // the listener stays and hands the loop exactly what the loop produced -- so switching one back on resumes.
    .description(`Points of the loop to call, from: ${PROBE_SEAMS.join(', ')}. Read at every firing: a seam added or removed here takes effect on the next event, with no restart.`)
    .volatile(),
  provider: Schema.string().description('The system1 provider id, for example `typesafe` for Jev or `laya`. Read at each call, so a settings save reaches a running row.').volatile(),
  model: Schema.string().description('The model id to pass to that provider, for example `jev-latest`. Read at each call, so a settings save reaches a running row.').volatile(),
  // THE DECLARED DEFAULT, which the field never had: the row fell back to `?? 8000` and the model layer
  // defaulted to 5000, so an unset field meant one thing to the schema and another to the call.
  timeoutMs: Schema.number().min(0).default(DEFAULT_TIMEOUT_MS).description('Per-call bound in milliseconds. Read at each call, so a settings save reaches a running row.').volatile(),
  wireUrl: Schema.string().description('Base URL used only when the profile mounts no system1 service. Read at each call, so a settings save reaches a running row.').volatile(),
  // MOUNT-BOUND, AND NOT FOR STYLE. This text IS the instrument's identity (`probeFingerprint` hashes it) and the
  // hash is written on the MOUNT line, so a value that changed mid-run would leave calls scored under one question
  // and keyed under another -- the silent mixing the comparability key exists to prevent. A reworded question needs a
  // re-mount, and then the new hash makes the runs honestly incomparable.
  //
  // THE ANSWER SET IS NOT CONFIGURABLE, and the code says why: only the labels decide what an answer means, so the
  // criteria are fixed and a reworded question keeps all ten.
  // ---------------------------------------------------------------------------------------------
  // THE SECOND SUBJECT SOURCE: a STORED SESSION (§11 of docs/settings.md).
  //
  // The live modes judge what is happening; these four let a row judge a conversation that is over --
  // whole, or as a slice -- on demand. The events come from the harness's own session-query service and
  // go into the SAME composer, with `scope: 'session'`, so there is still one answer to "what is the
  // judge shown".
  // ---------------------------------------------------------------------------------------------
  subjectSource: Schema.union(['live', 'stored']).default('live').volatile().description('What the subject is: `live` is the session happening now, judged at seams and turn boundaries; `stored` is a session that is already over, read on demand, whole or as a slice.'),
  subjectSession: Schema.string().default('').volatile().description('Which stored session to read: a session id, or the word `newest`. Empty means none is selected, which is a named problem rather than a silent fallback.'),
  // THE DEFAULT IS ON: the effective slice of a row that configured nothing is both kinds, and a card showing nothing
  // selected while the row judges everything would be the interface lying about the measurement.
  subjectKinds: Schema.array(Schema.string()).default(['operator', 'assistant']).volatile().description('Which message kinds a stored judgement sees. The names map onto the event types the harness writes; a name that maps to nothing is refused by name.'),
  subjectLastMessages: Schema.number().min(0).default(0).volatile().description('How many of the stored session’s newest messages to judge. 0 is the whole session, which is the honest default for a feature whose point is judging a conversation as a whole.'),
  // ---------------------------------------------------------------------------------------------
  // QUESTION SETS AS FILES (§12): a questions map in a `.json` file, selected by name (the file's stem).
  //
  // VOLATILE, BY THE OPERATOR'S DECISION, and the cost is stated rather than hidden. A set decides WHICH QUESTIONS ARE
  // ASKED, so it is part of the instrument; the hash of the set IN FORCE AT MOUNT is on the mount line and in
  // `instrument`, so runs that mounted different sets are refused comparison. A save that swaps the set on a RUNNING
  // row therefore changes what is asked without changing that key -- which is exactly the behaviour `hooks` and
  // `seamEnabled` already have, both volatile and both part of the key from the mount snapshot. The honest reading is
  // that the mount line records what the run STARTED with, not that the run never changed.
  // ---------------------------------------------------------------------------------------------
  questionSetsDir: Schema.string().default('').volatile().description('Directory of question-set files: one `.json` per set, each a questions map keyed by seam. Read at each call, so a save reaches a running row -- and the mount line records the hash of the set that was in force when the row mounted.'),
  // THE HARNESS AXIS (ROADMAP 12.2) AND THE USER AXIS (12.1), declared rather than inferred. `harnessLabel` is the
  // technique in force -- the system prompt, the steering, the loop policy -- and `operatorLabel` is who is driving.
  // NEITHER enters `instrument` (`lib/compare.js`): they are GROUPING axes, so putting them in the comparability key
  // would refuse the two comparisons this device exists to make. Only their HASHES reach the trace
  // (`lib/label-hash.js`), never the text.
  harnessLabel: Schema.string().default('').volatile().description('A name for the harness technique in force: the system prompt, the steering, the loop policy. Free text, declared rather than inferred, because the plugin cannot tell a technique from the operator\'s own request. Its hash is recorded on each line so runs under different techniques can be told apart; it is NOT part of the comparability key, because comparing techniques is the point.'),
  operatorLabel: Schema.string().default('').volatile().description('A name for the person driving this row. Its hash is recorded on each line, never the text, so a reading can be grouped by who produced it. Not part of the comparability key: comparing users is a question this device exists to answer.'),

  questionSet: Schema.string().default('').volatile().description('Which set in `questionSetsDir` this row asks, by name (the file\u2019s stem). Empty means the inline `questions` object, which is what every row did before sets existed. Read at each call, so a set can be swapped on a running row.'),
  probeQuestion: Schema.string().description('The probe question asked at every seam that has no question of its own, for a domain that needs it put differently. YAML only, because it changes the instrument: the mount line records a hash of the text in force. The answer set is fixed -- reword the question, not the options.'),
  question: Schema.string().description('The question asked at every seam until a per-seam question is configured: `noul` built from this text, or the runtime probe question when empty. Read at each firing, so a settings save reaches a running row.').volatile(),
  // MOUNT-BOUND FOR A REASON, NOT BY OMISSION: the trace writer holds an open file handle and a rotation ledger, so a
  // live change would move where evidence lands mid-run. It could be made volatile with a reopen-and-rotate story;
  // that is a design change, not a flag.
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
    .description('Fire the scheduled turn measurement every Nth turn boundary. 0, the default, switches it off. The on/off is read at every boundary; the interval itself is read at mount. The count is the session turn number, not this process, so a settings save -- which re-applies the row -- cannot restart it.')
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
    // THE TURN HOOK IS NOT A PROBE SEAM, AND IT STILL NEEDS A KEY HERE. The nine seams take the probe question when
    // unconfigured; the SCHEDULED MEASUREMENT takes a set of its own, and `turnSpecs` reads it from
    // `config.questions[TURN_HOOK]`. Undeclared, `projectForm` drops it -- so a stored turn set vanishes the next time
    // any other field is saved, which is what this schema test's own comment warns about: "a seam missing here is a
    // seam whose stored questions vanish on the next save by any other field."
    //
    // `QUESTION_SCOPES` IS THAT LIST -- the nine seams, the aggregate, and the SESSION scope, exported by
    // lib/questions.js -- so this names one list rather than reconstructing it. The session scope is not a firing:
    // nothing fires at it, and `system1_evaluate_session` asks it on demand (§11). Measured: the plugin's only live measurement (22:13, turn 5)
    // asked twelve questions from criteria/helpfulness-set@2.json, and today the resolved config carries no turn key.
    Object.fromEntries(QUESTION_SCOPES.map(scope => [scope, Schema.array(Schema.any())])),
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
  // A SESSION-SCOPED ROW GOES INERT ACROSS A RESTART, and this is measured rather than supposed. The `sessions`
  // list named one session; the process restarted; that session was not resumed. The trigger then evaluated this
  // gate on 145 consecutive turn boundaries and skipped every one -- correctly, and uselessly. The id stays
  // configured while the session is gone, so nothing in the trace says "you pointed me at a session that is not
  // here"; it says `session not observed` 145 times, which reads like a scope working as intended.
  //
  // The default below is `['*']` -- EVERY session -- so the narrowing is always this list's doing, and an operator
  // who expects a scheduled measurement and sees none should check FIRST that the named session is live in the
  // current process. Measured: five attempts to drive that session were refused with "is not live in this process",
  // and the trace held 145 skip lines and zero call lines on the turn hook.
  sessions: Schema.array(Schema.any()).default(['*']).volatile().description('Observe only these sessions, matched by id or id prefix. `*` means EVERY session and is the default; an EMPTY list observes nothing. The “...” menu on a session in the sidebar is the way in, and it can also narrow to one session. An entry may be a bare id string or `{ id, title }` — the title is a display cache and is never matched on. A firing in any other session records a `skip` with reason `session not observed` and its text never reaches the model or the trace.'),
  includeNonOperatorFacing: Schema.boolean().volatile().description('Also call the model for the harness’s own purpose-tagged streaming calls, for example session titles and compaction. A stream the harness does not tag with a purpose, including a subagent’s, is observed either way. Off keeps the trace to what an operator would read.'),
  observeSubagents: Schema.boolean().volatile().description('Observe subagent sessions too. Off (the default) records a subagent’s streams and tool calls as `skip` lines with reason `subagent session`, and their text never reaches the model. On observes a subagent like any other agent.'),
  // HOW MUCH OF THE END A CUT ALWAYS KEEPS, in characters. Beside the cap because it only means anything with one:
  // the cap decides the budget, this decides how it is spent. Zero is head-only, and legitimate.
  tailChars: Schema.number().min(0).default(TAIL_CHARS).volatile().description('Characters of the END that a truncated value always keeps, so the newest part of a long field survives the cut. Zero keeps the head only. Read at each cut, so a save reaches a running row.'),
  maxFieldChars: Schema.number().min(1).volatile().description('Longest state field recorded in one trace line. Longer values are cut and the line is marked truncated.'),
  // THE SIZES THIS PLUGIN KEEPS ARE DEPLOYMENT CHOICES, NOT CONSTANTS. config.md:80-94 states the convention
  // and gives its test: can you change this in cordis.yml without editing code? These five could not, and each
  // was already a factory argument with a module default -- so the defaults below ARE the module constants, and
  // the conformance test asserts they stay equal. Plain rather than `.volatile()`: every one is read once at
  // mount, so declaring it writable from the settings card would offer an edit the running plugin ignores.
  // THE THREE CAPS ON HELD STATE, AND THEY *CAN* BE LIVE -- which is what checking rather than assuming established.
  // The note that stood here said a flag would not be enough and a re-creation path would be needed. It was wrong:
  // each cap is consulted on every record (the feed's per event, the journal's per touch), so making them volatile
  // needed the cap to be a FUNCTION, not a rebuild. One asymmetry is worth knowing -- lowering a cap trims on the
  // next record, and raising it cannot bring back what the old cap already dropped. Nothing claims otherwise.
  feedMaxPerSession: Schema.number().min(1).default(DEFAULT_MAX_PER_SESSION).volatile().description('Events kept per session in the in-memory feed, newest kept. Read at each event: a LOWERED cap trims on the next one, and a raised cap cannot bring back what the old one already dropped.'),
  fsJournalMaxPaths: Schema.number().min(1).default(DEFAULT_MAX_PATHS).description('Paths the filesystem journal remembers, least recently touched dropped first. Paths the filesystem journal remembers, least recently touched dropped first. Read at each observation: a LOWERED cap trims on the next one.').volatile(),
  fsJournalMaxPerPath: Schema.number().min(1).default(DEFAULT_MAX_PER_PATH).description('Versions remembered per path in the filesystem journal. Versions remembered per path in the filesystem journal. Read at each observation.').volatile(),
  composeMaxChars: Schema.number().min(1).default(8000).description('Longest composed state handed to the model at one seam, in characters; longer state is cut. Read at each turn, so a settings save reaches a running row.').volatile(),
  toolBlockMaxChars: Schema.number().min(1).default(4000).description('Longest tool-call window rendered into that state, in characters. Read at each turn, so a settings save reaches a running row.').volatile(),
  // THE RECORD'S OWN SWITCHES, all three volatile because all three must be live: a trace that had to be
  // restarted to stop leaking is a trace that leaks until somebody notices.
  redactEnabled: Schema.boolean().default(true).volatile().description('Redact the trace copy. ON by default, and it NEVER touches what the model is asked: `state` stays raw, because a model asked to classify `[REDACTED]` measures the scrubber. Off lets credential shapes through on purpose — truncation still applies, because a kill switch that also removed the size cap would be a foot-gun.'),
  // PATTERNS, NOT KEYS: a key names a FIELD, a pattern matches TEXT, and a deployment with an in-house token format
  // has the second problem. Addition-only, so this cannot switch off a shipped rule.
  redactPatterns: Schema.array(Schema.string()).default([]).volatile().description('Extra regular expressions, as source strings, applied to the record AFTER the shipped rules. A pattern that does not compile is dropped and its reason reported, never thrown. Additions only: the built-in rules cannot be turned off.'),
  // WHAT COUNTS AS A NUDGE. Three settings rather than none, because "the operator had to correct it" is the ground
  // truth the whole calibration is checked against -- and a deployment whose operators correct in another language,
  // or whose domain words are noise, has a real reason to say so.
  //
  // EVERY ONE OF THEM CHANGES A MEASUREMENT. Adding a marker makes more turns read as corrections; adding a stopword
  // removes a word from the content set, which makes the recurrence test looser; raising the threshold makes it
  // stricter. None of them can change what was already written, and all of them change what is written next.
  nudgeExtraMarkers: Schema.array(Schema.string()).default([]).volatile().description('Extra phrases that mean the previous answer did not do the job, matched case-insensitively. Additions only: the shipped markers cannot be removed. This changes the nudge MEASUREMENT, not only its wording.'),
  nudgeExtraStopwords: Schema.array(Schema.string()).default([]).volatile().description('Extra words to ignore when comparing two messages. Additions only. Adding one makes the recurrence test looser, because fewer words carry content. This changes the nudge MEASUREMENT.'),
  nudgeRecurrenceThreshold: Schema.number().min(0).max(1).default(0.5).volatile().description('How much of the request must come back, in different words, before a turn counts as a nudge. 0.5 is the shipped value. Raising it makes the test stricter; this changes the nudge MEASUREMENT.'),
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
  // THE DEFAULT IS DECLARED BECAUSE THE CODE HAS ONE: `index.js` reads this as `=== true`, so absent means off.
  // A field whose effective default lives only in a reader is a field whose schema is not the whole truth -- which is
  // what the card/schema check found, one step after O14.
  redactSessionTelemetry: Schema.boolean().default(false).volatile().description('Scrub the harness’s own outbound session-telemetry records, which otherwise leave the process unredacted. Unrelated to this plugin’s own JSONL trace, which is local and redacts its copy. Off by default: a plugin whose contract is “it decides nothing” must not silently rewrite a user’s telemetry the moment it mounts.'),
  maxQuestionChars: Schema.number().default(MAX_QUESTION_CHARS_DEFAULT).volatile().description('Longest the configured question text may serialize to, at one firing. Over it, the seam asks NOTHING and records the reason as a `problem` — refused rather than truncated, because the answer map is keyed by question and a shortened question returns answers that cannot be matched to what was asked. Defaults to ' + MAX_QUESTION_CHARS_DEFAULT + ', which is room for both the agent and the operator dimensions in one set.'),
  pricePerMTokInput: Schema.number().default(0.042).volatile().description('USD per million input tokens for the COST OF THE JUDGEMENT only. The subject model’s tokens are never captured, so a session cost is not computable from this trace. Output tokens are free on this model; the input term is the whole cost. Defaults to the rate transcribed 2026-09-28.'),
  // HOW MANY RUNS A COMPARISON MAY SHOW. A reading decision, not a rendering detail: the comparison places runs
  // side by side, and past a handful the columns stop being readable.
  // HOW FINELY THE PROBABILITY SCALE IS SLICED for the calibration report. It changes the number the report shows,
  // which is the whole test for whether something is a setting.
  calibrationBins: Schema.number().min(2).default(BINS).volatile().description('How many equal-width bins the calibration report slices the probability scale into. Read at each report, so a save re-slices without a restart.'),
  maxCompareLanes: Schema.number().min(1).default(MAX_LANES).volatile().description('How many runs a comparison may show side by side. Read at each report, so a save reaches a running row.'),
  idleGapMs: Schema.number().min(0).default(IDLE_GAP_MS).volatile().description('Milliseconds within which two judge calls count as ONE active stretch on the cost line. It decides what `activeMs` means, and a deployment whose turns are shorter than the default would rather count them apart. Read at each report, so a save re-prices without a restart.'),
  maxTraceBytes: Schema.number().default(33554432).volatile().description('Rotate the trace when the next line would cross this many bytes. 0 disables rotation. Rotation renames the full file aside as `<name>.<run>.<n>.jsonl` and starts a fresh one at the same path, so every reader keeps following the live file; each rotation writes a `rotate` line naming both, and the count is on the mount line.'),
})

async function apply(ctx, config) {
  const here = dirname(fileURLToPath(import.meta.url))
  // THE MOUNT-BOUND FIELDS, READ ONCE. `hooks` decides which listeners exist, and a transport binds
  // when its client is built, so neither can change under a running row; unwrapping them once is
  // correct. The VOLATILE fields are deliberately NOT taken from here -- see `readConfig` below.
  const mount = plainConfig(config)
  // THE LIVE EVENT FEED: the holder for what the harness commits. It is read by `readEvents` below and is empty
  // until something fills it, which is the next commit -- an empty feed is exactly the previous behaviour.
  // THE ANNOUNCED TURN BOUNDARY, held per session. Declared HERE because the observer below is
  // constructed before the listener that fills it, and `readClaimed` closes over this binding.
  const claimed = new Map()
  const feed = createEventFeed({ maxPerSession: () => readConfigValue(liveConfig().feedMaxPerSession) })
  const fsJournal = createFsJournal({
    maxPaths: () => readConfigValue(liveConfig().fsJournalMaxPaths),
    maxPerPath: () => readConfigValue(liveConfig().fsJournalMaxPerPath),
  })
  // THE SESSION'S OWN EVENTS, as one function, so the fallback and the comparison cannot drift apart. It is the
  // only thing here that needs a LIVE session -- which is why the feed exists, and why this is the function to
  // delete when the adapter reads sessionQuery instead.
  const sessionEvents = (sessionId) => {
    try {
      const agents = typeof ctx.get === 'function' ? ctx.get('agents') : undefined
      const direct = agents !== undefined && typeof agents.get === 'function' ? agents.get(sessionId) : undefined
      const agent = direct ?? (agents !== undefined && typeof agents.list === 'function' ? agents.list().find((one) => one?.id === sessionId) : undefined)
      const session = agent !== undefined && agent !== null ? agent.session : undefined
      return session !== undefined && typeof session.snapshotEvents === 'function' ? session.snapshotEvents(0) : []
    } catch {
      return []
    }
  }

  // WHAT AN EVENT SAYS, which is what the judge reads. Two events can share a seq and a type and still describe
  // different turns -- the harness feed and the live session are the SAME events only if their text matches.
  // Comparing seq and type alone reported agreement for two different conversations: a detector that cannot
  // detect the thing it exists for, found by the test that asserts the line says DISAGREE.
  const textOfEvent = (event) => {
    const content = event?.data?.message?.content
    if (!Array.isArray(content)) return ''
    return content.map((block) => (typeof block?.text === 'string' ? block.text : '')).join('\u0000')
  }
  const hooks = readHooks(mount)

  /** The selected set's content hash, or the empty string when the row asks its inline questions. */
  const setHashOf = (config) => {
    const settings = setSettings(config)
    return readSelectedSet(settings.dir, settings.name).hash
  }                        // a typo refuses the mount, naming the seam

  // AND THE LIVE READ OF THE SAME THING, for the service's `config()`. `readHooks` THROWS on an unknown seam -- which
  // is right at mount, where a typo must refuse the row, and wrong here, where a consumer reading a description must
  // not take the row down. The mount's own hooks are the honest fallback.
  const hooksNow = () => {
    try { return readHooks(liveConfig()) } catch { return hooks }
  }
  // THE POLICY IS A GETTER because it is live config, read per line; the path is captured because the test suite
  // depends on that ordering. See `lib/evidence.js`.
  const liveConfig = () => plainConfig(config)
  const evidence = createEvidence({
    defaultPath: resolveTracePath(mount, here),
    envVar: 'SYSTEM1_OBSERVER_TRACE',
    policy: liveConfig,
    maxBytes: () => readConfigValue(liveConfig().maxTraceBytes),
  })
  // THE TRANSPORT IS BUILT FROM THE LIVE CONFIG, NOT FROM THE MOUNT SNAPSHOT. `provider`, `model` and `timeoutMs`
  // are volatile, so a settings save has to be able to reach a RUNNING row: a client captured here would keep the
  // values the row mounted with, the save would be reported as "Saved", and the next call would use the old ones.
  // A client is a closure, so building one per call costs an allocation and holds no state.
  const transport = { kind: 'wire', provider: mount.provider ?? null, model: mount.model ?? null }
  const wire = () => createModel({
    baseUrl: readConfigValue(liveConfig().wireUrl) || 'http://127.0.0.1:8766',
    timeoutMs: readConfigValue(liveConfig().timeoutMs) ?? DEFAULT_TIMEOUT_MS,
  })
  // BOTH FACTORIES RETURN A CLIENT `{decide, health}`, NOT A FUNCTION. This indirection is what keeps one call
  // site working across the two transports; assigning the client itself to `decide` made every call throw
  // "decide is not a function", which no unit test saw because `apply` was never executed.
  let decide = (request, options) => wire().decide({ ...request, ...(options?.signal === undefined ? {} : { signal: options.signal }) })

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
      // THE SCOPE THIS RUN STARTED WITH CANNOT FIRE, WHICH THE MOUNT LINE SHOULD SAY. It already carries the
      // scope, deliberately -- "was it scoped, paused, or broken?" is the first question of a quiet trace -- but
      // a scope naming a session that is not live in this process answers that question WRONGLY: it reads as
      // scoped-and-working, and it took 145 identical skips to tell.
      const scopeNote = configuredScopeNotLive()
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
        ...(scopeNote === null ? {} : { scopeNote }),
        // THE INSTRUMENT'S IDENTITY. The probe's question text was authored by intuition, so a run with edited
        // instructions is a NEW MEASUREMENT and not a comparison. Without this, two runs are silently averaged
        // as though one instrument produced both.
        // THE HASH IS OVER THE QUESTION ACTUALLY IN FORCE, so a row that rewords the probe records a different
        // instrument and no reader has to be told: `instrument` in `lib/compare.js` then refuses to compare its runs
        // with a row that asked the built-in question. That is the constraint working rather than a warning.
        probeHash: probeFingerprint(probeOf(mount).instructions),
        // THE DECLARED AXES, as the run STARTED (the same snapshot rule `hooks` follows). Omitted when nothing is
        // declared, so an unlabelled run says so by absence rather than by a hash of the empty string.
        ...(labelHash(mount.harnessLabel) === '' ? {} : { harnessHash: labelHash(mount.harnessLabel) }),
        ...(labelHash(mount.operatorLabel) === '' ? {} : { userHash: labelHash(mount.operatorLabel) }),
        // WHICH SET WAS IN FORCE, hashed from its bytes: `instrument` includes it, so editing one character of a set
        // makes its runs incomparable rather than silently averaged -- the same mechanism as `probeHash`.
        questionSetHash: setHashOf(mount),
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

  // THE HARNESS'S SESSION STORE, IF THIS PROFILE MOUNTS IT. Optional on purpose: a deployment without it simply has
  // no stored sessions to read, which is a NAMED problem from the adapter rather than a mount failure.
  let sessionQuery
  ctx.inject(['sessionQuery'], (child) => {
    sessionQuery = child.sessionQuery ?? (typeof child.get === 'function' ? child.get('sessionQuery') : undefined)
  })

  // ONE COMPOSER, TWO TOOLS. `system1_evaluate_session` judges a session and `system1_sessions` SHOWS what
  // would be judged; if each built its own state the two could drift, and the tool that exists to preview a
  // judgement would be previewing something else. Hoisted rather than duplicated for exactly that reason.
  // `maxChars` IS AN OVERRIDE FOR SEGMENTED CALLS, and it is not optional plumbing. A segmented evaluation composes
  // EACH SEGMENT, and the row's `composeMaxChars` is a WHOLE-SESSION parameter: measured, five segments of the freeciv
  // session each composed to 49k-70k characters, and the row's 8,000 cap cut every one of them to exactly 8,000 --
  // so segmenting would have bought nothing at all while looking like it had. A segment passes the state budget
  // instead, which is the number the segmentation was measured against.
  const composeSubject = (events, maxChars) => composeTurnState({
        events,
        scope: 'session',
        maxChars: maxChars ?? readConfigValue(liveConfig().composeMaxChars),
        toolMaxChars: readConfigValue(liveConfig().toolBlockMaxChars),
        tailChars: readConfigValue(liveConfig().tailChars),
      })

  ctx.inject(['tools'], (child) => {
    const tools = child.get('tools')
    if (tools === undefined || typeof tools.register !== 'function') return
    tools.register(createTraceTool({
      path: evidence.path,
      runId: evidence.runId(),
      liveAgents: liveAgentRoutes,
      price: () => readConfigValue(liveConfig().pricePerMTokInput),
      // THE IDLE GAP AND THE LANE LIMIT, read live for the same reason the rate is: each decides what a number in
      // the report MEANS. Both were, until these lines existed, DECLARED AND UNREAD: in the schema, marked
      // volatile, reported by the agent config tool, and passed by nothing -- so the host accepted a write that
      // changed no reading. test/schema.test.js now fails on any volatile field nothing reads.
      idleGap: () => readConfigValue(liveConfig().idleGapMs),
      compareLanes: () => readConfigValue(liveConfig().maxCompareLanes),
      calibrationBins: () => readConfigValue(liveConfig().calibrationBins),
      probe: () => probeOf(liveConfig()).instructions,
    }))
      // SYSTEM1_RESULTS: the trace read as MEASUREMENTS rather than as a chronology (ROADMAP 13.3 item 1). It
      // shares the trace tool's path, and it exists because the question an agent asks before changing a setting
      // is "what do I have" -- whose honest answer is usually about n, about silence, and about what could not be
      // attributed, rather than about answers.
      tools.register(createResultsTool({
        path: evidence.path,
        runId: evidence.runId(),
        // THE PACKAGE RECORDS WHAT PRODUCED IT, so a report read a year later can say which build wrote it -- and the
        // version comes from the manifest rather than a constant that would drift from it.
        version: packageVersion(),
        meta: { dsh: DSH_VERSION },
      }))
      // SYSTEM1_QUESTIONS: the composing half of the loop (ROADMAP 13.3 item 2). It validates with the SAME
      // loader the row uses before it writes anything, refuses to overwrite a published scope without an explicit
      // `replace`, and answers with the composition hash read back from disk -- so an agent can say which
      // instrument it just created rather than which one it intended to.
      tools.register(createQuestionsTool({
        dir: () => setSettings(liveConfig()).dir,
      }))
      // SYSTEM1_SESSIONS: the agent-facing half of the session story. DSH gives an agent live peers and a plugin
      // the whole corpus; nothing let an agent NAME a stored session, which is why every historical read here was a
      // shell script. `list` finds one, `read` shows its content sliced exactly as an evaluation would slice it.
      // SYSTEM1_BATTERY: the gate that tells a BETTER question from a DIFFERENT one (ROADMAP 13.5). Batteries live
      // BESIDE the sets they judge, in the same directory, because a battery is written against a set and the design
      // records its path on the set's own record -- and `listSets` excludes the battery files so the picker cannot
      // offer one as a set nobody wrote. It spends model calls, so it refuses before it spends, and it writes an
      // `experiment` line rather than a reading: an accuracy on five fabricated cases must not sit in a table of
      // judgements about somebody's real conversation.
      tools.register(createBatteryTool({
        dir: () => setSettings(liveConfig()).dir,
        setsDir: () => setSettings(liveConfig()).dir,
        decide: (request, options) => decide(request, options),
        record: (line) => {
          const { event, ...fields } = line
          evidence.trace(event, fields)
        },
        toolId: 'system1-observer',
      }))
      tools.register(createSessionsTool({
        query: () => sessionQuery,
        settings: () => subjectSettings(liveConfig()),
        compose: composeSubject,
      }))
    // THE REPOSITORY'S OWN DECISION TOOL, over the SAME `decide` the observer uses. The closure is deliberate:
    // `decide` is assigned by the transports below, which may arrive after this callback runs, so the tool reads
    // it at call time. Reaching for a model here would freeze whichever transport happened to be ready first and
    // would let the tool and the instrument drift apart -- the exact failure the thin-tool design exists to
    // prevent. `mount` supplies the defaults the row was configured with, so the tool's own description names the
    // backend it will actually reach.
    tools.register(createDecideTool({
      decide: (request, options) => decide(request, options),
      provider: mount.provider ?? null,
      model: mount.model ?? null,
      // The line goes to the same sink as every other one, so a reader finds it where it already looks.
      record: (line) => {
        const { event, ...fields } = line
        evidence.trace(event, fields)
      },
    }))
    // THE WHOLE-CONVERSATION TOOL (§11). The seams judge a turn as it happens; this judges a session -- live, or one
    // that is already over -- whole or as a slice, and records its call under a hook that is deliberately NOT a probe
    // site, so a whole-session opinion never enters the probe calibration.
    tools.register(createEvaluateTool({
      settings: () => subjectSettings(liveConfig()),
      // THE PACKAGE WRITER, over the SAME helpers the measurements tool registers -- one home for what a package is,
      // reached from two tools. `run: 'current'` because the evaluation that just happened IS this run's latest
      // reading, and the trace has already been written by the time this runs.
      packageRun: () => createResultsTool({ path: evidence.path, runId: evidence.runId(), version: packageVersion(), meta: { dsh: DSH_VERSION } })
        .execute({ action: 'package', run: 'current' })
        .then((value) => (value.package === undefined ? { problem: 'the package writer returned nothing' } : value.package)),
      // READ AT CALL TIME: `sessionQuery` is captured by a `ctx.inject` callback that may run after this block.
      stored: async (options) => {
        const asked = Object.assign({ sessionQuery: sessionQuery }, options)
        // `newest` IS RESOLVED AGAINST THE SERVICE, because this tool's own parameter description promised it and the
        // store answered `session "newest" not found`: a tool must not advertise a value and then reject it. The
        // newest is by `header.createdAt`, and the id handed on is the service's own logical id, not a directory name.
        if (options !== undefined && options.sessionId === 'newest') {
          let chosen
          try {
            const records = await sessionQuery.listSessions()
            chosen = (records ?? []).slice().sort((a, b) => (b?.header?.createdAt ?? 0) - (a?.header?.createdAt ?? 0))[0]?.header?.id
          } catch {
            chosen = undefined
          }
          if (chosen === undefined) {
            return { events: [], slice: { matched: 0, total: 0, unknownKinds: [] }, session: null, problem: 'no stored session is available to resolve `newest` against' }
          }
          asked.sessionId = chosen
        }
        return readStoredSubject(asked)
      },
      liveEvents: async () => {
        // `agents` IS NOT IN SCOPE HERE, measured: this closure threw a ReferenceError on the first live call and the
        // tool reported it. The four sibling sites (316, 762, 842, 873) each resolve the service from `ctx` inside
        // their own scope; this one assumed the name was already bound.
        const agents = typeof ctx.get === 'function' ? ctx.get('agents') : undefined
        const initiator = agents !== undefined && typeof agents.currentInitiator === 'function' ? agents.currentInitiator() : undefined
        const session = initiator?.session
        return session !== undefined && typeof session.snapshotEvents === 'function' ? session.snapshotEvents(0) : []
      },
      // THE ONE COMPOSER, WITH ITS SESSION SCOPE: a conversation has no reaction, so it is a transcript rather than an
      // exchange, and it is cut keeping both ends because a transcript's newest turns are the point.
      compose: composeSubject,
      // THE AGGREGATE QUESTION SET, through the reader the mount line uses: with nothing configured this falls back to
      // the probe question exactly as the live path does, so a tool does not invent its own convention.
      questions: (asked = {}) => {
        // A SET NAMED IN THE CALL WINS, and it is REUSED through `buildQuestions` rather than re-loaded here: that is
        // where a selected set replaces the row's questions and where a malformed spec is refused, so a second path
        // through the loader would be a second set of rules for what a question is.
        //
        // WHY IT EXISTS AT ALL: measured on a live session whose agent was asked to measure with the OPERATOR set. It
        // had to read the settings, change the live row, run, and change the row back -- because the tool could only
        // ever ask whatever set the row happened to name, and `questions()` took no arguments (register row F65).
        const named = typeof asked.set === 'string' && asked.set.trim() !== '' ? asked.set.trim() : null
        if (named !== null) {
          const scope = typeof asked.scope === 'string' && asked.scope.trim() !== '' ? asked.scope.trim() : SESSION_HOOK
          const built = buildQuestions(Object.assign({}, liveConfig(), { questionSet: named, seamEnabled: { [scope]: true } }), scope)
          if ((built.problems ?? []).length > 0) return built
          if (Object.keys(built.questions ?? {}).length > 0) return built
          return { questions: {}, problems: ['the set "' + named + '" declares no "' + scope + '" scope, so a judgement at it would have nothing to answer -- it declares: ' + 'none' ] }
        }
        // THE ROW'S OWN CONFIG, NOT A HAND-BUILT ONE. `buildQuestions` is where a selected set REPLACES the row's
        // questions (lib/questions.js:152-157), and it can only do that if it is handed the config that NAMES the
        // set. What stood here passed `{seamEnabled, questions:{session: specs}}` built from the inline map alone,
        // so `questionSet` was invisible at this call site and the tool asked the probe question instead -- measured
        // on a live call whose trace line reads `"questionIds":["probe"]` while the row selected
        // `agent-helpfulness-session@1`, whose whole point is the three `session` questions it declares.
        const config = liveConfig()
        // A SESSION HAS ITS OWN SCOPE. Before this it asked the TURN questions, which is the gap the three-scope
        // taxonomy exposed: a conversation judged with questions written about one exchange.
        const atSession = buildQuestions(Object.assign({}, config, { seamEnabled: { [SESSION_HOOK]: true } }), SESSION_HOOK)
        if ((atSession.problems ?? []).length > 0) return atSession
        if (Object.keys(atSession.questions ?? {}).length > 0) return atSession
        // THE FALLBACK IS DELIBERATE AND PRESERVES BEHAVIOUR -- and it is applied to the EFFECTIVE questions rather
        // than to the inline map, so a row with no session questions keeps asking the aggregate set it already
        // asked, whether those turn questions were written inline or come from a selected set.
        const atTurn = buildQuestions(Object.assign({}, config, { seamEnabled: { [TURN_HOOK]: true } }), TURN_HOOK)
        if ((atTurn.problems ?? []).length > 0) return atTurn
        if (Object.keys(atTurn.questions ?? {}).length > 0) return atTurn
        // ASKING NOTHING IS NOT AN ANSWER. An empty map would send the model a whole conversation with no question
        // attached, and the call would be paid for and record nothing. A set that declares neither scope says
        // nothing about sessions, so the refusal travels as the problem the tool already throws on.
        // AND THE LAST RESORT IS THE PLUGIN'S OWN DEFAULT, so a row that names nothing at all still measures -- and
        // measures BOTH dimensions. The two rungs above are unchanged and deliberate: a row's session questions, then
        // the aggregate set it already asked. This rung is what removes the row from the list of things a measurement
        // NEEDS. Three rungs, in order: the caller's `set`, the row's config, the plugin's `session@1`.
        const bundled = buildQuestions(Object.assign({}, config, { questionSet: DEFAULT_SESSION_SET, seamEnabled: { [SESSION_HOOK]: true } }), SESSION_HOOK)
        if ((bundled.problems ?? []).length === 0 && Object.keys(bundled.questions ?? {}).length > 0) return bundled
        return {
          questions: {},
          problems: [
            ...(bundled.problems ?? []),
            'the questions in force ask nothing at the `session` scope and nothing at `turn`, and the plugin\'s own default set `' + DEFAULT_SESSION_SET + '` could not be read either, so a session judgement would have nothing to answer',
          ],
        }
      },
      decide: (request, options) => decide(request, options),
      record: (line) => {
        const { event, ...fields } = line
        evidence.trace(event, fields)
      },
      toolId: 'system1-observer',
    }))


    // THE SETTINGS TOOL. `record` writes a config line BEFORE the change -- that ordering is the tool's contract,
    // and `evidence.trace` is the same sink every other line goes to, so a reader finds it where it looks.
    // `write` goes through the harness's configEditor rather than editing the profile file, and NO knob list is
    // passed: the editor validates and reconciles a plugin's next config itself, so an unknown field is refused
    // by the thing that owns the schema instead of by a copy of it that would drift.
    tools.register(createConfigTool({
      read: () => plainConfig(liveConfig()),
      // THE SCHEMA ITSELF, as a function: the tool digests it into per-setting type/bounds/writability for `list`
      // and checks `set` against it. Passed rather than imported so the tool stays testable without the plugin,
      // and read per call so a field added here appears there without a second list to maintain.
      schema: () => Config.dict,
      // THE SETS A MODEL CAN CHOOSE FROM, listed live: a model should not have to guess a filename, and a broken
      // file must be visible as a named problem rather than as an absent option.
      sets: () => listSets(setSettings(liveConfig()).dir),
      record: (line) => {
        const { event, ...fields } = line
        evidence.trace(event, fields)
      },
      // AND THE RECORD OF A MOVE WOULD LAND IN THE SINK BEING LEFT, which the plan's section 4 wanted. It still holds
      // by MECHANISM -- `evidence` is built at MOUNT with `resolveTracePath(mount, here)`, and the live reads above
      // are for `maxTraceBytes`, price and the knobs, not the path -- but the ROUTE is now closed: `tracePath` is the
      // one mount-bound field, so the tool refuses a `set` on it before recording anything. That was the correction:
      // the old route failed at the editor (`not volatile`) after the line had already been written, leaving a record
      // of a move that never landed. It becomes reachable again only if `tracePath` does -- `docs/settings.md` §4
      // item 9, a reopen-and-rotate story.
      write: async (change) => {
        if (configEditor === null) {
          throw new Error('system1_settings: the configEditor service is not available in this profile, so no change can be persisted.')
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
    // THE NUDGE VOCABULARY, read live: it decides what the derived label MEANS, and the label is the ground
    // truth every calibration in the report is measured against.
    vocabulary: () => ({
      markers: readConfigValue(liveConfig().nudgeExtraMarkers),
      stopwords: readConfigValue(liveConfig().nudgeExtraStopwords),
    }),
    // AND THE THRESHOLD, SIBLING TO THE VOCABULARY AND NOT INSIDE IT. It was inside it for one commit, where it was
    // dead code that the read-ratchet counted anyway -- the ratchet scans for a read, and a read in an object nobody
    // calls still looks like one. `test/service.test.js` holds the behavioural half.
    threshold: () => readConfigValue(liveConfig().nudgeRecurrenceThreshold),
    read: (options) => readTraceWindow(evidence.path, options?.maxBytes),
    runs: () => runIds(readTraceWindow(evidence.path).events),
    sessions: () => ({ live: liveAgentRoutes(), configured: mount.sessions ?? null }),
    /**
     * THE SUBJECT SETTINGS IN FORCE, read live -- the inputs to a stored-session evaluation (§11). Read-only like
     * everything else here: the EVALUATION is a call to a model, and that belongs to a tool rather than to a view.
     */
    subject: () => subjectSettings(liveConfig()),
    /** The stored sessions a row may choose from, from the harness's own service. Named problems, never throws. */
    storedSessions: () => listStoredSessions(sessionQuery),
    /** The sets this row can see, for a plugin that wants to list or offer them. */
    questionSets: () => listSets(setSettings(liveConfig()).dir),
    config: () => ({
      // ALL LIVE, INCLUDING THE THREE THAT WERE NOT. `hooks` came from `readHooks(mount)` and `provider`/`model`
      // straight off the snapshot, while every sibling field in this same object read the running config -- so the
      // one view a consumer uses to describe the row told it what the row mounted with, forever. A settings save
      // changed the calls and not the description of them, which is the failure this whole register is about.
      //
      // THE MOUNT SNAPSHOT IS STILL THE HISTORICAL RECORD, and it is not lost: it is written on the mount line, which
      // is where "what did this run mount with" belongs. `config()` answers the other question -- what is it doing
      // NOW -- which is why it must not borrow from it.
      hooks: hooksNow(),
      // WHICH QUESTIONS, WHICH IS WHAT `config()` IS FOR. The first version reported hooks, provider and model and
      // left this out, so a consumer could see that calls were recorded but not WHAT was asked -- and a count of
      // answers is not interpretable without the questions they answer. Read through the same reader the mount line
      // uses, so the two cannot disagree about what the row is configured to ask.
      questionIds: configuredQuestionIds(liveConfig()),
      provider: readConfigValue(liveConfig().provider) ?? null,
      model: readConfigValue(liveConfig().model) ?? null,
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
    // BUILT PER CALL, for the same reason as the wire client: `provider` and `model` are volatile, and a client
    // captured here would keep the values this row mounted with.
    const viaService = () => createServiceModel({
      service,
      provider: readConfigValue(liveConfig().provider) ?? undefined,
      model: readConfigValue(liveConfig().model) ?? undefined,
    })
    // THE SERVICE PATH CANNOT CARRY A SIGNAL. `dsh-system1`'s `decide(request)` is another plugin's API and takes no
    // signal, so a call made through the service cannot be aborted in flight -- the tool's entry check is what a
    // cancelled call gets, and saying so is better than pretending the transport is uniform.
    decide = (request) => viaService().decide(request)
    transport.kind = 'service'
    writeMount()
  })

  // THE VOLATILE FIELDS ARE READ FRESH ON EVERY CALL. `plainConfig` unwraps each `Volatile` with
  // `.get()` at this moment, which is what lets a saved setting reach a RUNNING row: the harness does
  // not re-apply the plugin -- instance identity is unchanged by design -- so a value captured in
  // `apply` would never move. Reading that captured object instead made every settings save a no-op
  // that the card still reported as "Saved."
  // THE VOLATILE FIELDS COME FROM THE SPREAD, `provider` AND `model` INCLUDED. They used to be overridden with the
  // mount snapshot here, because they were not volatile and the spread would have supplied `undefined`; with them
  // volatile the override is what would freeze them, so it is gone.
  const readConfig = () => ({
    ...plainConfig(config),
    transport: transport.kind,
  })
  // THE HOOK SET, READ AT EACH FIRING. Tolerant where `readHooks` is strict: a typo is a mount error (that call
  // throws at load), but a value edited while running must not be able to break the loop, and a hook nobody
  // configured is a hook that does not fire -- so a malformed live value falls back to the defaults.
  const liveHooks = () => {
    try { return readHooks(liveConfig()) } catch { return readHooks({}) }
  }
  const observer = createObserver({ decide: (request, options) => decide(request, options), trace: evidence.trace, readConfig })

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
  // A TRACE PATH NOBODY CAN WRITE IS A CONFIGURATION ERROR, NOT A RUNTIME HICCUP (delta 3). The per-line writes
  // stay best-effort so a full disk cannot fail a turn; this probe is what keeps "records nothing while looking
  // healthy" from being a supported outcome.
  try {
    evidence.probe()
  } catch (error) {
    throw new Error(`cannot write the trace to ${evidence.path}: ${error?.message ?? String(error)}`)
  }

  const turnObserver = createTurnObserver({
    // THE TWO SIZES ARE RESOLVED AT EACH TURN, and passed as functions for that reason: they are volatile now, so a
    // value captured here would keep whatever the row mounted with and the save would change nothing. The observer
    // still accepts a plain number, which is what its own tests pass.
    maxChars: () => readConfigValue(liveConfig().composeMaxChars),
    toolMaxChars: () => readConfigValue(liveConfig().toolBlockMaxChars),
    listener: createTurnListener({
      everyNTurns,
      isEnabled: () => Number(readConfigValue(liveConfig().turnEveryNTurns) ?? 0) > 0,
      readConfig: () => liveConfig(),
    }),
    // The session's events, obtained the way the peer bridge does: the agents service by session id, then the
    // agent's own session. A missing service or session yields no events, which `composeTurnState` refuses on.
    // WHAT THE HARNESS ANNOUNCED AS THE TURN'S OPENING MESSAGE. Held by the `agent/inbox/claimed` recorder below;
    // null when nothing was announced, which leaves the composer's own inference in charge.
    readClaimed: (sessionId) => claimed.get(sessionId) ?? null,
    readSurfaceSeqs: (sessionId) => {
      try {
        const agents = typeof ctx.get === 'function' ? ctx.get('agents') : undefined
        const agent = agents !== undefined && typeof agents.get === 'function' ? agents.get(sessionId) : undefined
        const nodes = agent?.session?.surface?.nodes
        const hostSeqs = Array.isArray(nodes) ? [...nodes] : null

        // THE ORACLE, AND THE COMPARISON IT EXISTS FOR. `sessionQuery.readSurface` answers the same question the fold
        // answers -- which seqs survive -- and this line records whether the two AGREE. It is the surface's twin of
        // `feed-compare`, and it is here because this is the only place both answers are reachable: the fold from the
        // events, the oracle from the service.
        //
        // DETACHED, because the service read is asynchronous and this function is not: the host's seqs are returned
        // unchanged, and the line is written when the answer arrives. A trace line does not need to hold a turn.
        //
        // OPTIONAL ACCESS, per the plan: a deployment without `sessionQuery` keeps exactly the behaviour it had.
        const query = typeof ctx.get === 'function' ? ctx.get('sessionQuery') : undefined
        if (query !== undefined && query !== null && typeof query.readSurface === 'function') {
          const foldedSeqs = surfaceEvents(sessionEvents(sessionId)).map((event) => (typeof event?.seq === 'number' ? event.seq : null))
          Promise.resolve(query.readSurface(sessionId))
            .then((surface) => {
              // `SessionSurfaceSnapshot = { session, inheritedEventCount, capturedThroughSeq, events: SurfaceEvent[] }`
              // -- the sequence numbers are on the EVENTS, not in a `nodes` list. My first version read `nodes`, got
              // null, and recorded `agree: false`: an instrument announcing a disagreement it had not measured.
              const oracleEvents = Array.isArray(surface?.events) ? surface.events : null
              const oracleSeqs = oracleEvents === null ? null : oracleEvents.map((event) => (typeof event?.seq === 'number' ? event.seq : null))
              const comparable = oracleSeqs !== null
              evidence.trace('surface-compare', {
                agentId: sessionId ?? null,
                // NULL, NOT FALSE, when there was nothing to compare against.
                agree: comparable ? oracleSeqs.length === foldedSeqs.length && oracleSeqs.every((seq, index) => seq === foldedSeqs[index]) : null,
                comparable,
                hostSeqs,
                foldedSeqs,
                oracleSeqs,
              })
            })
            .catch(() => {
              // A comparison that cannot be made is not a comparison that agreed: recording nothing is the honest
              // outcome, and that is why this is a `.catch` rather than a `try`.
            })
        }
        return hostSeqs
      } catch {
        return null
      }
    },
    readEvents: (sessionId) => {
    // THE FEED FIRST, THEN THE SESSION. An empty feed falls through to exactly the behaviour that was here before.
    const held = feed.events(sessionId)
    // AND THE TWO SOURCES ARE COMPARED ONCE PER JUDGED TURN. When both have something to say, one line records
    // whether they AGREE -- same order, same seqs, same types, and the SAME TEXT. The text is the criterion that
    // matters: seq and type are bookkeeping, and agreeing on them while disagreeing on content is exactly the
    // regression this line exists to catch. Silent when only one source has content, because comparing one thing
    // with nothing is noise -- and on an empty feed that is every turn.
    const snapshot = sessionEvents(sessionId)
    if (held.length > 0 && snapshot.length > 0) {
      // THE FEED IS A SUFFIX OF THE SESSION, NOT A COPY OF IT. Live measurement, first run: the feed held 57 events,
      // the session held 452, and both ended on seqs 446-451. Comparing LENGTHS therefore reported `agree: false`
      // on every measurement -- an instrument that cannot tell "these disagree" from "one of them is shorter".
      // The overlap is the only part both sources claim to describe, so that is what is compared.
      const firstSeq = held[0]?.seq
      const overlap = typeof firstSeq === 'number' ? snapshot.filter((event) => (event?.seq ?? -1) >= firstSeq) : []
      const agree = overlap.length === held.length
        && held.every((event, index) => event?.seq === overlap[index]?.seq
          && event?.type === overlap[index]?.type
          && textOfEvent(event) === textOfEvent(overlap[index]))
      evidence.trace('feed-compare', {
        agentId: sessionId ?? null,
        agree,
        feedEvents: held.length,
        sessionEvents: snapshot.length,
        overlapEvents: overlap.length,
        // `agree` is about the overlap; this says whether the feed was even the same size, so a short feed cannot
        // masquerade as a disagreement or hide one.
        feedIsSubset: overlap.length === held.length,
        feedSeqs: held.map((event) => event?.seq ?? null).slice(-6),
        sessionSeqs: snapshot.map((event) => event?.seq ?? null).slice(-6),
      })
    }
    if (held.length > 0) return held
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
  /**
   * WHY NOTHING FIRED, WHEN THE REASON IS A CONFIGURATION THAT CANNOT FIRE.
   *
   * A skip that says only `session not observed` cannot be told from a scope working as intended, and that is
   * exactly the confusion this row caused live: it was scoped to one session, a restart did not resume that
   * session, and 145 consecutive boundaries skipped identically. The row can tell the two apart -- it knows which
   * sessions are LIVE -- so the skip says which it is. Null when nothing configured is missing, because a note on
   * every skip would be noise.
   */
  function configuredScopeNotLive() {
    try {
      const agents = typeof ctx.get === 'function' ? ctx.get('agents') : undefined
      if (agents === undefined || typeof agents.list !== 'function') return null
      // THE RULE ITSELF LIVES IN lib/sessions.js, beside the gate it explains, so the SEAM path can adopt it
      // without a second copy -- and a second copy is how the envelope rule went wrong twice. This function only
      // supplies what a module cannot know: which sessions this process currently has.
      return scopeNotLiveNote(liveConfig(), (agents.list() ?? []).map((entry) => entry?.id))
    } catch {
      // A diagnostic must never be the reason a turn is lost.
      return null
    }
  }

  ctx.on('session/event', (session, event) => {
    feed.record(session?.id, event)
  })

  // `agent/inbox/claimed` ANNOUNCES WHICH MESSAGE OPENS A TURN, as `{agent, message, turn}`. Step 1 of the adoption
  // plan names it for exactly that: the composer INFERS the boundary by searching backwards for the newest operator
  // message, and this is the harness saying which one it is. The mode is `emit` -- fire and forget -- so this is a
  // synchronous recorder like `fs/observed`, and a throw must not escape into the loop.
  //
  // HELD, NOT YET CONSUMED, and that is deliberate: the boundary rule has three rounds of history and moves on its
  // own, with a test that the announced message wins and a control that its absence falls back to the inference.
  ctx.on('agent/inbox/claimed', (payload) => {
    try {
      const sessionId = payload?.agent?.id
      if (typeof sessionId !== 'string' || sessionId === '') return
      const message = payload?.message
      if (message === null || message === undefined) return
      claimed.set(sessionId, {
        message,
        turn: typeof payload?.turn === 'number' ? payload.turn : null,
        seq: typeof message.seq === 'number' ? message.seq : null,
      })
      // AND IT IS RECORDED, BECAUSE THE SESSION LOGS COULD NOT SETTLE WHETHER THIS EVENT FIRES. `agent` namespace events
      // LIVE COORDINATION and are not persisted to the session log -- agent-lifecycle.md:86 says SDK users who need a
      // replayable transcript must consume `session/event`, and that `agent/*` is the live interface for queueing,
      // status, prompt interception, steering and error handling. So grepping session logs for `agent/inbox/claimed`
      // could only ever return nothing, and I read that nothing as "declared and never emitted". The lifecycle page
      // documents it firing once per claimed message, with `{ message, turn }` (agent-lifecycle.md:31,70).
      //
      // One line per claimed message, which is one per turn: cheap enough for an `emit` listener, and the instrument
      // that can actually see a live-only event.
      evidence.trace('claimed', {
        agentId: sessionId,
        turn: typeof payload?.turn === 'number' ? payload.turn : null,
        seq: typeof message.seq === 'number' ? message.seq : null,
      })
    } catch {
      // An emitter's listener must never become the reason a turn fails.
    }
  })

  // `agent/turn-stopping` IS SERIAL -- THE HARNESS AWAITS THIS LISTENER BEFORE CLOSING THE TURN. So it returns
  // UNDEFINED: no promise, and no work that could delay a close. An 800ms judge call here would hold every turn
  // open, which is why the measurement is dispatched nowhere near it.
  //
  // THIS IS THE SHADOW, and it changes no behaviour: it records the turn the harness says is ending, beside the
  // trigger that now runs on this SAME event. Both listeners are subscribed to `agent/turn-stopping`, so the trace
  // carries the harness's own numbering next to the counter the trigger keeps -- which is the comparison that was
  // once the reason for not switching, and is now the check that the switch is faithful.
  ctx.on('agent/turn-stopping', (payload) => {
    try {
      evidence.trace('turn-stopping', {
        agentId: payload?.agent?.id ?? null,
        turn: typeof payload?.turn === 'number' ? payload.turn : null,
      })
    } catch {
      // A listener the harness awaits must not become the reason a turn fails to close.
    }
  })

  // `fs/observed` LISTENERS MUST BE SYNCHRONOUS RECORDERS, quoted from the harness: "throws fail the tool call and
  // returned promises are not awaited". A bug here would break the AGENT'S filesystem call rather than this
  // plugin's record, so this is synchronous, returns nothing, and every access inside is guarded.
  ctx.on('fs/observed', (target, observation, actor) => {
    fsJournal.record(target, observation, actor)
  })

  // THE INTENT WATERFALLS: WHAT IS ABOUT TO HAPPEN, BESIDE WHAT DID. `fs/write-intent` and `fs/edit-intent` are
  // SINGLE-SLOT decisions -- quoted from the harness: "the first listener that returns an intent owns the decision
  // rather than composing with peers", and "calling next() yields the bare provider's unconditional write". So this
  // records and hands the decision back UNTOUCHED: same call, same reference.
  //
  // THE SESSION IS NOT ON THIS EVENT. `actor` is declared "the opaque tool-execution context", so the record is keyed
  // by `target.displayPath` -- the same FsTarget `fs/observed` already records. Intent and observation are therefore
  // joinable on the path, which is the pair that makes "I created X" checkable rather than merely plausible. The
  // event carries no content, so "what is about to be written" would have been the wrong claim.
  //
  // THE DECIDED INTENT IS RECORDED FROM THE PROMISE, DETACHED, AND THE ORIGINAL IS RETURNED. Returning a `.then()`
  // chain would hand back a DIFFERENT promise resolving to the same value, and under first-returned-guard-wins that
  // is exactly the substitution the contract forbids.
  const intents = new Map()
  const recordIntent = (kind, target, decision) => {
    Promise.resolve(decision)
      .then((intent) => {
        const path = typeof target?.displayPath === 'string' ? target.displayPath : null
        if (path === null) return
        intents.set(path, { kind, intent: intent ?? null, at: Date.now() })
      })
      .catch(() => {})
  }
  const intentListener = (kind) => (target, actor, next) => {
    // RECORDING IS BEST-EFFORT AND MUST NOT BECOME THE REASON A WRITE FAILS; the decision is the harness's.
    const decision = typeof next === 'function' ? next() : undefined
    try { recordIntent(kind, target, decision) } catch { /* recording is never load-bearing */ }
    return decision
  }
  // TWO LITERAL SUBSCRIPTIONS, NOT A LOOP OVER NAMES. The inventory scans `ctx.on('...')` LITERALS and is right to:
  // a host dependency reached through a variable is invisible to the audit, and the first version of this used a
  // loop -- the declaration then read as stale, which is that check working.
  ctx.on('fs/write-intent', intentListener('write'))
  ctx.on('fs/edit-intent', intentListener('edit'))

  // THE TRIGGER IS THE HARNESS'S OWN TURN BOUNDARY, which is what step 2 of the adoption plan asked for.
  // `agent/pre-step` fires once per STEP, so counting its calls was a proxy for turns; `agent/turn-stopping` IS the
  // turn ending, carrying `{agent, turn, signal}` -- so the count and the thing counted are the same event.
  //
  // SERIAL, SO `next()` DOES NOT EXIST HERE. A waterfall hands its listener a continuation to call; a serial seam
  // hands it a payload and AWAITS ITS RETURN. Calling next() would throw, so every gate below returns undefined --
  // the property turn-stopping-shadow.test.js already pins for the shadow listener beside it.
  //
  // AND THIS PAYLOAD CARRIES NO `messages`, so a scheduled turn's reaction comes from the events, in either declared
  // shape -- the path e405b04 landed for exactly this class of seam. The `messages` read stays because a driver may
  // supply one and the supplied-reaction path is a real capability; surface-nodes-is-read pins the no-messages case.
  ctx.on('agent/turn-stopping', (payload) => {
    // THE MOUNT LINE PRECEDES ANY SKIP THIS HANDLER WRITES, as the seam path arranges at its own observe and
    // skip. This handler wrote its gate skip straight to the trace, so a row whose FIRST event is a turn skip
    // -- which a scope pointing at a dead session produces, 145 times over -- recorded no mount line at all,
    // and the mount line is the thing that answers "was it scoped, paused, or broken?" for a quiet trace.
    writeMount()
    const sessionId = payload?.agent?.id
    // THE SAME SESSION GATE THE OBSERVATION PATH APPLIES, and the schema's own description depends on it: a firing
    // in a session this row was not pointed at "never reaches the model or the trace". Without this, the scheduled
    // measurement would send an EXCLUDED conversation to the judge -- the documented promise, broken, and broken by
    // the one code path that was added last. The reason string is the same one, so a reader can group them.
    if (!sessionObserved(liveConfig(), sessionId)) {
      const note = configuredScopeNotLive()
      evidence.trace('skip', {
        hook: 'turn',
        agentId: sessionId ?? null,
        reason: 'session not observed',
        ...(note === null ? {} : { note }),
      })
      return undefined
    }
    // AND THE SUBAGENT GATE, from the same module and with the same reason string the observation path uses. It is
    // off unless the config says exactly `true`, so a scheduled measurement does not silently start watching the
    // worker sessions an operator never asked about.
    if (isSubagent(payload?.agent) && readConfigValue(liveConfig().observeSubagents) !== true) {
      evidence.trace('skip', { hook: 'turn', agentId: sessionId ?? null, reason: SUBAGENT_SKIP_REASON })
      return undefined
    }
    // The payload's own messages, taken as they stand: `composeTurnState` accepts text or a message-like object, so
    // this does not need to know the UserMessage shape -- and must not, since guessing it is what this fix avoids.
    const messages = Array.isArray(payload?.messages) ? payload.messages : []

    // WHICH COHORT THIS BOUNDARY BELONGS TO. Peer-opened turns are COUNTED -- that is the operator's decision -- so
    // they must also be LABELLED, or a judgement about a peer's request cannot be told from one about the operator's
    // while both sit in the same series under questions that say "OPERATOR REQUEST".
    //
    // THE DISCRIMINATOR IS THE MESSAGE ID, read from the live feed rather than from the session: `peer-<id>` is what
    // the bridge writes for a delivered message, while an operator's own message carries a uuid and a `source` with
    // `rpcId` and `clientTimeZone`. Verified against 33 user messages of one session: peer ids all begin `peer-`,
    // operator ids are uuids, and the two never overlap. Bounded to the last few events, and NULL when the feed
    // cannot say -- a cohort nobody measured must not be reported as one we did.
    const cohortOf = (sessionId) => {
      const events = feed.events(sessionId)
      for (let index = events.length - 1; index >= 0 && index >= events.length - 40; index -= 1) {
        const event = events[index]
        if (event?.type !== 'user/message') continue
        const data = event?.data ?? {}
        const message = data.message ?? data
        const id = typeof message?.id === 'string' ? message.id : ''
        const text = textOfEvent(event)
        const peer = id.startsWith('peer-') || text.startsWith('[peer-bridge:')
        return { seq: typeof event?.seq === 'number' ? event.seq : null, peer, how: id !== '' ? 'id' : 'text' }
      }
      return { seq: null, peer: null, how: 'unknown' }
    }
    const cohort = cohortOf(sessionId)
    // EVERY OUTCOME THAT ASKS NOTHING IS RECORDED, not only the ones that throw. A REFUSAL WROTE NOTHING AT ALL --
    // no boundary yet, no set configured under `turn`, and a malformed set were all indistinguishable from silence,
    // and an operator could not tell a schedule that has not come round from one that will never fire. Measured:
    // with a set configured and the interval at 1, this handler produced ZERO trace lines, which is the same
    // evidence as a node that was never reached.
    Promise.resolve(turnObserver.onAdmit({ sessionId, harnessTurn: payload?.turn, nextMessage: messages[messages.length - 1] }))
      .then((outcome) => {
      // THE SUBJECT'S COST, FROM THE HARNESS. `tokenMeter.measure(session)` is O(surface) and SYNCHRONOUS, and its
      // result says whether the number is usage, estimated or none. It is called HERE -- on the detached path, after
      // the judgement -- and never inside a listener the harness awaits, where O(surface) work would delay a turn.
      try {
        const meter = typeof ctx.get === 'function' ? ctx.get('tokenMeter') : undefined
        const session = payload?.agent?.session
        if (meter !== undefined && meter !== null && typeof meter.measure === 'function' && session !== undefined && session !== null) {
          const measured = meter.measure(session)
          evidence.trace('subject-cost', {
            agentId: sessionId ?? null,
            totalTokens: typeof measured?.totalTokens === 'number' ? measured.totalTokens : null,
            surfaceTokens: typeof measured?.surfaceTokens === 'number' ? measured.surfaceTokens : null,
            baseline: typeof measured?.baseline?.kind === 'string' ? measured.baseline.kind : null,
          })
        }
      } catch {
        // A diagnostic must never be the reason a turn is lost.
      }
        // THE DISK TRUTH, BESIDE THE COST. `workspaceChanges.summary` is EVENT-ADDRESSED -- it takes the seq of a
        // `workspace/changes` event -- and SYNCHRONOUS, so it belongs on this detached path for the same reason the
        // meter does. The feed supplies the address: the events the harness published carry the seqs. Together with
        // `fs/observed` (what was LOOKED AT) this is what was CHANGED, which is what makes "I created X" and "I changed
        // nothing else" checkable instead of merely plausible.
        try {
          const changes = typeof ctx.get === 'function' ? ctx.get('workspaceChanges') : undefined
          if (changes !== undefined && changes !== null && typeof changes.summary === 'function') {
            const newest = feed.events(sessionId).filter((event) => event?.type === 'workspace/changes').map((event) => event?.seq).filter((seq) => typeof seq === 'number').pop()
            if (newest !== undefined) {
              const summary = changes.summary(sessionId, newest)
              if (summary !== undefined && summary !== null) {
                evidence.trace('workspace-change', {
                  agentId: sessionId ?? null,
                  seq: newest,
                  turn: typeof summary.turn === 'number' ? summary.turn : null,
                  total: typeof summary.total === 'number' ? summary.total : null,
                  added: typeof summary.added === 'number' ? summary.added : null,
                  deleted: typeof summary.deleted === 'number' ? summary.deleted : null,
                  files: Array.isArray(summary.files) ? summary.files.map((file) => file?.display ?? file?.path ?? null).filter((name) => typeof name === 'string').slice(0, 20) : [],
                })
              }
            }
          }
        } catch {
          // A diagnostic must never be the reason a turn is lost.
        }

        if (outcome !== undefined && (outcome.refused === true || outcome.failed === true)) {
          evidence.trace('skip', { hook: 'turn', agentId: sessionId ?? null, reason: `the turn measurement did not run: ${outcome.reason ?? 'no reason given'}` })
        }
        // ONE LINE PER IN-SCOPE TURN, FIRED OR NOT. The cadence answer used to be silence -- the comment above this
        // chain claims every outcome that asks nothing is recorded, and the code recorded only refusals and failures
        // -- so "the schedule has not come round" and "the trigger is dead" were the same evidence. Measured: six
        // consecutive boundaries of a live session produced no line at all.
        //
        // AND IT CARRIES THE COHORT, because the series mixes peer-opened and operator-opened turns by decision. The
        // line is written for every boundary, so the counter is observable whether or not the judge was asked.
        if (outcome !== undefined && typeof outcome.turn === 'number' && outcome.turn > 0) {
          evidence.trace('turn-boundary', {
            agentId: sessionId ?? null,
            boundary: outcome.turn,
            // THE HARNESS'S OWN TURN NUMBER, BESIDE THE ONE THIS LISTENER COUNTS. They are different numbers: the
            // boundary counter is in memory and STARTS AT 1 AT EVERY MOUNT, while the harness's number is the
            // session's, and continues. Measured: this process was at boundary 3 while the session was at turn 30.
            // Carrying both makes the two comparable without joining on timestamps -- and the cadence currently uses
            // the counter, so "every 5" means every 5 boundaries this process has SEEN.
            harnessTurn: typeof payload?.turn === 'number' ? payload.turn : null,
            everyNTurns,
            fired: outcome.fired === true,
            requestSeq: cohort?.seq ?? null,
            requestIsPeer: cohort?.peer ?? null,
            cohortSource: cohort?.how ?? 'unknown',
          })
        }
      })
      .catch((error) => {
        evidence.trace('skip', { hook: 'turn', agentId: sessionId ?? null, reason: `the turn measurement failed: ${error instanceof Error ? error.message : String(error)}` })
      })
    // THE CHAIN CONTINUES. Everything above is bookkeeping around the seam; the seam's own decision is not ours.
    return undefined
  })

  // EVERY SEAM IS SUBSCRIBED, AND EACH ONE IS GATED AT ITS OWN FIRING (`hookEnabled`): a listener that is not
  // registered cannot be switched on without a re-mount, which is what the volatile `hooks` field is for.
  registerListeners(ctx, PROBE_SEAMS, {
    // THE MOUNT LINE PRECEDES THE FIRST OBSERVATION when no service ever appeared. Calling the writer here
    // rather than at the end of `apply` is what keeps "no service" from being recorded before it is known --
    // including when the first event of a run is a subagent's `skip`.
    observe: (hook, text, meta) => { writeMount(); return observer.observe(hook, text, meta) },
    skip: (hook, meta, reason) => { writeMount(); return observer.skip(hook, meta, reason) },
    readConfig,
    hookEnabled: (seam) => liveHooks().includes(seam),
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
