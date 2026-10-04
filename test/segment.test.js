// SEGMENTING A SESSION THAT DOES NOT FIT ONE REQUEST, and combining the readings in code.
//
// The vendor's published limit is why: 32k tokens of `state` plus the longest question. A 611-message session is about
// twice that, and the request does not fail loudly -- it returns answers nobody can read. So the session is split, and
// every rule in `lib/segment.js` is a way that split could judge something nobody wrote.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aggregateReadings, segmentsOf } from '../lib/segment.js'
import { createEvaluateTool, EVALUATE_TOOL_NAME, REVIEW_HOOK } from '../lib/evaluate-tool.js'
import { composeTurnState } from '../lib/turn-state.js'
import { choice, noul } from '../lib/model/questions.js'
import { checkAgainst } from '../lib/tool-args.js'

const message = (seq, type, text) => ({ seq, time: seq, type, data: { message: { role: type.startsWith('user') ? 'user' : 'assistant', content: [{ type: 'text', text }] } } })
const toolCall = (seq, id, name, args) => ({ seq, time: seq, type: 'tool/call', data: { callId: id, name, arguments: args } })
const toolResult = (seq, id, text) => ({ seq, time: seq, type: 'tool/result', data: { message: { id: 'm' + seq, toolCallId: id, content: [{ type: 'text', text }] } } })

/** Six messages of 100 chars, with a tool pair between the third and fourth. */
const EVENTS = [
  message(1, 'user/message', 'a'.repeat(100)),
  message(2, 'assistant/message', 'b'.repeat(100)),
  message(3, 'user/message', 'c'.repeat(100)),
  toolCall(4, 'k1', 'bash', '{"command":"ls"}'),
  toolResult(5, 'k1', 'r'.repeat(100)),
  message(6, 'assistant/message', 'd'.repeat(100)),
  message(7, 'user/message', 'e'.repeat(100)),
  message(8, 'assistant/message', 'f'.repeat(100)),
]
const MESSAGES = EVENTS.filter((event) => event.type.endsWith('/message'))

test('segments are CONTIGUOUS, message-aligned, and carry the tool record between their messages', () => {
  const parts = segmentsOf(EVENTS, MESSAGES, { maxChars: 250 })
  // 250 chars holds TWO 100-char messages and not three, so six messages make three segments of two.
  assert.equal(parts.length, 3)
  assert.deepEqual(parts.map((p) => [p.from, p.to]), [[0, 2], [2, 4], [4, 6]], 'every message appears once, in order, and none is split')
  assert.deepEqual(parts.flatMap((p) => p.events.filter((e) => MESSAGES.includes(e))).map((e) => e.seq), [1, 2, 3, 6, 7, 8], 'six messages, once each')
  // THE TOOL PAIR TRAVELS WITH THE MESSAGES IT SITS BETWEEN, or a segment cannot answer a question about a lookup --
  // and this is the exact content a stored slice of MESSAGES ALONE used to drop (register row F32).
  const spanning = parts.find((p) => p.from <= 2 && p.to >= 4)
  assert.notEqual(spanning, undefined, 'the second segment spans the tool pair')
  assert.equal(spanning.events.some((event) => event.type === 'tool/call'), true, 'the call travels with it')
  assert.equal(spanning.events.some((event) => event.type === 'tool/result'), true, 'AND the result')
  // AND A SEGMENT THAT DOES NOT SPAN IT DOES NOT CARRY IT, so the window is the segment's own rather than the session's.
  assert.equal(parts[0].events.some((event) => event.type === 'tool/result'), false)
  // A MESSAGE IS NEVER SPLIT, however small the budget: a question's criteria refer to messages, so half of one is
  // something nobody wrote. The oversized one goes alone and the row's `chars` says it is over.
  const tiny = segmentsOf(EVENTS, MESSAGES, { maxChars: 50 })
  assert.equal(tiny.length, MESSAGES.length, 'one message per segment when the budget cannot hold two')
  assert.deepEqual(tiny.map((p) => p.messages), [1, 1, 1, 1, 1, 1])
  const empty = segmentsOf([], [], { maxChars: 250 })
  assert.deepEqual(empty, [], 'nothing to segment is no segments, not one empty one')
})

test('the aggregate is ARITHMETIC over segments, and keeps every reading it averaged', () => {
  const questions = { n: noul('true?'), s: { type: 'score' }, c: choice('which?', [{ label: 'x', criterion: 'x' }, { label: 'none', criterion: 'none', abstain: true }]) }
  const rows = [
    { index: 0, answers: { n: { type: 'noul', probability: 0.9 }, s: { type: 'score', level: 2 }, c: { type: 'choice', label: 'x' } } },
    { index: 1, answers: { n: { type: 'noul', probability: 0.4 }, s: { type: 'score', level: 0 }, c: { type: 'choice', label: 'none' } } },
    { index: 2, answers: { n: { type: 'noul', probability: 0.6 }, s: { type: 'score', level: 1 }, c: { type: 'unreadable', reason: 'no' } } },
    { index: 3, failure: { reason: 'timed out' } },
  ]
  const per = aggregateReadings(rows, questions)
  assert.equal(per.n.n, 3, 'the failed segment is not an answer')
  assert.equal(per.n.failed, 1)
  assert.equal(per.n.median, 0.6, 'the middle of 0.9, 0.4, 0.6')
  assert.equal(per.n.min, 0.4)
  assert.equal(per.n.max, 0.9)
  assert.equal(per.n.aboveHalf, 2 / 3, 'true in two of three segments')
  assert.deepEqual(per.n.readings.map((r) => r.segment), [0, 1, 2], 'and every reading is kept, so the aggregate can be argued with')
  assert.equal(per.s.median, 1)
  assert.equal(per.c.labels[0].label, 'none', 'labels are counted, not averaged')
  assert.deepEqual(per.c.labels.map((l) => l.n), [1, 1])
  assert.equal(per.c.unreadable, 1)
  assert.equal(per.c.agreement, 0.5, 'a tie is a tie, and 0.5 says so')
})

/** The tool, with a `decide` that answers per segment so the aggregate is not a constant. */
function harness() {
  const lines = []
  const tool = createEvaluateTool({
    settings: () => ({ source: 'stored', sessionId: 'S1', kinds: ['operator', 'assistant'], lastMessages: 0 }),
    stored: async () => ({
      events: EVENTS, messages: MESSAGES,
      slice: { matched: MESSAGES.length, total: EVENTS.length, unknownKinds: [], page: { offset: 0, from: 0, to: MESSAGES.length, of: MESSAGES.length } },
      coverage: { events: EVENTS.length, messages: MESSAGES.length, chars: 600, toolEvents: 2 },
      session: { id: 'S1' }, problem: null,
    }),
    liveEvents: async () => EVENTS,
    compose: (events) => composeTurnState({ events, scope: 'session', maxChars: 8000, toolMaxChars: 4000, tailChars: 1000 }),
    questions: () => ({
      questions: {
        flavour: noul('did it go well?'),
        served: choice('how far was it served?', [{ label: 'yes', criterion: 'served' }, { label: 'no', criterion: 'not served' }, { label: 'cannot_tell', criterion: 'unclear', abstain: true }]),
      },
      problems: [],
    }),
    // THE ANSWERS VARY BY SEGMENT, which is the only way an aggregate can be shown to be arithmetic rather than the
    // first reading repeated.
    decide: async (request) => {
      const opening = String(request.state).includes('aaa')
      return { answers: { flavour: { type: 'noul', probability: opening ? 0.9 : 0.2 }, served: { type: 'choice', label: opening ? 'yes' : 'no' } } }
    },
    record: (line) => lines.push(line),
  })
  return { tool, lines }
}

test('a SEGMENTED run reads every part, writes one line per part, and aggregates in code', async () => {
  const h = harness()
  const out = await h.tool.execute({ segmentChars: 250 }, {})

  assert.equal(out.subject.segmented.segments, 3)
  assert.equal(out.subject.segmented.failed, 0)
  assert.equal(out.subject.segmented.budgetChars > 0, true, 'and it says which budget it obeyed')
  assert.equal(out.segments.length, 3)
  assert.equal(out.segments[0].messages, 2)
  assert.equal(typeof out.segments[0].stateHash, 'string')
  assert.deepEqual(out.first, { index: 0, from: 0, to: 2 })
  assert.deepEqual(out.last, { index: 2, from: 4, to: 6 })

  // THE ARITHMETIC, not a second model call: the first segment saw `aaa`, the other two did not.
  assert.equal(out.answers.flavour.n, 3)
  assert.equal(out.answers.flavour.aboveHalf, 1 / 3, 'true in one of three segments')
  assert.deepEqual(out.answers.served.labels.map((l) => [l.label, l.n]), [['no', 2], ['yes', 1]])

  // ONE LINE PER SEGMENT, each carrying WHICH part it was, so a reading is traceable to its place in the session.
  assert.equal(h.lines.length, 3)
  assert.deepEqual(h.lines.map((line) => line.segment.index), [0, 1, 2])
  assert.equal(h.lines.every((line) => line.hook === REVIEW_HOOK), true)
  assert.equal(h.lines[2].segment.of, 3)
  assert.equal(h.lines.every((line) => Array.isArray(line.questionIds)), true)

  // AND THE OUTPUT SATISFIES THE TOOL'S OWN SCHEMA -- the check that would have caught `isRecord` being used without
  // being imported, which no test could see because the branch had never run.
  checkAgainst(h.tool.output.schema, out, EVALUATE_TOOL_NAME)

  const text = h.tool.output.render({}, out)[0].text
  assert.match(text, /SEGMENTED stored subject, 3 segment\(s\) of up to 250 chars/)
  assert.match(text, /flavour \[noul\]: n=3 median=/)
  assert.match(text, /true in 33% of segments/)
  assert.match(text, /served \[choice\]: n=3 modal=no \(67%\) no=2 yes=1/)
  assert.match(text, /not a session-level judgement/)
  assert.match(text, /seg 0: messages 1-2 \(2\)/)
})

test('a segment that FAILS is reported and excluded from every n, never averaged in as a zero', async () => {
  const h = harness()
  let calls = 0
  const failing = createEvaluateTool({
    settings: () => ({ source: 'stored', sessionId: 'S1', kinds: ['operator', 'assistant'], lastMessages: 0 }),
    stored: async () => ({ events: EVENTS, messages: MESSAGES, slice: { matched: 6, total: 8, unknownKinds: [], page: {} }, coverage: { events: 8, messages: 6, chars: 600, toolEvents: 2 }, session: { id: 'S1' }, problem: null }),
    liveEvents: async () => EVENTS,
    compose: (events) => composeTurnState({ events, scope: 'session', maxChars: 8000, toolMaxChars: 4000, tailChars: 1000 }),
    questions: () => ({ questions: { flavour: noul('did it go well?') }, problems: [] }),
    decide: async () => {
      calls += 1
      if (calls === 2) throw new Error('socket closed')
      return { answers: { flavour: { type: 'noul', probability: 0.8 } } }
    },
    record: () => {},
  })
  const out = await failing.execute({ segmentChars: 250 }, {})
  assert.equal(out.subject.segmented.failed, 1, 'the failure is counted')
  assert.equal(out.answers.flavour.n, 2, 'and NOT counted as an answer')
  assert.equal(out.answers.flavour.failed, 1)
  assert.equal(out.segments[1].failure.reason, 'socket closed', 'the row says which segment and why')
  assert.match(failing.output.render({}, out)[0].text, /1 segment\(s\) produced no reading at all/)
  assert.match(failing.output.render({}, out)[0].text, /FAILED: socket closed/)
  // AND WITHOUT `segmentChars` THE SAME TOOL MAKES ONE CALL, so the technique is opt-in.
  h.tool.execute({}, {})
})
