// THE SURFACE AUTHORITY, AND THE WIRING THAT USES IT.
//
// `lib/host/surface.js` folds `surfaceOp: replace` spans out of the events in hand and nominates itself for deletion
// "when the plugin is wired to" the host's own answer. Two things had to be measured before that could be believed:
// the authority EXISTS (`sessionQuery.filterEvents(sessionId, [{kind:'surface', values:['current']}])`, verified in the
// producer, where `SessionEventSurface = 'current' | 'shadowed' | 'log-only'`), and it is ASYNC and OPTIONAL -- so the
// fold is not deleted but kept as the fallback, and this file holds both halves of that rule.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../index.js'
import { currentSurfaceSeqs } from 'dsh-session-adapter/surface-authority'

const FILTER = [{ kind: 'surface', values: ['current'] }]

test('the authority answers with the seqs the host calls CURRENT', async () => {
  const asked = []
  const query = { async filterEvents(sessionId, filters) { asked.push([sessionId, filters]); return [{ seq: 1 }, { seq: 3 }] } }
  assert.deepEqual(await currentSurfaceSeqs(query, 's1'), [1, 3])
  assert.deepEqual(asked, [['s1', FILTER]], 'the filter is the documented surface kind, not a guess')
})

test('a refusal is NOT an answer: every failure returns null so the fold stays in charge', async () => {
  // Returning `[]` would claim "nothing is in the surface", and the composer refuses every turn rather than quote one.
  assert.equal(await currentSurfaceSeqs(undefined, 's1'), null, 'no service')
  assert.equal(await currentSurfaceSeqs({}, 's1'), null, 'a service without filterEvents')
  assert.equal(await currentSurfaceSeqs({ async filterEvents() { throw new Error('unavailable') } }, 's1'), null, 'a throw')
  assert.equal(await currentSurfaceSeqs({ async filterEvents() { return [] } }, 's1'), null, 'an empty page')
  assert.equal(await currentSurfaceSeqs({ async filterEvents() { return [{ sessionId: 's1' }] } }, 's1'), null, 'documents with no seq')
  assert.equal(await currentSurfaceSeqs({ async filterEvents() { return [{ seq: 1 }] } }, ''), null, 'no session id')
})

/** The apply-level harness: a ctx that answers `inject` and `get`, capturing the tools the plugin registers. */
function fakeCtx({ query, registered }) {
  const handlers = new Map()
  const tools = { register: (definition) => { registered.set(definition.name, definition); return () => {} } }
  const child = { get: (name) => (name === 'tools' ? tools : name === 'sessionQuery' ? query : undefined) }
  return {
    handlers,
    on: (event, handler) => { handlers.set(event, handler); return () => handlers.delete(event) },
    inject: (_names, callback) => { callback(child) },
    get: (name) => (name === 'sessionQuery' ? query : undefined),
    provide: () => () => {},
    agents: { currentInitiator: () => ({ id: 'agent-1' }) },
  }
}

const SHADOWED = 'THE SHADOWED ANSWER -- dropped from the surface'
const VISIBLE = 'the answer that stayed'

function eventsOf() {
  return [
    { type: 'user/message', seq: 1, time: 1, data: { turn: 1, source: { kind: 'user' }, content: [{ type: 'text', text: 'the operator request' }] } },
    { type: 'assistant/message', seq: 2, time: 2, data: { turn: 1, message: { content: [{ type: 'text', text: SHADOWED }] } } },
    { type: 'assistant/message', seq: 3, time: 3, data: { turn: 1, message: { content: [{ type: 'text', text: VISIBLE }] } } },
  ]
}

function queryWith(events, filter) {
  return {
    async listSessions() { return [{ header: { id: 'agent-1', cwd: '/tmp' } }] },
    async readTitleSnapshots(ids) { return ids.map((sessionId) => ({ sessionId, status: 'fulfilled', value: { title: { title: 'a session' } } })) },
    async readSession() { return { session: { id: 'agent-1', cwd: '/tmp', createdAt: 1000 }, inheritedEventCount: 0, events } },
    ...(filter === undefined ? {} : { async filterEvents(sessionId, filters) { return filter(sessionId, filters) } }),
  }
}

async function subjectOf(query) {
  const registered = new Map()
  const ctx = fakeCtx({ query, registered })
  await apply(ctx, { hooks: ['draft'], tracePath: join(mkdtempSync(join(tmpdir(), 'surface-authority-')), 'trace.jsonl'), sessions: ['agent-1'], wireUrl: 'http://127.0.0.1:9', timeoutMs: 200 })
  const tool = registered.get('system1_sessions')
  assert.ok(tool !== undefined, 'the sessions tool was registered')
  const value = await tool.execute({ action: 'read', sessionId: 'agent-1', format: 'subject' })
  return { value, registered }
}

test('THE WIRING: the composer asks the host, and composes ONLY the events the host calls current', async () => {
  const asked = []
  const { value } = await subjectOf(queryWith(eventsOf(), (sessionId, filters) => { asked.push([sessionId, filters]); return [{ seq: 1 }, { seq: 3 }] }))
  assert.deepEqual(asked, [['agent-1', FILTER]], 'the session id reached the authority, and the filter is the documented one')
  assert.match(value.state, /the answer that stayed/, 'the surfaced answer is composed')
  assert.doesNotMatch(value.state, /THE SHADOWED ANSWER/, 'and the one the host calls shadowed is NOT -- this is what the wiring buys')
})

test('and WITHOUT the authority the fold decides, so such a deployment behaves exactly as it did', async () => {
  // No `filterEvents` on the service: the fold sees no `replace` in these events, so both answers are composed. The
  // point is not that the fold is right here -- it is that the plugin still has an answer with no service to ask.
  const { value } = await subjectOf(queryWith(eventsOf(), undefined))
  assert.match(value.state, /THE SHADOWED ANSWER/, 'the fold kept what it had no reason to drop')
  assert.match(value.state, /the answer that stayed/)
})
