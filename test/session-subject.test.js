// THE STORED-SESSION SUBJECT: the adapter's contract, and the reuse it exists for.
//
// The point of this module is that it has NO composer of its own -- it produces events, and the ONE existing composer
// (`composeTurnState`) turns them into the text a judge is shown. The last test here asserts exactly that, because it
// is the property that keeps the live and stored modes from drifting apart in what they present.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_KINDS, SUBJECT_KINDS, eventTypesOf, listStoredSessions, readStoredSubject, sliceEvents, subjectSettings,
} from '../lib/session-subject.js'
import { composeTurnState } from '../lib/turn-state.js'

/** One session event in the shape the harness writes and the composer reads. */
const message = (seq, type, text) => ({
  seq,
  time: seq,
  type,
  data: { message: { role: type.startsWith('user') ? 'user' : 'assistant', content: [{ type: 'text', text }] } },
})

const EVENTS = [
  message(1, 'user/message', 'please summarise the deployment logs'),
  message(2, 'assistant/message', 'here is the summary'),
  message(3, 'user/message', 'now shorten it'),
  message(4, 'assistant/message', 'shorter'),
  { seq: 5, time: 5, type: 'tool/result', data: { message: { content: [{ type: 'text', text: 'tool output' }] } } },
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
  assert.equal(whole.matched, 4, 'the four messages, and not the tool result')
  assert.equal(whole.total, 5, 'out of five events')
  assert.deepEqual(whole.events.map((event) => event.seq), [1, 2, 3, 4], 'newest last, as the composer expects')
  const tail = sliceEvents(EVENTS, { kinds: ['operator', 'assistant'], lastMessages: 2 })
  assert.deepEqual(tail.events.map((event) => event.seq), [3, 4], 'the last two messages, not the last two events')
  const onlyOperator = sliceEvents(EVENTS, { kinds: ['operator'], lastMessages: 0 })
  assert.deepEqual(onlyOperator.events.map((event) => event.seq), [1, 3], 'one kind is a legitimate slice')
})

test('a stored subject is read, and every failure is a sentence rather than a throw', async () => {
  const read = await readStoredSubject({ sessionQuery: queryWith(), sessionId: 'S1', kinds: ['operator', 'assistant'], lastMessages: 3 })
  assert.equal(read.problem, null)
  assert.equal(read.session.id, 'S1', 'the header comes back with the events')
  assert.deepEqual(read.events.map((event) => event.seq), [2, 3, 4])

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
  assert.match(text, /AGENT: here is the summary/, 'with the response to it')
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
