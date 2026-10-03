// THE LABELLED BATTERY: the gate that tells BETTER from DIFFERENT, and every rule in it is a way a battery could
// flatter a question instead of measuring it. Each refusal below is one of those ways.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { batteryHash, checkBattery, coveredQuestions, isCorrect, MIN_CASES, parseBattery, scoreBattery } from '../lib/battery.js'

const cases = (n) => Array.from({ length: n }, (_, i) => ({ id: 'c' + i, state: 'state ' + i, expected: { q: true } }))
const batteryOf = (n) => parseBattery(JSON.stringify({ cases: cases(n) })).battery

test('a battery that cannot separate a better question from a luckier one is REFUSED, by name', () => {
  // THE FLOOR IS THE POINT. Four correct out of five is the smallest battery whose accuracy can move at all; a rate
  // over three cases moves by 33 points per case and would decide a rewrite on a coin toss.
  const thin = parseBattery(JSON.stringify({ cases: cases(MIN_CASES - 1) }))
  assert.equal(thin.battery, null)
  assert.match(thin.problem, /cannot separate a better question from a luckier one: the floor is 5/)
  assert.notEqual(batteryOf(MIN_CASES), null, 'and the floor itself is allowed')

  for (const [label, body, expected] of [
    ['not JSON', 'nonsense', /is not JSON/],
    ['no cases', JSON.stringify({}), /must have a `cases` array/],
    ['no state', JSON.stringify({ cases: [{ id: 'a', expected: { q: true } }] }), /has no `state`/],
    ['no expected', JSON.stringify({ cases: [{ id: 'a', state: 's' }] }), /nothing is expected of cannot be wrong/],
    ['empty expected', JSON.stringify({ cases: [{ id: 'a', state: 's', expected: {} }] }), /nothing is expected of/],
    ['no id', JSON.stringify({ cases: [{ state: 's', expected: { q: true } }] }), /needs a non-empty id/],
  ]) {
    const read = parseBattery(body)
    assert.equal(read.battery, null, label)
    assert.match(read.problem, expected, label)
  }
  // A DUPLICATE ID IS REFUSED because a case has to be identifiable before its result can be argued about.
  const dup = parseBattery(JSON.stringify({ cases: [...cases(4), { id: 'c0', state: 's', expected: { q: true } }, { id: 'c5', state: 's', expected: { q: true } }] }))
  assert.equal(dup.battery, null)
  assert.match(dup.problem, /two cases share the id "c0"/)
})

test('the hash is the CASES, so reformatting is the same instrument and a changed label is not', () => {
  const one = batteryHash(batteryOf(5))
  const formatted = parseBattery(JSON.stringify({ appliesTo: 'anything', rationale: 'a note', cases: cases(5) }, null, 2)).battery
  assert.equal(batteryHash(formatted), one, '`appliesTo` and `rationale` explain a battery, they do not measure with it')
  const relabelled = parseBattery(JSON.stringify({ cases: cases(5).map((c, i) => (i === 0 ? { ...c, expected: { q: false } } : c)) })).battery
  assert.notEqual(batteryHash(relabelled), one, 'a changed expectation is a different instrument')
  assert.deepEqual(coveredQuestions(batteryOf(5)), ['q'])
})

test('a battery and a set must cover each other, IN BOTH DIRECTIONS', () => {
  const battery = parseBattery(JSON.stringify({ cases: cases(5).map((c) => ({ ...c, expected: { asks: true, never_asked: true } })) })).battery
  const check = checkBattery(battery, ['asks', 'uncovered'])
  assert.equal(check.problems.length, 2)
  assert.match(check.problems[0], /expectations for question\(s\) the set does not ask: never_asked/)
  assert.match(check.problems[0], /permanent misses/)
  assert.match(check.problems[1], /asks question\(s\) the battery does not cover: uncovered/)
  assert.match(check.problems[1], /an unreported absence reads as a pass/)
  assert.deepEqual(checkBattery(battery, ['asks', 'never_asked']).problems, [], 'a matched pair is silent')
})

test('the expectation TYPE decides the comparison, and a mismatch is refused rather than counted wrong', () => {
  // A NOUL takes true or false; the probability decides.
  assert.equal(isCorrect({ type: 'noul', probability: 0.8 }, true).correct, true)
  assert.equal(isCorrect({ type: 'noul', probability: 0.8 }, false).correct, false)
  assert.equal(isCorrect({ type: 'noul', probability: 0.4 }, false).correct, true)
  assert.match(isCorrect({ type: 'noul', probability: 0.8 }, 'yes').reason, /needs true or false/)
  // A CHOICE takes a label, and the ABSTAIN option is a legitimate expectation -- which is what stops a battery
  // punishing a question for refusing to guess.
  assert.equal(isCorrect({ type: 'choice', label: 'unclear' }, 'unclear').correct, true)
  assert.equal(isCorrect({ type: 'choice', label: 'x' }, 'y').correct, false)
  assert.match(isCorrect({ type: 'choice', label: 'x' }, true).reason, /needs a label/)
  // A SCORE IS SCORED BY DISTRIBUTION, NOT BY ROUNDING: the mean can round a near-tie into an answer nobody gave.
  const score = { type: 'score', level: 0.6, probabilities: { no: 0.45, yes: 0.55 } }
  assert.equal(isCorrect(score, 'yes').correct, true, 'the most probable level is the answer')
  assert.equal(isCorrect(score, 'no').correct, false)
  assert.match(isCorrect({ type: 'score', level: 1 }, 'yes').reason, /no distribution/)
  // AN UNREADABLE ANSWER IS UNREADABLE, not wrong, so it is counted in its own column.
  assert.equal(isCorrect({ type: 'unreadable', reason: 'no probability' }, true).readable, false)
  assert.equal(isCorrect(undefined, true).readable, false)
  assert.match(isCorrect({ type: 'mystery' }, true).reason, /is not one this can score/)
})

test('a rate is published only at or above the floor, and a type mismatch refuses the whole run', () => {
  const battery = parseBattery(JSON.stringify({ cases: cases(5).map((c, i) => ({ ...c, expected: { q: i < 3 } })) })).battery
  const good = scoreBattery({
    battery,
    answersByCase: Object.fromEntries(cases(5).map((c, i) => [c.id, { q: { type: 'noul', probability: i < 3 ? 0.9 : 0.1 } }])),
    questionTypes: { q: 'noul' },
  })
  assert.deepEqual(good.refusals, [])
  assert.equal(good.perQuestion[0].n, 5)
  assert.equal(good.perQuestion[0].correct, 5)
  assert.equal(good.perQuestion[0].accuracy, 1)
  assert.deepEqual(good.perCase.map((entry) => entry.wrong.length), [0, 0, 0, 0, 0])

  // A WRONG ANSWER IS REPORTED WITH WHAT WAS EXPECTED, so a run can be INSPECTED rather than only counted.
  const mixed = scoreBattery({
    battery,
    answersByCase: Object.fromEntries(cases(5).map((c, i) => [c.id, { q: { type: 'noul', probability: i === 0 ? 0.1 : 0.9 } }])),
    questionTypes: { q: 'noul' },
  })
  // THREE CASES EXPECT `true` AND TWO EXPECT `false`; answering `true` to all five is right twice.
  assert.equal(mixed.perQuestion[0].correct, 2)
  assert.equal(mixed.perCase[0].wrong.length, 1, 'the case that expected `true` and was answered `false`')
  assert.equal(mixed.perCase[0].wrong[0].expected, true)
  assert.equal(mixed.perCase[4].wrong.length, 1, 'and the cases that expected `false` are wrong too')

  // A MISMATCHED EXPECTATION REFUSES THE RUN: it says the question was wrong when the BATTERY was.
  const mismatched = scoreBattery({
    battery: parseBattery(JSON.stringify({ cases: cases(5).map((c) => ({ ...c, expected: { q: 'a label' } })) })).battery,
    answersByCase: Object.fromEntries(cases(5).map((c) => [c.id, { q: { type: 'noul', probability: 0.9 } }])),
    questionTypes: { q: 'noul' },
  })
  assert.match(mismatched.refusals.join(' '), /do not match the type of the question they are for/)
})
