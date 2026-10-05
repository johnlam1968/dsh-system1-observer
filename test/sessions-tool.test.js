// THE GAP THIS CLOSES: an agent could not name a stored session. DSH's own agent-facing session tools reach LIVE
// sessions in this process; `sessionQuery` reaches everything but is a SERVICE, so only a plugin can call it. Every
// historical read in this repository had to be a shell script -- which is how three scans in a row were mis-read.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSessionsTool, rowsOf, SESSIONS_TOOL_NAME, textOf } from '../lib/sessions-tool.js'
import { composeTurnState } from '../lib/turn-state.js'

const record = (id, { cwd = '/home/john/freeciv', createdAt = 1000, live = false, persisted = true } = {}) => ({ header: { id, cwd, createdAt }, live, persisted })

/** A query service with the methods the tool uses, and a store of message events keyed by session. */
function fakeQuery({ records = [], events = {}, titles = {}, failList = false, hits = null, seen = null } = {}) {
  return {
    // FULL TEXT IS THE SERVICE'S, NOT OURS. The harness documents the query as "interpreted as data, never
    // executable FTS syntax", so the fake records exactly what was sent -- that is what the test asserts.
    ...(hits === null ? {} : {
      async searchSessions(request) {
        if (seen !== null) seen.push(request)
        return { items: hits }
      },
    }),
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

test('textOf reads the content shapes the harness writes, and nothing else', () => {
  assert.equal(textOf({ data: { message: { content: 'plain' } } }), 'plain')
  // A BLOCK CARRIES ITS TYPE. The harness declares `TextBlock` as `{ type: 'text'; text: string }`
  // (`packages/llm/llm/lib/types/types.d.ts:46`), so a block without one is NOT a shape it writes -- this fixture
  // used to omit it, and the reader accepted it, which is how the shape stayed wrong in six other cases.
  assert.equal(textOf({ data: { message: { content: [{ type: 'text', text: 'one' }, { type: 'text', text: 'two' }] } } }), 'one two')
  // AND REASONING IS NOT THE MESSAGE. `ReasoningBlock` carries a `text` field too, so the reader that took `.text`
  // from any block returned the model's thinking as though the operator had written it. This is that defect pinned.
  const reasoning = { data: { message: { content: [{ type: 'reasoning', text: 'thinking' }, { type: 'text', text: 'shown' }] } } }
  assert.equal(textOf(reasoning), 'shown')
  assert.equal(textOf({ data: {} }), '')
})

test('list marks the sessions the observer will actually MEASURE, and never confuses "these" with "all"', async () => {
  // The allow-list is the row's own, written by the session's "..." menu in the UI. Its matching rule lives in
  // lib/sessions.js; this asserts the tool REPORTS it rather than re-deriving it.
  const records = [record('session-30500a5a-c2da-4420-8087-e46356490ac9', { createdAt: 3 }), record('session-other', { createdAt: 2 })]
  const pinned = createSessionsTool({
    query: fakeQuery({ records }),
    observed: () => ({ every: false, match: (id) => id.startsWith('session-30500a5a') }),
  })
  const value = await pinned.execute({ action: 'list' })
  assert.equal(value.observesEverySession, false)
  assert.equal(value.observedCount, 1)
  assert.equal(value.sessions.find((r) => r.id.startsWith('session-30500a5a')).observed, true)
  assert.equal(value.sessions.find((r) => r.id === 'session-other').observed, false)
  assert.match(pinned.output.render({}, value)[0].text, /NOT measured/)
  // AND "EVERY SESSION" IS SAID, not implied by 498 trues
  const all = createSessionsTool({ query: fakeQuery({ records }), observed: () => ({ every: true, match: () => true }) })
  const every = await all.execute({ action: 'list' })
  assert.equal(every.observesEverySession, true)
  assert.match(all.output.render({}, every)[0].text, /EVERY session is measured/)
  // NO SCOPE WIRED: the field is absent rather than guessed, and nothing claims a session is measured
  const bare = createSessionsTool({ query: fakeQuery({ records }) })
  const none = await bare.execute({ action: 'list' })
  assert.equal(none.observesEverySession, false)
  assert.equal(none.sessions.every((r) => r.observed === undefined), true)
})

test('list search finds a session by its PROJECT, because the title is a summary of the work', async () => {
  // Measured on this host: the dsh session whose cwd is /home/john/CodingProjects/zeroclaw-voice-proxy is titled
  // "Push repo to GitHub account". An agent asking for the session in a named project would search a string that no
  // title contains, so `search` must compare the directory too.
  const records = [{ header: { id: 'session-d8d5d126', cwd: '/home/john/CodingProjects/zeroclaw-voice-proxy', createdAt: 5 }, live: false, persisted: true }]
  const tool = createSessionsTool({ query: fakeQuery({ records, titles: { 'session-d8d5d126': 'Push repo to GitHub account' } }) })
  const value = await tool.execute({ action: 'list', search: 'zeroclaw-voice-proxy' })
  assert.equal(value.count, 1)
  assert.equal(value.sessions[0].id, 'session-d8d5d126')
  assert.equal(value.sessions[0].title, 'Push repo to GitHub account')
  // and the title still matches, so nothing that worked before stopped working
  assert.equal((await tool.execute({ action: 'list', search: 'GitHub account' })).count, 1)
})

test('search finds a session by the TEXT of its conversation, which list cannot', async () => {
  // The capability this adds: `list`'s `search` compares a title or an id, so a phrase that exists only inside the
  // conversation is invisible to it. The harness's own index is what makes the phrase findable.
  const seen = []
  const hits = [{
    ...record('session-deep', { cwd: '/home/john/somewhere', createdAt: 2000 }),
    bestMatch: { snippet: '…the operator asked about civil disorder and research…' },
  }]
  const tool = createSessionsTool({ query: fakeQuery({ records: [record('session-deep')], titles: { 'session-deep': 'unrelated title' }, hits, seen }) })
  const value = await tool.execute({ action: 'search', query: 'civil disorder' })
  assert.equal(value.action, 'search')
  assert.equal(value.usedService, 'searchSessions')
  assert.equal(value.count, 1)
  assert.equal(value.sessions[0].id, 'session-deep')
  assert.match(value.sessions[0].snippet, /civil disorder/)
  // AND THE QUERY IS HANDED OVER AS DATA: verbatim, with no FTS syntax built around it.
  assert.deepEqual(seen, [{ query: 'civil disorder', limit: 20 }])
  assert.match(tool.output.render({}, value)[0].text, /session-deep/)
})

test('search REFUSES rather than falling back to a substring scan when the index is absent', async () => {
  const tool = createSessionsTool({ query: fakeQuery({ records: [record('session-a')] }) })
  const value = await tool.execute({ action: 'search', query: 'anything' })
  assert.equal(value.sessions.length, 0)
  assert.match(value.problem, /searchSessions/)
  assert.match(tool.output.render({}, value)[0].text, /UNAVAILABLE/)
  // a substring scan would have "found" this session by title; saying nothing would have looked like no matches
  const listed = await tool.execute({ action: 'list', search: 'anything' })
  assert.equal(listed.sessions.length, 0)
})

test('search without a query says which argument is missing', async () => {
  const tool = createSessionsTool({ query: fakeQuery({ records: [] }) })
  const value = await tool.execute({ action: 'search' })
  assert.deepEqual(value.problems, ['`query` is required for `search`'])
})

test('list finds a session by title substring, by cwd, and by availability', () => {
  // DISTINCT PROJECTS ON PURPOSE. Every record used to share one cwd, so once `search` began comparing the directory a
  // single term matched all three and the assertion below stopped meaning anything about the title.
  const records = [
    record('session-a', { createdAt: 3, cwd: '/home/john/freeciv' }),
    record('session-b', { createdAt: 2, cwd: '/home/john/other' }),
    record('session-c', { createdAt: 1, cwd: '/home/john/third', live: true, persisted: false }),
  ]
  const titles = { 'session-a': 'Assisted freeciv play', 'session-b': 'Something else' }
  // the search that motivated this tool: a name, not an id, and not a walk through ~/.dsh/sessions
  const byTitle = rowsOf(records, new Map(Object.entries(titles)), { search: 'freeciv' })
  assert.deepEqual(byTitle.rows.map((r) => r.id), ['session-a'])
  assert.equal(byTitle.rows[0].title, 'Assisted freeciv play')
  assert.equal(byTitle.total, 1)
  // and the same argument now matches a DIRECTORY, which is the handle that works when a title describes the work
  assert.deepEqual(rowsOf(records, new Map(), { search: 'john/other' }).rows.map((r) => r.id), ['session-b'])
  // cwd, availability, and newest-first
  assert.deepEqual(rowsOf(records, new Map(), { cwd: '/home/john/other' }).rows.map((r) => r.id), ['session-b'])
  assert.deepEqual(rowsOf(records, new Map(), { availability: 'live' }).rows.map((r) => r.id), ['session-c'])
  assert.deepEqual(rowsOf(records, new Map(), {}).rows.map((r) => r.id), ['session-a', 'session-b', 'session-c'])
  assert.equal(rowsOf(records, new Map(), { limit: 1 }).rows.length, 1)
})

test('read returns a session\'s messages, sliced, with the session named', async () => {
  const query = fakeQuery({
    records: [record('session-bba92d44')],
    titles: { 'session-bba92d44': 'Assisted freeciv play' },
    events: { 'session-bba92d44': [message('user/message', 'help me play freeciv'), message('assistant/message', 'here is a plan'), message('tool/call', 'ignored')] },
  })
  const tool = createSessionsTool({ query })
  const out = await tool.execute({ action: 'read', sessionId: 'session-bba92d44' })
  assert.deepEqual(out.problems, [])
  assert.equal(out.session.id, 'session-bba92d44')
  assert.equal(out.session.title, 'Assisted freeciv play')
  assert.deepEqual(out.messages, [{ role: 'OPERATOR', text: 'help me play freeciv' }, { role: 'AGENT', text: 'here is a plan' }])
  const rendered = tool.output.render({}, out)[0].text
  assert.match(rendered, /Assisted freeciv play/)
  assert.match(rendered, /OPERATOR: help me play freeciv/)
})

test('`newest` is RESOLVED, because a parameter must not promise a value it rejects', async () => {
  const query = fakeQuery({ records: [record('session-old', { createdAt: 1 }), record('session-new', { createdAt: 9 })], events: { 'session-new': [message('user/message', 'newest one')] } })
  const out = await createSessionsTool({ query }).execute({ action: 'read', sessionId: 'newest', lastMessages: 1 })
  assert.equal(out.session.id, 'session-new')
  assert.equal(out.messages[0].text, 'newest one')
  // and with nothing to resolve against it is a sentence, not the store's "not found"
  const empty = await createSessionsTool({ query: fakeQuery({ records: [] }) }).execute({ action: 'read', sessionId: 'newest' })
  assert.match(String(empty.problems[0]), /no session is available to resolve `newest`/)
})

test('a session with no event log is a FACT the render states, not a silent zero', async () => {
  // MEASURED: 48 logs on this box decompress to a single `{"type":"session"}` line. A created-but-never-appended
  // session has a header and nothing else, and the doc says so: "abandoned sessions leave nothing behind".
  const query = fakeQuery({ records: [record('session-stub')], events: { 'session-stub': [] } })
  const tool = createSessionsTool({ query })
  const out = await tool.execute({ action: 'read', sessionId: 'session-stub' })
  assert.deepEqual(out.messages, [])
  assert.equal(out.slice.total, 0)
  assert.match(tool.output.render({}, out)[0].text, /NO event log/)
})

test('every failure is a named problem, never a throw', async () => {
  const noService = await createSessionsTool({}).execute({ action: 'list' })
  assert.match(String(noService.problem), /no session-query service is mounted/)
  const failing = await createSessionsTool({ query: fakeQuery({ failList: true }) }).execute({ action: 'list' })
  assert.match(String(failing.problem), /listing sessions failed/)
  const unknown = await createSessionsTool({ query: fakeQuery({ records: [] }) }).execute({ action: 'read', sessionId: 'session-nope' })
  assert.match(String(unknown.problems[0]), /not found/)
  const missing = await createSessionsTool({ query: fakeQuery({ records: [] }) }).execute({ action: 'read' })
  assert.match(String(missing.problems[0]), /`sessionId` is required/)
  const bad = await createSessionsTool({ query: fakeQuery({ records: [] }) }).execute({ action: 'delete' })
  assert.match(String(bad.problem), /delete|enum|action/)
})

test('the tool declares everything it emits, and names itself the way the registry will', async () => {
  const tool = createSessionsTool({ query: fakeQuery({ records: [record('session-a')] }) })
  assert.equal(tool.name, SESSIONS_TOOL_NAME)
  assert.equal(tool.name, 'system1_sessions')
  for (const value of [await tool.execute({ action: 'list' }), await tool.execute({ action: 'read', sessionId: 'session-a' })]) {
    for (const key of Object.keys(value)) {
      assert.ok(tool.output.schema.properties[key] !== undefined, key + ' is emitted and declared')
    }
  }
})

test('`format: subject` composes from the WHOLE log, and says so when no composer is wired', async () => {
  const query = fakeQuery({ records: [record('session-a')], events: { 'session-a': [message('user/message', 'help me play freeciv'), message('assistant/message', 'here is a plan')] } })
  const seen = []
  const tool = createSessionsTool({ query, compose: (events) => { seen.push(events.length); return 'SESSION TRANSCRIPT\nOPERATOR: help me play freeciv\nAGENT: here is a plan' } })
  // `lastMessages: 1` must NOT bound what the composer sees: a judgement is shown the log, not the tail the caller asked to read.
  const out = await tool.execute({ action: 'read', sessionId: 'session-a', lastMessages: 1, format: 'subject' })
  assert.deepEqual(seen, [2], 'the composer saw both events while `messages` was bounded to the tail')
  assert.equal(out.messages.length, 1)
  assert.match(out.state, /SESSION TRANSCRIPT/)
  assert.match(tool.output.render({}, out)[0].text, /state: \d+ chars/)
  // and with no composer it is a sentence, not an empty subject
  const bare = await createSessionsTool({ query }).execute({ action: 'read', sessionId: 'session-a', format: 'subject' })
  assert.match(String(bare.problems.join(' ')), /no composer is wired/)
  assert.equal('state' in bare, false, 'and no state key at all, rather than an empty one')
})

test('a THUNK query is resolved at call time -- the idiom the registration uses, and the bug the first live call found', async () => {
  // `UNAVAILABLE: no session-query service is mounted` came from the factory reading `query.listSessions` off the thunk.
  // The registration passes a thunk BECAUSE `sessionQuery` is captured by a `ctx.inject` callback that may run later.
  const inner = fakeQuery({ records: [record('session-a')] })
  const tool = createSessionsTool({ query: () => inner })
  const out = await tool.execute({ action: 'list' })
  assert.equal(out.count, 1, 'the thunk form works')
  assert.deepEqual(out.sessions.map((s) => s.id), ['session-a'])
  // and a thunk that is not ready yet is still the named problem, not a throw
  const late = createSessionsTool({ query: () => undefined })
  assert.match(String((await late.execute({ action: 'list' })).problem), /no session-query service is mounted/)
})

// A SESSION LONGER THAN ANY PROMPT MUST BE READABLE A PAGE AT A TIME. Before this the only way to reach a deep part of
// a conversation was `lastMessages` big enough to include it -- which drags every message since into the window and,
// measured on the 611-message freeciv session, into a state capped at 8,000 characters. `offset` skips from the NEWEST
// end, so a page composes with `lastMessages` instead of competing with it.
test('offset pages backwards from the newest, and says which page it read', async () => {
  const events = []
  for (let i = 1; i <= 10; i += 1) events.push({ type: i % 2 === 0 ? 'assistant/message' : 'user/message', seq: i, time: i, data: { message: { content: [{ type: 'text', text: 'message ' + i }] } } })
  const tool = createSessionsTool({ query: fakeQuery({ records: [record('s1')], events: { s1: events } }) })
  const newest = await tool.execute({ action: 'read', sessionId: 's1', lastMessages: 3 })
  assert.deepEqual(newest.messages.map((m) => m.text), ['message 8', 'message 9', 'message 10'])
  assert.deepEqual(newest.slice.page, { offset: 0, from: 7, to: 10, of: 10 })
  const second = await tool.execute({ action: 'read', sessionId: 's1', lastMessages: 3, offset: 3 })
  assert.deepEqual(second.messages.map((m) => m.text), ['message 5', 'message 6', 'message 7'], 'the page BEFORE the newest one')
  assert.equal(second.slice.page.offset, 3)
  assert.match(tool.output.render({}, second)[0].text, /page: messages 5-7 of 10 \(the newest 3 skipped/, 'and the render says how to read further back')
  // AN OFFSET PAST THE START IS AN EMPTY PAGE, not a throw and not a quiet re-read of the beginning.
  const past = await tool.execute({ action: 'read', sessionId: 's1', lastMessages: 3, offset: 99 })
  assert.deepEqual(past.messages, [])
  assert.deepEqual(past.problems, [])
})

test('a message longer than the budget is CUT AND SAID SO, and can be read whole', async () => {
  // 400 characters of a 9,000-character answer reads exactly like a short answer, which is the failure class this
  // repository keeps recording. The count is reported, and `messageChars` is the caller's way to lift it.
  const long = 'x'.repeat(9000)
  const events = [message('user/message', 'ask'), { type: 'assistant/message', seq: 2, time: 2, data: { message: { content: [{ type: 'text', text: long }] } } }]
  const tool = createSessionsTool({ query: fakeQuery({ records: [record('s1')], events: { s1: events } }) })
  const clipped = await tool.execute({ action: 'read', sessionId: 's1' })
  assert.equal(clipped.messageChars, 400, 'the budget this call used is on the record')
  assert.equal(clipped.clipped, 1, 'and how many messages it cut')
  const text = tool.output.render({}, clipped)[0].text
  assert.match(text, /\(8600 more chars\)/, 'the cut is marked in the text, so a short line cannot be read as a short message')
  assert.match(text, /1 message\(s\) are longer than `messageChars` 400/)
  const whole = await tool.execute({ action: 'read', sessionId: 's1', messageChars: 0 })
  assert.equal(whole.clipped, 0)
  assert.equal(whole.messages[1].text, long, 'and `messageChars: 0` returns it entire')
})

test('a `subject` PREVIEW says when the composed state was CUT', async () => {
  // A preview exists to show what a judgement would see. `state: 8000 chars` with no marker reads as the whole
  // subject, and measured at the live defaults a stored judgement fits FIVE messages whole -- so a caller who cannot
  // see the cut cannot tell a page that fits from one that does not.
  const big = Array.from({ length: 4 }, (_, i) => ({ type: i % 2 === 0 ? 'user/message' : 'assistant/message', seq: i + 1, time: i + 1, data: { message: { content: [{ type: 'text', text: 'y'.repeat(4000) }] } } }))
  const compose = (events) => composeTurnState({ events, scope: 'session', maxChars: 8000, toolMaxChars: 4000, tailChars: 1000 })
  const tool = createSessionsTool({ query: fakeQuery({ records: [record('s1')], events: { s1: big } }), compose })
  const out = await tool.execute({ action: 'read', sessionId: 's1', format: 'subject', lastMessages: 0 })
  assert.equal(out.stateTruncated, true, 'the cut is on the record')
  assert.match(tool.output.render({}, out)[0].text, /TRUNCATED at `composeMaxChars`/, 'and in the render, with what to do about it')
  // AND A SUBJECT THAT FITS SAYS NOTHING, rather than claiming a cut that did not happen. The subject here is a
  // DIFFERENT session: `format: 'subject'` composes the whole log by design, so `lastMessages` does not shrink it --
  // which is the property the next assertion pins.
  const short = [message('user/message', 'ask'), message('assistant/message', 'answer')]
  const smallTool = createSessionsTool({ query: fakeQuery({ records: [record('s1')], events: { s1: short } }), compose })
  const small = await smallTool.execute({ action: 'read', sessionId: 's1', format: 'subject' })
  assert.equal(small.stateTruncated, false)
  assert.doesNotMatch(smallTool.output.render({}, small)[0].text, /TRUNCATED/)
  // THE PREVIEW COMPOSES THE WHOLE LOG, NOT THE PAGE: `lastMessages` bounds the LISTING, and a preview that shrank
  // with it would be previewing a judgement nobody would make.
  const paged = await tool.execute({ action: 'read', sessionId: 's1', format: 'subject', lastMessages: 1 })
  assert.equal(paged.stateTruncated, true, 'the whole four-message subject is still cut, even though one was listed')
})
