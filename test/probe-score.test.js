// THE ACCURACY FIGURE THE README PROMISED AND NOTHING COMPUTED.
//
// These tests are written so that the arithmetic is checkable by hand: a four-call fixture whose accuracy,
// majority floor and κ are all computable on paper. The point is the κ, because that is where a plausible
// implementation is silently wrong.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { probeFingerprint, ABSTAIN_LABEL, PROBE_LABELS, SEAM_OF_LABEL, isProbeQuestion, probeAnswerOf, probeScore } from '../lib/probe-score.js'
import { PROBE_QUESTION } from '../lib/seams.js'
import { noul } from '../lib/model/questions.js'
import { probeOf } from '../lib/questions.js'

/** One `call` line as the observer writes it, with the probe asked under whatever id is given. */
function callEvent(hook, answer, { qid = 'probe', question = PROBE_QUESTION, at = '2026-01-02T00:00:00.000Z' } = {}) {
  return { at, event: 'call', hook, questions: { [qid]: question }, answer: { answers: { [qid]: answer } } }
}

// --- the identity predicate, which is the whole reason this is not scored by seam or by id --------------
test('O15: a trace written under ANOTHER probe is scored by the hash ITS OWN RUN recorded', () => {
  // The reader must not depend on the row's CURRENT question. Each call line carries the question it asked, and each
  // run's mount line carries the fingerprint of the question in force when it started, so the two join per RUN. Before
  // this, a row that reworded its probe and then read its own older trace found no probe calls at all: the calibration
  // read EMPTY rather than wrong, which is the failure mode that hides.
  const oldText = 'Which part of the OLD loop produced this?'
  const newText = 'Which part of the NEW loop produced this?'
  const oldQuestion = { ...PROBE_QUESTION, instructions: oldText }
  const mount = { event: 'mount', run: 'R1', probeHash: probeFingerprint(oldText) }
  const call = { event: 'call', run: 'R1', hook: 'admit', questions: { probe: oldQuestion } }
  // The row is configured for the NEW text now, so by the live question alone the old line matches nothing.
  assert.equal(probeAnswerOf(call, newText), null, 'by the live text alone, an older run\u2019s probe is invisible')
  assert.notEqual(probeAnswerOf(call, { instructions: newText, probeHash: mount.probeHash }), null,
    'but its own run says what it asked, and that is the identity that holds')
  // AND THE SCORER JOINS IT ITSELF: every window that carries calls carries the mount that opened them.
  assert.notDeepEqual(probeScore([mount, call]), probeScore([call]),
    'the mount line must change what is scored, or the join is not happening')
  // A run whose mount hash matches NOTHING is still not a probe, so the join cannot make every call a probe.
  const stranger = { event: 'call', run: 'R2', hook: 'admit', questions: { probe: oldQuestion } }
  assert.equal(probeAnswerOf(stranger, { instructions: newText, probeHash: probeFingerprint('something else') }), null,
    'a line whose question matches neither identity is not a probe call')
})

test('a call from a NON-PROBE site is never scored, however it is worded', () => {
  // `system1_decide` records `hook: 'tool'` (lib/decide-tool.js:212 -- "`hook: 'tool'` is not a seam") and a stored
  // session evaluation will record its own hook. Either can carry the probe question BY IDENTITY and is still not a
  // measurement of this row's probe. The filter is what makes that a rule rather than a coincidence.
  const mount = { event: 'mount', run: 'R1', probeHash: probeFingerprint() }
  const call = { event: 'call', run: 'R1', hook: 'tool', questions: { probe: PROBE_QUESTION } }
  assert.equal(probeAnswerOf(call), null, 'a tool call is not a probe, even carrying the probe question')
  assert.notEqual(probeAnswerOf({ ...call, hook: 'draft' }), null, 'while the same line AT a seam is one')
  assert.notDeepEqual(probeScore([mount, call]), probeScore([mount, { ...call, hook: 'draft' }]),
    'and the score sees the difference rather than averaging the two together')
  // THE TURN MEASUREMENT MUST STAY SCORABLE: it is a probe site too, and a filter that dropped it would silently
  // remove the scheduled measurement from every calibration in the report.
  assert.notEqual(probeAnswerOf({ ...call, hook: 'turn' }), null, 'the scheduled turn measurement is still scored')
  // AND THE STORED-SESSION EVALUATION'S OWN HOOK IS NOT A SITE, which is the requirement §11 states.
  assert.equal(probeAnswerOf({ ...call, hook: 'session-review' }), null, 'a stored evaluation contributes no probe rows')
})

test('a reworded probe is SCORED as a probe when the row says which question it asked', () => {
  // The end-to-end half of the identity change, shape-agnostic on purpose: without the second argument a row's own
  // calls are judged "not the probe" and every calibration over them is silently empty -- a wrong number rather than
  // a missing one.
  const mine = { ...PROBE_QUESTION, instructions: 'Which part of OUR loop produced this?' }
  const event = { event: 'call', hook: 'admit', questions: { probe: mine } }
  assert.equal(probeAnswerOf(event), null, 'against the built-in, this call is not a probe call')
  assert.notEqual(probeAnswerOf(event, mine.instructions), null, 'against its own row it is')
  assert.notDeepEqual(probeScore([event], { probeInstructions: mine.instructions }), probeScore([event]),
    'and the score computed over it is not the score computed without it')
})

test('the identity follows the INSTRUCTIONS, so a reworded probe is still the probe it was asked as', () => {
  // THE ASYMMETRY IS THE CODE'S OWN, NOT A PREFERENCE: `probeFingerprint` hashes the instructions -- the instrument's
  // identity -- while `isProbeQuestion` treats the CRITERIA as fixed, on the stated ground that a reworded criterion
  // is the same instrument because only the labels decide what an answer means. So the question TEXT is configurable
  // and the answer SET is not. Without the parameter below, a reworded row would have every call judged "not the
  // probe" and dropped from every calibration, silently.
  const mine = { ...PROBE_QUESTION, instructions: 'Which part of OUR loop produced this?' }
  assert.equal(isProbeQuestion(mine), false, 'against the built-in, a reworded question is a different instrument')
  assert.equal(isProbeQuestion(mine, mine.instructions), true, 'against its own row it is the probe')
  assert.notEqual(probeFingerprint(mine.instructions), probeFingerprint(), 'and the mount hash says so')
  assert.equal(probeFingerprint('same text'), probeFingerprint('same text'), 'the hash is a function of the text alone')
  assert.deepEqual(Object.keys(mine.criteria), Object.keys(PROBE_QUESTION.criteria), 'the labels are unchanged')
})

test('probeOf takes the question from the config, and an empty one is a NAMED problem', () => {
  assert.equal(probeOf({}).configured, false, 'nothing configured')
  assert.equal(probeOf({}).question, PROBE_QUESTION, 'absent is the constant itself, by reference')
  assert.equal(probeOf({}).problem, null, 'and that is not a problem')
  // PRESENT BUT UNUSABLE IS NAMED, not silent: a row that quietly reverted to a question nobody chose is the failure
  // this repository keeps refusing.
  assert.equal(probeOf({ probeQuestion: '   ' }).problem, 'probeQuestion: an empty string; the built-in question is in force')
  assert.equal(probeOf({ probeQuestion: '' }).configured, false)
  const mine = probeOf({ probeQuestion: '  Which bit is this?  ' })
  assert.equal(mine.configured, true)
  assert.equal(mine.instructions, 'Which bit is this?', 'trimmed')
  assert.equal(mine.question.type, 'choice', 'and still a choice question with the built-in answers')
  // THE ANSWERS ARE KEPT WHOLE -- label, criterion text and the abstain label -- because only the INSTRUCTIONS are
  // configurable. My first version asserted `criteria.unclear.abstain`, which does not exist: the criterion is its
  // text, and the abstain marker belongs to the built question rather than to the criterion.
  assert.equal(Object.hasOwn(mine.question.criteria, ABSTAIN_LABEL), true, 'the abstain label survives, which is what keeps the question well-posed')
  assert.equal(mine.question.criteria.unclear, 'none of these fits the text', 'and the criterion text comes with it')
})

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
