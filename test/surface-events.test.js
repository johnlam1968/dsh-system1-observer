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
