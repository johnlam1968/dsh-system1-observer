// THE SCHEDULED LINE, AND THE CHECK THAT IT IS NOT THE PROBE'S. The check REFUSES TO PASS ON SILENCE: a line that
// does not name its questions is a violation, because a checker that looked only for a `probe: true` field would
// pass every line that omits it -- including lines written before the field existed -- and would certify exactly
// the traces it cannot read.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { turnLine, probeViolations, SEAM_HOOKS } from '../lib/turn-record.js'

test('a scheduled line is a call under `turn`, which is deliberately not a seam', () => {
  const line = turnLine({ sessionId: 'session-a', turn: 5, questionIds: ['a_noul', 'a_noul', 'a_score'], dropped: ['b'], executed: { provider: 'typesafe' }, durationMs: 812.5, worstCase: null })
  assert.equal(line.event, 'call')
  assert.equal(line.hook, 'turn')
  assert.equal(SEAM_HOOKS.includes('turn'), false, 'the hook must not be one of the seams')
  assert.deepEqual(line.questionIds, ['a_noul', 'a_score'], 'deduplicated, in order')
  assert.deepEqual(line.dropped, ['b'])
  assert.deepEqual(line.executed, { provider: 'typesafe' })
  assert.equal(line.durationMs, 812.5)
  assert.equal(Object.hasOwn(line, 'worstCase'), false, 'a null object field is dropped, as the tool does')
})

test('a scheduled line without questions is refused rather than written', () => {
  assert.throws(() => turnLine({ sessionId: 'session-a', turn: 1 }), /must name at least one question/)
  assert.throws(() => turnLine({ sessionId: 'session-a', turn: 1, questionIds: ['  '] }), /must name at least one question/)
  assert.throws(() => turnLine({ turn: 1, questionIds: ['x'] }), /`sessionId` is required/)
  assert.throws(() => turnLine({ sessionId: 'session-a', turn: 0, questionIds: ['x'] }), /positive integer/)
})

test('the check passes the line the writer writes -- they cannot drift', () => {
  assert.deepEqual(probeViolations([turnLine({ sessionId: 'session-a', turn: 5, questionIds: ['a_noul'] })]), [])
})

test('a seam call is left alone: it never named its questions and does not need to', () => {
  assert.deepEqual(probeViolations([{ event: 'call', hook: 'draft', agentId: 'a' }]), [])
  assert.deepEqual(probeViolations([{ event: 'call', hook: 'admit' }]), [])
})

test('the probe under a non-seam hook is a violation, by id', () => {
  const found = probeViolations([{ event: 'call', hook: 'turn', questionIds: ['probe', 'a_noul'] }])
  assert.equal(found.length, 1)
  assert.match(found[0].reason, /the probe question was asked under the non-seam hook "turn"/)
})

test('SILENCE IS A VIOLATION: a non-seam call that does not name its questions cannot be shown not to be the probe', () => {
  const found = probeViolations([{ event: 'call', hook: 'turn' }, { event: 'call', hook: 'some_future_hook', questionIds: ['x'] }])
  assert.equal(found.length, 1, 'only the silent one is reported')
  assert.match(found[0].reason, /does not name its questions/)
  assert.equal(found[0].index, 0)
})

test('junk lines are not violations and do not throw', () => {
  assert.deepEqual(probeViolations([null, 7, 'x', { event: 'mount' }, { event: 'skip', hook: 'turn' }]), [])
  assert.deepEqual(probeViolations(), [])
})
