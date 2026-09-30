// THE TURN LISTENER. It counts boundaries and answers one question -- fire, and with which questions? -- so the
// model call and the trace line stay with the caller and this can be tested without a session or a backend.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTurnListener } from '../lib/turn-listener.js'

const SPECS = [
  { id: 'a_noul', type: 'noul', instructions: 'Is this true?' },
  { id: 'a_score', type: 'score', instructions: 'How much?', levels: ['low', 'high'] },
]
const config = { questions: { turn: SPECS } }
const listener = (over = {}) => createTurnListener({ everyNTurns: 3, readConfig: () => config, ...over })

test('it fires on every Nth boundary and counts the turns between', () => {
  const l = listener()
  const session = { sessionId: 'session-a' }
  assert.deepEqual(l.onAdmit(session), { fire: false, turn: 1 })
  assert.deepEqual(l.onAdmit(session), { fire: false, turn: 2 })
  const third = l.onAdmit(session)
  assert.equal(third.fire, true)
  assert.equal(third.turn, 3)
  assert.deepEqual(third.questionIds, ['a_noul', 'a_score'])
  assert.equal(l.turnOf('session-a'), 3)
  assert.deepEqual(l.onAdmit(session), { fire: false, turn: 4 })
  assert.equal(l.onAdmit(session).fire, true, 'it fires again at the next multiple')
})

// THE POINT OF FIRING AT AN ADMIT: the admit that wakes this listener ENDS the turn before it, so the turn being
// judged has closed and the questions that need the operator's reply can be answered rather than dropped.
test('the turn it judges is CLOSED, so no next-message question is dropped', () => {
  const l = listener({ needsNextMessage: ['a_noul'] })
  const out = [1, 2, 3].map(() => l.onAdmit({ sessionId: 's' })).at(-1)
  assert.equal(out.fire, true)
  assert.deepEqual(out.dropped, [], 'nothing dropped: the operator has already replied, that is what an admit is')
  assert.deepEqual(out.questionIds.sort(), ['a_noul', 'a_score'])
})

test('the knob is read at each boundary, so switching it off stops the calls', () => {
  let on = true
  const l = listener({ isEnabled: () => on })
  l.onAdmit({ sessionId: 's' }); l.onAdmit({ sessionId: 's' })
  on = false
  assert.deepEqual(l.onAdmit({ sessionId: 's' }), { fire: false, turn: 3 }, 'counting continues, firing stops')
  on = true
  assert.equal(l.onAdmit({ sessionId: 's' }).fire, true, 'and it resumes at the next multiple')
})

test('the config is read at each boundary, so a settings change needs no restart', () => {
  let current = { questions: { turn: [] } }
  const l = createTurnListener({ everyNTurns: 1, readConfig: () => current })
  const first = l.onAdmit({ sessionId: 's' })
  assert.equal(first.fire, false)
  assert.equal(first.refused, true, 'no set under turn: refuse, never the probe')
  current = config
  assert.equal(l.onAdmit({ sessionId: 's' }).fire, true, 'the same listener, the new config')
})

test('sessions are counted independently', () => {
  const l = listener({ everyNTurns: 2 })
  l.onAdmit({ sessionId: 'a' })
  l.onAdmit({ sessionId: 'b' })
  assert.equal(l.onAdmit({ sessionId: 'a' }).fire, true, 'a reaches its second')
  assert.deepEqual(l.onAdmit({ sessionId: 'b' }), { fire: false, turn: 2 })
  assert.equal(l.onAdmit({ sessionId: 'b' }).fire, true)
})

test('a missing session on the event is a skip with a reason, not a fire', () => {
  const l = listener({ everyNTurns: 1 })
  assert.deepEqual(l.onAdmit({}), { fire: false, turn: 0, reason: 'no session on the admit event' })
  assert.deepEqual(l.onAdmit(), { fire: false, turn: 0, reason: 'no session on the admit event' })
})

test('it refuses rather than firing when the set is malformed', () => {
  const l = createTurnListener({ everyNTurns: 1, readConfig: () => ({ questions: { turn: [{ id: 'bad', type: 'score', instructions: 'x', levels: ['one'] }] } }) })
  const out = l.onAdmit({ sessionId: 's' })
  assert.equal(out.fire, false)
  assert.equal(out.refused, true)
  assert.match(out.reason, /bad|at least two/)
})

test('a non-function dependency is refused at construction', () => {
  assert.throws(() => createTurnListener({ isEnabled: 'yes' }), /`isEnabled` must be a function/)
  assert.throws(() => createTurnListener({ readConfig: 7 }), /`readConfig` must be a function/)
})
