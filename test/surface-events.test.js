// THE SURFACE, NOT THE LOG. A composer that searches the raw event log can judge a message the subject never saw,
// because the newest message of a role is not always IN the surface.
//
// THE FIXTURE TOOK TWO ATTEMPTS, and the first one matters: an ordinary replacement does NOT reproduce this. A
// compaction that replaces a request with a summary leaves the composer quoting the SUMMARY, because a replacement
// always arrives after what it replaces and "newest wins" coincides with "surface wins".
//
// AND THE ASSERTION TOOK TWO ATTEMPTS TOO. I expected the fix to swap which message is judged; instead the composer
// REFUSES the turn, because after the fold it contains no response at all. That is the stronger behaviour and the
// one asserted here: nothing is invented out of the log.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { surfaceEvents } from '../lib/host/surface.js'
import { composeTurnState } from '../lib/turn-state.js'

const msg = (seq, type, text, surfaceOp = 'append') => ({
  seq, time: seq, type, surfaceOp,
  data: { message: { role: type === 'user/message' ? 'user' : 'assistant', content: [{ type: 'text', text }] } },
})
const toolResult = (seq, text, surfaceOp) => ({
  seq, time: seq, type: 'tool/result', surfaceOp,
  data: { message: { role: 'tool', toolCallId: 't1', content: [{ type: 'text', text }] } },
})

test('a replace op removes its range from the surface, and the replacement itself survives', () => {
  const events = [msg(1, 'user/message', 'a'), msg(2, 'assistant/message', 'b'), toolResult(3, 'summary', { op: 'replace', startSeq: 1, endSeq: 2 })]
  assert.deepEqual(surfaceEvents(events).map((e) => e.seq), [3], 'the range goes, its carrier stays')
  assert.deepEqual(surfaceEvents(events.map((e) => ({ ...e, surfaceOp: 'append' }))).map((e) => e.seq), [1, 2, 3], 'append removes nothing')
  assert.deepEqual(surfaceEvents([]), [], 'and an empty log is not a throw')
  assert.deepEqual(surfaceEvents([{ seq: 1 }, { seq: 2, surfaceOp: { op: 'replace', startSeq: 'x' } }]).map((e) => e.seq), [1, 2], 'a malformed op removes nothing rather than everything')
})

test('the composer REFUSES a turn whose response the surface dropped, rather than judging the log', () => {
  const events = [
    msg(1, 'user/message', 'the operator request'),
    msg(2, 'assistant/message', 'THE SHADOWED ANSWER -- dropped from the surface'),
    toolResult(3, 'tool output that replaced it', { op: 'replace', startSeq: 2, endSeq: 2 }),
    msg(4, 'user/message', 'the operator reaction'),
  ]
  const out = composeTurnState({ events })
  assert.equal(out.refused, true, 'the surface holds no response for this turn, so there is nothing to judge')
  assert.match(String(out.reason ?? ''), /no agent response/, 'and it says why: ' + String(out.reason))
  assert.doesNotMatch(JSON.stringify(out), /SHADOWED/, 'and the dropped text appears NOWHERE in the result')
})

test('an ordinary turn is unchanged by the fold, which is what makes it safe to add', () => {
  const events = [msg(1, 'user/message', 'a request'), msg(2, 'assistant/message', 'an answer'), msg(3, 'user/message', 'a reaction')]
  const sections = composeTurnState({ events }).sections ?? {}
  assert.match(String(sections['OPERATOR REQUEST']), /a request/)
  assert.match(String(sections['AGENT RESPONSE']), /an answer/)
  assert.match(String(sections['OPERATOR NEXT MESSAGE']), /a reaction/)
})

test('a compaction that replaces a request still yields the SUMMARY, which is why the first fixture passed', () => {
  const events = [
    msg(1, 'user/message', 'FIRST REQUEST'),
    msg(2, 'assistant/message', 'first answer'),
    msg(3, 'user/message', 'SECOND REQUEST -- replaced'),
    msg(4, 'assistant/message', 'answer to the second request'),
    msg(5, 'user/message', 'COMPACTED SUMMARY of everything before', { op: 'replace', startSeq: 1, endSeq: 3 }),
    msg(6, 'assistant/message', 'the answer after compaction'),
    msg(7, 'user/message', 'the operator reaction'),
  ]
  const sections = composeTurnState({ events }).sections ?? {}
  assert.doesNotMatch(String(sections['OPERATOR REQUEST']), /SECOND REQUEST/, 'the replaced request is gone')
  assert.match(String(sections['OPERATOR REQUEST']), /COMPACTED SUMMARY/, 'and the summary is what remains')
})

// THE HOST'S OWN ANSWER, WHEN IT IS GIVEN. `Session.surface.nodes` is the surviving seqs -- precisely what the fold
// computes -- so a caller holding it passes `surfaceSeqs` and the fold becomes the portable substitute rather than
// the rule. BOTH DIRECTIONS ON THE SAME FIXTURE, and the second is what makes the first more than a comment: the fold
// alone refuses a turn whose response a replace dropped, and the host's seqs keep it so the turn composes.
//
// THIS TEST EARNED ITS KEEP. The first implementation filtered the fold's OUTPUT, so the host's answer could only
// ever subtract -- and a message the fold had dropped could never be kept, which is the exact case the parameter
// exists for. The assertion below failed, and the fix was to make the host's answer replace the fold rather than
// pass through it.
test('surfaceSeqs, when given, is the RULE -- and the fold is the fallback', () => {
  const events = [
    msg(1, 'user/message', 'the operator request'),
    msg(2, 'assistant/message', 'the answer'),
    toolResult(3, 'a tool result', { op: 'replace', startSeq: 2, endSeq: 2 }),
    msg(4, 'user/message', 'the operator reaction'),
  ]
  assert.equal(composeTurnState({ events }).refused, true, 'the fold alone refuses: the response was replaced away')

  const kept = composeTurnState({ events, surfaceSeqs: [1, 2, 4] })
  assert.notEqual(kept.refused, true, "the host's surface keeps the response, so there is something to judge")
  assert.match(String(kept.sections?.['AGENT RESPONSE']), /the answer/, 'and it is the message the host kept')
  assert.match(String(kept.sections?.['OPERATOR NEXT MESSAGE']), /the operator reaction/)

  // AND AN EMPTY LIST IS NOT AN EMPTY SURFACE. Falling back on absent OR empty is deliberate: reading [] as "nothing
  // survives" would refuse every turn, and both cases are asserted so that cannot be introduced quietly.
  assert.equal(composeTurnState({ events, surfaceSeqs: [] }).refused, true, 'an empty list falls back to the fold')
  assert.equal(composeTurnState({ events, surfaceSeqs: null }).refused, true, 'and so does null')
})

// EITHER SHAPE, BECAUSE THE DECLARATION AND THE LIVE RUN DISAGREE. `SessionEventMap` says `'user/message': UserMessage`
// -- `data` IS the message -- while `assistant/message` and `tool/result` say `data.message`. Every fixture in this
// suite used the latter, so the DECLARED shape had never been exercised; the composer rejected it and refused the
// turn with "no operator message in the window". This feeds the declared shape and asserts the exchange composes.
test('a HARNESS-DECLARED user/message event is read, where `data` is the message itself', () => {
  const declaredUser = (seq, text) => ({ seq, time: seq, type: 'user/message', surfaceOp: 'append', data: { role: 'user', content: [{ type: 'text', text }] } })
  const declaredAssistant = (seq, text) => ({ seq, time: seq, type: 'assistant/message', surfaceOp: 'append', data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text }] }, stream: [] } })
  const events = [
    declaredUser(1, 'THE DECLARED OPERATOR REQUEST'),
    declaredAssistant(2, 'the answer'),
    declaredUser(3, 'moved on'),
  ]
  const out = composeTurnState({ events })
  assert.notEqual(out.refused, true, 'a declared-shape exchange must compose, not refuse: ' + String(out.reason))
  assert.match(String(out.sections?.['OPERATOR REQUEST']), /THE DECLARED OPERATOR REQUEST/, 'the request comes from an event whose data IS the message')
  assert.match(String(out.sections?.['AGENT RESPONSE']), /the answer/)
  assert.match(String(out.sections?.['OPERATOR NEXT MESSAGE']), /moved on/)

  // AND THE OTHER SHAPE STILL WORKS, so this widened the reader rather than replacing one assumption with another.
  const wrapped = (seq, text) => ({ seq, time: seq, type: 'user/message', surfaceOp: 'append', data: { message: { role: 'user', content: [{ type: 'text', text }] } } })
  const other = composeTurnState({ events: [wrapped(1, 'THE WRAPPED REQUEST'), declaredAssistant(2, 'an answer'), wrapped(3, 'moved on')] })
  assert.match(String(other.sections?.['OPERATOR REQUEST']), /THE WRAPPED REQUEST/, 'and the wrapped shape is still read')
})

// THE TEST THAT SHOULD HAVE EXISTED FROM THE START, BUILT FROM THE HARNESS'S DECLARATION RATHER THAN FROM MY FIXTURE.
//
// lib/tool-blocks.js said in its own header that the block types were NOT VERIFIED and reported what it could not
// classify -- honest, and it still matched nothing real, because every fixture in this suite used the Anthropic-style
// `tool_use`/`input` while ContentBlockMap declares `'tool-call'` with `arguments` as a JSON STRING. Measured with
// declared shapes, the TOOL CALLS section came out EMPTY: the call name absent, the result dropped. That is the state
// the one live measurement was judged on -- which is what `done_claim_without_tool_evidence: 0.86` was reporting.
//
// Both shapes are asserted, so this widened the reader rather than trading one assumption for another.
test('the tool window reads the DECLARED shapes: tool-call blocks and tool/result events', () => {
  const user = (seq, text) => ({ seq, time: seq, type: 'user/message', surfaceOp: 'append', data: { role: 'user', content: [{ type: 'text', text }] } })
  const assistant = (seq, blocks) => ({ seq, time: seq, type: 'assistant/message', surfaceOp: 'append', data: { turn: 1, step: 1, message: { role: 'assistant', content: blocks }, stream: [] } })
  const declaredCall = (seq, name, args) => ({ seq, time: seq, type: 'tool/call', data: { turn: 1, step: 1, callId: 't1', name, arguments: args } })
  const declaredResult = (seq, text) => ({ seq, time: seq, type: 'tool/result', data: { turn: 1, step: 1, message: { role: 'tool', toolCallId: 't1', content: [{ type: 'text', text }] } } })

  const declared = composeTurnState({ events: [
    user(1, 'find me a plugin'),
    assistant(2, [{ type: 'text', text: 'searching' }, { type: 'tool-call', id: 't1', name: 'find_dsh_plugin', arguments: '{"query":"system1"}' }]),
    declaredCall(3, 'find_dsh_plugin', '{"query":"system1"}'),
    declaredResult(4, 'no results for system1'),
    assistant(5, [{ type: 'text', text: 'nothing found' }]),
    user(6, 'try other keywords'),
  ] }).sections ?? {}
  assert.match(String(declared['TOOL CALLS']), /find_dsh_plugin/, 'the DECLARED call block names the tool')
  assert.match(String(declared['TOOL CALLS']), /no results for system1/, 'and the DECLARED result EVENT reaches the window')

  // AND THE SHAPE I HAD ASSUMED STILL WORKS, so the reader widened rather than swapped.
  const assumed = composeTurnState({ events: [
    user(1, 'a request'),
    assistant(2, [{ type: 'tool_use', id: 't2', name: 'find_dsh_plugin', input: { query: 'x' } }]),
    { seq: 3, time: 3, type: 'user/message', surfaceOp: 'append', data: { message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: 'nothing' }] } } },
    assistant(4, [{ type: 'text', text: 'an answer' }]),
    user(5, 'moved on'),
  ] }).sections ?? {}
  assert.match(String(assumed['TOOL CALLS']), /find_dsh_plugin/, 'the assumed block shape is still read')
  assert.match(String(assumed['TOOL CALLS']), /nothing/, 'and its result')
})
