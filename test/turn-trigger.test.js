// THE TRIGGER'S DECISIONS. Two refusals carry measurements behind them, and both are asserted here rather than
// described: a turn with no set of its own must NOT fall back to the probe question, and a question that needs the
// operator's next message must not be asked while the turn is open.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { shouldFire, turnQuestions } from '../lib/turn-trigger.js'
import { PROBE_QUESTION } from '../lib/seams.js'
import { ABSTAIN_LABEL } from '../lib/probe-score.js'

/** A criteria directory with the compositions these tests select, written here so no shipped corpus is edited. */
function setsDir() {
  const dir = mkdtempSync(join(tmpdir(), 'turn-trigger-'))
  mkdirSync(join(dir, 'turn-trial'), { recursive: true })
  writeFileSync(join(dir, 'turn-trial', 'turn.json'), JSON.stringify(SPECS))
  mkdirSync(join(dir, 'session-only'), { recursive: true })
  writeFileSync(join(dir, 'session-only', 'session.json'), JSON.stringify(SPECS))
  return dir
}

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

// REGISTER ROW O25. `turnSpecs` read `config.questions.turn` directly, so a row that SELECTED a set declaring `turn`
// was refused with "no question set is configured under turn" -- a reason that was not true -- and the scheduled
// measurement never ran. Measured before the fix on the shipped corpus:
//   turnQuestions({config: {questionSetsDir: 'criteria', questionSet: 'helpfulness-set@1'}}) -> refused: true
// although that set declares nine `turn` questions.
test('a SELECTED SET is resolved FIRST, so the turn gate is not set-blind', () => {
  const dir = setsDir()
  const out = turnQuestions({ config: { questionSetsDir: dir, questionSet: 'turn-trial' }, closed: true })
  assert.equal(out.refused, false, 'a set that declares `turn` is asked, whatever the inline map says: ' + out.reason)
  assert.deepEqual(Object.keys(out.questions).sort(), ['a_choice', 'a_noul', 'a_score'])
})

test('a set that declares NO turn scope is refused BY NAME, not as "nothing configured"', () => {
  // THE TWO REFUSALS ARE DIFFERENT FACTS. Telling an operator "no question set is configured under turn" when they
  // selected one sends them to look for a missing file; the file is there and simply says nothing about turns.
  const dir = setsDir()
  const out = turnQuestions({ config: { questionSetsDir: dir, questionSet: 'session-only' } })
  assert.equal(out.refused, true)
  assert.match(out.reason, /selected set `session-only` declares no "turn" scope/, 'the set is named: ' + out.reason)
  assert.doesNotMatch(out.reason, /no question set is configured/)
  // AND A SELECTED SET THAT CANNOT BE READ IS ITS OWN CASE TOO, rather than the generic one above.
  const broken = turnQuestions({ config: { questionSetsDir: dir, questionSet: 'does-not-exist' } })
  assert.equal(broken.refused, true)
  assert.doesNotMatch(broken.reason, /no question set is configured under/)
})

// THE OTHER HALF OF REGISTER ROW O17. A probe row at `turn` is `correct: false` ALWAYS (`lib/probe-score.js`:
// `expected` is `LABEL_OF_SEAM[hook]`, and there is no seam called `turn`), so the scorer no longer scores one. That
// makes a hand-written probe in the `turn` scope UNSCORED -- and unscored by silence is what this repository refuses.
// It is refused by name instead.
test('a `turn` scope that asks the PROBE question is refused, not asked and never scored', () => {
  // THE BUILT-IN PROBE, REBUILT AS A SPEC: one option must be the abstain one, or the loader refuses the shape first.
  const probe = {
    id: 'probe', type: 'choice', instructions: PROBE_QUESTION.instructions,
    options: Object.entries(PROBE_QUESTION.criteria).map(([label, criterion]) => ({ label, criterion, ...(label === ABSTAIN_LABEL ? { abstain: true } : {}) })),
  }
  const out = turnQuestions({ config: { questions: { turn: [probe] } } })
  assert.equal(out.refused, true)
  assert.match(out.reason, /`probe` IS the probe question/, 'named, so the fix is obvious: ' + out.reason)
  assert.deepEqual(out.questions, {})
  // AND A REWORDED PROBE IS STILL THE PROBE: the row's own `probeQuestion` is what identity is judged against.
  const reworded = turnQuestions({ config: { probeQuestion: 'Which part of OUR loop produced this?', questions: { turn: [{ ...probe, instructions: 'Which part of OUR loop produced this?' }] } } })
  assert.equal(reworded.refused, true, 'a row that reworded its probe is judged against ITS wording')
  // WHILE AN ORDINARY TURN SET IS UNTOUCHED, which is the case every working row is in.
  assert.equal(turnQuestions({ config: configured, closed: true }).refused, false)
})
