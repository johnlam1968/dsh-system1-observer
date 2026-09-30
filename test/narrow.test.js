// THE THREE UNCHECKED INVARIANTS, pinned here because this is "the module every gate's correctness rests on"
// (`lib/model/service.js`) and it validated only one of the four things that can be wrong with a reply.
//
// Every case below was executed against the previous version and ACCEPTED: a `NaN` probability, an answer whose
// declared type contradicted the question, and a probability vector summing to 1.8. Each is now RECORDED rather
// than discarded, because all three are readable -- and a readable answer that is wrong is the most interesting
// thing a judge can send back, which is exactly what a throwaway cannot show.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { narrowAnswers } from '../lib/model/narrow.js'
import { choice, noul, score } from '../lib/model/questions.js'

const QUESTION = choice('what is it doing?', [
  { label: 'an_answer', criterion: 'a reply to the operator' },
  { label: 'a_tool_call', criterion: 'a request to run a tool' },
  { label: 'unclear', criterion: 'it cannot be told', abstain: true },
])
const NOUL = noul('is this complete?', { true: 'complete', false: 'not complete' })
const SCORED = score('how far along?', ['nothing', 'partial', 'complete'])
const read = (raw, question = QUESTION, qid = 'probe') =>
  narrowAnswers({ answers: { [qid]: raw } }, { [qid]: question }).answers[qid]

// --- 3.1 ---------------------------------------------------------------------------------------------
// `typeof NaN === 'number'`, so this passed every check, and `JSON.stringify` writes NaN as null -- the line
// read `"probability": null`, which looks exactly like "no answer was read".
test('a NaN probability is refused a number slot and named, not silently written as null', () => {
  const answer = read({ noul: NaN, confidence: NaN }, NOUL)
  assert.equal(answer.type, 'noul', 'still an answer: it is readable, so it is not "unreadable"')
  assert.equal(answer.probability, null, 'JSON can only carry this as null, so it is null ON PURPOSE')
  assert.equal(answer.confidence, null)
  assert.equal(answer.invalid, true)
  assert.match(answer.invalidReason, /not a finite number/)
})

// The poisoning this prevents: a mean over [0.9, 0.8, NaN, 0.7] is NaN, so one bad call destroyed every
// aggregate for the whole run.
test('a NaN inside a probability vector can no longer win Math.max or poison a confidence', () => {
  const answer = read({ choice: 'an_answer', probabilities: { an_answer: NaN, a_tool_call: 0.6, unclear: NaN } })
  assert.equal(answer.confidence, 0.6, 'the largest FINITE value, not NaN')
  assert.deepEqual(answer.probabilities, { an_answer: null, a_tool_call: 0.6, unclear: null })
  assert.match(answer.invalidReason, /not finite numbers/)
})

test('a probability outside [0,1] is recorded, and the sum is not reported twice', () => {
  const answer = read({ choice: 'an_answer', probabilities: { an_answer: 1.4, a_tool_call: -0.4, unclear: 0 } })
  assert.equal(answer.invalid, true)
  assert.match(answer.invalidReason, /outside \[0,1\]/)
  assert.doesNotMatch(answer.invalidReason, /sum to/, 'a sum over failed values says nothing')
})

// --- 3.2 ---------------------------------------------------------------------------------------------
// The module branches on `question.type` and reads the matching field, so a reply that declared another type
// was accepted as though it had answered correctly.
test('an answer that declares the wrong type is recorded as a defect, not as a valid answer', () => {
  const answer = read({ type: 'choice', noul: 0.9 }, NOUL)
  assert.equal(answer.type, 'noul')
  assert.equal(answer.probability, 0.9, 'the answer is kept: refusing it would discard a fact about the server')
  assert.equal(answer.invalid, true)
  assert.match(answer.invalidReason, /declares type "choice" for a noul question/)
})

test('an answer that declares no type at all is not accused of one', () => {
  const answer = read({ noul: 0.9 })
  assert.equal(Object.hasOwn(answer, 'invalid'), false, 'nothing to compare, so nothing to report')
})

// --- 3.3 ---------------------------------------------------------------------------------------------
test('a distribution that does not sum to 1 is recorded with its own sum', () => {
  const answer = read({ choice: 'an_answer', probabilities: { an_answer: 0.9, a_tool_call: 0.9, unclear: 0 } })
  assert.equal(answer.invalid, true)
  assert.match(answer.invalidReason, /probabilities sum to 1\.80/)
})

test('a distribution keyed to labels the question never offered is recorded', () => {
  const answer = read({ choice: 'an_answer', probabilities: { an_answer: 0.5, invented: 0.5 } })
  assert.equal(answer.invalid, true)
  assert.match(answer.invalidReason, /probabilities carry 2 key\(s\) where the question offered 3/)
})

test('a distribution within tolerance is not a defect', () => {
  const answer = read({ choice: 'an_answer', probabilities: { an_answer: 0.51, a_tool_call: 0.48, unclear: 0.02 } })
  assert.equal(Object.hasOwn(answer, 'invalid'), false, '1.01 is inside the tolerance the servers use')
})

// --- the remaining range checks from the same section --------------------------------------------------
test('a score outside the levels the question offered is recorded', () => {
  const answer = read({ score: 7, confidence: 0.5, probabilities: { 0: 0, 1: 0, 2: 1 } }, SCORED)
  assert.equal(answer.invalid, true)
  assert.match(answer.invalidReason, /outside the 3 level\(s\)/)
})

test('a score distribution keyed by level index is accepted, and the level is finite', () => {
  const answer = read({ score: 1.4, confidence: 0.3, probabilities: { 0: 0.1, 1: 0.4, 2: 0.5 } }, SCORED)
  assert.equal(Object.hasOwn(answer, 'invalid'), false)
  assert.equal(answer.level, 1.4)
})

test('a confidence outside [0,1] is recorded and KEPT, because the value is the evidence', () => {
  const answer = read({ choice: 'an_answer', confidence: 1.5, answer_confidence: 2 })
  assert.equal(answer.confidence, 1.5, 'only a value JSON cannot carry is nulled')
  assert.equal(answer.answerConfidence, 2)
  assert.match(answer.invalidReason, /confidence 1\.5 is not a finite number in \[0,1\]/)
  assert.match(answer.invalidReason, /answer_confidence 2 is not a finite number in \[0,1\]/)
})

// --- and the unchanged half: a reply we cannot read is still unreadable, not invalid ------------------
test('an unreadable answer stays unreadable, because it cannot be read at all', () => {
  const missing = read({})
  assert.equal(missing.type, 'unreadable')
  assert.equal(Object.hasOwn(missing, 'invalid'), false)

  const invented = read({ choice: 'maybe' })
  assert.equal(invented.type, 'unreadable')
  assert.match(invented.reason, /which the question never offered/)

  const notANumber = read({ score: 'high' }, SCORED)
  assert.equal(notANumber.type, 'unreadable')
})

test('a body with no answers object is still one top-level error', () => {
  assert.deepEqual(narrowAnswers({}, { probe: QUESTION }), {
    kind: 'error', reason: 'the response carried no answers object',
  })
})

test('a clean answer carries no invalid field at all', () => {
  const answer = read({ choice: 'a_tool_call', confidence: 0.8, answer_confidence: 0.93, probabilities: { an_answer: 0.05, a_tool_call: 0.9, unclear: 0.05 } })
  assert.equal(Object.hasOwn(answer, 'invalid'), false, 'absent, not false: an unmarked answer is the normal case')
  assert.equal(answer.label, 'a_tool_call')
  assert.equal(answer.answerConfidence, 0.93)
})
