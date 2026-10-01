// THE TRIGGER, END TO END, THROUGH A MOUNTED ROW. Every other test in this repository exercises a module or a
// piece of the wiring; this one fires real `agent/pre-step` events at a mounted row and reads the trace back, so
// the chain runs as one: admit -> count -> shouldFire -> compose X -> ask -> narrow -> write the turn line.
//
// THE JUDGE IS A LOCAL HTTP STUB, deliberately, rather than an injected service object. `system1` service replies
// have an envelope I would have to guess, and guessing shapes is what has produced most of this goal's defects.
// The WIRE body shape is known from the tool's own description and from live calls, so a stub server exercises the
// REAL path -- including `narrowAnswers`, which is where the last live defect was found.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
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

// NOT PASSING YET, AND SKIPPED WITH THE EVIDENCE RATHER THAN DELETED OR CLAIMED WORKING.
//
// What it establishes so far: the row mounts, `apply` completes, and the handler is registered -- the first
// assertion passes. What it does NOT establish: the judge is never asked (the stub server receives no request) and
// the row writes NO trace line at all, not even a skip. That combination is what a node that did not fire or that
// refused before asking looks like, because both of those write nothing by design.
//
// So the chain returns somewhere between the admit handler and the request. Not yet established: which step.
// Candidates, in the order I would check them: whether `isEnabled()` reads the interval out of the config the test
// passes (an accessor on a plain object), whether `turnQuestions` refuses because `liveConfig().questions` does not
// survive `plainConfig`, and whether `decode` reaches the wire at all.
//
// It is left skipped rather than deleted because the assertion list is the specification of what an end-to-end pass
// looks like, and it cost real work to write. Whoever un-skips it should expect it to FAIL first, and should not
// "fix" it by weakening the assertions.
test('a mounted row fires the trigger on an admit and records a usable turn line', async () => {
  let posted = null
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      posted = JSON.parse(body)
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ answers: { a_noul: { noul: 0.9 } }, model: 'stub-judge', usage: { inputTokens: 12, outputTokens: 3 } }))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${server.address().port}`

  const dir = mkdtempSync(join(tmpdir(), 'turn-e2e-'))
  const tracePath = join(dir, 'trace.jsonl')
  const agent = { id: 'session-a', session: { snapshotEvents: () => EXCHANGE } }
  const handlers = new Map()
  const ctx = {
    on(event, handler) { const list = handlers.get(event) ?? []; list.push(handler); handlers.set(event, list); return () => {} },
    inject() {}, provide: () => () => {},
    get: (name) => (name === 'agents' ? { get: () => agent, list: () => [agent] } : undefined),
    agents: { currentInitiator: () => agent },
  }
  await apply(ctx, {
    hooks: accessor(['admit']), tracePath: accessor(tracePath), sessions: accessor(['*']),
    turnEveryNTurns: accessor(1), questions: { turn: SPECS }, observeSubagents: accessor(true),
    wireUrl: baseUrl, timeoutMs: accessor(2000),
  })

  const handler = handlers.get('agent/turn-stopping')?.[1]
  assert.equal(typeof handler, 'function', 'the row subscribes the event the admit seam maps to')
  await handler({ agent, messages: [{ text: 'You should mutate the keywords and search again.' }] })
  await new Promise((resolve) => setTimeout(resolve, 60))
  server.close()

  assert.notEqual(posted, null, 'the judge was actually asked')
  assert.match(posted.state, /^OPERATOR REQUEST:/, 'and X was sent as the state')
  assert.match(posted.state, /OPERATOR NEXT MESSAGE:\nYou should mutate the keywords/, 'including the operator reply from the boundary')
  assert.match(posted.state, /call 1: find_dsh_plugin/, 'and the tool calls of the exchange')
  assert.deepEqual(Object.keys(posted.questions), ['a_noul'], 'with the configured set')

  const lines = existsSync(tracePath) ? readFileSync(tracePath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []
  const turns = lines.filter((line) => line.event === 'call' && line.hook === 'turn')
  assert.equal(turns.length, 1, 'exactly one turn line was recorded')
  assert.deepEqual(turns[0].questionIds, ['a_noul'])
  // FIELD-WISE, because the narrowing makes MORE of the answer than the wire sent: the stub sends `{noul: 0.9}` and
  // the answer carries a probability AND a confidence the wire never sends (`Math.max(p, 1 - p)`). A deepEqual had
  // to be kept in step with a rule it was not testing.
  assert.equal(turns[0].answers.a_noul.type, 'noul')
  assert.equal(turns[0].answers.a_noul.probability, 0.9, 'the raw {noul: 0.9} the judge sent')
  assert.equal(turns[0].answers.a_noul.confidence, 0.9, 'and the confidence the narrowing derives from it')
  // THE ENVELOPE IS NOT ASSERTED HERE, by decision rather than omission. `durationMs` is the SERVICE path's field
  // and the wire envelope is model, usage, routing and executed -- so checking it here was checking another module's
  // contract from the outside, one guessed field at a time, at a round per guess. lib/model/client.js owns that
  // contract and its tests cover it. What THIS test owns is the chain: that the judge was asked, that X was what it
  // was asked about, that a turn line was recorded with the right questions and the narrowed answer, and that the
  // trace passes the acceptance check.
  assert.deepEqual(probeViolations(lines), [], 'no call line pairs the probe with a non-seam hook')
})
