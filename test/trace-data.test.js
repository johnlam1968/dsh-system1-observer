import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MAX_CARD_ROWS, traceData } from '../lib/trace-data.js'

const mount = (run, at, extra = {}) => ({
  at, run, event: 'mount', hooks: ['admit', 'draft'], transport: 'service',
  provider: 'typesafe', model: 'jev-latest', questionIds: ['q'], callsEnabled: true,
  seamsOff: [], sessions: ['*'], tracePath: '/tmp/t.jsonl', ...extra,
})
const call = (run, at, extra = {}) => ({
  at, run, event: 'call', hook: 'draft', agentId: 'session-aaaa-1111', ms: 800,
  // The judge's own usage, which is where the price comes from. Output is free on this model, so the input term
  // is the whole cost -- and the output count is still recorded, so its absence from the sum is visible.
  envelope: { usage: { inputTokens: 800, outputTokens: 20 }, durationMs: 795, executed: { provider: 'typesafe', model: 'typesafe/jev-1.13' } },
  excerpt: 'the model is answering', subject: { provider: 'openrouter', model: 'x/y' },
  questions: { reply_kind: { type: 'choice', instructions: 'Is it an answer?' } },
  answer: { answers: { reply_kind: { type: 'choice', label: 'an_answer', confidence: 0.9, probabilities: { an_answer: 0.95 } } } },
  ...extra,
})
const skip = (run, at, reason) => ({ at, run, event: 'skip', hook: 'execute', agentId: 'session-aaaa-1111', reason })

function fixture(lines) {
  const dir = mkdtempSync(join(tmpdir(), 'observer-data-'))
  const path = join(dir, 'trace.jsonl')
  writeFileSync(path, lines.map(line => JSON.stringify(line)).join('\n') + '\n')
  return path
}

test('the card data is plain JSON, counted from the whole run rather than the listed rows', () => {
  const path = fixture([
    mount('RUN-A', '2026-01-02T00:00:00.000Z'),
    call('RUN-A', '2026-01-02T00:00:01.000Z'),
    skip('RUN-A', '2026-01-02T00:00:02.000Z', 'no text at this seam'),
    skip('RUN-A', '2026-01-02T00:00:03.000Z', 'no text at this seam'),
    skip('RUN-A', '2026-01-02T00:00:04.000Z', 'session not observed'),
  ])
  const data = traceData({ path, tail: 1 })
  assert.equal(data.run, 'RUN-A')
  assert.deepEqual(data.counts, { call: 1, skip: 3, error: 0, mount: 1, rotate: 0, events: 5 })
  assert.equal(data.listed.length, 1, 'the card lists what it was asked for')
  assert.equal(data.listedOf, 5, 'but the counts cover the run')
  assert.deepEqual(data.reasons.map(r => r.key), ['no text at this seam', 'session not observed'])
  assert.deepEqual(data.subjects, [{ key: 'openrouter/x/y', count: 1 }])
  assert.equal(data.latency.min, 800)
  assert.equal(data.latency.median, 800)
  assert.equal(data.latency.max, 800)
  assert.equal(data.latency.p95, 800, 'and the tail, which a min/median/max triple cannot show')
  // THE MONEY CARRIES ITS PROVENANCE, because a figure without it is the defect: this is the JUDGE's cost, the
  // rate is a dated transcription, and a call with no usage is counted rather than silently dropped.
  assert.equal(data.cost.estimatedUsd, 0.000034, '800 input tokens at the cited rate')
  assert.equal(data.cost.covers, 'the decision model only')
  assert.match(data.cost.priceSource, /transcribed 2026-09-28/)
  assert.equal(data.cost.pricedCalls + data.cost.unpricedCalls, 1)
  // It crosses a wire, so it must survive one.
  assert.deepEqual(JSON.parse(JSON.stringify(data)), data)
})

test('the mount scope is carried, because it is what explains a run that recorded nothing', () => {
  const path = fixture([
    mount('RUN-B', '2026-01-02T00:00:00.000Z', { callsEnabled: false, seamsOff: ['admit'], sessions: [] }),
    skip('RUN-B', '2026-01-02T00:00:01.000Z', 'calls disabled'),
  ])
  const data = traceData({ path })
  assert.equal(data.mounts.length, 1)
  assert.equal(data.mounts[0].callsEnabled, false)
  assert.deepEqual(data.mounts[0].seamsOff, ['admit'])
  assert.deepEqual(data.mounts[0].sessions, [], 'an empty list is a state, not a missing field')
})

// AN UNKNOWN RUN IS NOT AN EMPTY CARD. A renderer that drew nothing would look identical to a run with no
// events, so the data says which runs exist and lets the card offer them.
test('an unmatched run says so, and lists the runs that do exist', () => {
  const path = fixture([
    mount('RUN-C', '2026-01-02T00:00:00.000Z'),
    mount('RUN-D', '2026-01-02T00:01:00.000Z'),
  ])
  const data = traceData({ path, run: 'nope' })
  assert.equal(data.unknownRun, true)
  assert.deepEqual(data.runs.sort(), ['RUN-C', 'RUN-D'])
  assert.deepEqual(data.counts.events, 0)
})

test('a missing file is an empty card rather than a throw', () => {
  const data = traceData({ path: '/nonexistent/trace.jsonl' })
  assert.equal(data.counts.events, 0)
  assert.deepEqual(data.listed, [])
  assert.equal(data.run, null)
})

// A DOM BUDGET, NOT A DATA LIMIT: the tool may be asked for 200 rows, and a card that tried to draw them all
// would freeze the page it is trying to inform.
test('the card never lists more rows than it can draw', () => {
  const lines = [mount('RUN-E', '2026-01-02T00:00:00.000Z')]
  for (let i = 0; i < 120; i += 1) lines.push(skip('RUN-E', `2026-01-02T00:00:${String(i % 60).padStart(2, '0')}.000Z`, 'no text at this seam'))
  const data = traceData({ path: fixture(lines), tail: 200 })
  assert.equal(data.listed.length, MAX_CARD_ROWS)
  assert.equal(data.counts.events, 121, 'the counts still cover everything')
})
