import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../index.js'

// WHY THIS EXISTS: the observer's first live mount wrote 209 `error` lines reading "decide is not a function"
// and no `call` lines at all. Both model factories return a CLIENT object, and `apply` assigned it to `decide`
// and called it. Every unit test passed, because none of them executed `apply`.
function fakeCtx() {
  const handlers = new Map()
  return {
    handlers,
    on(event, handler) { handlers.set(event, handler); return () => handlers.delete(event) },
    inject() { /* no system1 service in this test: the wire path is used */ },
    agents: { currentInitiator: () => ({ id: 'agent-1' }) },
  }
}

test('apply wires a callable decide, so a streamed reply reaches the transport instead of throwing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'system1-observer-'))
  const tracePath = join(dir, 'trace.jsonl')
  const ctx = fakeCtx()
  await apply(ctx, { hooks: ['draft'], tracePath, wireUrl: 'http://127.0.0.1:9', timeoutMs: 200 })

  const handler = ctx.handlers.get('llm/stream')
  assert.equal(typeof handler, 'function', 'apply did not subscribe the draft seam')

  async function* reply() {
    yield { type: 'text-delta', text: 'hello' }
    yield { type: 'block-end', block: { type: 'text', text: 'hello' } }
  }
  // DRAIN, THEN ASSERT. The briefed form asserted `chunk.type === 'block-end'` for EVERY chunk, but the reply
  // below yields `text-delta` first, so that assertion fired before `tee` ever reached its `onEnd` -- the
  // observer was never called, and the RED would have been the chunk type rather than the defect. Collecting
  // the relayed types keeps the brief's intent (the stream passes through unchanged AND is drained to the end)
  // and lets the observation actually run.
  const relayed = []
  for await (const chunk of handler({ purpose: undefined }, reply)) relayed.push(chunk.type)
  assert.deepEqual(relayed, ['text-delta', 'block-end'], 'the draft seam must relay the reply unchanged')

  const lines = readFileSync(tracePath, 'utf8').trim().split('\n').map(line => JSON.parse(line))
  const observed = lines.find(line => line.event === 'call' || line.event === 'error')
  assert.ok(observed !== undefined, 'no line was written for the draft seam')
  assert.doesNotMatch(String(observed.error ?? ''), /decide is not a function/)
})
