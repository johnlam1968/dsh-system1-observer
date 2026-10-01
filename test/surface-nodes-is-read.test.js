// IS Session.surface.nodes ACTUALLY USED? The composer's parameter has its own tests; the WIRING had only the fact
// that nothing changes when the surface is absent -- which proves the fallback, not the feature. Same shape as the
// feed's proof: the session says one thing by its event log and another by its surface, and the judge is asked about
// the SURFACE. If the row stopped reading it, the first test would refuse the turn instead of judging it.
//
// BOTH DIRECTIONS, because either alone proves nothing: with surface.nodes the turn composes and a message the fold
// would have dropped reaches the judge; without it the fold decides, the turn REFUSES, and no judge is asked.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../index.js'

const accessor = (value) => ({ get: () => value })
const msg = (seq, type, text) => ({ seq, time: seq, type, surfaceOp: 'append', data: { message: { role: type === 'user/message' ? 'user' : 'assistant', content: [{ type: 'text', text }] } } })
// A replace carried by a TOOL RESULT: it drops seq 2 and puts nothing of that role back, which is the case where
// "newest of a role" and "surviving in the surface" disagree.
const replaced = (seq, text) => ({ seq, time: seq, type: 'tool/result', surfaceOp: { op: 'replace', startSeq: 2, endSeq: 2 }, data: { message: { role: 'tool', toolCallId: 't1', content: [{ type: 'text', text }] } } })
const EVENTS = [
  msg(1, 'user/message', 'the operator request'),
  msg(2, 'assistant/message', 'THE ANSWER THE FOLD WOULD DROP'),
  replaced(3, 'a tool result that replaced it'),
  msg(4, 'user/message', 'the operator reaction'),
]
const SPECS = [{ id: 'a_noul', type: 'noul', instructions: 'Is this true?' }]

async function run({ surface }) {
  let posted = null
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => { posted = JSON.parse(body); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ answers: { a_noul: { noul: 0.9 } } })) })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const tracePath = join(mkdtempSync(join(tmpdir(), 'surface-nodes-')), 'trace.jsonl')
  const session = { snapshotEvents: () => EVENTS, ...(surface === undefined ? {} : { surface }) }
  const agent = { id: 'session-a', session }
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
  await handlers.get('agent/turn-stopping')[1]({ agent, turn: 5, messages: [{ text: 'the reaction' }] })
  for (let i = 0; i < 240 && posted === null; i += 1) await new Promise((r) => setTimeout(r, 25))
  server.close()
  return posted
}

test("the host's surface IS read: a message the fold would drop reaches the judge", async () => {
  const posted = await run({ surface: { nodes: [1, 2, 4], replaceGeneration: 1, contentGeneration: 1 } })
  assert.notEqual(posted, null, 'the judge was asked, because the host says seq 2 belongs to the surface')
  assert.match(posted.state, /THE ANSWER THE FOLD WOULD DROP/, 'and the state carries the message the fold would have removed')
  assert.match(posted.state, /the operator request/, 'with the request')

  // THE SUPPLIED REACTION WINS, which is the composer's documented rule: "Supplied text wins over what the events
  // say, because the payload is the boundary itself." So the section carries the boundary's text, not seq 4's -- and
  // my first version of this assertion expected the event's, which the printed state corrected in one run.
  assert.match(posted.state, /OPERATOR NEXT MESSAGE:\nthe reaction/, 'the reaction section carries the SUPPLIED text')
  assert.doesNotMatch(posted.state, /the operator reaction/, 'and not the event it would otherwise have picked')
})

test('CONTROL: with no host surface the fold decides, the turn refuses, and NO judge is asked', async () => {
  const posted = await run({ surface: undefined })
  assert.equal(posted, null, 'the fold removed the only response, so there was nothing to judge and nothing was sent')
})
