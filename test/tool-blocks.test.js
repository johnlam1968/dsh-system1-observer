// X's TOOL CALLS SECTION. The property that matters is not that it extracts a call -- it is that a block it does
// NOT recognise is REPORTED rather than dropped. A target built by silently discarding half its evidence produces
// confident answers about a trajectory it never saw, which is the failure this whole repository catalogues.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assembleToolCalls } from '../lib/tool-blocks.js'

// THE ENVELOPE IS MEASURED: the peer bridge reads live sessions with exactly this shape.
const envelope = (seq, type, content) => ({ seq, type, data: { message: { content } } })

test('a call and its result reach the section, in order, from the measured envelope', () => {
  const events = [
    envelope(1, 'user/message', [{ type: 'text', text: 'find dsh plugins about system1' }]),
    envelope(2, 'assistant/message', [
      { type: 'text', text: 'Searching.' },
      { type: 'tool_use', name: 'find_dsh_plugin', input: { query: 'system1' } },
    ]),
    envelope(3, 'user/message', [{ type: 'tool_result', tool_use_id: 't1', content: 'no results' }]),
  ]
  const out = assembleToolCalls(events)
  assert.equal(out.calls.length, 1)
  assert.match(out.calls[0], /find_dsh_plugin\(\{"query":"system1"\}\)/)
  assert.deepEqual(out.results, ['no results'])
  assert.match(out.text, /call 1: find_dsh_plugin/)
  assert.match(out.text, /-> no results/)
  assert.deepEqual(out.unclassified, {}, 'nothing here should be unreadable')
  assert.equal(out.truncated, false)
})

test('a block whose type is unknown is REPORTED with its type, not dropped', () => {
  const events = [envelope(1, 'assistant/message', [
    { type: 'text', text: 'kept' },
    { type: 'some_future_block', payload: 1 },
    { type: 'another_shape' },
  ])]
  const out = assembleToolCalls(events)
  assert.deepEqual(out.unclassified, { some_future_block: 1, another_shape: 1 })
  assert.match(out.text, /kept/, 'and what it COULD read is still there')
})

// The type names `tool_use` / `tool_result` are the conventional ones and are NOT verified against a live sample --
// the bridge never inspected a tool block. The shape path below is the fallback for that reason, and both are
// tested so that discovering the real names changes the classification without changing the reporting.
test('a call is recognised by SHAPE when its type is not the conventional name', () => {
  const out = assembleToolCalls([envelope(1, 'assistant/message', [{ name: 'bash', input: { command: 'ls' } }])])
  assert.equal(out.calls.length, 1)
  assert.match(out.calls[0], /bash\(\{"command":"ls"\}\)/)
  assert.deepEqual(out.unclassified, {})
})

test('a result with no call before it is called out rather than paired with the wrong one', () => {
  const out = assembleToolCalls([envelope(1, 'user/message', [{ type: 'tool_result', tool_use_id: 't9', content: 'orphan' }])])
  assert.match(out.text, /1 result\(s\) with no preceding call/)
})

test('the section is capped, and says that it was', () => {
  const big = envelope(1, 'assistant/message', [{ name: 'bash', input: { command: 'x'.repeat(500) } }])
  const out = assembleToolCalls([big], { maxChars: 100 })
  assert.equal(out.truncated, true)
  assert.equal(out.text.length, 100)
})

test('junk in the events does not throw, and is not counted as evidence', () => {
  const out = assembleToolCalls([null, 7, 'x', { type: 'other/event' }, envelope(1, 'assistant/message', 'not an array')])
  assert.deepEqual(out.calls, [])
  assert.deepEqual(out.results, [])
  assert.deepEqual(out.unclassified, {})
  assert.equal(out.text, '')
  assert.deepEqual(assembleToolCalls().text, '')
})
