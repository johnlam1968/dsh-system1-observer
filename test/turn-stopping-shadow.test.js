// THE SERIAL CONSTRAINT, ASSERTED RATHER THAN ASSUMED. `agent/turn-stopping` is a serial event: the harness AWAITS
// its listeners before closing the turn. So the shadow listener must return UNDEFINED -- not a promise the harness
// would wait on -- and it must not throw, because a listener the harness awaits must never become the reason a turn
// fails to close. Both properties are checked here; a comment saying "this is detached" would not be.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../index.js'

const accessor = (value) => ({ get: () => value })

test('the turn-stopping shadow records the harness turn and returns NOTHING the harness could await', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'turn-stop-'))
  const tracePath = join(dir, 'trace.jsonl')
  const agent = { id: 'session-a', session: { snapshotEvents: () => [] } }
  const handlers = new Map()
  const ctx = {
    on(event, handler) { const list = handlers.get(event) ?? []; list.push(handler); handlers.set(event, list); return () => {} },
    inject() {}, provide: () => () => {},
    get: (name) => (name === 'agents' ? { get: () => agent, list: () => [agent] } : undefined),
    agents: { currentInitiator: () => agent },
  }
  await apply(ctx, {
    hooks: accessor(['admit']), tracePath: accessor(tracePath), sessions: accessor(['*']),
    turnEveryNTurns: accessor(0), questions: { turn: [{ id: 'a', type: 'noul', instructions: 'x?' }] },
  })
  const listener = handlers.get('agent/turn-stopping')?.[0]
  assert.equal(typeof listener, 'function', 'the row subscribes the harness signal')

  const returned = listener({ agent, turn: 42 })
  assert.equal(returned, undefined, 'SERIAL: it must return undefined, not a promise the harness would await')

  await new Promise((r) => setTimeout(r, 30))
  const lines = existsSync(tracePath) ? readFileSync(tracePath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []
  const shadow = lines.filter((l) => l.event === 'turn-stopping')
  assert.equal(shadow.length, 1, 'one shadow line per completed turn')
  assert.equal(shadow[0].turn, 42, "the harness's own turn number, which is the point of watching it")
  assert.equal(shadow[0].agentId, 'session-a')

  // AND A JUNK PAYLOAD IS SURVIVED rather than thrown on: this listener runs inside a turn close.
  assert.equal(listener(undefined), undefined, 'no payload is not a throw')
  assert.equal(listener({ agent: { id: 'x' } }), undefined, 'and a missing turn is recorded as null rather than guessed')
})
