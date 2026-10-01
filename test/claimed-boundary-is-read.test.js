// THE ANNOUNCED BOUNDARY REACHES THE JUDGE, THROUGH A MOUNTED ROW. The composer's own tests prove the composition;
// this proves the WIRING -- that the recorder's hold is read back and passed down. Same shape as the surface's proof:
// the session offers two exchanges, the harness announces the SECOND, and the judge must be asked about that one.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../index.js'

const accessor = (value) => ({ get: () => value })
const user = (seq, text) => ({ seq, time: seq, type: 'user/message', surfaceOp: 'append', data: { role: 'user', content: [{ type: 'text', text }] } })
const assistant = (seq, text) => ({ seq, time: seq, type: 'assistant/message', surfaceOp: 'append', data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text }] }, stream: [] } })
const EVENTS = [user(1, 'THE FIRST REQUEST'), assistant(2, 'the reply to it'), user(3, 'THE SECOND REQUEST'), assistant(4, 'the reply to that')]
const SPECS = [{ id: 'a_noul', type: 'noul', instructions: 'Is this true?' }]

async function run({ announce }) {
  let posted = null
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => { posted = JSON.parse(body); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ answers: { a_noul: { noul: 0.9 } } })) })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const tracePath = join(mkdtempSync(join(tmpdir(), 'claimed-b-')), 'trace.jsonl')
  const agent = { id: 'session-a', session: { snapshotEvents: () => EVENTS } }
  const handlers = new Map()
  const ctx = {
    on(event, handler) { const list = handlers.get(event) ?? []; list.push(handler); handlers.set(event, list); return () => {} },
    inject() {}, provide: () => () => {},
    get: (name) => (name === 'agents' ? { get: () => agent, list: () => [agent] } : undefined),
    agents: { currentInitiator: () => agent },
  }
  await apply(ctx, {
    hooks: accessor([]), tracePath: accessor(tracePath), sessions: accessor(['*']),
    turnEveryNTurns: accessor(1), questions: { turn: SPECS }, observeSubagents: accessor(true),
    wireUrl: `http://127.0.0.1:${server.address().port}`, timeoutMs: accessor(2000),
  })
  if (announce) {
    handlers.get('agent/inbox/claimed')[0]({ agent, message: { text: 'THE SECOND REQUEST', seq: 3 }, turn: 2 })
  }
  await handlers.get('agent/turn-stopping')[1]({ agent, turn: 2 })
  for (let i = 0; i < 240 && posted === null; i += 1) await new Promise((r) => setTimeout(r, 25))
  server.close()
  return posted
}

test('the announced boundary IS read: the judge is asked about the exchange the harness named', async () => {
  const posted = await run({ announce: true })
  assert.notEqual(posted, null, 'the judge was asked')
  assert.match(posted.state, /THE SECOND REQUEST/, 'the announced message is the request')
  assert.match(posted.state, /the reply to that/, 'and the response follows it')
})

test('CONTROL: with nothing announced the inference decides, and it picks the OTHER exchange', async () => {
  const posted = await run({ announce: false })
  assert.notEqual(posted, null, 'the judge was asked either way')
  assert.match(posted.state, /THE FIRST REQUEST/, 'the inference judges the exchange before the newest operator message')
  assert.match(posted.state, /the reply to it/)
})
