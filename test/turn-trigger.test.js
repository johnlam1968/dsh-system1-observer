// THE TRIGGER'S DECISIONS. Two refusals carry measurements behind them, and both are asserted here rather than
// described: a turn with no set of its own must NOT fall back to the probe question, and a question that needs the
// operator's next message must not be asked while the turn is open.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shouldFire, turnQuestions } from '../lib/turn-trigger.js'

const SPECS = [
  { id: 'a_noul', type: 'noul', instructions: 'Is this true?' },
  { id: 'a_score', type: 'score', instructions: 'How much?', levels: ['low', 'high'] },
  { id: 'a_choice', type: 'choice', instructions: 'Which?', options: [{ label: 'x', criterion: 'it is x' }, { label: 'none', criterion: 'none fits', abstain: true }] },
]
const configured = { questions: { turn: SPECS } }

test('it fires on every Nth turn, and only then', () => {
  assert.equal(shouldFire({ turn: 5, everyNTurns: 5 }), true)
  assert.equal(shouldFire({ turn: 6, everyNTurns: 5 }), false)
  assert.equal(shouldFire({ turn: 10, everyNTurns: 5 }), true)
  assert.equal(shouldFire({ turn: 5, everyNTurns: 5, enabled: false }), false, 'the knob is the agent\'s, and off means off')
  assert.equal(shouldFire({ turn: 0, everyNTurns: 5 }), false, 'turn numbering is 1-based')
  assert.equal(shouldFire({ turn: 5, everyNTurns: 0 }), false)
  assert.equal(shouldFire({ turn: 5, everyNTurns: 2.5 }), false)
  assert.equal(shouldFire(), false)
})

test('a turn with NO set refuses, and never falls back to the probe question', () => {
  const out = turnQuestions({ config: { questions: { turn: [] } } })
  assert.equal(out.refused, true)
  assert.match(out.reason, /no question set is configured under "turn"/)
  assert.match(out.reason, /corrupt the probe's calibration/)
  assert.deepEqual(out.questions, {}, 'an empty map, NOT { probe: ... }')
  assert.equal(Object.hasOwn(out.questions, 'probe'), false)
})

// The plan's §9.3 property, in the form a runtime can enforce: the probe is scored against the seam a call came
// from, and `turn` is not a seam -- measured, that scores accuracy 0 and would corrupt a published figure.
test('the questions a turn asks are never the probe', () => {
  const out = turnQuestions({ config: configured, closed: true })
  assert.equal(out.refused, false)
  assert.deepEqual(Object.keys(out.questions).sort(), ['a_choice', 'a_noul', 'a_score'])
  assert.equal(Object.hasOwn(out.questions, 'probe'), false)
})

test('an OPEN turn drops the questions that need the operator to have replied', () => {
  const open = turnQuestions({ config: configured, closed: false, needsNextMessage: ['a_noul', 'a_score'] })
  assert.deepEqual(Object.keys(open.questions), ['a_choice'], 'what cannot be answered is not asked')
  assert.deepEqual(open.dropped.sort(), ['a_noul', 'a_score'])
  const closed = turnQuestions({ config: configured, closed: true, needsNextMessage: ['a_noul', 'a_score'] })
  assert.deepEqual(Object.keys(closed.questions).sort(), ['a_choice', 'a_noul', 'a_score'], 'and asked once it closes')
  assert.deepEqual(closed.dropped, [])
})

test('a malformed set refuses the whole turn rather than asking part of it', () => {
  const out = turnQuestions({ config: { questions: { turn: [{ id: 'bad', type: 'score', instructions: 'How?', levels: ['one'] }] } } })
  assert.equal(out.refused, true)
  assert.match(out.reason, /bad|at least two/)
  assert.deepEqual(out.questions, {})
})

test('a next-message id that is not in the set is ignored, not invented', () => {
  const out = turnQuestions({ config: configured, closed: false, needsNextMessage: ['not_a_question'] })
  assert.deepEqual(out.dropped, [])
  assert.equal(Object.keys(out.questions).length, 3)
})
