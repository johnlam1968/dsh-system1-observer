import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readHooks, registerListeners } from '../lib/register.js'

/** A Cordis context, reduced to what this plugin touches. */
function fakeCtx() {
  const handlers = new Map()
  return {
    handlers,
    on(event, handler) { handlers.set(event, handler); return () => handlers.delete(event) },
  }
}

test('an unknown hook refuses, naming it and the known set', () => {
  assert.throws(() => readHooks({ hooks: ['draft', 'nope'] }), /nope/)
})

test('a missing or empty hooks list falls back to the documented default', () => {
  assert.deepEqual(readHooks({}), ['admit', 'draft', 'pre_execute', 'post_execute'])
  assert.deepEqual(readHooks({ hooks: [] }), ['admit', 'draft', 'pre_execute', 'post_execute'])
})

test('only the selected hooks are subscribed', () => {
  const ctx = fakeCtx()
  registerListeners(ctx, ['draft'], { observe: async () => {} })
  assert.deepEqual([...ctx.handlers.keys()], ['llm/stream'])
})

test('a waterfall listener returns the decision it was given, unchanged', async () => {
  const ctx = fakeCtx()
  let called = 0
  registerListeners(ctx, ['admit'], { observe: async () => { called += 1 } })
  const decision = { messages: ['original'] }
  const returned = await ctx.handlers.get('agent/pre-step')({ agent: { id: 'a1' }, messages: [], turn: 1, step: 1 }, async () => decision)
  assert.equal(returned, decision)
  assert.equal(called, 1)
})
