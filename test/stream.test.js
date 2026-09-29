import { test } from 'node:test'
import assert from 'node:assert/strict'
import { textOf, tee } from '../lib/stream.js'

async function* source(list) { for (const chunk of list) yield chunk }

test('textOf prefers a finished text block and falls back to deltas', () => {
  assert.equal(textOf([{ type: 'text-delta', text: 'a' }, { type: 'text-delta', text: 'b' }]), 'ab')
  assert.equal(textOf([{ type: 'block-end', block: { type: 'text', text: 'done' } }]), 'done')
  assert.equal(textOf([]), '')
})

test('tee relays every chunk unchanged and in order, and calls onEnd once, after the source ends', async () => {
  const input = [{ type: 'text-delta', text: 'a' }, { type: 'text-delta', text: 'b' }, { type: 'finish' }]
  const relayed = []
  let collected
  for await (const chunk of tee(source(input), async (all) => { collected = all })) relayed.push(chunk)
  assert.deepEqual(relayed, input)
  assert.deepEqual(collected, input)
})

test('tee propagates a source error rather than swallowing it', async () => {
  async function* boom() { yield { type: 'text-delta', text: 'a' }; throw new Error('provider died') }
  await assert.rejects(async () => { for await (const _ of tee(boom(), async () => {})) { /* drain */ } }, /provider died/)
})
