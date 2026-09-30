// THE WHOLE CHAIN, with every step that can refuse. This is where the six modules are tested TOGETHER, and where the
// acceptance check is applied to a line the chain actually wrote rather than to a fixture.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTurnObserver } from '../lib/turn-observer.js'
import { createTurnListener } from '../lib/turn-listener.js'
import { probeViolations } from '../lib/turn-record.js'

const env = (seq, type, content) => ({ seq, type, data: { message: { content } } })
const text = (t) => ({ type: 'text', text: t })
const SPECS = [{ id: 'a_noul', type: 'noul', instructions: 'Is this true?' }]
const config = { questions: { turn: SPECS } }
const EXCHANGE = [
  env(1, 'user/message', [text('Find dsh plugins.')]),
  env(2, 'assistant/message', [text('Searching.'), { type: 'tool_use', name: 'find_dsh_plugin', input: { query: 'x' } }]),
  env(3, 'user/message', [{ type: 'tool_result', tool_use_id: 't1', content: 'no results' }]),
  env(4, 'assistant/message', [text('Nothing found; here is how to search.')]),
  env(5, 'user/message', [text('Mutate the keywords and try again.')]),
]

function chain({ events = EXCHANGE, askResult = { kind: 'answers', answers: { a_noul: { status: 'ok' } }, executed: { provider: 'typesafe' }, durationMs: 812.5 }, everyNTurns = 3 } = {}) {
  const lines = []
  const asked = []
  const listener = createTurnListener({ everyNTurns, readConfig: () => config })
  const observer = createTurnObserver({
    listener,
    readEvents: () => events,
    ask: async (request) => { asked.push(request); return askResult },
    record: (line) => lines.push(line),
  })
  return { observer, lines, asked, listener }
}

test('an admit that fires asks the model about the composed exchange and records the measurement', async () => {
  const { observer, lines, asked } = chain()
  await observer.onAdmit({ sessionId: 's' })   // 1
  await observer.onAdmit({ sessionId: 's' })   // 2
  const out = await observer.onAdmit({ sessionId: 's' })  // 3 -> fires
  assert.equal(out.fired, true)
  assert.equal(out.turn, 3)
  assert.deepEqual(out.questionIds, ['a_noul'])
  assert.equal(asked.length, 1, 'exactly one judgement')
  assert.match(asked[0].state, /^OPERATOR REQUEST:/)
  assert.match(asked[0].state, /OPERATOR NEXT MESSAGE:\nMutate the keywords/)
  assert.deepEqual(Object.keys(asked[0].questions), ['a_noul'])
  assert.equal(lines.length, 1)
  assert.equal(lines[0].hook, 'turn')
  assert.deepEqual(lines[0].questionIds, ['a_noul'])
  assert.deepEqual(lines[0].answers, { a_noul: { status: 'ok' } })
  assert.equal(lines[0].durationMs, 812.5)
})

test('the acceptance check passes the line the CHAIN wrote', async () => {
  const { observer, lines } = chain({ everyNTurns: 1 })
  await observer.onAdmit({ sessionId: 's' })
  assert.equal(lines.length, 1)
  assert.deepEqual(probeViolations(lines), [], 'a scheduled line names its questions, so it cannot be the probe')
})

test('an exchange with no agent response refuses, and writes nothing', async () => {
  const { observer, lines, asked } = chain({ events: [env(1, 'user/message', [text('hi')])], everyNTurns: 1 })
  const out = await observer.onAdmit({ sessionId: 's' })
  assert.equal(out.fired, false)
  assert.equal(out.refused, true)
  assert.match(out.reason, /no agent response in the window/)
  assert.equal(asked.length, 0, 'nothing to judge, so nothing is asked')
  assert.deepEqual(lines, [], 'and no line claims a measurement')
})

test('a judge that could not answer writes NO call line', async () => {
  const { observer, lines } = chain({ askResult: { kind: 'error', reason: 'the service refused' }, everyNTurns: 1 })
  const out = await observer.onAdmit({ sessionId: 's' })
  assert.equal(out.fired, false)
  assert.equal(out.failed, true)
  assert.equal(out.reason, 'the service refused')
  assert.deepEqual(lines, [], 'a line with empty answers would be filed as a measurement, and it is not one')
})

test('a judge that THREW is a failure, not an exception escaping the listener', async () => {
  const listener = createTurnListener({ everyNTurns: 1, readConfig: () => config })
  const observer = createTurnObserver({
    listener,
    readEvents: () => EXCHANGE,
    ask: async () => { throw new Error('socket closed') },
    record: () => { throw new Error('must not record') },
  })
  const out = await observer.onAdmit({ sessionId: 's' })
  assert.equal(out.failed, true)
  assert.match(out.reason, /socket closed/)
})

test('a boundary that does not fire asks nothing and records nothing', async () => {
  const { observer, lines, asked } = chain({ everyNTurns: 5 })
  const out = await observer.onAdmit({ sessionId: 's' })
  assert.deepEqual(out, { fired: false, turn: 1, reason: null, refused: false })
  assert.equal(asked.length, 0)
  assert.deepEqual(lines, [])
})

test('a dependency that cannot work is refused at construction', () => {
  assert.throws(() => createTurnObserver({ listener: {}, readEvents: () => [], ask: () => {}, record: () => {} }), /`listener` must be/)
  assert.throws(() => createTurnObserver({ listener: { onAdmit: () => {} }, readEvents: 7, ask: () => {}, record: () => {} }), /`readEvents` must be a function/)
  assert.throws(() => createTurnObserver({ listener: { onAdmit: () => {} }, readEvents: () => [], ask: () => {} }), /`record` must be a function/)
})

// THE BOUNDARY MESSAGE REACHES THE COMPOSITION. `agent/pre-step` carries the operator's message, and a session
// stream that names it otherwise would leave every turn uncomposable -- so the wiring must not depend on the events
// alone, and this asserts the value actually arrives.
test('the operator message from the boundary reaches the composed target', async () => {
  const lines = []
  const listener = createTurnListener({ everyNTurns: 1, readConfig: () => config })
  const observer = createTurnObserver({
    listener,
    // No operator message in the events at all -- only the agent's reply.
    readEvents: () => [env(1, 'assistant/message', [text('Nothing found; here is how to search.')])],
    ask: async () => ({ kind: 'answers', answers: { a_noul: { status: 'ok' } } }),
    record: (line) => lines.push(line),
  })
  const out = await observer.onAdmit({ sessionId: 's', nextMessage: { text: 'You should mutate the keywords.' } })
  assert.equal(out.fired, true, 'the turn composes because the boundary supplied the message')
  assert.equal(lines.length, 1)
})

test('a truncated target is recorded as truncated on the line', async () => {
  const lines = []
  const listener = createTurnListener({ everyNTurns: 1, readConfig: () => config })
  const observer = createTurnObserver({
    listener,
    readEvents: () => EXCHANGE,
    ask: async () => ({ kind: 'answers', answers: { a_noul: { status: 'ok' } } }),
    record: (line) => lines.push(line),
    maxChars: 60,
  })
  await observer.onAdmit({ sessionId: 's' })
  assert.equal(lines.length, 1)
  assert.equal(lines[0].truncated, true, 'the reader can see the state was cut short')
})
