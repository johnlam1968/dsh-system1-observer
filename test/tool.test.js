// THE PROJECTION CONTRACT: THE CARD MUST NOT BE ABLE TO TURN A SUCCESSFUL CALL INTO A TOOL ERROR.
//
// The sibling implementation on this same seat records the reason (`presentation.ts:171-176`): "the registry
// snapshots the returned value as lossless JSON and fails the whole call when that snapshot is `undefined`, so an
// underivable card would turn a successful decision into a tool error."
//
// Ours returns `null` rather than `undefined`, and the installed host confirms `null` survives `snapshotJsonValue`
// -- so we are safe. But we were safe because the CARD treats `null` as absent, not because the PROJECTOR
// guarantees it. These tests move the guarantee to the projector, where it belongs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTraceTool } from '../lib/tool.js'

function toolWith(traceBody) {
  const dir = mkdtempSync(join(tmpdir(), 'observer-tool-'))
  const path = join(dir, 'trace.jsonl')
  if (traceBody !== undefined) writeFileSync(path, traceBody)
  return createTraceTool({ path, runId: 'RUN-T', liveAgents: () => [] })
}

/** Exactly what the registry does to the value before it reaches the browser. */
const snapshot = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))

test('the projection is never `undefined`, whatever the tool returned', async () => {
  const tool = toolWith()
  for (const value of [undefined, null, {}, { data: null }, { data: undefined }, { text: 'x' }, { data: 42 }, { data: 'string' }, []]) {
    const meta = tool.output.presentationMeta({}, value)
    assert.notEqual(meta, undefined, `undefined would fail the whole call for ${JSON.stringify(value)}`)
    // A snapshot of `undefined` is what the registry rejects; everything else it accepts.
    assert.notEqual(snapshot(meta), undefined)
  }
})

test('the projection is JSON, not an object that merely looks like it', async () => {
  // A RUN IS NEEDED for the card to name one, and an empty file legitimately has none -- which the first version
  // of this test forgot, and then asserted a field that could not be there.
  const tool = toolWith([
    JSON.stringify({ at: '2026-01-02T00:00:00.000Z', run: 'RUN-T', event: 'mount', hooks: ['draft'], callsEnabled: true, sessions: ['*'] }),
    JSON.stringify({ at: '2026-01-02T00:00:01.000Z', run: 'RUN-T', event: 'skip', hook: 'execute', reason: 'no text at this seam' }),
  ].join('\n') + '\n')
  const value = await tool.execute({ tail: 3 })
  const meta = tool.output.presentationMeta({}, value)
  assert.notEqual(meta, undefined)
  // A THUNK, A CYCLE OR A CLASS INSTANCE WOULD SNAPSHOT BADLY OR THROW; a round trip that deep-equals is what
  // "lossless JSON" means, and it is the only property the registry actually needs.
  assert.deepEqual(JSON.parse(JSON.stringify(meta)), meta)
  assert.ok(typeof meta.run === 'string', 'and it carries the run')
  assert.ok(Array.isArray(meta.listed))
})

test('the model-facing render carries the text and NOT the structured data', async () => {
  const tool = toolWith()
  const value = await tool.execute({ tail: 2 })
  const blocks = tool.output.render({}, value)
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].type, 'text')
  assert.doesNotMatch(blocks[0].text, /"counts"/, 'the card copy never enters a context')
  assert.deepEqual(snapshot(tool.output.presentationMeta({}, value)), JSON.parse(JSON.stringify(value.data)))
})

test('a tool with no trace file still returns a value both halves can carry', async () => {
  const tool = toolWith()
  const value = await tool.execute({})
  assert.equal(typeof value.text, 'string')
  assert.match(value.text, /no trace at/)
  assert.notEqual(tool.output.presentationMeta({}, value), undefined)
})
