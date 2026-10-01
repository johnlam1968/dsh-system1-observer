// THE ANNOUNCED BOUNDARY IS RECORDED, AND RECORDING IT CANNOT BREAK A TURN.
//
// `agent/inbox/claimed` is `emit` mode -- fire and forget -- so this listener is a synchronous recorder and a throw
// inside it must not escape into the loop. That constraint is the testable part: the HOLD is deliberately not yet
// consumed, because the composer's boundary rule moves on its own.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../index.js'

const accessor = (value) => ({ get: () => value })

test('agent/inbox/claimed is subscribed, and NOTHING a payload can contain escapes as a throw', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'claimed-'))
  const agent = { id: 'session-a', session: { snapshotEvents: () => [] } }
  const handlers = new Map()
  const ctx = {
    on(event, handler) { const list = handlers.get(event) ?? []; list.push(handler); handlers.set(event, list); return () => {} },
    inject() {}, provide: () => () => {},
    get: (name) => (name === 'agents' ? { get: () => agent, list: () => [agent] } : undefined),
    agents: { currentInitiator: () => agent },
  }
  await apply(ctx, {
    hooks: accessor([]), tracePath: accessor(join(dir, 'trace.jsonl')), sessions: accessor(['*']),
    turnEveryNTurns: accessor(0), questions: { turn: [] },
  })
  const listener = handlers.get('agent/inbox/claimed')?.[0]
  assert.equal(typeof listener, 'function', 'the row subscribes the harness signal')

  // EVERY SHAPE A PAYLOAD COULD ARRIVE IN, including the ones that would throw a naive reader: no payload, no agent,
  // no message, a message that is not an object, a message whose seq getter throws, and the ordinary case.
  const hostile = [
    undefined, null, {}, { agent: null }, { agent: {} }, { agent: { id: '' } },
    { agent: { id: 's' } }, { agent: { id: 's' }, message: null }, { agent: { id: 's' }, message: 'not an object' },
    { agent: { id: 's' }, message: { get seq() { throw new Error('hostile getter') } } },
    { agent: { id: 's' }, message: { text: 'the request', seq: 1 }, turn: 3 },
  ]
  for (const payload of hostile) {
    assert.equal(listener(payload), undefined, 'an emitter listener returns nothing the harness could await')
  }
})

// A CLAIMED MESSAGE IS RECORDED, BECAUSE NOTHING ELSE COULD SEE IT.
//
// `agent/*` events are live coordination and are NOT persisted to the session log (agent-lifecycle.md:86), so the
// earlier check -- grepping session logs for `agent/inbox/claimed` and finding zero -- was an instrument that could
// not observe the thing it was asked about, and its verdict ("declared and never emitted") was unsupported. The
// lifecycle page documents the event firing once per claimed message (agent-lifecycle.md:31,70). This is the probe.
test('a valid claim is recorded with its session, turn and seq', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'claimed-line-'))
  const tracePath = join(dir, 'trace.jsonl')
  const agent = { id: 'session-a', session: { snapshotEvents: () => [] } }
  const handlers = new Map()
  const ctx = {
    on(event, handler) { const list = handlers.get(event) ?? []; list.push(handler); handlers.set(event, list); return () => {} },
    inject() {}, provide: () => () => {},
    get: (name) => (name === 'agents' ? { get: () => agent, list: () => [agent] } : undefined),
    agents: { currentInitiator: () => agent },
  }
  await apply(ctx, {
    hooks: accessor([]), tracePath: accessor(tracePath), sessions: accessor(['*']),
    turnEveryNTurns: accessor(0), questions: { turn: [] },
  })
  handlers.get('agent/inbox/claimed')[0]({ agent, message: { id: 'peer-x', seq: 42, role: 'user', content: [{ type: 'text', text: 'the requested message' }] }, turn: 7 })
  const lines = existsSync(tracePath) ? readFileSync(tracePath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []
  const recorded = lines.filter((l) => l.event === 'claimed')
  assert.equal(recorded.length, 1, 'one line per claimed message: ' + JSON.stringify(lines.map((l) => l.event)))
  assert.equal(recorded[0].agentId, 'session-a')
  assert.equal(recorded[0].turn, 7)
  assert.equal(recorded[0].seq, 42)
})
