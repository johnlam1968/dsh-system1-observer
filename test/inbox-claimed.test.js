// THE ANNOUNCED BOUNDARY IS RECORDED, AND RECORDING IT CANNOT BREAK A TURN.
//
// `agent/inbox/claimed` is `emit` mode -- fire and forget -- so this listener is a synchronous recorder and a throw
// inside it must not escape into the loop. That constraint is the testable part: the HOLD is deliberately not yet
// consumed, because the composer's boundary rule moves on its own.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
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
