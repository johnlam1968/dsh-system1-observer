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
export function createDecideTool({ decide, provider = null, model = null } = {}) {
  if (typeof decide !== 'function') throw new TypeError(`${DECIDE_TOOL_NAME}: \`decide\` must be a function.`)
  return {
    name: DECIDE_TOOL_NAME,
    description: DESCRIPTION,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        state: {
          description: 'The text or JSON the judgement is about. Passed to the backend as the state, unchanged.',
        },
        questions: {
          type: 'array',
          description:
            'The set to ask: an array of specs, each `{id, type, instructions}` plus `levels` for a score or `options` for a choice. The same shape the observer is configured with, so a set file can be passed unchanged.',
        },
        provider: {
          type: 'string',
          description: provider === null ? 'Which registered backend answers. Omit for the profile default.' : `Which registered backend answers. This row defaults to ${JSON.stringify(provider)}.`,
        },
        model: {
          type: 'string',
          description: model === null ? 'Which model to ask. Omit for the profile default.' : `Which model to ask. This row defaults to ${JSON.stringify(model)}.`,
        },
      },
      required: ['state', 'questions'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          answers: { type: 'object', description: 'One entry per question id.' },
          executed: { type: 'object', description: 'The provider, model and revision that actually answered.' },
          usage: { type: 'object', description: 'Token counts as the backend reported them.' },
          durationMs: { type: 'number', description: 'How long the backend took.' },
          worstCase: { type: 'object', description: 'The least favourable reading of the answers, from the repository escalation logic.' },
          failure: { type: 'object', description: 'Present when the backend could not answer. Neither a gate nor a verdict: every answer is then an error it produced before execution.' },
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
    async execute(args) {
      const state = readState(args.state)
      const built = buildQuestions({ seamEnabled: { [TOOL_HOOK]: true }, questions: { [TOOL_HOOK]: readSpecs(args.questions) } }, TOOL_HOOK)
      // REFUSE, DO NOT TRIM, and name the question: a set that reaches a backend with a silently shortened
      // question files a measurement of one thing under another. This is the repository's rule for the same
      // reason it is the caller's protection.
      if (built.problems.length > 0) throw new Error(`${DECIDE_TOOL_NAME}: ${built.problems[0]}`)
      const result = await decide({ state, questions: built.questions })
      if (!isRecord(result)) return { failure: { reason: 'the model returned no result' } }
      if (result.kind === 'error') return { failure: { reason: String(result.reason ?? 'the model could not answer') } }
      // EVERY FIELD EMITTED MUST MATCH THE SCHEMA THAT DECLARES IT. The first version copied `executed`,
      // `usage` and `worstCase` whenever they were not `undefined`, and the harness validates a tool's output
      // against its own schema -- so the first LIVE call failed with `"value.worstCase" must be an object`,
      // because the model returned a `worstCase` that is not one. Unit tests could not see it: the stub returned
      // no `worstCase` at all, so the property was absent and the schema was satisfied vacuously. A live call is
      // what caught it, which is the argument for making one.
      const out = { answers: isRecord(result.answers) ? result.answers : {} }
      if (isRecord(result.executed)) out.executed = result.executed
      if (isRecord(result.usage)) out.usage = result.usage
      if (isRecord(result.worstCase)) out.worstCase = result.worstCase
      if (typeof result.durationMs === 'number' && Number.isFinite(result.durationMs)) out.durationMs = result.durationMs
      return out
    },
  }
}
