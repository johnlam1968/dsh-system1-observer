// THE PATH PRODUCTION RUNS. The other end-to-end test drives the WIRE, because `apply` falls back to it when no
// `system1` service is mounted. This profile mounts one, so a live turn takes the SERVICE path, and nothing covered
// it end to end -- which is exactly where the envelope defect lived: a consumer reading the top level lost the
// provenance and the cost in production while every test stayed green.
//
// BOTH SHAPES ARE READ FROM THE CODE, NOT GUESSED, and each one took a round to find because I guessed first:
//
//   the INJECTION, from the row's own call site -- `ctx.inject(['system1'], (child) => child.get('system1'))` --
//     is a CHILD CTX rather than the service, the same way `test/entry-apply.test.js` stubs it.
//   the ANSWER, from `flattenOne` in `lib/model/service-answers.js`, is
//     `{ status: 'ok', answer: { type, probabilityTrue, confidence } }` -- the service's own shape, which
//     `serviceAnswers` flattens into what the shared reader expects. It is NOT the wire's `{ noul: 0.9 }`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../index.js'
import { probeViolations } from '../lib/turn-record.js'

const accessor = (value) => ({ get: () => value })
const env = (seq, type, content) => ({ seq, type, data: { message: { content } } })
const text = (t) => ({ type: 'text', text: t })
const EXCHANGE = [
  env(1, 'user/message', [text('Find dsh plugins related to system1.')]),
  env(2, 'assistant/message', [text('Searching.'), { type: 'tool_use', name: 'find_dsh_plugin', input: { query: 'system1' } }]),
  env(3, 'user/message', [{ type: 'tool_result', tool_use_id: 't1', content: 'no results' }]),
  env(4, 'assistant/message', [text('Nothing found; here is how to search yourself.')]),
]
const SPECS = [{ id: 'a_noul', type: 'noul', instructions: 'Is this true?' }]

test('a mounted row asks the SERVICE, and the line carries what the service answered', async () => {
  let asked = null
  const dir = mkdtempSync(join(tmpdir(), 'svc-path-'))
  const tracePath = join(dir, 'trace.jsonl')
  const agent = { id: 'session-a', session: { snapshotEvents: () => EXCHANGE } }
  const handlers = new Map()
  const service = {
    decide: async (request) => {
      asked = request
      return {
        answers: { a_noul: { status: 'ok', answer: { type: 'noul', probabilityTrue: 0.9, confidence: 0.9 } } },
        meta: { executed: { provider: 'typesafe', revision: 'typesafe/jev-1.13' }, usage: { inputTokens: 12 }, durationMs: 812.5, requestId: 'r1' },
      }
    },
  }
  const ctx = {
    on(event, handler) { const list = handlers.get(event) ?? []; list.push(handler); handlers.set(event, list); return () => {} },
    inject(services, callback) {
      if (Array.isArray(services) && services.includes('system1')) callback({ get: (name) => (name === 'system1' ? service : undefined) })
    },
    provide: () => () => {},
    get: (name) => (name === 'agents' ? { get: () => agent, list: () => [agent] } : undefined),
    agents: { currentInitiator: () => agent },
  }
  await apply(ctx, {
    hooks: accessor(['admit']), tracePath: accessor(tracePath), sessions: accessor(['*']),
    turnEveryNTurns: accessor(1), questions: { turn: SPECS }, observeSubagents: accessor(true),
  })
  const handler = handlers.get('agent/turn-stopping')?.[1]
  assert.equal(typeof handler, 'function', 'the row subscribes the event the admit seam maps to')
  await handler({ agent, messages: [{ text: 'You should mutate the keywords and search again.' }] })
  const recorded = () => existsSync(tracePath) && readFileSync(tracePath, 'utf8').includes('"hook":"turn"')
  for (let attempt = 0; attempt < 40 && !recorded(); attempt += 1) await new Promise((r) => setTimeout(r, 25))

  assert.notEqual(asked, null, 'the MOUNTED SERVICE was asked, not the wire fallback')
  const lines = existsSync(tracePath) ? readFileSync(tracePath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []
  const turns = lines.filter((line) => line.event === 'call' && line.hook === 'turn')
  assert.equal(turns.length, 1, 'exactly one turn line, and the trace says: ' + JSON.stringify(lines.map((l) => l.event + '/' + (l.hook ?? '-'))))
  assert.deepEqual(turns[0].questionIds, ['a_noul'])
  assert.equal(turns[0].answers.a_noul.probability, 0.9, 'the service answer flattened and narrowed, not the wire shape')
  // THE ENVELOPE, NESTED THE WAY THE SERVICE NESTS IT -- the fields that were silently absent in production before
  // the envelope fix: answers with no record of which checkpoint judged them, and no cost.
  assert.deepEqual(turns[0].executed, { provider: 'typesafe', revision: 'typesafe/jev-1.13' }, 'which checkpoint judged it')
  assert.deepEqual(turns[0].usage, { inputTokens: 12 }, 'and what it cost')
  assert.equal(turns[0].durationMs, 812.5)
  assert.deepEqual(probeViolations(lines), [], 'no call line pairs the probe with a non-seam hook')
})
