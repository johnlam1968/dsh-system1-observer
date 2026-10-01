// "NOT THIS TURN" MUST BE VISIBLE. The trigger's own comment says every outcome that asks nothing is recorded,
// because "an operator could not tell a schedule that has not come round from one that will never fire". The code
// recorded only refusals and failures -- so the commonest outcome of all, a cadence skip, was SILENCE. Measured
// live: six consecutive boundaries of a live session produced no line at all, and I could not tell whether the
// counter was advancing or the trigger was dead.
//
// This test drives three boundaries with the interval at 3 and asserts the first two are recorded WITH THEIR
// BOUNDARY NUMBER -- which is the thing that makes the counter observable. Before the fix this test fails with zero
// such lines; a test that passes either way would be worth nothing here.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../index.js'

const accessor = (value) => ({ get: () => value })

test('a cadence skip is recorded with its boundary number, so the schedule is observable', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'turn-cadence-'))
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
    hooks: accessor([]), tracePath: accessor(tracePath), sessions: accessor(['*']),
    turnEveryNTurns: accessor(3), questions: { turn: [] }, observeSubagents: accessor(true),
  })
  const listener = handlers.get('agent/turn-stopping')[1]
  assert.equal(typeof listener, 'function', 'the trigger is subscribed')

  for (let i = 0; i < 3; i += 1) { listener({ agent, turn: 10 + i }) }
  for (let i = 0; i < 80 && !(existsSync(tracePath) && readFileSync(tracePath, 'utf8').includes('boundary 2 of every 3')); i += 1) {
    await new Promise((r) => setTimeout(r, 25))
  }
  const lines = existsSync(tracePath) ? readFileSync(tracePath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []
  const cadence = lines.filter((l) => l.event === 'skip' && String(l.reason).startsWith('not this turn:'))
  assert.deepEqual(cadence.map((l) => l.turn), [1, 2], 'both non-firing boundaries are recorded, with their numbers: ' + JSON.stringify(lines.map((l) => [l.event, l.reason])))
  assert.match(String(cadence[0].reason), /boundary 1 of every 3/, 'and the reason names the interval')
  // AND THE THIRD BOUNDARY IS NOT A CADENCE SKIP: it fires, and refuses for its own reason (no set configured here).
  assert.equal(cadence.filter((l) => l.turn === 3).length, 0, 'the boundary that fires is not reported as a cadence skip')
})
