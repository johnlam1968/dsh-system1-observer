// SYSTEM1_EVALUATE: judging a whole conversation, and the rule that keeps it out of the calibration.
//
// The collaborators are injected, so these tests need no harness: a stub subject, a stub model, a recording stub. The
// assertion that matters most is the last one -- the call line this tool writes contributes NO probe rows, which is
// the requirement §11 states and the thing register row O17 is the cautionary tale about (a measurement recorded and
// silently never read is the failure mode; a measurement recorded and deliberately not scored is a decision).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EVALUATE_TOOL_NAME, REVIEW_HOOK, createEvaluateTool } from '../lib/evaluate-tool.js'
import { composeTurnState } from '../lib/turn-state.js'
import { probeFingerprint, probeScore } from '../lib/probe-score.js'
import { PROBE_QUESTION } from '../lib/seams.js'
import { noul } from '../lib/model/questions.js'

const message = (seq, type, text) => ({
  seq,
  time: seq,
  type,
  data: { message: { role: type.startsWith('user') ? 'user' : 'assistant', content: [{ type: 'text', text }] } },
})
const EVENTS = [
  message(1, 'user/message', 'please summarise the deployment logs'),
  message(2, 'assistant/message', 'here is the summary'),
  message(3, 'user/message', 'now shorten it'),
  message(4, 'assistant/message', 'shorter'),
]

const harness = (overrides = {}) => {
  const lines = []
  const calls = []
  const tool = createEvaluateTool({
    settings: () => ({ source: 'stored', sessionId: 'S1', kinds: ['operator', 'assistant'], lastMessages: 0 }),
    stored: async (options) => {
      calls.push(options)
      return { events: EVENTS, slice: { matched: EVENTS.length, total: EVENTS.length }, session: { id: options.sessionId }, problem: null }
    },
    liveEvents: async () => EVENTS,
    compose: (events) => composeTurnState({ events, scope: 'session' }),
    questions: () => ({ questions: { review: noul('did this conversation go well?') }, problems: [] }),
    decide: async () => ({
      answers: { review: { label: 'yes', confidence: 0.8 } },
      envelope: { executed: { provider: 'typesafe', model: 'jev-latest' }, durationMs: 12 },
    }),
    record: (line) => lines.push(line),
    ...overrides,
  })
  return { tool, lines, calls }
}

test('it judges a stored session and reports WHAT it judged, with the input\u2019s identity', async () => {
  const h = harness()
  const out = await h.tool.execute({})
  assert.deepEqual(out.answers, { review: { label: 'yes', confidence: 0.8 } })
  assert.deepEqual(out.subject, { source: 'stored', sessionId: 'S1', kinds: ['operator', 'assistant'], lastMessages: 0, messages: 4, total: 4 })
  assert.equal(typeof out.stateHash, 'string')
  assert.equal(out.stateHash.length, 12, 'a short hash, so two evaluations of the same input are recognisable as one')
  assert.equal(out.truncated, false)
  assert.equal(out.executed.model, 'jev-latest', 'the provenance travels, read from the envelope')
  assert.equal(out.durationMs, 12)
})

test('the recorded line names the tool, the subject and the hash -- and its hook is NOT a probe site', async () => {
  const h = harness()
  await h.tool.execute({})
  assert.equal(h.lines.length, 1, 'exactly one line per evaluation')
  const line = h.lines[0]
  assert.equal(line.event, 'call')
  assert.equal(line.hook, REVIEW_HOOK)
  assert.equal(line.tool, 'system1-observer')
  assert.equal(line.subject.source, 'stored')
  assert.equal(line.stateHash.length, 12, 'the identity of what was actually sent')
  assert.deepEqual(line.questionIds, ['review'])
})

test('A STORED EVALUATION CONTRIBUTES NO PROBE ROWS, even carrying the probe question by identity', async () => {
  // The requirement in as many words. The subject is the real probe question, asked at a hook that is not a probe
  // site -- and the score is byte-identical with and without the line. Register row O17 is the opposite case: a
  // measurement the scorer silently never reads.
  const h = harness({ questions: () => ({ questions: { probe: PROBE_QUESTION }, problems: [] }) })
  await h.tool.execute({})
  const line = h.lines[0]
  const mount = { event: 'mount', run: 'R1', probeHash: probeFingerprint() }
  const withLine = JSON.stringify(probeScore([mount, { ...line, run: 'R1' }]))
  const withoutLine = JSON.stringify(probeScore([mount]))
  assert.equal(withLine, withoutLine, 'a whole-session judgement is not this row\u2019s probe measurement')
})

test('an argument overrides the row for one call, and an override means STORED even when the row is live', async () => {
  const h = harness({ settings: () => ({ source: 'live', sessionId: '', kinds: ['operator'], lastMessages: 0 }) })
  const out = await h.tool.execute({ sessionId: 'session-other', kinds: ['assistant', 'operator'], lastMessages: 5 })
  assert.equal(out.subject.source, 'stored', 'asking about a named session cannot mean the live one')
  assert.equal(out.subject.sessionId, 'session-other')
  assert.deepEqual(h.calls[0], { sessionId: 'session-other', kinds: ['assistant', 'operator'], lastMessages: 5 })
  // AND THE LIVE SUBJECT IS STILL THE DEFAULT WHEN NOTHING IS CONFIGURED OR OVERRIDDEN.
  const live = harness({ settings: () => ({ source: 'live', sessionId: '', kinds: ['operator', 'assistant'], lastMessages: 0 }) })
  const liveOut = await live.tool.execute({})
  assert.equal(liveOut.subject.source, 'live')
  assert.equal(liveOut.subject.sessionId, '')
})

test('a subject that cannot be read is refused BY NAME, and nothing is sent to a model', async () => {
  let decided = 0
  const h = harness({
    stored: async () => ({ events: [], slice: { matched: 0, total: 0 }, session: null, problem: 'reading session S9 failed: no session with that id' }),
    decide: async () => { decided += 1; return { answers: {} } },
  })
  await assert.rejects(() => h.tool.execute({}), /reading session S9 failed/)
  // AN EMPTY SUBJECT IS ITS OWN REFUSAL, and neither case pays for a judgement.
  const empty = harness({ stored: async () => ({ events: [], slice: { matched: 0, total: 0 }, session: { id: 'S1' }, problem: null }) })
  await assert.rejects(() => empty.tool.execute({}), /no messages, so there is no conversation to judge/)
  assert.equal(decided, 0, 'a refusal before the call is a call not paid for')
})

test('a model failure is REPORTED, not thrown: the subject was read and the call may have been paid for', async () => {
  const h = harness({ decide: async () => ({ kind: 'error', reason: 'the request timed out after 8000 ms' }) })
  const out = await h.tool.execute({})
  assert.equal(out.failure.reason, 'the request timed out after 8000 ms')
  assert.equal(out.subject.source, 'stored', 'what was judged is still reported')
  assert.equal(h.lines.length, 1, 'and the attempt is on the trace')
  // A THROWN transport failure is turned into the same shape, because a tool that throws loses the subject with it.
  const thrown = harness({ decide: async () => { throw new Error('socket closed') } })
  assert.equal((await thrown.tool.execute({})).failure.reason, 'socket closed')
})

test('it declares PRESENTATIONMETA, which is how the conversation card gets structured data', () => {
  // `lib/tool.js:91` says it: the projection "leaves through `presentationMeta`, which the tool contract persists on
  // `tool/result` as `meta`". The card reads that, so it never re-parses the model-facing text.
  const h = harness()
  assert.equal(typeof h.tool.output.presentationMeta, 'function')
  const meta = h.tool.output.presentationMeta({}, {
    answers: { review: { label: 'yes' } },
    subject: { source: 'stored', sessionId: 'S1', kinds: ['operator'], lastMessages: 0, messages: 4, total: 4 },
    stateHash: 'abcdef123456', stateChars: 120, truncated: true,
    executed: { model: 'jev-latest' },
  })
  assert.deepEqual(meta.subject, { source: 'stored', sessionId: 'S1', kinds: ['operator'], lastMessages: 0, messages: 4, total: 4 })
  assert.equal(meta.stateHash, 'abcdef123456')
  assert.equal(meta.truncated, true)
  assert.deepEqual(meta.answers, { review: { label: 'yes' } })
  assert.deepEqual(meta.executed, { model: 'jev-latest' })
  // A FAILURE RIDES IT TOO, and a value missing a field does not throw: the card is given what exists.
  assert.equal(h.tool.output.presentationMeta({}, { failure: { reason: 'timed out' } }).failure.reason, 'timed out')
  const sparse = h.tool.output.presentationMeta({}, undefined)
  assert.equal(sparse.stateHash, '')
  assert.equal(sparse.stateChars, 0)
  assert.equal(sparse.truncated, false)
})

test('it declares a RENDER, which the registry requires and whose absence was register row O19', () => {
  // The registry refuses a tool declaring `output { schema }` alone: "must declare output { schema, render,
  // presentationMeta? }". A refusal in one registration takes the whole `ctx.inject(['tools'], ...)` callback down, so
  // the symptom was a MISSING tool with no error -- which is why the fix carries a test rather than only a comment.
  const h = harness()
  assert.equal(typeof h.tool.output.render, 'function')
  // THE ARGUMENT ORDER IS THE HOST'S, AND THIS TEST USED TO GET IT WRONG IN THE SAME DIRECTION AS THE TOOL.
  // `dsh-tools/lib/index.js:3548` invokes `tool.output.render(exec.arguments, value)`. The tool declared
  // `render: (value)` and every assertion here called `render(value)`, so both agreed on the wrong convention and a
  // live call rendered `? subject, 0 of 0 message(s)` for a trace line that said `messages: 611`. The assertions
  // below now pass BOTH arguments, which is what the host does.
  assert.ok(h.tool.output.render.length >= 2, 'render declares (args, value), the order the host calls it in')
  const args = { sessionId: 'S1' }
  const text = h.tool.output.render(args, {
    answers: { review: { label: 'yes', confidence: 0.8 } },
    subject: { source: 'stored', sessionId: 'S1', kinds: [], lastMessages: 0, messages: 4, total: 4 },
    stateHash: 'abcdef123456', stateChars: 120, truncated: false,
  })
  assert.equal(Array.isArray(text), true)
  assert.match(text[0].text, /stored subject, 4 of 4 message/)
  assert.match(text[0].text, /review: yes \(0.8\)/)
  // AND A NOUL, the shape this plugin asks in most: a probability, not a label. Reading `noul` -- the key the READER
  // consumes -- renders "(no label)" here, which is the bug the end-to-end run found (register row O20).
  const noul = h.tool.output.render(args, {
    answers: { review: { type: 'noul', probability: 0.8 }, reading: { type: 'unreadable', reason: 'no answer' } },
    subject: { source: 'stored', messages: 1, total: 1 }, stateHash: 'h', stateChars: 1, truncated: false,
  })
  assert.match(noul[0].text, /review: p=0\.8/)
  assert.match(noul[0].text, /reading: unreadable \[unreadable: no answer\]/, 'an unreadable answer says so')
  assert.match(text[0].text, /abcdef123456/, 'the identity of what was sent is in the rendered line')
  // AND A FAILURE RENDERS AS A FAILURE rather than as an empty answer set.
  const failed = h.tool.output.render(args, { answers: {}, subject: { source: 'stored', messages: 0, total: 0 }, stateHash: 'x', stateChars: 0, truncated: false, failure: { reason: 'timed out' } })
  assert.match(failed[0].text, /could not answer: timed out/)
})

test('the tool declares its own name and refuses a bad argument against that declaration', async () => {
  const h = harness()
  assert.equal(h.tool.name, EVALUATE_TOOL_NAME)
  assert.throws(() => createEvaluateTool({}), /`settings` must be a function/)
  await assert.rejects(() => h.tool.execute({ lastMessages: 'many' }), /lastMessages/)
})
