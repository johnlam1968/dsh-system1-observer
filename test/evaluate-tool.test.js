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

test('the tool declares its own name and refuses a bad argument against that declaration', async () => {
  const h = harness()
  assert.equal(h.tool.name, EVALUATE_TOOL_NAME)
  assert.throws(() => createEvaluateTool({}), /`settings` must be a function/)
  await assert.rejects(() => h.tool.execute({ lastMessages: 'many' }), /lastMessages/)
})
