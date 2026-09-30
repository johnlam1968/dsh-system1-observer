// THE WIRING, DRIVEN. The module tests prove each piece; nothing yet proved that the ROW calls them, and a green
// suite with the registration deleted looks identical. These drive `agent/pre-step` through a mounted row and read
// the trace back -- the same standard the service wiring was held to.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../index.js'

const accessor = (value) => ({ get: () => value })
const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

function mount({ sessions = ['*'], turn = 1, agent = { id: 'session-a' }, questions = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'turn-wiring-'))
  const tracePath = join(dir, 'trace.jsonl')
  const handlers = new Map()
  const ctx = {
    handlers,
    // A LIST per event, because Cordis supports many listeners on one event and a Map keeps only the last: the
    // first version of this stub silently kept the observer's own admit listener and dropped the trigger's.
    on(event, handler) {
      const list = handlers.get(event) ?? []
      list.push(handler)
      handlers.set(event, list)
      return () => {}
    },
    inject() {},
    provide: () => () => {},
    get: (name) => (name === 'agents' ? { get: () => ({ id: agent?.id, session: { snapshotEvents: () => [] } }), list: () => [] } : undefined),
    agents: { currentInitiator: () => agent },
  }
  const config = {
    hooks: accessor(['admit']),
    tracePath: accessor(tracePath),
    sessions: accessor(sessions),
    turnEveryNTurns: accessor(turn),
    questions: { turn: questions },
    wireUrl: accessor('http://127.0.0.1:9'),
    timeoutMs: accessor(200),
  }
  // A FILE NOTHING WROTE TO IS AN EMPTY LIST, NOT AN ERROR -- the same rule lib/evidence.js states, because "the row
  // said nothing" is exactly what two of these tests assert and readFileSync would throw on it.
  const lines = () => {
    if (!existsSync(tracePath)) return []
    const text = readFileSync(tracePath, 'utf8').trim()
    return text === '' ? [] : text.split('\n').map((line) => JSON.parse(line))
  }
  return { ctx, config, tracePath, lines }
}

test('an EXCLUDED session records a skip and never reaches the judge', async () => {
  const row = mount({ sessions: ['session-someone-else'] })
  await apply(row.ctx, row.config)
  // The TRIGGER's listener is registered before the seam's, so it is first in the list.
  const handler = row.ctx.handlers.get('agent/pre-step')?.[0]
  assert.equal(typeof handler, 'function', 'the row must subscribe the event the admit seam maps to')
  const next = () => Promise.resolve()
  handler({ agent: { id: 'session-not-watched' } }, next)
  await tick()
  const skips = row.lines().filter((line) => line.event === 'skip' && line.hook === 'turn')
  assert.equal(skips.length, 1)
  assert.equal(skips[0].reason, 'session not observed')
  assert.equal(row.lines().some((line) => line.event === 'call'), false, 'and nothing was sent')
})

test('an observed session with no turn set refuses rather than asking the probe', async () => {
  const row = mount({ questions: [] })
  await apply(row.ctx, row.config)
  row.ctx.handlers.get('agent/pre-step')[0]({ agent: { id: 'session-a' } }, () => Promise.resolve())
  await tick()
  assert.equal(row.lines().some((line) => line.event === 'call'), false, 'no call line, and never a probe call')
})

test('the trigger is off by default: turnEveryNTurns 0 mounts and watches nothing', async () => {
  const row = mount({ turn: 0 })
  await apply(row.ctx, row.config)
  assert.equal(typeof row.ctx.handlers.get('agent/pre-step')?.[0], 'function', 'the handler exists')
  row.ctx.handlers.get('agent/pre-step')[0]({ agent: { id: 'session-a' } }, () => Promise.resolve())
  await tick()
  // THE PROPERTY IS "NO MEASUREMENT", NOT "NO LINES". A skip is not a measurement -- it is the record that nothing
  // was sent, which is the behaviour the observation path has too. Asserting silence made this test depend on the
  // fixture agent's shape: `isSubagent` consults the real helper, and an agent the fixture invents can legitimately
  // trip that gate and write `subagent session`. So the assertion names what the knob controls.
  assert.equal(row.lines().some((line) => line.event === 'call'), false, 'off means nothing was sent')
  assert.equal(row.lines().some((line) => Array.isArray(line.questionIds)), false, 'and no measurement was recorded')
})
