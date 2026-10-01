// THE INTENT WATERFALLS ARE LISTENED TO, AND THE DECISION IS UNTOUCHED.
//
// The harness is explicit: "the first listener that returns an intent owns the decision rather than composing with
// peers", and "calling next() yields the bare provider's unconditional write". So a recorder must call next() and hand
// back what it returned -- and the two properties that can break are exactly these:
//
//   1. next() is called EXACTLY ONCE. A listener that skips it turns an unconditional write into no write at all.
//   2. the return value is IDENTICAL BY REFERENCE. Under first-returned-guard-wins, a `.then()` chain resolving to the
//      same value is still a substitution, and deep equality would not catch it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../index.js'

const accessor = (value) => ({ get: () => value })

async function mounted() {
  const dir = mkdtempSync(join(tmpdir(), 'fs-intent-'))
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
  return handlers
}

for (const [name, decision] of [['fs/write-intent', { kind: 'replaceIfVersion', version: 'v1' }], ['fs/edit-intent', { version: 'v2' }]]) {
  test(`${name}: next() is called exactly once, and its decision comes back BY REFERENCE`, async () => {
    const handlers = await mounted()
    const listener = handlers.get(name)?.[0]
    assert.equal(typeof listener, 'function', 'the row subscribes the waterfall')
    let calls = 0
    const returned = listener({ targetKey: 'k', displayPath: '/tmp/some-file' }, { toolCallId: 't' }, () => { calls += 1; return decision })
    assert.equal(calls, 1, 'the provider is asked exactly once -- skipping it would suppress the write')
    assert.equal(returned, decision, 'the SAME reference: a reconstructed promise resolving to this value is still a substitution')
    await new Promise((r) => setTimeout(r, 5))
  })
}

test('nothing a payload can contain escapes as a throw, and a throwing next is NOT swallowed', async () => {
  const handlers = await mounted()
  for (const name of ['fs/write-intent', 'fs/edit-intent']) {
    const listener = handlers.get(name)[0]
    for (const [target, next] of [[undefined, () => undefined], [{ get displayPath() { throw new Error('hostile') } }, () => undefined], [{ displayPath: '/x' }, undefined], [{ displayPath: '/x' }, 'not a function']]) {
      assert.doesNotThrow(() => listener(target, undefined, next), 'recording must never be the reason a write fails')
    }
    assert.throws(() => listener({ displayPath: '/x' }, undefined, () => { throw new Error('the provider failed') }), /the provider failed/, 'a failing provider fails visibly')
  }
})
