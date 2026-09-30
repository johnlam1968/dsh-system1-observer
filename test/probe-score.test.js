// THE ACCURACY FIGURE THE README PROMISED AND NOTHING COMPUTED.
//
// These tests are written so that the arithmetic is checkable by hand: a four-call fixture whose accuracy,
// majority floor and κ are all computable on paper. The point is the κ, because that is where a plausible
// implementation is silently wrong.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ABSTAIN_LABEL, PROBE_LABELS, SEAM_OF_LABEL, isProbeQuestion, probeAnswerOf, probeScore } from '../lib/probe-score.js'
import { PROBE_QUESTION } from '../lib/seams.js'
import { noul } from '../lib/model/questions.js'

/** One `call` line as the observer writes it, with the probe asked under whatever id is given. */
function callEvent(hook, answer, { qid = 'probe', question = PROBE_QUESTION, at = '2026-01-02T00:00:00.000Z' } = {}) {
  return { at, event: 'call', hook, questions: { [qid]: question }, answer: { answers: { [qid]: answer } } }
}

// --- the identity predicate, which is the whole reason this is not scored by seam or by id --------------
test('the probe is identified structurally, so the operator’s question is not mistaken for it', () => {
  assert.equal(isProbeQuestion(PROBE_QUESTION), true)
  // `lib/questions.js` builds a custom question under the SAME id as the probe, so an id check cannot work.
  assert.equal(isProbeQuestion(noul('is this call appropriate?')), false)
  // Reworded instructions are a different instrument even if the labels match.
  assert.equal(isProbeQuestion({ ...PROBE_QUESTION, instructions: 'Which bit made this?' }), false)
  // RENAMING AN OPTION is a different instrument, because the labels are what an answer MEANS.
  const criteria = { ...PROBE_QUESTION.criteria }
  delete criteria.closing_the_turn
  criteria.turn_is_closing = 'the end of a turn'
  assert.equal(isProbeQuestion({ ...PROBE_QUESTION, criteria }), false)
  // REWORDING A CRITERION is not: the instructions and the labels still decide what an answer means, and
  // treating a clarification as a new instrument would discard every measurement taken before it.
  const clarified = { ...PROBE_QUESTION, criteria: { ...PROBE_QUESTION.criteria, closing_the_turn: 'a clearer wording' } }
  assert.equal(isProbeQuestion(clarified), true)
  assert.equal(isProbeQuestion(undefined), false)
})

test('a call asked the operator’s question under the id `probe` is not a scored call', () => {
  const event = callEvent('draft', { type: 'noul', probability: 0.9 }, { question: noul('is this call appropriate?') })
  assert.equal(probeAnswerOf(event), null, 'the id is not the instrument')
})

test('only a call line can carry a probe answer', () => {
  assert.equal(probeAnswerOf({ event: 'skip', hook: 'draft', reason: 'no text at this seam' }), null)
  assert.equal(probeAnswerOf({ event: 'mount', hooks: [] }), null)
  assert.equal(probeAnswerOf(null), null)
})

// --- the four-call fixture, computable on paper --------------------------------------------------------
// truth: admit 2, draft 2.  predictions: admitting_a_step 3, model_output 1.
//   accuracy = 3/4 = 0.75        majority floor = 2/4 = 0.50
//   p_e = (2/4)(3/4) + (2/4)(1/4) = 0.375 + 0.125 = 0.50
//   kappa = (0.75 - 0.50) / (1 - 0.50) = 0.50
const FOUR = [
  callEvent('admit', { type: 'choice', label: 'admitting_a_step', confidence: 0.9 }),
  callEvent('admit', { type: 'choice', label: 'admitting_a_step', confidence: 0.8 }),
  callEvent('draft', { type: 'choice', label: 'model_output', confidence: 0.7 }),
  callEvent('draft', { type: 'choice', label: 'admitting_a_step', confidence: 0.6 }),
]

test('accuracy, floor and kappa on a fixture whose arithmetic is checkable by hand', () => {
  const score = probeScore(FOUR)
  assert.equal(score.calls, 4)
  assert.equal(score.scored, 4)
  assert.equal(score.accuracy, 0.75)
  assert.equal(score.majority.floor, 0.5)
  assert.equal(score.majority.label, 'admit')
  assert.equal(score.kappa, 0.5)
  assert.equal(score.selective.accuracy, 0.75)
  assert.equal(score.abstain.count, 0)
})

// THE TRAP. A true class is a SEAM and a predicted class is an OPTION, so indexing both by the same key makes
// every lookup miss, p_e collapse to 0, and kappa collapse to the raw accuracy -- the number the statistic
// exists to correct, reported as though it had been corrected.
test('kappa is not the raw accuracy wearing a hat', () => {
  const score = probeScore(FOUR)
  assert.notEqual(score.kappa, score.accuracy, 'p_e must be computed over relabelled predictions')
  assert.ok(score.kappa < score.accuracy, 'and it must be below the accuracy here, by construction')
})

test('the confusion matrix counts truth as rows and the offered options as columns', () => {
  const score = probeScore(FOUR)
  assert.deepEqual(score.confusion.rows, ['admit', 'draft'])
  assert.deepEqual(score.confusion.columns, [...PROBE_LABELS])
  const at = (seam, label) => score.confusion.counts[score.confusion.rows.indexOf(seam)][score.confusion.columns.indexOf(label)]
  assert.equal(at('admit', 'admitting_a_step'), 2)
  assert.equal(at('draft', 'model_output'), 1)
  assert.equal(at('draft', 'admitting_a_step'), 1)
  assert.equal(at('admit', 'model_output'), 0)
})

// --- the bucket that must not be the denominator ------------------------------------------------------
test('an unreadable answer is its own bucket, never a wrong answer', () => {
  const score = probeScore([...FOUR, callEvent('draft', { type: 'unreadable', reason: 'no answer' })])
  assert.equal(score.calls, 5, 'it IS a probe call')
  assert.equal(score.scored, 4, 'and it is NOT a scored one')
  assert.equal(score.unreadable, 1)
  assert.equal(score.accuracy, 0.75, 'the accuracy is unchanged by a call nobody could read')
})

test('an abstention is scored, excluded from the selective figure, and counted as one', () => {
  const score = probeScore([...FOUR, callEvent('draft', { type: 'choice', label: ABSTAIN_LABEL, confidence: 0.4 })])
  assert.equal(score.scored, 5)
  assert.equal(score.abstain.count, 1)
  assert.equal(score.abstain.rate, 0.2)
  assert.equal(score.accuracy, 0.6, '3 of 5')
  assert.equal(score.selective.accuracy, 0.75, '3 of the 4 it was willing to answer')
})

// --- the honesty flags --------------------------------------------------------------------------------
test('a per-seam rate over too few calls says so instead of looking like a result', () => {
  const score = probeScore(FOUR)
  const admit = score.seams.find((seam) => seam.seam === 'admit')
  assert.equal(admit.n, 2)
  assert.equal(admit.thin, true, 'n < 30 cannot support a rate')
})

test('the instrument is carried with its hash, so an edited question is a different instrument', () => {
  const score = probeScore(FOUR)
  assert.equal(score.instrument.instructions, PROBE_QUESTION.instructions)
  assert.deepEqual(score.instrument.labels, [...PROBE_LABELS])
  assert.match(score.instrument.hash, /^[0-9a-f]{12}$/)
})

test('every label maps to a seam, and only the abstain option does not', () => {
  const mapped = Object.keys(SEAM_OF_LABEL)
  assert.equal(mapped.length, PROBE_LABELS.length - 1)
  for (const label of mapped) assert.ok(PROBE_LABELS.includes(label), `${label} must be an offered option`)
  assert.equal(Object.hasOwn(SEAM_OF_LABEL, ABSTAIN_LABEL), false, 'the abstain option is not a seam')
})

test('an empty run scores nothing rather than dividing by zero', () => {
  const score = probeScore([])
  assert.equal(score.calls, 0)
  assert.equal(score.accuracy, null)
  assert.equal(score.majority.floor, null)
  assert.equal(score.kappa, null)
  assert.deepEqual(score.seams, [])
})
