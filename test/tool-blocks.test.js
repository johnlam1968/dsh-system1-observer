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

test('a CUT tool section reports how many calls and results it SHOWED', () => {
  // Measured on a real session at the default `toolBlockMaxChars` of 4000: the section held the FIRST 3 of 529 calls
  // and their results, while the lookup a question asked about was much later. A section cut like that and silent
  // about it reads as the whole trajectory -- so the count is the fix, and it comes from the CAPPED text.
  const events = []
  for (let i = 1; i <= 40; i += 1) {
    events.push(envelope(i * 2, 'assistant/message', [{ type: 'tool-call', id: 'c' + i, name: 'bash', arguments: '{"command":"echo ' + 'x'.repeat(120) + '"}' }]))
    events.push({ seq: i * 2 + 1, type: 'tool/result', data: { message: { id: 'msg' + i, toolCallId: 'c' + i, content: [{ type: 'text', text: 'y'.repeat(200) }] } } })
  }
  const out = assembleToolCalls(events, { maxChars: 1000 })
  assert.equal(out.calls.length, 40, 'all forty calls were collected')
  assert.equal(out.truncated, true, 'and the section was cut')
  assert.ok(out.shown.calls > 0 && out.shown.calls < 40, 'so only some were shown: ' + out.shown.calls + ' of 40')
  assert.equal((out.text.match(/^call \d+:/gm) ?? []).length, out.shown.calls, 'the number is what the TEXT contains, not what was collected')
  assert.equal((out.text.match(/^ {2}-> /gm) ?? []).length, out.shown.results)
  // AND AN UNCUT SECTION SAYS 40 OF 40, so a reader never has to infer the difference from an absence.
  const whole = assembleToolCalls(events, { maxChars: 1000000 })
  assert.equal(whole.truncated, false)
  assert.deepEqual(whole.shown, { calls: 40, results: 40 })
})

/** Sixty calls, each with a result far larger than the whole budget -- the shape that wasted the section. */
const manyCalls = (count) => {
  const events = []
  for (let i = 1; i <= count; i += 1) {
    events.push(envelope(i * 2, 'assistant/message', [{ type: 'tool-call', id: 'c' + i, name: 'bash', arguments: '{"command":"ls"}' }]))
    events.push({ seq: i * 2 + 1, type: 'tool/result', data: { message: { id: 'm' + i, toolCallId: 'c' + i, content: [{ type: 'text', text: 'R'.repeat(5000) }] } } })
  }
  return events
}

test('a big section is CLIPPED PER ENTRY, so the budget covers many calls instead of one long result', () => {
  // Measured on a real session: one file-dump result consumed the entire 4,000-char section and the rest of the record
  // was never written at all -- 3 of 529 calls shown. Each entry now gets `maxChars / calls` (never below 60 chars), so
  // the budget is spread across the record instead of being spent on whichever result happened to come first.
  const out = assembleToolCalls(manyCalls(60), { maxChars: 2000, tailChars: 0 })
  assert.ok(out.shown.calls > 5, 'far more than a handful fit: ' + out.shown.calls + ' of 60')
  assert.match(out.text, /\u2026/, 'and a clipped entry is MARKED, so a short line cannot be read as a short result')
})

test('a cut tool section keeps BOTH ENDS, so the NEWEST calls survive', () => {
  // THE POINT OF THE WHOLE FIX. A section cut from the start shows the first calls of a session; the question this
  // repository's session set asks is what the agent did after a lookup returned nothing, and those lookups are late.
  const out = assembleToolCalls(manyCalls(60), { maxChars: 2000, tailChars: 800 })
  assert.equal(out.kept, 'both ends')
  assert.equal(out.truncated, true)
  assert.match(out.text, /call 1: /, 'the first call is still there')
  assert.match(out.text, /call 60: /, 'AND the last one, which a head-only cut drops')
  // THE TAIL BEGINS AT AN ENTRY BOUNDARY. A fragment of a result without its `call N:` line is the mis-attribution
  // register row F33 records, arrived at by cutting instead of by pairing.
  assert.match(out.text, /\n\u2026\ncall \d+:/, 'the elision is marked, and the tail resumes at a whole entry')
  // AND ASKING FOR NO TAIL STILL GIVES THE OLD BEHAVIOUR, so a caller that wants the head alone can say so.
  const headOnly = assembleToolCalls(manyCalls(60), { maxChars: 2000, tailChars: 0 })
  assert.equal(headOnly.kept, 'head')
  assert.doesNotMatch(headOnly.text, /call 60: /)
})

// MEASURED ON A REAL SESSION, and both halves were invisible while the section was empty: the harness writes each
// call TWICE -- a `tool/call` event and a `tool-call` block in the assistant message, same id -- and the result once,
// carrying that id. Counting both shapes gave 1,058 calls for 529 real ones, so `results[index]` attached every
// result after the first to the WRONG call: call 2 (a duplicate of call 1) was shown the README's contents. A
// mis-attributed result is worse than a missing one, because it reads as evidence.
test('a call written twice under one id is ONE call, and its result pairs with it BY ID', () => {
  const call = (seq, id, name, args) => [
    envelope(seq, 'assistant/message', [{ type: 'tool-call', id, name, arguments: args }]),
    { seq: seq + 1, type: 'tool/call', data: { callId: id, name, arguments: args } },
  ]
  const result = (seq, id, text) => ({
    seq,
    type: 'tool/result',
    // THE REAL SHAPE, including the trap: `id` is the RESULT MESSAGE'S OWN id and is NOT the call id. A reader that
    // takes `id` first matches nothing -- measured on a real session, where that produced 529 calls, 529 results and
    // zero pairings.
    data: { message: { id: 'msg-' + seq, toolCallId: id, source: { kind: 'tool', callId: id }, content: [{ type: 'text', text }] } },
  })
  const out = assembleToolCalls([
    envelope(1, 'user/message', [{ type: 'text', text: 'go' }]),
    ...call(2, 'c1', 'bash', '{"command":"ls"}'),
    result(4, 'c1', 'file-a'),
    ...call(5, 'c2', 'grep', '{"pattern":"x"}'),
    result(7, 'c2', 'nothing'),
  ], { includeText: false })
  assert.equal(out.calls.length, 2, 'two calls, not four -- the same id twice is one call')
  assert.equal(out.results.length, 2)
  assert.match(out.text, /call 1: bash\(\{"command":"ls"\}\)\n  -> file-a/, 'the first result belongs to the first call')
  assert.match(out.text, /call 2: grep\(\{"pattern":"x"\}\)\n  -> nothing/, 'and the second result to the second call')
  assert.doesNotMatch(out.text, /no preceding call/, 'and every result found its call, so nothing is reported orphaned')
})
