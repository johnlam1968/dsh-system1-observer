// WHAT THE BACKEND WILL ACTUALLY TAKE: the vendor's published limits, in one place, because a caller that does not
// know them sends requests that come back as answers nobody can read.
//
// THE INCIDENT THIS EXISTS FOR, measured on 2026-10-03: `system1_evaluate_session` was given a 291,137-character state
// composed from a 611-message session. The call was ACCEPTED, took 919 ms, recorded `failure: None`, and returned
// eight answers that were all `unreadable` -- with `executed: None` in the reply, which was the only sign the whole
// request had been refused. Nothing in this repository said why. The answer was one fetch away:
//
//   https://docs.typesafe.ai/models.md            -- the context length, in tokens, per model
//   https://docs.typesafe.ai/model-jaggedness/jev-1.13.md -- "large state full of irrelevant detail", failure mode 5
//   https://docs.typesafe.ai/api.md               -- the endpoint, `usage`, and the error codes
//
// `jev-1.13` is the frontier System One model as of this writing, so ITS NUMBERS ARE THE ONES THIS PLUGIN BUILDS TO.
// When another frontier decision model appears these become a table rather than a constant -- keyed by the `model` the
// row sends -- which is why they are gathered here instead of being spread through the callers as magic numbers.
//
// THE TWO NUMBERS THAT MATTER, and they are not the same number:
//   * REQUEST: 64k tokens, covering the `state` PLUS ALL QUESTIONS TOGETHER.
//   * STATE:   32k tokens, covering the `state` PLUS THE SINGLE LONGEST QUESTION.
// A request can therefore be inside the first and outside the second, and the smaller one binds. Rate limits are
// separate and are the vendor's to change: 100K tokens/s and 80 requests/s, `429` when exceeded.
//
// TOKENS, NOT CHARACTERS, and this repository cannot convert. The vendor counts tokens; everything here counts
// characters; and the reply's `usage.input_tokens` -- the field that would tell us our own headroom -- is recorded as
// `usage: None` on every line we hold. So `CHARS_PER_TOKEN_ESTIMATE` is an ESTIMATE for planning, labelled as one, and
// `stateBudgetChars` says so in its name. A measured conversion needs the usage field to start arriving.

/** The model these numbers describe, and the alias that resolves to it. */
export const FRONTIER_MODEL = Object.freeze({ id: 'jev-1.13.0', alias: 'jev-latest', vendor: 'TypeSafe', family: 'jev-1.13' })

/** The published limits for `FRONTIER_MODEL`, as the vendor states them. Source: docs.typesafe.ai/models.md */
export const CONTEXT = Object.freeze({
  requestTokens: 64000,
  statePlusLongestQuestionTokens: 32000,
  rateLimitTokensPerSecond: 100000,
  rateLimitRequestsPerSecond: 80,
})

/**
 * English prose is roughly four characters to a token, which is the rule of thumb the vendor's own examples fit
 * (`input_tokens: 296` for a two-sentence state and one question). It is an ESTIMATE and it is only used to pick a
 * segment size that leaves margin -- never to decide that a request is legal.
 */
export const CHARS_PER_TOKEN_ESTIMATE = 4

/**
 * The `state` budget in characters, BY ESTIMATE, with a deliberate safety factor.
 *
 * `CONTEXT.statePlusLongestQuestionTokens` is the smaller of the two limits and the one that binds a single judgement.
 * `SAFETY` exists because the estimate is the weakest link in the chain: real prose runs past four characters per
 * token on code, JSON and identifiers, and this repository's states are full of all three.
 */
export const SAFETY = 0.75
export const stateBudgetChars = Math.floor(CONTEXT.statePlusLongestQuestionTokens * CHARS_PER_TOKEN_ESTIMATE * SAFETY)

/**
 * Whether a composed state is plausibly inside the documented budget.
 *
 * IT DOES NOT REFUSE, and that is deliberate: the number is an estimate, and a plugin that refuses a request the
 * vendor would have accepted is a plugin that loses measurements. It reports, the caller records, and the segmenter
 * (`lib/segment.js`) is what keeps a state under it in the first place.
 */
export function withinStateBudget(chars) {
  const size = Number(chars)
  if (!Number.isFinite(size) || size < 0) return { ok: false, problem: 'the state size is not a number of characters' }
  if (size <= stateBudgetChars) return { ok: true, estimate: true, budgetChars: stateBudgetChars, chars: size }
  return {
    ok: false,
    estimate: true,
    budgetChars: stateBudgetChars,
    chars: size,
    problem: size + ' characters is over the estimated state budget of ' + stateBudgetChars
      + ' (' + CONTEXT.statePlusLongestQuestionTokens + ' tokens of `state` plus the longest question, at about '
      + CHARS_PER_TOKEN_ESTIMATE + ' characters per token and a ' + SAFETY + ' safety factor). Send a segment, not the session.',
  }
}
