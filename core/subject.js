// WHICH MODEL PRODUCED THE TEXT BEING JUDGED.
//
// The trace already recorded the DECISION model -- `provider`/`model` are the observer's own config, and
// `requested`/`executed` are the judge's provenance. None of those says which model wrote the excerpt, and
// that is the fact the measurement is missing: the same question scores differently on different models'
// output, so an accuracy figure -- or a threshold -- measured against one model's drafts does not transfer to
// another's. It is the same warning the System One skill makes about decision servers, one level down:
// `subject` is to the text what `executed` is to the judge.
//
// TWO SOURCES, because the fact lives in two places and they are not the same claim:
//
//   `llm/stream`'s first argument is a `GenerateOptions` -- the request as sent, with `provider`, `model`,
//   `reasoningEffort` and `temperature` on it. That is what actually produced THIS text.
//
//   `Agent.options` is an `AgentOptions` -- the route the agent's requests use, with `provider`, `model`,
//   `reasoningEffort` and `maxTokens`. Every other seam has no LLM request in its payload (a tool call is a
//   tool call), so this is the best available answer there: the model the session is configured for, not
//   proof of what produced that specific event.
//
// PROPERTY CHECKS ONLY, and every field optional: this crosses a runtime boundary, and a missing field must
// produce an absent field rather than a wrong one.
import { isRecord } from './is-record.js'

function strings(source, keys) {
  const out = {}
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.trim() !== '') out[key] = value
  }
  return out
}

function numbers(source, keys) {
  const out = {}
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value
  }
  return out
}

function orUndefined(out) {
  return Object.keys(out).length === 0 ? undefined : out
}

/**
 * The model that produced one streamed reply, from the LLM request the harness is about to make.
 *
 * @param options the `GenerateOptions` handed to the `llm/stream` listener
 * @returns `{ provider?, model?, reasoningEffort?, temperature? }`, or `undefined` when nothing is known
 */
export function subjectOfRequest(options) {
  if (!isRecord(options)) return undefined
  return orUndefined({
    ...strings(options, ['provider', 'model', 'reasoningEffort']),
    ...numbers(options, ['temperature']),
  })
}

/**
 * The model an agent's requests use, for the seams whose payload carries no LLM request.
 *
 * @param agent the `Agent` the seam belongs to
 * @returns `{ provider?, model?, reasoningEffort?, maxTokens? }`, or `undefined` when nothing is known
 */
export function subjectOfAgent(agent) {
  if (!isRecord(agent) || !isRecord(agent.options)) return undefined
  return orUndefined({
    ...strings(agent.options, ['provider', 'model', 'reasoningEffort']),
    ...numbers(agent.options, ['maxTokens']),
  })
}

/** One line a person reads: `openrouter/mistralai/ministral-3b-2512`, or `(unknown)`. */
export function describeSubject(subject) {
  if (!isRecord(subject)) return '(unknown)'
  const route = typeof subject.model === 'string'
    ? (typeof subject.provider === 'string' ? `${subject.provider}/${subject.model}` : subject.model)
    : '(unknown)'
  return route
}
