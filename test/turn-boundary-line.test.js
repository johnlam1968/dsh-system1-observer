// EVERY IN-SCOPE BOUNDARY IS RECORDED, WITH ITS COHORT AND ITS CADENCE BASIS.
//
// Four failures this covers, each measured live rather than imagined:
//   1. a cadence skip wrote NOTHING, so "the schedule has not come round" and "the trigger is dead" were one fact;
//   2. peer-opened turns are COUNTED by the operator's decision, so they must be LABELLED, or a judgement about a
//      peer's request is indistinguishable from one about the operator's under questions that say "OPERATOR REQUEST";
//   3. the cadence ran on an IN-MEMORY ledger that resets at every apply -- and a settings save re-applies the row;
//   4. and the fix for 3 was itself delivered dead, because the observer dropped `harnessTurn` on its way to the
//      listener. That is the failure this file most needs to be able to see, so the basis is asserted directly.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../index.js'

const accessor = (value) => ({ get: () => value })

async function mounted() {
  const dir = mkdtempSync(join(tmpdir(), 'turn-boundary-'))
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
  const lines = () => (existsSync(tracePath) ? readFileSync(tracePath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
  const waitFor = async (n) => { for (let i = 0; i < 120 && lines().filter((l) => l.event === 'turn-boundary').length < n; i += 1) await new Promise((r) => setTimeout(r, 25)) }
  return { handlers, lines, waitFor }
}

const userMessage = (seq, id, text) => ({ seq, time: seq, type: 'user/message', surfaceOp: 'append', data: { id, role: 'user', content: [{ type: 'text', text }] } })

test('the cadence basis is the HARNESS turn, not the count of boundaries this process saw', async () => {
  const { handlers, lines, waitFor } = await mounted()
  const listener = handlers.get('agent/turn-stopping')[1]
  for (let i = 0; i < 3; i += 1) listener({ agent: { id: 'session-a' }, turn: 20 + i })
  await waitFor(3)
  const b = lines().filter((l) => l.event === 'turn-boundary')
  // THIS ASSERTION ONCE SAID [1, 2, 3] AND PASSED, because the code and the test agreed with each other and both were
  // wrong. Measured in production, on one line: `harnessTurn=21` beside `boundary=19`.
  assert.deepEqual(b.map((l) => l.boundary), [20, 21, 22], 'the basis is the session turn, NOT 1,2,3: ' + JSON.stringify(b.map((l) => [l.boundary, l.harnessTurn])))
  assert.ok(b.every((l) => l.boundary === l.harnessTurn), 'and it agrees with the harness turn recorded beside it')
  assert.deepEqual(b.map((l) => l.fired), [false, false, false], 'interval 3 into an empty question set fires nothing, but every boundary is still recorded')
  assert.ok(b.every((l) => l.everyNTurns === 3), 'the interval is on the line, so "not this turn" is checkable')
})

test('with no turn on the payload the ledger IS the fallback, and the line says so', async () => {
  const { handlers, lines, waitFor } = await mounted()
  const listener = handlers.get('agent/turn-stopping')[1]
  for (let i = 0; i < 3; i += 1) listener({ agent: { id: 'session-a' } })
  await waitFor(3)
  const b = lines().filter((l) => l.event === 'turn-boundary')
  assert.deepEqual(b.map((l) => l.boundary), [1, 2, 3], 'no turn number means the ledger decides: ' + JSON.stringify(b.map((l) => [l.boundary, l.harnessTurn])))
  assert.deepEqual(b.map((l) => l.harnessTurn), [null, null, null], 'and the absence is visible rather than guessed')
})

test('a PEER-delivered opening message is labelled, an operator one is not, and no feed is UNKNOWN', async () => {
  const peerSide = await mounted()
  peerSide.handlers.get('session/event')[0]({ id: 'session-a' }, userMessage(1, 'peer-mup6su0g-rvnvsjkh', '[peer-bridge: from session-91d07b68] do the thing'))
  peerSide.handlers.get('agent/turn-stopping')[1]({ agent: { id: 'session-a' }, turn: 1 })
  await peerSide.waitFor(1)
  const peerLine = peerSide.lines().find((l) => l.event === 'turn-boundary')
  assert.equal(peerLine.requestIsPeer, true, 'the message id marks it: ' + JSON.stringify(peerLine))
  assert.equal(peerLine.requestSeq, 1)
  assert.equal(peerLine.cohortSource, 'id')

  const operatorSide = await mounted()
  operatorSide.handlers.get('session/event')[0]({ id: 'session-a' }, userMessage(1, '86ee1670-826a-4b51-9dd7-9cc428b4e368', 'To prove the format, use the tool'))
  operatorSide.handlers.get('agent/turn-stopping')[1]({ agent: { id: 'session-a' }, turn: 1 })
  await operatorSide.waitFor(1)
  assert.equal(operatorSide.lines().find((l) => l.event === 'turn-boundary').requestIsPeer, false, 'an operator message is not a peer one')

  const noFeed = await mounted()
  noFeed.handlers.get('agent/turn-stopping')[1]({ agent: { id: 'session-a' }, turn: 1 })
  await noFeed.waitFor(1)
  const unknown = noFeed.lines().find((l) => l.event === 'turn-boundary')
  assert.equal(unknown.requestIsPeer, null, 'a cohort nobody measured is reported as unknown, not as operator: ' + JSON.stringify(unknown))
  assert.equal(unknown.cohortSource, 'unknown')
})
