// THE CONVERSION RULES, TESTED WITHOUT A HARNESS, A MODEL OR SOMEBODY'S PRIVATE CHAT.
//
// Every assertion here corresponds to a rule that was measured rather than guessed (`lib/deepseek-web-export.js`
// records where each came from). The fixtures are synthetic: the export this was built from is the operator's own
// conversation archive, and a test that needed it would be a test nobody else could run.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { branchPoints, eventsOf, exchangesOf, linearize, loadExport, readNode, sideOf, slugify } from '../lib/deepseek-web-export.js'

/** A node in the export's `mapping` shape. */
const node = (id, parent, children, fragments, extra = {}) => [id, {
  id,
  parent,
  children,
  message: fragments === null ? null : { id: `m-${id}`, model: 'deepseek-chat', inserted_at: '2025-11-02T10:00:00.000Z', fragments, ...extra },
}]

const req = (text) => ({ type: 'REQUEST', content: text })
const res = (text) => ({ type: 'RESPONSE', content: text })
const think = (text) => ({ type: 'THINK', content: text })

/**
 * A conversation that exercises everything at once: a branch where the DEEPER subtree is NOT the first child, a
 * reasoning block beside an answer, a citation, an attachment-only turn, and a title.
 *
 *   root(REQUEST) -> a(RESPONSE) -> branch:  b1 (dead end, one node)
 *                                            b2 (continues: RESPONSE+THINK, then a FILE-only node)
 */
function syntheticConversation() {
  return {
    id: 'conv-1',
    title: 'A titled conversation',
    inserted_at: '2025-11-02T10:00:00.000Z',
    mapping: Object.fromEntries([
      node('root', null, ['a'], [req('first question')]),
      node('a', 'root', ['b1', 'b2'], [res('first answer')]),
      node('b1', 'a', [], [req('abandoned branch')]),
      node('b2', 'a', ['b3'], [req('second question')]),
      node('b3', 'b2', ['c'], [think('let me think'), res('second answer'), { type: 'SEARCH', results: [{ url: 'https://example.org/x', title: 'X' }] }]),
      node('c', 'b3', [], [{ type: 'FILE', files: [{ file_id: 'f1', file_name: 'IMG_1.png', file_size: 1234 }] }]),
    ]),
  }
}

test('a conversation is a TREE, and the live thread is the DEEPEST subtree, not the first child', () => {
  const ids = linearize(syntheticConversation()).map((n) => n.id)
  assert.deepEqual(ids, ['root', 'a', 'b2', 'b3', 'c'], 'the deeper branch is followed even when it is listed second')
})

test('branch points are reported, because following one silently would hide a choice', () => {
  const points = branchPoints(syntheticConversation())
  assert.equal(points.length, 1)
  assert.equal(points[0].id, 'a')
  assert.deepEqual(points[0].branches.map((b) => b.id), ['b1', 'b2'], 'both branches are reported, followed or not')
})

test('fragments are read by their own type, and their side follows REQUEST/FILE', () => {
  const conversation = syntheticConversation()
  const read = readNode({ id: 'b3', ...conversation.mapping.b3 })
  assert.deepEqual(read.answers, ['second answer'])
  assert.deepEqual(read.thoughts, ['let me think'])
  assert.deepEqual(read.searches, [{ url: 'https://example.org/x', title: 'X' }])
  assert.equal(sideOf(req('x')), 'user')
  assert.equal(sideOf({ type: 'FILE', files: [] }), 'user')
  assert.equal(sideOf(think('x')), 'assistant')
})

test('exchanges pair the human side with the model side, structurally', () => {
  const exchanges = exchangesOf(syntheticConversation())
  assert.equal(exchanges.length, 3, 'first, second, and the attachment-only turn')
  assert.deepEqual(exchanges[0].asks, ['first question'])
  assert.deepEqual(exchanges[0].answers, ['first answer'])
  assert.deepEqual(exchanges[1].answers, ['second answer'])
  assert.deepEqual(exchanges[2].files.map((f) => f.file_name), ['IMG_1.png'])
})

test('the events obey the rule the harness enforces: every message sits inside an open turn and step', () => {
  // A hand-written log pairing assistant/message with turn/start but omitting step/start is REFUSED at read time:
  // `SessionFormatError: assistant/message does not match an open turn and step`. This walks the sequence the way
  // that check does, so the exporter cannot regress into writing a log the harness will not read.
  const { events } = eventsOf(syntheticConversation())
  let openTurn = null
  let openStep = null
  for (const event of events) {
    if (event.type === 'turn/start') openTurn = event.data.turn
    else if (event.type === 'step/start') openStep = event.data.step
    else if (event.type === 'step/end') { assert.equal(openStep, event.data.step); openStep = null }
    else if (event.type === 'turn/end') { assert.equal(openTurn, event.data.turn); openTurn = null }
    else if (event.type === 'user/message' || event.type === 'assistant/message') {
      assert.notEqual(openTurn, null, `${event.type} outside a turn`)
      assert.notEqual(openStep, null, `${event.type} outside a step`)
    }
  }
  assert.equal(openTurn, null, 'every turn is closed')
  assert.equal(openStep, null, 'every step is closed')
  assert.deepEqual(events.map((e) => e.seq), events.map((_, i) => i), 'seq is contiguous from 0')
})

test('reasoning is carried as a reasoning block and NEVER as answer text (F79 at the source)', () => {
  const { events } = eventsOf(syntheticConversation())
  const assistant = events.find((e) => e.type === 'assistant/message' && e.data.message.content.some((b) => b.type === 'reasoning'))
  assert.deepEqual(assistant.data.message.content.map((b) => b.type), ['reasoning', 'text'], 'thought first, then the answer')
  const visible = assistant.data.message.content.filter((b) => b.type === 'text').map((b) => b.text)
  assert.deepEqual(visible, ['second answer'])
  assert.ok(!visible.includes('let me think'), 'text never shown to the user is not counted as the answer')
})

test('the title is pinned as source.kind user, or automatic generation would overwrite it', () => {
  const { events } = eventsOf(syntheticConversation())
  const title = events.find((e) => e.type === 'session/title')
  assert.equal(title.data.title, 'A titled conversation')
  assert.equal(title.data.source.kind, 'user')
  assert.deepEqual(title.data.messageSeqs, [])
  const untitled = eventsOf({ ...syntheticConversation(), title: '' }).events.find((e) => e.type === 'session/title')
  assert.equal(untitled, undefined, 'no title event when the conversation has none')
})

test('an attachment-only turn becomes an EMPTY message, never a fabricated block', () => {
  const { events, counts, attachments } = eventsOf(syntheticConversation())
  const empty = events.filter((e) => e.type === 'user/message').find((e) => e.data.content.length === 0)
  assert.ok(empty, 'the bytes are absent from the archive, so the message is empty rather than invented')
  assert.equal(counts.emptyAttachmentTurns, 1)
  assert.deepEqual(attachments, [{ turn: 3, file_id: 'f1', file_name: 'IMG_1.png', file_size: 1234 }])
})

test('citations are NOT session events, so no tool history is fabricated', () => {
  const { events, citations } = eventsOf(syntheticConversation())
  assert.deepEqual(events.filter((e) => e.type.startsWith('tool/')), [], 'no tool/call or tool/result is invented')
  assert.deepEqual(citations, [{ turn: 2, url: 'https://example.org/x', title: 'X' }])
})

test('loadExport reads the archive, and tolerates a missing user.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'deepseek-export-'))
  const conversation = syntheticConversation()
  writeFileSync(join(dir, 'conversations.json'), JSON.stringify([conversation]))
  const withoutUser = loadExport(dir)
  assert.equal(withoutUser.conversations.length, 1)
  assert.equal(withoutUser.user, null, 'an absent account record is not a failure')
  writeFileSync(join(dir, 'user.json'), JSON.stringify({ email: 'someone@example.org' }))
  assert.equal(loadExport(dir).user.email, 'someone@example.org')
})

test('slugify keeps a title usable as a filename', () => {
  assert.equal(slugify('Risk-Off Market, Strong Dollar!'), 'risk-off-market-strong-dollar')
  assert.equal(slugify(''), 'conversation')
  assert.equal(slugify('中文标题'), '中文标题', 'non-latin titles survive rather than collapsing to the fallback')
})
