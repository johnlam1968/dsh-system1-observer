// THE SUBJECT'S COST, which the plugin has never recorded: it records the JUDGE's usage on every call line and knew
// nothing about what the observed agent spent. `tokenMeter.measure(session)` answers that, is O(surface), and is
// synchronous -- so WHERE it is called matters, and is recorded here: on the detached path, after the judgement,
// never inside the serial `turn-stopping` listener the harness awaits. A static check cannot establish that; the
// placement is a decision, and the assertion below is about the number and its provenance.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../index.js'

const accessor = (value) => ({ get: () => value })
const env = (seq, type, text) => ({ seq, time: seq, type, surfaceOp: 'append', data: { message: { role: type === 'user/message' ? 'user' : 'assistant', content: [{ type: 'text', text }] } } })

test('the subject cost is recorded once per measurement, from the harness meter', async () => {
  let posted = null
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => { posted = JSON.parse(body); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ answers: { a_noul: { noul: 0.9 } } })) })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const tracePath = join(mkdtempSync(join(tmpdir(), 'subject-cost-')), 'trace.jsonl')
  const session = { snapshotEvents: () => [env(1, 'user/message', 'a request'), env(2, 'assistant/message', 'an answer')] }
  const agent = { id: 'session-a', session }
  const measured = []
  const meter = { measure: (s) => { measured.push(s); return { totalTokens: 1234, surfaceTokens: 1200, baseline: { kind: 'usage', tokens: 1200 } } } }
  const handlers = new Map()
  const ctx = {
    on(event, handler) { const list = handlers.get(event) ?? []; list.push(handler); handlers.set(event, list); return () => {} },
    inject() {}, provide: () => () => {},
    get: (name) => (name === 'agents' ? { get: () => agent, list: () => [agent] } : name === 'tokenMeter' ? meter : undefined),
    agents: { currentInitiator: () => agent },
  }
  await apply(ctx, {
    hooks: accessor(['admit']), tracePath: accessor(tracePath), sessions: accessor(['*']),
    turnEveryNTurns: accessor(1), questions: { turn: [{ id: 'a_noul', type: 'noul', instructions: 'x?' }] }, observeSubagents: accessor(true),
    wireUrl: `http://127.0.0.1:${server.address().port}`, timeoutMs: accessor(2000),
  })
  await handlers.get('agent/pre-step')[0]({ agent, messages: [{ text: 'the reaction' }] }, () => Promise.resolve())
  for (let i = 0; i < 240 && posted === null; i += 1) await new Promise((r) => setTimeout(r, 25))
  for (let i = 0; i < 240; i += 1) {
    const seen = existsSync(tracePath) ? readFileSync(tracePath, 'utf8') : ''
    if (seen.includes('subject-cost')) break
    await new Promise((r) => setTimeout(r, 25))
  }
  server.close()
  const lines = existsSync(tracePath) ? readFileSync(tracePath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []
  const cost = lines.filter((l) => l.event === 'subject-cost')
  assert.equal(cost.length, 1, 'one cost line per measurement')
  assert.equal(cost[0].agentId, 'session-a')
  assert.equal(cost[0].totalTokens, 1234, 'the number the harness meter returned')
  assert.equal(cost[0].surfaceTokens, 1200)
  assert.equal(cost[0].baseline, 'usage', 'and WHICH KIND of number it is -- usage, estimated or none')
  assert.equal(measured.length, 1, 'and the meter was asked once, with the SUBJECT session')
  assert.equal(measured[0], session, 'the session object the row already holds')
})

// THE DISK TRUTH. `workspaceChanges.summary` is event-addressed -- the seq of a `workspace/changes` event -- and
// synchronous, so it goes on the same detached path as the meter. The FEED supplies the address, which is why this
// test records the event through `session/event` before the turn: without the feed the plugin would have no seq to
// ask about, and the line would silently never appear.
test('the workspace change is recorded, addressed by the seq the feed carried', async () => {
  let posted = null
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => { posted = JSON.parse(body); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ answers: { a_noul: { noul: 0.9 } } })) })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const tracePath = join(mkdtempSync(join(tmpdir(), 'workspace-change-')), 'trace.jsonl')
  const session = { snapshotEvents: () => [env(1, 'user/message', 'a request'), env(2, 'assistant/message', 'an answer')] }
  const agent = { id: 'session-a', session }
  const asked = []
  const workspaceChanges = {
    summary: (sessionId, seq) => {
      asked.push({ sessionId, seq })
      return { turn: 3, cwd: '/w', total: 2, added: 40, deleted: 5, files: [{ path: '/w/a.md', display: 'a.md', added: 30, deleted: 5 }, { path: '/w/b.md', display: 'b.md', added: 10, deleted: 0 }] }
    },
  }
  const handlers = new Map()
  const ctx = {
    on(event, handler) { const list = handlers.get(event) ?? []; list.push(handler); handlers.set(event, list); return () => {} },
    inject() {}, provide: () => () => {},
    get: (name) => (name === 'agents' ? { get: () => agent, list: () => [agent] } : name === 'workspaceChanges' ? workspaceChanges : undefined),
    agents: { currentInitiator: () => agent },
  }
  await apply(ctx, {
    hooks: accessor(['admit']), tracePath: accessor(tracePath), sessions: accessor(['*']),
    turnEveryNTurns: accessor(1), questions: { turn: [{ id: 'a_noul', type: 'noul', instructions: 'x?' }] }, observeSubagents: accessor(true),
    wireUrl: `http://127.0.0.1:${server.address().port}`, timeoutMs: accessor(2000),
  })
  handlers.get('session/event')[0]({ id: 'session-a' }, { seq: 7, time: 7, type: 'workspace/changes', data: { turn: 3 } })
  await handlers.get('agent/pre-step')[0]({ agent, messages: [{ text: 'the reaction' }] }, () => Promise.resolve())
  for (let i = 0; i < 240; i += 1) {
    const seen = existsSync(tracePath) ? readFileSync(tracePath, 'utf8') : ''
    if (seen.includes('workspace-change')) break
    await new Promise((r) => setTimeout(r, 25))
  }
  server.close()
  const lines = existsSync(tracePath) ? readFileSync(tracePath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []
  const change = lines.filter((l) => l.event === 'workspace-change')
  assert.equal(change.length, 1, 'one workspace record per measurement')
  assert.equal(change[0].seq, 7, 'addressed by the seq the FEED carried -- without the feed there is no address')
  assert.equal(change[0].total, 2, 'the number of files changed')
  assert.equal(change[0].added, 40)
  assert.equal(change[0].deleted, 5)
  assert.deepEqual(change[0].files, ['a.md', 'b.md'], 'and WHICH files, by display name')
  assert.deepEqual(asked, [{ sessionId: 'session-a', seq: 7 }], 'asked once, with the session and the event seq')
})
