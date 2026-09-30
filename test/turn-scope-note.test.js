// A SKIP THAT CANNOT BE TOLD FROM A SCOPE WORKING AS INTENDED. Measured live: the row was scoped to one session, a
// restart did not resume it, and 145 consecutive boundaries skipped with the identical reason `session not observed`
// -- which reads like correct scoping. The row knows which sessions are live, so the skip now says which it is.
//
// WHAT DISTINGUISHES THE CASES IS THE REASON, NOT THE COUNT. A gated boundary is skipped with `session not observed`;
// a boundary the gate lets through can ALSO produce a skip, because a chain that refuses records its refusal as a
// skip too -- so a test counting skips cannot tell "scoped out" from "ran and had nothing to judge".
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../index.js'

const accessor = (value) => ({ get: () => value })
const read = (path) => (existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
const gated = (lines) => lines.filter((line) => line.reason === 'session not observed')

async function fire({ configured, liveId, eventId }) {
  const dir = mkdtempSync(join(tmpdir(), 'scope-note-'))
  const tracePath = join(dir, 'trace.jsonl')
  const agent = { id: liveId, session: { snapshotEvents: () => [] } }
  const handlers = new Map()
  await apply({
    on(event, handler) { const list = handlers.get(event) ?? []; list.push(handler); handlers.set(event, list); return () => {} },
    inject() {}, provide: () => () => {},
    get: (name) => (name === 'agents' ? { get: () => agent, list: () => [agent] } : undefined),
    agents: { currentInitiator: () => agent },
  }, {
    hooks: accessor(['admit']), tracePath: accessor(tracePath), sessions: accessor(configured),
    turnEveryNTurns: accessor(1), questions: { turn: [{ id: 'a', type: 'noul', instructions: 'x?' }] },
  })
  await handlers.get('agent/pre-step')?.[0]({ agent: { id: eventId, session: agent.session }, messages: [{ text: 'no' }] }, () => Promise.resolve())
  return read(tracePath).filter((line) => line.event === 'skip' && line.hook === 'turn')
}

test('a skip says when the session it is scoped to is CONFIGURED BUT NOT LIVE', async () => {
  // The measured situation: scoped to a session that is not live, and the boundary is another session's.
  const dead = await fire({ configured: ['session-x'], liveId: 'session-y', eventId: 'session-y' })
  assert.equal(gated(dead).length, 1, 'the boundary is gated out, and the trace says: ' + JSON.stringify(dead))
  assert.equal(gated(dead)[0].reason, 'session not observed', 'the reason is unchanged, so readers keep working')
  assert.match(gated(dead)[0].note ?? '', /session-x configured, not live in this process/, 'and the note names the session that cannot fire')

  // An ordinary out-of-scope session, where the configured scope IS live: gated, but no note. That is scope working.
  const ordinary = await fire({ configured: ['session-y'], liveId: 'session-y', eventId: 'session-z' })
  assert.equal(gated(ordinary).length, 1, 'still gated')
  assert.equal(gated(ordinary)[0].note, undefined, 'and no note, because the configured session is live')

  // A wildcard scope observes this session, so the GATE does not fire. The chain then runs and refuses -- this
  // fixture has no exchange to judge -- and a refusal is recorded as a skip too. Hence the reason, not the count.
  const all = await fire({ configured: ['*'], liveId: 'session-y', eventId: 'session-z' })
  assert.equal(gated(all).length, 0, 'a wildcard scope does not gate this session out')
  assert.equal(all.every((line) => line.note === undefined), true, 'and nothing carries the dead-configuration note')
})
