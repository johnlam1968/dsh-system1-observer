// EVERY IN-SCOPE BOUNDARY IS RECORDED, WITH ITS COHORT.
//
// Two failures this covers. One: a cadence skip used to write NOTHING -- the comment claimed every outcome that asks
// nothing is recorded, while the code recorded only refusals and failures -- so "the schedule has not come round" and
// "the trigger is dead" were the same evidence. Two: peer-opened turns are COUNTED by decision, so they must be
// LABELLED, or a judgement about a peer's request is indistinguishable from one about the operator's.
//
// Both directions are asserted: a peer-delivered message marks the boundary, and an operator's own message does not.
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

test('every boundary is recorded -- fired or not -- so the schedule is observable', async () => {
  const { handlers, lines, waitFor } = await mounted()
  const listener = handlers.get('agent/turn-stopping')[1]
  for (let i = 0; i < 3; i += 1) listener({ agent: { id: 'session-a' }, turn: 20 + i })
  await waitFor(3)
  const boundaries = lines().filter((l) => l.event === 'turn-boundary')
  assert.deepEqual(boundaries.map((l) => l.boundary), [1, 2, 3], 'one line per boundary, in order: ' + JSON.stringify(boundaries))
  assert.deepEqual(boundaries.map((l) => l.fired), [false, false, false], 'interval 3 with an empty question set fires nothing here, but every boundary is still recorded')
  assert.ok(boundaries.every((l) => l.everyNTurns === 3), 'and the interval is on the line, so "not this turn" is checkable')
  // AND THE HARNESS'S OWN TURN NUMBER, which is a DIFFERENT number from the boundary counter: the counter is in memory
  // and restarts at 1 on every mount, while the harness's continues. Measured live: boundary 3 against session turn 30.
  assert.deepEqual(boundaries.map((l) => l.harnessTurn), [20, 21, 22], 'the harness turn is recorded beside the count: ' + JSON.stringify(boundaries.map((l) => [l.boundary, l.harnessTurn])))
})

test('a PEER-delivered opening message is labelled, and an operator one is not', async () => {
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
  const operatorLine = operatorSide.lines().find((l) => l.event === 'turn-boundary')
  assert.equal(operatorLine.requestIsPeer, false, 'an operator message is not a peer one: ' + JSON.stringify(operatorLine))

  const noFeed = await mounted()
  noFeed.handlers.get('agent/turn-stopping')[1]({ agent: { id: 'session-a' }, turn: 1 })
  await noFeed.waitFor(1)
  const unknown = noFeed.lines().find((l) => l.event === 'turn-boundary')
  assert.equal(unknown.requestIsPeer, null, 'a cohort nobody measured is reported as unknown, not as operator: ' + JSON.stringify(unknown))
  assert.equal(unknown.cohortSource, 'unknown')
})
