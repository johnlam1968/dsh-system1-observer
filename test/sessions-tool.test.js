// THE GAP THIS CLOSES: an agent could not name a stored session. DSH's own agent-facing session tools reach LIVE
// sessions in this process; `sessionQuery` reaches everything but is a SERVICE, so only a plugin can call it. Every
// historical read in this repository had to be a shell script -- which is how three scans in a row were mis-read.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSessionsTool, rowsOf, SESSIONS_TOOL_NAME, textOf } from '../lib/sessions-tool.js'

const record = (id, { cwd = '/home/john/freeciv', createdAt = 1000, live = false, persisted = true } = {}) => ({ header: { id, cwd, createdAt }, live, persisted })

/** A query service with the two methods the tool uses, and a store of message events keyed by session. */
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

test('textOf reads the content shapes the harness writes, and nothing else', () => {
  assert.equal(textOf({ data: { message: { content: 'plain' } } }), 'plain')
  assert.equal(textOf({ data: { message: { content: [{ text: 'one' }, { text: 'two' }] } } }), 'one two')
  assert.equal(textOf({ data: {} }), '')
})

test('list finds a session by title substring, by cwd, and by availability', () => {
  const records = [record('session-a', { createdAt: 3 }), record('session-b', { createdAt: 2, cwd: '/home/john/other' }), record('session-c', { createdAt: 1, live: true, persisted: false })]
  const titles = { 'session-a': 'Assisted freeciv play', 'session-b': 'Something else' }
  // the search that motivated this tool: a name, not an id, and not a walk through ~/.dsh/sessions
  const byTitle = rowsOf(records, new Map(Object.entries(titles)), { search: 'freeciv' })
  assert.deepEqual(byTitle.rows.map((r) => r.id), ['session-a'])
  assert.equal(byTitle.rows[0].title, 'Assisted freeciv play')
  assert.equal(byTitle.total, 1)
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
