// WHAT THE OBSERVER ASKS, in one place.
//
// The default is the runtime's OWN probe question, imported rather than restated: its wording is what makes
// the answers checkable (the seam is known), and a second copy of that text is a second text that drifts.
//
// `question` replaces the instructions with a `noul`. The question's TYPE is part of what a trace means, so
// the trace records the questions as sent and a deployment that changes the type can see it in the record.
import { PROBE_QUESTION } from 'dsh-system1-runtime/guard/hooks.js'
import { noul } from 'dsh-system1-runtime/model/questions.js'

/** One id, so a trace line never needs a second lookup to know what was asked. */
export const QUESTION_ID = 'probe'

/**
 * Build the question map for one call.
 *
 * @param config the row's config, as Cordis passed it (a plain object; nothing is required)
 * @returns `{ probe: Question }`, ready to be the `questions` of a decision-model request
 */
export function buildQuestions(config) {
  const given = typeof config?.question === 'string' ? config.question.trim() : ''
  return { [QUESTION_ID]: given === '' ? PROBE_QUESTION : noul(given) }
}
