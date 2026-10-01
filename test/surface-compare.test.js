// THE FOLD IS CHECKED AGAINST THE ORACLE, AND A DISAGREEMENT IS RECORDED RATHER THAN SMOOTHED OVER.
//
// `sessionQuery.readSurface` answers the same question the fold answers -- which seqs survive -- so one line records
// whether they agree. This test makes them DISAGREE on purpose: a comparison that cannot report disagreement is the
// class of check this session has learned to distrust.
//
// THE FOLD'S EXPECTED LIST IS [1, 3, 4], NOT [1, 4]. A `replace 2..2` carried by seq 3 drops the REPLACED range and
// the REPLACING EVENT SURVIVES -- which is what lib/host/surface.js's own tests have asserted since round 108, and
// what my first version of this fixture got wrong twice.
//
// AND IT NEEDS A QUESTION SET: with `questions: { turn: [] }` the turn is SKIPPED before the composer runs, and the
// trace says so in two entries -- ["mount","skip"]. `readSurfaceSeqs` is read while COMPOSING, before anything is
// asked, so the judge call this never reaches is irrelevant.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../index.js'

const accessor = (value) => ({ get: () => value })
const msg = (seq, type, text) => ({ seq, time: seq, type, surfaceOp: 'append', data: { message: { role: type === 'user/message' ? 'user' : 'assistant', content: [{ type: 'text', text }] } } })
const EVENTS = [
  msg(1, 'user/message', 'the request'),
  msg(2, 'assistant/message', 'the answer the fold must drop'),
  { seq: 3, time: 3, type: 'tool/result', surfaceOp: { op: 'replace', startSeq: 2, endSeq: 2 }, data: { message: { role: 'tool', toolCallId: 't', content: [{ type: 'text', text: 'replaced' }] } } },
  msg(4, 'user/message', 'the reaction'),
]
const SPECS = [{ id: 'a_noul', type: 'noul', instructions: 'Is this true?' }]

async function mounted({ oracleNodes }) {
  const dir = mkdtempSync(join(tmpdir(), 'surface-compare-'))
  const tracePath = join(dir, 'trace.jsonl')
  const agent = { id: 'session-a', session: { snapshotEvents: () => EVENTS } }
  const handlers = new Map()
  const ctx = {
    on(event, handler) { const list = handlers.get(event) ?? []; list.push(handler); handlers.set(event, list); return () => {} },
    inject() {}, provide: () => () => {},
    get: (name) => {
      if (name === 'agents') return { get: () => agent, list: () => [agent] }
      if (name === 'sessionQuery') return { readSurface: async () => ({ nodes: oracleNodes }) }
      return undefined
    },
    agents: { currentInitiator: () => agent },
  }
  await apply(ctx, {
    hooks: accessor([]), tracePath: accessor(tracePath), sessions: accessor(['*']),
    turnEveryNTurns: accessor(1), questions: { turn: SPECS }, observeSubagents: accessor(true),
  })
  await handlers.get('agent/turn-stopping')[1]({ agent, turn: 1 })
  const lines = () => (existsSync(tracePath) ? readFileSync(tracePath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
  for (let i = 0; i < 80 && !lines().some((l) => l.event === 'surface-compare'); i += 1) await new Promise((r) => setTimeout(r, 25))
  return lines()
}

test('a DISAGREEING oracle is recorded, with both lists', async () => {
  const lines = await mounted({ oracleNodes: [1, 2, 4] })
  const compared = lines.filter((l) => l.event === 'surface-compare')
  assert.equal(compared.length, 1, 'one comparison per surface read: ' + JSON.stringify(lines.map((l) => l.event)))
  assert.equal(compared[0].agree, false, 'the oracle kept seq 2 and the fold dropped it, so they DISAGREE')
  assert.deepEqual(compared[0].foldedSeqs, [1, 3, 4], 'the fold drops the REPLACED range; the replacing event survives')
  assert.deepEqual(compared[0].oracleSeqs, [1, 2, 4], "and the oracle's answer is recorded beside it")
})

test('an AGREEING oracle says so -- so the line is not reporting a fixed value', async () => {
  const lines = await mounted({ oracleNodes: [1, 3, 4] })
  const compared = lines.filter((l) => l.event === 'surface-compare')
  assert.equal(compared.length, 1)
  assert.equal(compared[0].agree, true, 'matching lists agree')
})
