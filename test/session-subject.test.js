// THE STORED-SESSION SUBJECT: the adapter's contract, and the reuse it exists for.
//
// The point of this module is that it has NO composer of its own -- it produces events, and the ONE existing composer
// (`composeTurnState`) turns them into the text a judge is shown. The last test here asserts exactly that, because it
// is the property that keeps the live and stored modes from drifting apart in what they present.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_KINDS, SUBJECT_KINDS, eventTypesOf, listStoredSessions, readStoredSubject, sliceEvents,
} from 'dsh-session-adapter/reader'
// `subjectSettings` reads THIS PLUGIN's config, so it stayed here rather than going into the adapter package.
import { subjectSettings } from '../lib/subject-settings.js'
import { composeTurnState } from '../lib/turn-state.js'

/** One session event in the shape the harness writes and the composer reads. */
const message = (seq, type, text) => ({
  seq,
  time: seq,
  type,
  data: { message: { role: type.startsWith('user') ? 'user' : 'assistant', content: [{ type: 'text', text }] } },
})
/** An assistant turn that ALSO carries a tool call, which is where the real log puts every call (529 of them measured). */
const assistantWithCall = (seq, text, id, name, args) => ({
  seq,
  time: seq,
  type: 'assistant/message',
  data: { message: { role: 'assistant', content: [{ type: 'text', text }, { type: 'tool-call', id, name, arguments: args }] } },
})
// THE IDS ARE NOT DECORATION: the harness writes a call as BOTH a `tool/call` event and a `tool-call` block, and ties
// the result back by this id. A fixture without ids tests the positional fallback instead of the real path.
const toolCall = (seq, id, name, args) => ({ seq, time: seq, type: 'tool/call', data: { callId: id, name, arguments: args } })
const toolResult = (seq, id, text) => ({ seq, time: seq, type: 'tool/result', data: { message: { toolCallId: id, content: [{ type: 'text', text }] } } })

// THE TOOL RESULTS SIT BETWEEN THE MESSAGES, which is how the harness writes them and the whole point of the window.
// A fixture with every tool event after the last message cannot tell a window from a slice of messages.
const EVENTS = [
  message(1, 'user/message', 'please summarise the deployment logs'),
  toolCall(2, 'k1', 'grep', '{"pattern":"error"}'),
  toolResult(3, 'k1', 'the log says the deployment failed'),
  assistantWithCall(4, 'I looked it up.', 'k2', 'read', '{"file_path":"/tmp/log"}'),
  message(5, 'user/message', 'now shorten it'),
  toolCall(6, 'k3', 'wc', '{"file":"/tmp/log"}'),
  toolResult(7, 'k3', 'nothing usable'),
  message(8, 'assistant/message', 'shorter'),
]

const queryWith = (events = EVENTS) => ({
  listSessions: async () => [{ header: { id: 'S1', cwd: '/tmp/x' }, live: false, persisted: true }],
  readSession: async (id) => {
    if (id !== 'S1') throw new Error('no session with that id')
    return { session: { id: 'S1', cwd: '/tmp/x' }, events }
  },
})

test('the kinds map onto event types, and a kind that maps to nothing is NAMED', () => {
  assert.deepEqual(SUBJECT_KINDS, { operator: 'user/message', assistant: 'assistant/message' })
  assert.deepEqual(eventTypesOf(['operator']).types, ['user/message'])
  assert.deepEqual(eventTypesOf(['operator', 'assistant']).types, ['user/message', 'assistant/message'])
  // DEFAULTS ARE THE TWO VERIFIED KINDS, and an empty list means the default rather than nothing.
  assert.deepEqual(eventTypesOf([]).types, DEFAULT_KINDS.map((kind) => SUBJECT_KINDS[kind]))
  // AN UNKNOWN KIND IS REPORTED. A slice that matches nothing because a name is wrong would judge less than the row
  // asked for, so the name comes back beside whatever did match.
  const unknown = eventTypesOf(['operator', 'toolish'])
  assert.deepEqual(unknown.unknown, ['toolish'])
  assert.deepEqual(unknown.types, ['user/message'])
})

test('the slice takes the last N matched messages, and 0 means the whole session', () => {
  const whole = sliceEvents(EVENTS, { kinds: ['operator', 'assistant'], lastMessages: 0 })
  assert.equal(whole.matched, 4, 'the four messages, and not the tool events')
  assert.equal(whole.total, 8, 'out of eight events')
  assert.deepEqual(whole.messages.map((event) => event.seq), [1, 4, 5, 8], 'the messages, newest last')
  assert.deepEqual(whole.events.map((event) => event.seq), [1, 2, 3, 4, 5, 6, 7, 8], 'and the WINDOW is everything they span')
  const tail = sliceEvents(EVENTS, { kinds: ['operator', 'assistant'], lastMessages: 2 })
  assert.deepEqual(tail.messages.map((event) => event.seq), [5, 8], 'the last two messages, not the last two events')
  // THE WINDOW IS WHY THIS FUNCTION NO LONGER RETURNS A BARE MESSAGE LIST: the tool call and its result that sit
  // between the two selected messages travel with them, and the pair before the window does not.
  assert.deepEqual(tail.events.map((event) => event.seq), [5, 6, 7, 8], 'the window spans the selected messages and carries the tool record inside it')
  const onlyOperator = sliceEvents(EVENTS, { kinds: ['operator'], lastMessages: 0 })
  assert.deepEqual(onlyOperator.messages.map((event) => event.seq), [1, 5], 'one kind is a legitimate slice')
  assert.deepEqual(onlyOperator.events.map((event) => event.seq), [1, 2, 3, 4, 5], 'and the window still spans them')
})

test('the WINDOW keeps the tool RESULTS that a slice of messages alone drops', async () => {
  // THE DEFECT THIS EXISTS FOR, measured on a real session: a slice of messages keeps every tool CALL (they ride
  // inside the assistant turns' content blocks) and drops every tool RESULT (they are `tool/result` events). The
  // composed TOOL CALLS section then reads `call 1: bash({...})` for all 529 calls with no `-> ` line under any of
  // them, and the set asks "If a lookup in TOOL CALLS returned nothing usable, what did the agent do next?".
  const read = await readStoredSubject({ sessionQuery: queryWith(), sessionId: 'S1', kinds: ['operator', 'assistant'], lastMessages: 0 })
  const opt = { scope: 'session', maxChars: 4000, toolMaxChars: 2000 }
  const fromWindow = composeTurnState(Object.assign({ events: read.events }, opt)).sections['TOOL CALLS']
  const fromMessagesOnly = composeTurnState(Object.assign({ events: read.messages }, opt)).sections['TOOL CALLS']
  assert.match(fromWindow, /call 1: grep\(\{"pattern":"error"\}\)\n  -> the log says the deployment failed/, 'each result is under the call it belongs to, by id')
  assert.match(fromWindow, /call 3: wc\(\{"file":"\/tmp\/log"\}\)\n  -> nothing usable/, 'AND the result a stored judgement never saw at all')
  assert.match(fromMessagesOnly, /call 1: read/, 'messages alone still show a call, because calls ride inside the messages')
  assert.equal(/-> /.test(fromMessagesOnly), false, 'and drop every result -- which is the defect, in one assertion')
})

test('the coverage says how much session there was, which is the denominator O26 was missing', async () => {
  const read = await readStoredSubject({ sessionQuery: queryWith(), sessionId: 'S1', kinds: ['operator', 'assistant'], lastMessages: 0 })
  assert.deepEqual(read.coverage, {
    events: 8,
    messages: 4,
    chars: 'please summarise the deployment logs'.length + 'I looked it up.'.length + 'now shorten it'.length + 'shorter'.length,
    toolEvents: 4,
  })
  // AN EMPTY SESSION STILL REPORTS ZERO RATHER THAN `undefined`, so a reader never has to guess whether the number was
  // absent or the session was.
  const empty = await readStoredSubject({ sessionQuery: queryWith([]), sessionId: 'S1' })
  assert.deepEqual(empty.coverage, { events: 0, messages: 0, chars: 0, toolEvents: 0 })
})

test('a stored subject is read, and every failure is a sentence rather than a throw', async () => {
  const read = await readStoredSubject({ sessionQuery: queryWith(), sessionId: 'S1', kinds: ['operator', 'assistant'], lastMessages: 3 })
  assert.equal(read.problem, null)
  assert.equal(read.session.id, 'S1', 'the header comes back with the events')
  assert.deepEqual(read.messages.map((event) => event.seq), [4, 5, 8], 'the messages the caller lists')
  // THE WINDOW OPENS AT THE FIRST SELECTED MESSAGE, not at the first message in the session: the range is the one the
  // reader asked for, so a tool result that answered an earlier turn is not dragged in with it.
  assert.deepEqual(read.events.map((event) => event.seq), [4, 5, 6, 7, 8], 'and the window the composer takes')

  // A SESSION THAT DOES NOT EXIST, and a service that is not mounted: both are problems, and neither throws -- the
  // caller is a tool that has to explain what happened.
  const missing = await readStoredSubject({ sessionQuery: queryWith(), sessionId: 'S9' })
  assert.match(String(missing.problem), /no session with that id/)
  assert.deepEqual(missing.events, [])
  const unserved = await readStoredSubject({ sessionQuery: undefined, sessionId: 'S1' })
  assert.match(String(unserved.problem), /no session-query service/)
  const unchosen = await readStoredSubject({ sessionQuery: queryWith(), sessionId: '' })
  assert.match(String(unchosen.problem), /no stored session is selected/)

  // AN EMPTY SESSION IS NOT A FAILURE: it is a session with nothing in it, and the difference matters to a reader.
  const empty = await readStoredSubject({ sessionQuery: queryWith([]), sessionId: 'S1' })
  assert.equal(empty.problem, null)
  assert.deepEqual(empty.events, [])
})

test('the events go into the ONE composer, which composes THE EXCHANGE -- and that gap is register row O16', async () => {
  const read = await readStoredSubject({ sessionQuery: queryWith(), sessionId: 'S1', kinds: ['operator', 'assistant'], lastMessages: 0 })
  // WITH THE SCOPE O16 ASKED FOR: a stored subject is a conversation, not a turn in progress.
  const state = composeTurnState({ events: read.events, scope: 'session' })
  const text = String(state.state ?? '')
  assert.match(text, /SESSION TRANSCRIPT:\nOPERATOR: please summarise the deployment logs/, 'the conversation opens the state')
  assert.match(text, /AGENT: I looked it up\./, 'with the response to it')
  assert.match(text, /OPERATOR: now shorten it/, 'and the next request')
  // O16 WAS THIS ASSERTION'S OPPOSITE: as an exchange, the composer dropped the newest turn, and its test said so in
  // as many words. With the scope it is included, which is the whole point of a stored judgement.
  assert.match(text, /AGENT: shorter/, 'and the newest turn, which the exchange scope excluded')
})

test('the row\u2019s settings are read live, with the defaults a row that configured nothing should get', () => {
  const fresh = subjectSettings({})
  assert.equal(fresh.source, 'live', 'the live session stays the default subject')
  assert.equal(fresh.sessionId, '', 'and no stored session is selected')
  assert.deepEqual(fresh.kinds, [...DEFAULT_KINDS])
  assert.equal(fresh.lastMessages, 0, 'zero is the whole session')
  // THE VOLATILE ACCESSOR SHAPE, because that is what a running row actually passes: `.get()` rather than the value.
  const stored = subjectSettings({
    subjectSource: { get: () => 'stored' },
    subjectSession: { get: () => 'session-abc' },
    subjectKinds: { get: () => ['assistant'] },
    subjectLastMessages: { get: () => 20 },
  })
  assert.deepEqual(stored, { source: 'stored', sessionId: 'session-abc', kinds: ['assistant'], lastMessages: 20 })
})

test('the picker\u2019s list comes from the service, and names its absence', async () => {
  const listed = await listStoredSessions(queryWith())
  assert.deepEqual(listed.sessions, [{ id: 'S1', cwd: '/tmp/x', live: false }])
  assert.equal(listed.problem, null)
  const unserved = await listStoredSessions(undefined)
  assert.match(String(unserved.problem), /no session-query service/)
  assert.deepEqual(unserved.sessions, [])
})
