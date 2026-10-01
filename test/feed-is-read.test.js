// IS THE FEED ACTUALLY READ? The wiring was landed with the guarantee that an EMPTY feed is the previous
// behaviour, which a green suite proves and which says nothing about a POPULATED one. This test makes the
// difference observable: the session's own events say one thing, the harness's feed says another, and the judge is
// asked about the FEED. If `readEvents` stopped consulting it, the first test fails.
//
// The second test is the control. Without it, the first could pass because the strings collided, because the stub
// echoed something, or because the feed was never needed -- so the same assertion is made with NO feed events, and
// there the SESSION's text must appear instead.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../index.js'
import { createEventFeed } from '../lib/host/feed.js'

const accessor = (value) => ({ get: () => value })
const env = (seq, type, text) => ({ seq, time: seq, type, surfaceOp: 'append', data: { message: { role: type === 'user/message' ? 'user' : 'assistant', content: [{ type: 'text', text }] } } })
const SPECS = [{ id: 'a_noul', type: 'noul', instructions: 'Is this true?' }]

async function run({ feedEvents }) {
  let posted = null
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => { posted = JSON.parse(body); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ answers: { a_noul: { noul: 0.9 } } })) })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const tracePath = join(mkdtempSync(join(tmpdir(), 'feed-read-')), 'trace.jsonl')
  const agent = { id: 'session-a', session: { snapshotEvents: () => [env(1, 'user/message', 'THE SESSION REQUEST'), env(2, 'assistant/message', 'THE SESSION ANSWER')] } }
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
    wireUrl: `http://127.0.0.1:${server.address().port}`, timeoutMs: accessor(2000),
  })
  for (const event of feedEvents) handlers.get('session/event')[0]({ id: 'session-a' }, event)
  await handlers.get('agent/pre-step')[0]({ agent, messages: [{ text: 'the reaction' }] }, () => Promise.resolve())
  for (let i = 0; i < 60 && posted === null; i += 1) await new Promise((r) => setTimeout(r, 25))
  server.close()
  return posted
}

test('the judge is asked about the FEED, not about the session it could have asked', async () => {
  const posted = await run({ feedEvents: [env(1, 'user/message', 'THE FEED REQUEST'), env(2, 'assistant/message', 'THE FEED ANSWER')] })
  assert.notEqual(posted, null, 'the judge was asked')
  assert.match(posted.state, /THE FEED REQUEST/, 'the request came from the harness feed')
  assert.match(posted.state, /THE FEED ANSWER/, 'and so did the answer')
  assert.doesNotMatch(posted.state, /THE SESSION/, 'and NOT from the live session, which says something else')
})

test('CONTROL: with no feed events, the session is used -- so the test above is not passing by accident', async () => {
  const posted = await run({ feedEvents: [] })
  assert.notEqual(posted, null, 'the judge was asked')
  assert.match(posted.state, /THE SESSION REQUEST/, 'the fallback path reached the session')
  assert.match(posted.state, /THE SESSION ANSWER/)
  assert.doesNotMatch(posted.state, /THE FEED/, 'and no feed text can appear when none was recorded')
})

test('the feed holder is per session, so another session cannot supply this one', async () => {
  const feed = createEventFeed()
  feed.record('session-a', env(1, 'user/message', 'A'))
  feed.record('session-b', env(1, 'user/message', 'B'))
  assert.deepEqual(feed.events('session-a').map((e) => e.data.message.content[0].text), ['A'])
  assert.deepEqual(feed.events('session-b').map((e) => e.data.message.content[0].text), ['B'])
})

// THE COMPARISON LINE IS ASSERTED, not assumed -- and this test EARNED ITS KEEP: the first version of the detector
// compared seq and type only, so it reported agreement for a feed and a session carrying different text, which is
// the exact regression it exists to catch. The criterion that matters is the TEXT the judge reads.
test('a disagreement between the feed and the session is recorded once, and readably', async () => {
  const { existsSync, readFileSync } = await import('node:fs')
  const dir = mkdtempSync(join(tmpdir(), 'feed-compare-'))
  const tracePath = join(dir, 'trace.jsonl')
  const agent = { id: 'session-a', session: { snapshotEvents: () => [env(1, 'user/message', 'THE SESSION REQUEST'), env(2, 'assistant/message', 'THE SESSION ANSWER')] } }
  const handlers = new Map()
  const ctx = {
    on(event, handler) { const list = handlers.get(event) ?? []; list.push(handler); handlers.set(event, list); return () => {} },
    inject() {}, provide: () => () => {},
    get: (name) => (name === 'agents' ? { get: () => agent, list: () => [agent] } : undefined),
    agents: { currentInitiator: () => agent },
  }
  let posted = null
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => { posted = JSON.parse(body); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ answers: { a_noul: { noul: 0.9 } } })) })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  await apply(ctx, {
    hooks: accessor(['admit']), tracePath: accessor(tracePath), sessions: accessor(['*']),
    turnEveryNTurns: accessor(1), questions: { turn: SPECS }, observeSubagents: accessor(true),
    wireUrl: `http://127.0.0.1:${server.address().port}`, timeoutMs: accessor(2000),
  })
  handlers.get('session/event')[0]({ id: 'session-a' }, env(1, 'user/message', 'THE FEED REQUEST'))
  handlers.get('session/event')[0]({ id: 'session-a' }, env(2, 'assistant/message', 'THE FEED ANSWER'))
  await handlers.get('agent/pre-step')[0]({ agent, messages: [{ text: 'the reaction' }] }, () => Promise.resolve())
  for (let i = 0; i < 60 && posted === null; i += 1) await new Promise((r) => setTimeout(r, 25))
  server.close()
  const compares = (existsSync(tracePath) ? readFileSync(tracePath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []).filter((l) => l.event === 'feed-compare')
  assert.equal(compares.length, 1, 'exactly one comparison, per judged turn')
  assert.equal(compares[0].agree, false, 'and it says they DISAGREE -- same seqs and types, DIFFERENT TEXT, which is the case that matters')
  assert.equal(compares[0].feedEvents, 2)
  assert.equal(compares[0].sessionEvents, 2)
  assert.deepEqual(compares[0].feedSeqs, [1, 2], 'with the seqs of both, so a divergence can be read rather than noticed')
})
