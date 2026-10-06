import { checkAgainst } from './tool-args.js'
import { resultEnvelope } from './model/result-envelope.js'
// THE REPOSITORY'S OWN AGENT-FACING TOOL: ask a System One model about one state.
//
// WHY IT IS HERE RATHER THAN IN A SEPARATE BUNDLE. The logic a question needs -- the builders, the shape rules, the
// cap, the answer narrowing -- lives in this repository, and a tool in another package would be a second copy of
// the calling convention that could drift from the instrument's. `system1-bridge` supplied this tool while the
// observer had none; the operator has disabled that bundle, so the name is this repository's to take.
//
// THE INPUT SHAPE IS THE PLUGIN'S OWN, DELIBERATELY, and that is the one way this differs from the tool it
// replaces. A `choice` here carries `options` with exactly one `abstain: true`, and a `score` carries `levels` --
// the same shape the observer's own configuration uses, and the same shape a set file is written in. So a set is
// handed over with NO CONVERSION, which is the property the whole criteria/ directory was rewritten for. The
// cost, stated plainly: this is not a drop-in for the bridge's callers, who pass a `criteria` map with no way to
// name an abstain option at all.
//
// WHAT IT DOES NOT DO. It returns probabilities and decides nothing. No threshold, no gate, no verdict: the
// numbers come back and the caller's own code owns what they mean. `confidence` is a spread statistic over the
// options offered, NOT a probability that the answer is right.
import { buildQuestions } from './questions.js'
import { questionGroup } from './instrument-input.js'
import { isRecord } from './is-record.js'

export const DECIDE_TOOL_NAME = 'system1_decide'

/** The hook the questions are built under. One name, because a tool call asks one set about one state. */
export const TOOL_HOOK = 'call'

const DESCRIPTION = [
  'Ask System One -- the decision model this profile configures -- for probabilities about one state.',
  '',
  'Parameters: `state` is the text or JSON the judgement is about. `questions` is the set to ask: an array of specs, or a map from id to spec. A spec is `{id, type, instructions}` plus, for `type: "noul"`, nothing else; for `type: "score"`, `levels` (an ordered array of at least two strings); for `type: "choice"`, `options` (an array of `{label, criterion}`, EXACTLY ONE carrying `abstain: true`). This is the same shape the observer is configured with, so a set file can be passed as it is written.',
  '',
  'The result carries `answers` (one entry per question id), `executed` (the provider, model and revision that actually answered), `usage`, `durationMs`, and `worstCase`. A malformed question is REFUSED rather than trimmed, and the message names the question; when the backend itself could not answer, the result carries a `failure` block instead of a thrown error, so the two are never confused.',
  '',
  '`confidence` IS NOT ACCURACY: it is how peaked the distribution over the offered options was, not a probability that the answer is right.',
].join('\n')

/**
 * The specs a caller handed us: an array, or a map from id to spec.
 *
 * A map is accepted because a hand-written call is easier as one, and an array because that is what a set file
 * holds. Nothing else is accepted, and a value that is neither is refused by name rather than silently empty --
 * an empty set is the state that asks nothing and looks like an answer.
 */
export function readSpecs(value) {
  if (Array.isArray(value)) return value
  if (isRecord(value)) {
    return Object.entries(value).map(([id, spec]) =>
      isRecord(spec) && typeof spec.id === 'string' && spec.id.trim() !== '' ? spec : { ...(isRecord(spec) ? spec : {}), id },
    )
  }
  throw new Error(`${DECIDE_TOOL_NAME}: \`questions\` must be an array of specs or a map from id to spec.`)
}

/** The state, which must carry something: an empty state is a question asked of nothing. */
function readState(value) {
  if (typeof value === 'string') {
    if (value.trim() === '') throw new Error(`${DECIDE_TOOL_NAME}: \`state\` is empty.`)
    return value
  }
  if (value !== undefined && value !== null) return value
  throw new Error(`${DECIDE_TOOL_NAME}: \`state\` is required.`)
}

/**
 * The agent-facing tool.
 *
 * `decide` is injected rather than reached for, so the row wires the SAME model the observer uses
 * (`selectModel(ctx, wire)`) and a test can hand in a stub. Reaching for `ctx` here would make the tool
 * untestable without a profile and would hide which path a call took.
 */
export function createDecideTool({ decide, record, provider = null, model = null, toolId = 'system1-observer' } = {}) {
  const parameters = {
        type: 'object', additionalProperties: false,
        properties: {
          state: {
            // A ONE-OF, BECAUSE THE PARAMETER GATE REFUSES `json` -- measured: `state.type` is checked by
            // `assertObjectJsonSchema`, which allows only object/array/string/number/integer/boolean/null, even though
            // the authored DSL page lists `json` among the legal types. The state may be text or JSON, so this says so.
            oneOf: [
              { type: 'string' },
              { type: 'object', additionalProperties: true },
              { type: 'array' },
              { type: 'number' },
              { type: 'boolean' },
              { type: 'null' },
            ],
            description: 'The text or JSON the judgement is about. Passed to the backend as the state, unchanged.',
          },
          questions: {
            // A ONE-OF, BECAUSE BOTH SHAPES ARE HONOURED: an array of specs and a map from id to spec (`readSpecs` is
            // the gate, and a real set file is passed as a map -- measured by test/decide-tool.test.js). The authored
            // DSL refuses a parameter node with no type, so "either" has to be said as a union.
            oneOf: [{ type: 'array', items: { type: 'object', additionalProperties: true } }, { type: 'object', additionalProperties: true }],
            description:
              'The set to ask: an array of specs, or a map from id to spec. Each spec is `{id, type, instructions}` plus `levels` for a score or `options` for a choice. The same shape the observer is configured with, so a set file can be passed unchanged.',
          },
          provider: {
            type: 'string',
            // THE NAME STAYS, WITH ITS MOMENT ATTACHED. Dropping it failed a test whose intent was right ("the tool
            // names the backend its row configures, not a built-in default"), and the name IS useful -- but a tool
            // description is a STRING, fixed when the tool is registered, so it cannot follow a live change. The
            // honest form is to name the value and say which moment it came from, and to point at the two places
            // that are live: the result's `executed`, and `system1_settings`'s `list`.
            description: provider === null
              ? 'Which registered backend answers. Omit for the profile default; the result\u2019s `executed` names the backend that actually answered.'
              : `Which registered backend answers. This row was configured for ${JSON.stringify(provider)} when this tool was registered; omit to use it, and read the result\u2019s \`executed\` for the backend that actually answered.`,
          },
          model: {
            type: 'string',
            description: model === null
              ? 'Which model to ask. Omit for the profile default; the result\u2019s `executed` names the model that actually answered.'
              : `Which model to ask. This row was configured for ${JSON.stringify(model)} when this tool was registered; omit to use it, and read the result\u2019s \`executed\` for the model that actually answered.`,
          },
        },
        required: ['state', 'questions'],
      }

  if (typeof decide !== 'function') throw new TypeError(`${DECIDE_TOOL_NAME}: \`decide\` must be a function.`)
  return {
    name: DECIDE_TOOL_NAME,
    description: DESCRIPTION,
parameters,

    output: {
      schema: {
// THE RULE THIS FILE FOLLOWS, after a live call failed on it (F118): `additionalProperties: false` belongs on a shape
  // WE enumerate -- and on nothing else. A map keyed by the caller's data (an answer id, a scope name) or an envelope
  // ANOTHER producer owns (a transport, a JSON schema, a set manifest) cannot be closed: the keys are not ours to
  // list, and closing them makes every non-empty value a runtime refusal. `true` is not laxity here; it is the only
  // declaration that is TRUE about a map whose keys come from elsewhere.
        type: 'object', additionalProperties: false,
        properties: {
          answers: { type: 'object', additionalProperties: true, description: 'One entry per question id -- the KEY is the caller\'s id, so this map is open by construction.' },
          executed: { type: 'object', additionalProperties: true, properties: { provider: { type: 'string' }, model: { type: 'string' }, revision: { type: 'string' } }, description: 'The provider, model and revision that actually answered. A TRANSPORT envelope: the named fields are the ones this repository relies on, and the rest are the other service\'s to add.' },
          usage: { type: 'object', additionalProperties: true, properties: { inputTokens: { type: 'number' }, outputTokens: { type: 'number' }, totalTokens: { type: 'number' } }, description: 'Token counts as the backend reported them -- a transport envelope, same rule as `executed`.' },
          durationMs: { type: 'number', description: 'How long the backend took.' },
          worstCase: { type: 'object', additionalProperties: true, description: 'The least favourable reading of the answers, from the repository escalation logic. Only a record is forwarded, and its keys are that logic\'s.' },
          failure: { type: 'object', additionalProperties: false, properties: { reason: { type: 'string' } }, description: 'Present when the backend could not answer. Neither a gate nor a verdict: every answer is then an error it produced before execution. OUR shape, so it is closed -- and `reason` is what this file writes.' },
        },
      },
      render(_args, value) {
        if (isRecord(value?.failure)) {
          return [{ type: 'text', text: `${DECIDE_TOOL_NAME}: no answer -- ${String(value.failure.reason ?? 'the backend did not answer')}` }]
        }
        const answers = isRecord(value?.answers) ? value.answers : {}
        const lines = Object.entries(answers).map(([id, answer]) => {
          if (isRecord(answer) && answer.status === 'error') return `  ${id}: ERROR ${String(answer.reason ?? '')}`
          const a = isRecord(answer?.answer) ? answer.answer : answer
          if (!isRecord(a)) return `  ${id}: ${JSON.stringify(a)}`
          // THE FIELD NAMES WERE ASSUMED AND WERE WRONG. This renderer used the names the BRIDGE's mapping
          // produces (`probabilityTrue`, `value`, `levels`) and the observer's own `narrowAnswers` does not use
          // them, so the first live call printed `undefined true` and `undefined of ?` -- a tool that answered
          // correctly and reported it as nothing. Each shape is now recognised by what it actually carries, and
          // anything unrecognised is printed as it stands rather than as `undefined`.
          if (a.type === 'noul' && typeof a.probabilityTrue === 'number') return `  ${id}: ${a.probabilityTrue} true`
          if (a.type === 'score' && typeof a.value === 'number') return `  ${id}: ${a.value} of ${Array.isArray(a.levels) ? a.levels.length - 1 : '?'}`
          if (a.value !== undefined) return `  ${id}: ${String(a.value)}${a.confidence === undefined ? '' : ` (${String(a.confidence)})`}`
          return `  ${id}: ${JSON.stringify(a)}`
        })
        const executed = isRecord(value?.executed) ? `\nexecuted: ${JSON.stringify(value.executed)}` : ''
        return [{ type: 'text', text: lines.join('\n') + executed }]
      },
    },
    async execute(args, exec) {
      // THE CALLER'S CANCELLATION, HONOURED BEFORE ANY WORK AND RECORDED AFTER IT. `reference/cookbook/
      // adding-a-tool.md:49` requires it: "honour `exec.signal`; cancel in-flight work when it fires". The wire
      // forwards an external abort to its own controller, so a pre-flight cancel costs nothing there; the
      // `system1` service path cannot interrupt work in flight at all. That asymmetry is why the second half of
      // this contract lives in the RECORD rather than in the caller: the line carries `cancelled: true` when the
      // signal fired during the call, so an operator who walked away is visible in the trace instead of
      // indistinguishable from one who waited.
      if (exec?.signal?.aborted === true) throw new Error('the call was cancelled before it started')
      // THE ARGUMENTS, AGAINST THIS TOOL'S OWN DECLARATION. A raw registration gets no validation from the
      // registry (adding-a-tool.md:44), so this is where the model's call is checked -- and it checks the same
      // literal the model was shown.
      checkAgainst(parameters, args, DECIDE_TOOL_NAME)

      const state = readState(args.state)
      // REFUSE, DO NOT TRIM, and name the question: a set that reaches a backend with a silently shortened
      // question files a measurement of one thing under another. This is the repository's rule for the same
      // reason it is the caller's protection.
      // AND A SET THAT ASKS NOTHING IS REFUSED, not sent. The comment on `readSpecs` says an empty set "is the state
      // that asks nothing and looks like an answer" -- and until the contract test drove it, an empty ARRAY was
      // accepted and went to the backend, which is exactly that state. Measured, then fixed.
      const specs = readSpecs(args.questions)
      if ((Array.isArray(specs) ? specs : Object.keys(specs ?? {})).length === 0) {
        throw new Error(`${DECIDE_TOOL_NAME}: the question set is empty, so there is nothing to ask`)
      }
      // THE SAME SHAPE EVERY OTHER CALLER PASSES: the instrument's question group. `seamEnabled` was beside it and
      // was never read here -- `buildQuestions` resolves questions, and the per-seam switch is the observer's.
      const built = buildQuestions(questionGroup({ questions: { [TOOL_HOOK]: specs } }), TOOL_HOOK)
      // REFUSE, DO NOT TRIM, and name the question: a set that reaches a backend with a silently shortened question
      // files a measurement of one thing under another.
      if (built.problems.length > 0) throw new Error(`${DECIDE_TOOL_NAME}: ${built.problems[0]}`)
      // REGISTER ROW O18: THE LINE IS WRITTEN FOR EVERY OUTCOME, NOT ONLY FOR SUCCESS. Written only on success it was
      // absent exactly when it mattered most -- a timeout or a transport failure was still ATTEMPTED and, on a metered
      // backend, very probably still PAID FOR. `lib/evaluate-tool.js` records both outcomes for this reason; this tool
      // is where the row was found, and a call that happened and left no trace is indistinguishable from one that
      // never happened.
      const writeLine = (extra) => {
        if (typeof record !== 'function') return
        record({
          event: 'call',
          hook: 'tool',
          tool: toolId,
          questionIds: Object.keys(built.questions),
          answers: {},
          // A CANCELLATION THE TRANSPORT COULD NOT ACT ON IS STILL A FACT ABOUT THE MEASUREMENT. Only the wire
          // forwards an external abort (`lib/model/wire.js`); the `system1` service path cannot interrupt work in
          // flight, so a caller who cancels mid-call gets an ordinary answer with nothing to say the operator walked
          // away. The answer is not thrown away -- the backend was already paid for it -- but the line says so.
          ...(exec?.signal?.aborted === true ? { cancelled: true } : {}),
          ...extra,
        })
      }
      // THE SIGNAL GOES DOWN TO THE TRANSPORT, which has honoured one since it was written
      // (lib/model/wire.js forwards an external abort to its own controller and tells a timeout from a cancel).
      let result
      try {
        result = await decide({ state, questions: built.questions }, { signal: exec?.signal })
      } catch (error) {
        // A THROWN TRANSPORT FAILURE IS THE MOST EXPENSIVE OUTCOME OF ALL and it left no line either. The throw still
        // reaches the caller -- throwing is the tool contract's failure path -- but the attempt is recorded first.
        writeLine({ failure: { reason: messageOf(error) } })
        throw error
      }
      if (!isRecord(result)) {
        writeLine({ failure: { reason: 'the model returned no result' } })
        return { failure: { reason: 'the model returned no result' } }
      }
      if (result.kind === 'error') {
        const reason = String(result.reason ?? 'the model could not answer')
        writeLine({ failure: { reason } })
        return { failure: { reason } }
      }
      // EVERY FIELD EMITTED MUST MATCH THE SCHEMA THAT DECLARES IT. The first version copied `executed`,
      // `usage` and `worstCase` whenever they were not `undefined`, and the harness validates a tool's output
      // against its own schema -- so the first LIVE call failed with `"value.worstCase" must be an object`,
      // because the model returned a `worstCase` that is not one. Unit tests could not see it: the stub returned
      // no `worstCase` at all, so the property was absent and the schema was satisfied vacuously. A live call is
      // what caught it, which is the argument for making one.
      // THE ENVELOPE IS CARRIED BY BOTH TRANSPORTS, and this file read the wrong place. `lib/model/client.js`
      // spreads `executed`/`usage`/`durationMs` flat onto the result AND returns the whole `envelope`; the service
      // path returns only the `envelope`. Reading the top level therefore found the provenance on the wire and lost
      // it on the service path -- which is the one a profile with `system1` mounted actually runs -- so the tool
      // reported answers with no record of which checkpoint answered them. `lib/observe.js` had already found this
      // and says so at its own call site ("it has no top-level `requested` or `executed`"); the flat form is
      // tolerated here because a caller may hand over a result built by hand.
      const envelope = resultEnvelope(result)
      const out = { answers: isRecord(result.answers) ? result.answers : {} }
      if (isRecord(envelope.executed)) out.executed = envelope.executed
      if (isRecord(envelope.usage)) out.usage = envelope.usage
      if (isRecord(result.worstCase)) out.worstCase = result.worstCase
      if (typeof envelope.durationMs === 'number' && Number.isFinite(envelope.durationMs)) out.durationMs = envelope.durationMs
      // CRITERION 1(b): THE TOOL WRITES ITS OWN LINE, NAMING ITSELF. Without it a call through this tool leaves no
      // record of having happened, and once the bridge's tool is gone nothing could say which tool served a
      // measurement. `questionIds` is not decoration: the acceptance check requires every call line under a
      // NON-SEAM hook to name its questions, so omitting them here would make this line a violation of the very
      // rule the check exists to enforce -- and `hook: 'tool'` is not a seam.
      writeLine({
        answers: out.answers,
        ...(out.executed === undefined ? {} : { executed: out.executed }),
        ...(out.durationMs === undefined ? {} : { durationMs: out.durationMs }),
      })
      return out
    },
  }
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}
