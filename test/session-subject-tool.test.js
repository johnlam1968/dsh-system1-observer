// THE SUBJECT TOOL: composing what a judgement is composed from, for a session named by id.
//
// CORRECTION (F97), still standing: the claim that "DSH's own agent-facing session tools reach LIVE sessions in this
// process" was WRONG. `@deepseek-ai/dsh-tool-session-query` exists -- five read-only agent tools -- and it is OPT-IN,
// not mounted here. None of the five composes a subject, which is the gap that remains.
//
// WHAT CHANGED AND WHY THESE CASES MOVED. This was `system1_sessions` with four actions. `list`, `search` and
// `refresh` are gone: `dsh-session-index` answers those from a SQLite store in milliseconds, where `list` here went
// through the harness service and folded a title per row -- measured at ~54 s against the store's 78 ms, on 834
// sessions. Those cases, and the renderer branches behind them, are NOT deleted, they are MOVED: they live with the
// tools that now own the questions, in another repository. What is left is the read, and one case here pins the
// pointer that makes the move discoverable.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSessionSubjectTool, SUBJECT_TOOL_NAME } from '../dsh/session-subject-tool.js'
import { displayTextOfEvent } from 'dsh-session-adapter/session-format'
import { composeTurnState } from '../dsh/turn-state.js'
import { assertValidOutput } from './tool-output-validated.js'

const record = (id, { cwd = '/home/john/freeciv', createdAt = 1000, live = false, persisted = true } = {}) => ({ header: { id, cwd, createdAt }, live, persisted })

/** A query service with the methods this tool uses, and a store of message events keyed by session. */
function fakeQuery({ records = [], events = {}, titles = {}, failList = false } = {}) {
  return {
    async listSessions() {
      if (failList) throw new Error('persistence unavailable')
      return records
    },
    async readTitleSnapshots(ids) {
      return ids.map((sessionId) => ({ sessionId, status: 'fulfilled', value: { title: titles[sessionId] === undefined ? undefined : { title: titles[sessionId] } } }))
    },
    async readSession(sessionId) {
      if (events[sessionId] === undefined) throw new Error('session "' + sessionId + '" not found')
      return { session: { id: sessionId, cwd: '/home/john/freeciv', createdAt: 1000 }, inheritedEventCount: 0, events: events[sessionId] }
    },
  }
}

const message = (type, text) => ({ type, seq: 1, time: 0, data: { message: { content: [{ type: 'text', text }] } } })

test('the display reader reads the content shapes the harness writes, and nothing else', () => {
  assert.equal(displayTextOfEvent({ data: { message: { content: 'plain' } } }), 'plain')
  // A BLOCK CARRIES ITS TYPE. The harness declares `TextBlock` as `{ type: 'text'; text: string }`, so a block without
  // one is NOT a shape it writes -- this fixture used to omit it, and the reader accepted it, which is how the shape
  // stayed wrong in six other cases.
  assert.equal(displayTextOfEvent({ data: { message: { content: [{ type: 'text', text: 'one' }, { type: 'text', text: 'two' }] } } }), 'one two')
  // AND REASONING IS NOT THE MESSAGE. `ReasoningBlock` carries a `text` field too, so a reader that took `.text` from
  // any block returned the model's thinking as though the operator had written it. This is that defect pinned.
  const reasoning = { data: { message: { content: [{ type: 'reasoning', text: 'thinking' }, { type: 'text', text: 'shown' }] } } }
  assert.equal(displayTextOfEvent(reasoning), 'shown')
  assert.equal(displayTextOfEvent({ data: {} }), '')
})

test('read returns a session\'s messages, sliced, with the session named', async () => {
  const query = fakeQuery({
    records: [record('session-bba92d44')],
    titles: { 'session-bba92d44': 'Assisted freeciv play' },
    events: { 'session-bba92d44': [message('user/message', 'help me play freeciv'), message('assistant/message', 'here is a plan'), message('tool/call', 'ignored')] },
  })
  const tool = createSessionSubjectTool({ query })
  const out = await tool.execute({ sessionId: 'session-bba92d44' })
  assertValidOutput(tool, out)
  assert.deepEqual(out.problems, [])
  assert.equal(out.session.id, 'session-bba92d44')
  assert.equal(out.session.title, 'Assisted freeciv play')
  assert.deepEqual(out.messages, [{ role: 'OPERATOR', text: 'help me play freeciv' }, { role: 'AGENT', text: 'here is a plan' }])
  const rendered = tool.output.render({}, out)[0].text
  assert.match(rendered, /Assisted freeciv play/)
  assert.match(rendered, /OPERATOR: help me play freeciv/)
})

test('THE TOOL POINTS AT THE TOOLS THAT ANSWER THE OTHER THREE QUESTIONS, by name', async () => {
  // A retirement that is not discoverable is a user with a broken habit. The description is the only place an agent
  // learns that finding moved, so the three names are asserted rather than trusted to review.
  const tool = createSessionSubjectTool({ query: fakeQuery({}) })
  assert.equal(tool.name, SUBJECT_TOOL_NAME)
  assert.equal(tool.name, 'system1_session_subject')
  for (const moved of ['session_index_list', 'session_index_search', 'session_index_refresh']) {
    assert.match(tool.description, new RegExp(moved), 'the description names ' + moved)
  }
  assert.match(tool.description, /does NOT find sessions/, 'and says plainly what it stopped doing')
  // AND THE RETIRED ACTIONS ARE NOT STILL ACCEPTED: `action` is not in the schema, so a caller passing one gets the
  // NAMED refusal rather than a read -- a problem, not a throw, because that is this tool's contract.
  const stale = await tool.execute({ action: 'list' })
  assert.match(String(stale.problems[0]), /unknown parameter `action`/)
  assert.equal('session' in stale, false, 'and no half-answer beside the refusal')
})

test('`newest` is RESOLVED, because a parameter must not promise a value it rejects', async () => {
  const query = fakeQuery({ records: [record('session-old', { createdAt: 1 }), record('session-new', { createdAt: 9 })], events: { 'session-new': [message('user/message', 'newest one')] } })
  const out = await createSessionSubjectTool({ query }).execute({ sessionId: 'newest', lastMessages: 1 })
  assert.equal(out.session.id, 'session-new')
  assert.equal(out.messages[0].text, 'newest one')
  // and with nothing to resolve against it is a sentence, not the store's "not found"
  const empty = await createSessionSubjectTool({ query: fakeQuery({ records: [] }) }).execute({ sessionId: 'newest' })
  assert.match(String(empty.problems[0]), /no session is available to resolve `newest`/)
})

test('a session with no event log is a FACT the render states, not a silent zero', async () => {
  // MEASURED: 48 logs on this box decompress to a single `{"type":"session"}` line. A created-but-never-appended
  // session has a header and nothing else, and the doc says so: "abandoned sessions leave nothing behind".
  const query = fakeQuery({ records: [record('session-stub')], events: { 'session-stub': [] } })
  const tool = createSessionSubjectTool({ query })
  const out = await tool.execute({ sessionId: 'session-stub' })
  assert.deepEqual(out.messages, [])
  assert.equal(out.slice.total, 0)
  assert.match(tool.output.render({}, out)[0].text, /NO event log/)
})

test('every failure is a named problem, never a throw', async () => {
  const noService = await createSessionSubjectTool({}).execute({ sessionId: 'session-a' })
  assert.match(String(noService.problems[0]), /no session-query service is mounted/)
  const failing = await createSessionSubjectTool({ query: fakeQuery({ failList: true }) }).execute({ sessionId: 'newest' })
  assert.match(String(failing.problems[0]), /listing sessions failed/)
  const unknown = await createSessionSubjectTool({ query: fakeQuery({ records: [] }) }).execute({ sessionId: 'session-nope' })
  assert.match(String(unknown.problems[0]), /not found/)
  const missing = await createSessionSubjectTool({ query: fakeQuery({ records: [] }) }).execute({})
  assert.match(String(missing.problems[0]), /`sessionId` is required/)
})

test('the tool declares everything it emits, in both formats', async () => {
  const tool = createSessionSubjectTool({ query: fakeQuery({ records: [record('session-a')], events: { 'session-a': [message('user/message', 'ask')] } }) })
  const compose = (events) => composeTurnState({ events, scope: 'session', maxChars: 8000, toolMaxChars: 4000 })
  const composed = createSessionSubjectTool({ query: fakeQuery({ records: [record('session-a')], events: { 'session-a': [message('user/message', 'ask'), message('assistant/message', 'answer')] } }), compose })
  for (const value of [
    await tool.execute({ sessionId: 'session-a' }),
    await composed.execute({ sessionId: 'session-a', format: 'subject' }),
  ]) {
    for (const key of Object.keys(value)) {
      assert.ok(tool.output.schema.properties[key] !== undefined, key + ' is emitted and declared')
    }
    assertValidOutput(tool, value)
  }
})

test('`format: subject` composes from the WHOLE log, and says so when no composer is wired', async () => {
  const query = fakeQuery({ records: [record('session-a')], events: { 'session-a': [message('user/message', 'help me play freeciv'), message('assistant/message', 'here is a plan')] } })
  const seen = []
  const tool = createSessionSubjectTool({ query, compose: (events) => { seen.push(events.length); return 'SESSION TRANSCRIPT\nOPERATOR: help me play freeciv\nAGENT: here is a plan' } })
  // `lastMessages: 1` must NOT bound what the composer sees: a judgement is shown the log, not the tail the caller asked to read.
  const out = await tool.execute({ sessionId: 'session-a', lastMessages: 1, format: 'subject' })
  assert.deepEqual(seen, [2], 'the composer saw both events while `messages` was bounded to the tail')
  assert.equal(out.messages.length, 1)
  assert.match(out.state, /SESSION TRANSCRIPT/)
  assert.match(tool.output.render({}, out)[0].text, /state: \d+ chars/)
  // and with no composer it is a sentence, not an empty subject
  const bare = await createSessionSubjectTool({ query }).execute({ sessionId: 'session-a', format: 'subject' })
  assert.match(String(bare.problems.join(' ')), /no composer is wired/)
  assert.equal('state' in bare, false, 'and no state key at all, rather than an empty one')
})

test('a THUNK query is resolved at call time -- the idiom the registration uses, and the bug the first live call found', async () => {
  // `UNAVAILABLE: no session-query service is mounted` came from the factory reading `query.listSessions` off the thunk.
  // The registration passes a thunk BECAUSE `sessionQuery` is captured by a `ctx.inject` callback that may run later.
  const inner = fakeQuery({ records: [record('session-a')], events: { 'session-a': [message('user/message', 'hello')] } })
  const out = await createSessionSubjectTool({ query: () => inner }).execute({ sessionId: 'session-a' })
  assert.equal(out.messages[0].text, 'hello', 'the thunk form works')
  // and a thunk that is not ready yet is still the named problem, not a throw
  const late = await createSessionSubjectTool({ query: () => undefined }).execute({ sessionId: 'session-a' })
  assert.match(String(late.problems[0]), /no session-query service is mounted/)
})

// A SESSION LONGER THAN ANY PROMPT MUST BE READABLE A PAGE AT A TIME. Before this the only way to reach a deep part of
// a conversation was `lastMessages` big enough to include it -- which drags every message since into the window and,
// measured on the 611-message freeciv session, into a state capped at 8,000 characters. `offset` skips from the NEWEST
// end, so a page composes with `lastMessages` instead of competing with it.
test('offset pages backwards from the newest, and says which page it read', async () => {
  const events = []
  for (let i = 1; i <= 10; i += 1) events.push({ type: i % 2 === 0 ? 'assistant/message' : 'user/message', seq: i, time: i, data: { message: { content: [{ type: 'text', text: 'message ' + i }] } } })
  const tool = createSessionSubjectTool({ query: fakeQuery({ records: [record('s1')], events: { s1: events } }) })
  const newest = await tool.execute({ sessionId: 's1', lastMessages: 3 })
  assert.deepEqual(newest.messages.map((m) => m.text), ['message 8', 'message 9', 'message 10'])
  assert.deepEqual(newest.slice.page, { offset: 0, from: 7, to: 10, of: 10 })
  const second = await tool.execute({ sessionId: 's1', lastMessages: 3, offset: 3 })
  assert.deepEqual(second.messages.map((m) => m.text), ['message 5', 'message 6', 'message 7'], 'the page BEFORE the newest one')
  assert.equal(second.slice.page.offset, 3)
  assert.match(tool.output.render({}, second)[0].text, /page: messages 5-7 of 10 \(the newest 3 skipped/, 'and the render says how to read further back')
  // AN OFFSET PAST THE START IS AN EMPTY PAGE, not a throw and not a quiet re-read of the beginning.
  const past = await tool.execute({ sessionId: 's1', lastMessages: 3, offset: 99 })
  assert.deepEqual(past.messages, [])
  assert.deepEqual(past.problems, [])
})

test('a message longer than the budget is CUT AND SAID SO, and can be read whole', async () => {
  // 400 characters of a 9,000-character answer reads exactly like a short answer, which is the failure class this
  // repository keeps recording. The count is reported, and `messageChars` is the caller's way to lift it.
  const long = 'x'.repeat(9000)
  const events = [message('user/message', 'ask'), { type: 'assistant/message', seq: 2, time: 2, data: { message: { content: [{ type: 'text', text: long }] } } }]
  const tool = createSessionSubjectTool({ query: fakeQuery({ records: [record('s1')], events: { s1: events } }) })
  const clipped = await tool.execute({ sessionId: 's1' })
  assert.equal(clipped.messageChars, 400, 'the budget this call used is on the record')
  assert.equal(clipped.clipped, 1, 'and how many messages it cut')
  const text = tool.output.render({}, clipped)[0].text
  assert.match(text, /\(8600 more chars\)/, 'the cut is marked in the text, so a short line cannot be read as a short message')
  assert.match(text, /1 message\(s\) are longer than `messageChars` 400/)
  const whole = await tool.execute({ sessionId: 's1', messageChars: 0 })
  assert.equal(whole.clipped, 0)
  assert.equal(whole.messages[1].text, long, 'and `messageChars: 0` returns it entire')
})

test('a `subject` PREVIEW says when the composed state was CUT', async () => {
  // A preview exists to show what a judgement would see. `state: 8000 chars` with no marker reads as the whole
  // subject, and measured at the live defaults a stored judgement fits FIVE messages whole -- so a caller who cannot
  // see the cut cannot tell a page that fits from one that does not.
  const big = Array.from({ length: 4 }, (_, i) => ({ type: i % 2 === 0 ? 'user/message' : 'assistant/message', seq: i + 1, time: i + 1, data: { message: { content: [{ type: 'text', text: 'y'.repeat(4000) }] } } }))
  const compose = (events) => composeTurnState({ events, scope: 'session', maxChars: 8000, toolMaxChars: 4000, tailChars: 1000 })
  const tool = createSessionSubjectTool({ query: fakeQuery({ records: [record('s1')], events: { s1: big } }), compose })
  const out = await tool.execute({ sessionId: 's1', format: 'subject', lastMessages: 0 })
  assert.equal(out.stateTruncated, true, 'the cut is on the record')
  assert.match(tool.output.render({}, out)[0].text, /TRUNCATED at `composeMaxChars`/, 'and in the render, with what to do about it')
  // AND A SUBJECT THAT FITS SAYS NOTHING, rather than claiming a cut that did not happen.
  const short = [message('user/message', 'ask'), message('assistant/message', 'answer')]
  const smallTool = createSessionSubjectTool({ query: fakeQuery({ records: [record('s1')], events: { s1: short } }), compose })
  const small = await smallTool.execute({ sessionId: 's1', format: 'subject' })
  assert.equal(small.stateTruncated, false)
  assert.doesNotMatch(smallTool.output.render({}, small)[0].text, /TRUNCATED/)
  // THE PREVIEW COMPOSES THE WHOLE LOG, NOT THE PAGE: `lastMessages` bounds the LISTING, and a preview that shrank
  // with it would be previewing a judgement nobody would make.
  const paged = await tool.execute({ sessionId: 's1', format: 'subject', lastMessages: 1 })
  assert.equal(paged.stateTruncated, true, 'the whole four-message subject is still cut, even though one was listed')
})

test('a call cancelled before it starts is REFUSED by name, and no work is done', async () => {
  // `reference/cookbook/adding-a-tool.md:49`: "honour `exec.signal`; cancel in-flight work when it fires". The entry
  // check is what this tool can do -- it reads sessions through the host, and a read cannot be interrupted mid-flight
  // -- and it was MISSING until an audit drove every tool with an aborted signal (F112). Asserted here rather than
  // only in the shared source scan, because a tool that takes `exec` and ignores it would pass that scan.
  const tool = createSessionSubjectTool({ query: fakeQuery({ records: [] }) })
  await assert.rejects(() => tool.execute({ sessionId: 'session-a' }, { signal: { aborted: true } }), /cancelled before it started/)
})
