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
import { stateBudgetChars } from '../lib/model/limits.js'
import { checkAgainst } from '../lib/tool-args.js'

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

// F65: AN AGENT ASKED TO MEASURE WITH A PARTICULAR INSTRUMENT MUST BE ABLE TO SAY SO IN THE CALL. On a live session it
// had to discover `system1_settings`, change the row, run, and change it back -- four operations and a side effect on
// somebody else's configuration for what should be a parameter.
test('a question set can be NAMED IN THE CALL, so measuring with a second instrument is not a settings change', async () => {
  const asked = []
  const h = harness({ questions: (given) => { asked.push(given); return { questions: { q: { id: 'q', type: 'noul', instructions: 'x' } }, problems: [] } } })
  await h.tool.execute({ set: 'human-conduct-session@1' }, {})
  assert.deepEqual(asked[0], { set: 'human-conduct-session@1', scope: undefined }, 'the name reaches the resolver')
  await h.tool.execute({ set: 's@1', scope: 'turn' }, {})
  assert.deepEqual(asked[1], { set: 's@1', scope: 'turn' }, 'and so does the scope')
  await h.tool.execute({}, {})
  assert.deepEqual(asked[2], { set: undefined, scope: undefined }, 'WITHOUT IT the row\'s own set applies, unchanged')
  // A REFUSAL FROM THE RESOLVER IS THE ANSWER: a set that declares no session scope must not silently ask nothing.
  const refuses = harness({ questions: () => ({ questions: {}, problems: ['the set "x" declares no "session" scope'] }) })
  await assert.rejects(() => refuses.tool.execute({ set: 'x' }, {}), /declares no "session" scope/)
})

// MEASURED LIVE: `session_claim_unsupported_by_tools: p=0.41 (0.5900000000000001)` -- a probability the judge never
// reported, printed to sixteen digits because a confidence interpolated from a distribution was rendered raw. The
// skeleton rounded and this render did not, which is two consumers of one number and only one of them rounding.
test('a confidence is not printed as a float artefact', async () => {
  const h = harness()
  const out = await h.tool.execute({}, {})
  out.answers.q = { type: 'noul', probability: 0.41, confidence: 0.5900000000000001 }
  const text = h.tool.output.render({}, out)[0].text
  assert.match(text, /\(0\.59\)/, 'rounded: ' + text.split('\n').find((l) => l.includes('q:')))
  assert.doesNotMatch(text, /0\.5900000000000001/)
})

// THE SILENT ONE: without `segmentChars` a whole session was composed down to the row's cap and answered anyway, so a
// report about 8,000 characters read like a session-level judgement. Measured on this repository's own sessions --
// 855,812 characters of conversation composed to 8,000 -- which is why the default now segments itself.
test('a subject over the estimate SEGMENTS ITSELF, and says so', async () => {
  const short = harness()
  const small = await short.tool.execute({}, {})
  assert.equal(Object.hasOwn(small, 'autoSegmented') ? small.autoSegmented : false, false, 'a small subject is one call')
  assert.equal(Object.hasOwn(small, 'subject') && Object.hasOwn(small.subject, 'segmented'), false)

  // A WINDOW OVER THE BUDGET, WITH NO `segmentChars` AT ALL.
  // THE REAL EVENT SHAPE, built with the fixture's own helper -- `textOf` reads `data.message.content`, and a subject
  // the harness did not supply is a subject the tool never sees.
  const longEvents = Array.from({ length: 10 }, (_, k) => EVENTS.map((e, i) => message(k * 10 + i + 1, e.type, 'x'.repeat(5000)))).flat()
  const long = harness({
    stored: async () => ({
      events: longEvents, messages: longEvents, slice: { matched: longEvents.length, total: longEvents.length },
      coverage: { events: longEvents.length, messages: longEvents.length, chars: 200000, toolEvents: 0 },
      session: { id: 'S1' }, problem: null,
    }),
  })
  const out = await long.tool.execute({}, {})
  assert.equal(out.autoSegmented, true, 'it segments itself rather than judging 8,000 of 200,000 characters')
  assert.equal(out.windowChars, 200000, 'and reports the window it measured')
  assert.equal(out.subject.segmented.segments >= 2, true)
  const text = long.tool.output.render({}, out)[0].text
  assert.match(text, /AUTO-SEGMENTED: 200000 characters of conversation is over the \d+-character estimate/)
  assert.match(text, /Pass `segmentChars` to choose the size yourself/)
  // AND AN EXPLICIT `segmentChars` IS NOT "AUTO", so a caller who chose reads no advice about choosing.
  const chosen = await long.tool.execute({ segmentChars: 40000 }, {})
  assert.equal(chosen.autoSegmented, false)
  assert.doesNotMatch(long.tool.output.render({}, chosen)[0].text, /AUTO-SEGMENTED/)
})

// G0 AT THE TOOL: the composed state is the EXCHANGE, and the working record is not in it. This is the assertion that
// matters -- the module can be right while the tool still hands the judge the machinery.
test('groups: [G0] gives the judge the exchange and NOT the working record', async () => {
  const human = (seq, text) => ({ seq, type: 'user/message', data: { content: [{ type: 'text', text }], source: { kind: 'user' } } })
  const said = (seq, turn, text) => ({ seq, type: 'assistant/message', data: { turn, message: { content: [{ type: 'text', text }] } } })
  const events = [
    { seq: 1, type: 'user/message', data: { content: [{ type: 'text', text: 'APPROVAL NOTICE' }], source: { kind: 'user-approval' } } },
    human(2, 'REVIEW MY CITIES'),
    said(3, 36, 'NARRATION BETWEEN TOOL CALLS'),
    { seq: 4, type: 'tool/call', data: { turn: 36, name: 'bash', arguments: '{"command":"ls"}' } },
    { seq: 5, type: 'tool/result', data: { turn: 36, message: { content: [{ type: 'text', text: 'SAVE PARSED OK' }] } } },
    said(6, 36, 'FOUND IT'),
  ]
  const composed = []
  const h = harness({
    compose: (list, maxChars) => { composed.push(list); return composeTurnState({ events: list, scope: 'session', maxChars: maxChars ?? 8000 }) },
    stored: async () => ({ events, messages: events, slice: { matched: events.length, total: events.length }, coverage: { events: events.length, messages: events.length, chars: 100, toolEvents: 2 }, session: { id: 'S1' }, problem: null }),
  })
  const out = await h.tool.execute({ groups: ['G0'] }, {})
  assert.deepEqual(composed[0].map((e) => e.seq), [2, 6], 'the ask and the turn\'s last word, nothing between')
  assert.deepEqual(out.groups, ['G0'])
  assert.deepEqual(out.exchange.turns, [36])
  assert.equal(out.exchange.of, 1)
  assert.equal(out.subject.messages, 2, 'and the count a reader is told is the selection, not the session')
  assert.deepEqual(out.exchange.excluded.map((e) => e.kind), ['user-approval'])
  const text = h.tool.output.render({}, out)[0].text
  assert.match(text, /EVIDENCE: G0 -- 1 of 1 exchange\(s\)/)
  assert.match(text, /EXCLUDED 1 harness `user\/message`\(s\)/)
  // G0 + G1 IS THE WORKING RECORD, so the same call naming both composes every event -- the old behaviour, unchanged.
  const both = await h.tool.execute({ groups: ['G0', 'G1'] }, {})
  assert.equal(both.subject.messages, 6)
  // AND WHAT THIS BUILD CANNOT COMPOSE IS REFUSED.
  await assert.rejects(() => h.tool.execute({ groups: ['G2'] }, {}), /G2 cannot be composed by this build/)
  await assert.rejects(() => h.tool.execute({ groups: ['G0'], turn: 99 }, {}), /has no turn 99/)
})

// THE SINGLE PATH COMPOSES AT THE JUDGE'S BUDGET, not the row's `composeMaxChars` (8,000 by default). Every
// non-segmented measurement was cut to 8,000 characters regardless of what fitted -- so a level chosen BECAUSE it fits
// was still cut, which is the one thing the group selection exists to prevent.
test('a single-call measurement composes at the BUDGET, not at the row\'s legacy cap', async () => {
  const seen = []
  const h = harness({ compose: (events, maxChars) => { seen.push(maxChars); return composeTurnState({ events, scope: 'session', maxChars: maxChars ?? 8000 }) } })
  await h.tool.execute({}, {})
  assert.equal(seen[0], stateBudgetChars, 'the one call gets the budget: ' + seen[0])
  // AND THE SEGMENTED PATH KEEPS THE SAME CEILING, so the two paths cannot disagree about what "whole" means.
  const wide = harness({
    compose: (events, maxChars) => { seen.push(maxChars); return composeTurnState({ events, scope: 'session', maxChars: maxChars ?? 8000 }) },
    stored: async () => ({ events: Array.from({ length: 30 }, (_, k) => EVENTS.map((e, i) => message(k * 10 + i + 1, e.type, 'x'.repeat(5000)))).flat(), messages: null, slice: null, coverage: { events: 0, messages: 300, chars: 1500000, toolEvents: 0 }, session: { id: 'S1' }, problem: null }),
  })
  await wide.tool.execute({}, {})
  assert.equal(seen.slice(1).every((m) => m === stateBudgetChars), true, 'every segment too: ' + JSON.stringify([...new Set(seen.slice(1))]))
})

// A SCORE IS A POSITION ON A SCALE, and a bare `1.85` is not a reading anybody can act on. The tool now carries the
// top level so the render prints `1.85 of 2` -- asked for by the operator after a reading was reported without it.
test('a score renders WITH its scale, and a noul does not pretend to have one', async () => {
  const h = harness({
    questions: () => ({ questions: {
      graded: { id: 'graded', type: 'score', levels: ['no', 'partly', 'yes'], instructions: 'how well?' },
      yesno: { id: 'yesno', type: 'noul', instructions: 'did it?' },
    }, problems: [] }),
    decide: async () => ({ answers: { graded: { type: 'score', level: 1.85, confidence: 0.77 }, yesno: { type: 'noul', probability: 0.83, confidence: 0.83 } } }),
  })
  const out = await h.tool.execute({}, {})
  assert.deepEqual(out.scales, { graded: 2 }, 'the top level, from the levels the question declared')
  const text = h.tool.output.render({}, out)[0].text
  assert.match(text, /graded: 1\.85 of 2 \(0\.77\)/)
  assert.match(text, /yesno: p=0\.83 \(0\.83\)/, 'and a noul is not given a scale it does not have')
  // AND A SET WITH NO SCORE CARRIES NO `scales` AT ALL, rather than an empty object every reader must test.
  const plain = harness()
  assert.equal(Object.hasOwn(await plain.tool.execute({}, {}), 'scales'), false)
})

// THE OUTPUT MUST SATISFY THE TOOL'S OWN SCHEMA, and the session-scope path did not: `turn: null` was emitted where
// the schema declares a number. It went unnoticed because every call this feature had been given until then NAMED a
// turn, so the null branch had never run. The register's rule is to OMIT an absent field, and this test holds the
// whole family to it -- no turn, one turn, several turns, groups absent or present.
test('every selection shape satisfies the output schema, including the ones with no turn', async () => {
  const human = (seq, text) => ({ seq, type: 'user/message', data: { content: [{ type: 'text', text }], source: { kind: 'user' } } })
  const said = (seq, turn, text) => ({ seq, type: 'assistant/message', data: { turn, message: { content: [{ type: 'text', text }] } } })
  const events = [human(1, 'ask 36'), said(2, 36, 'answer 36'), human(3, 'ask 37'), said(4, 37, 'answer 37')]
  const h = harness({ stored: async () => ({ events, messages: events, slice: { matched: 4, total: 4 }, coverage: { events: 4, messages: 4, chars: 60, toolEvents: 0 }, session: { id: 'S1' }, problem: null }) })
  const shapes = [{ groups: ['G0'] }, { groups: ['G0'], turn: 37 }, { groups: ['G0'], turns: [36, 37] }, { groups: ['G0', 'G1'], turn: 37 }, {}]
  for (const args of shapes) {
    const out = await h.tool.execute(args, {})
    checkAgainst(h.tool.output.schema, out, 'system1_evaluate_session')   // THROWS on a violation
    assert.equal(out.turn === null, false, 'a null turn is what broke it: ' + JSON.stringify(args))
    assert.equal(Object.hasOwn(out, 'turn'), args.turn !== undefined, 'present exactly when named: ' + JSON.stringify(args))
    assert.equal(Object.hasOwn(out, 'turns'), Array.isArray(args.turns), 'and the list likewise: ' + JSON.stringify(args))
  }
})

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
  // `offset` RIDES BESIDE `lastMessages` ALWAYS, even at 0: the two are one paging decision, and an absent one
  // invites "was it ignored?" -- the same reason `lastMessages: 0` is written rather than omitted.
  // `groups` and `turn` ride beside the paging decision for the same reason: a reading that does not name the evidence
  // it was given cannot be told from one given different evidence (see `docs/measurement-depth.md`).
  assert.deepEqual(out.subject, { source: 'stored', sessionId: 'S1', kinds: ['operator', 'assistant'], lastMessages: 0, offset: 0, groups: null, turn: null, messages: 4, total: 4 })
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
  assert.deepEqual(h.calls[0], { sessionId: 'session-other', kinds: ['assistant', 'operator'], lastMessages: 5, offset: 0 })
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
  assert.deepEqual(meta.subject, { source: 'stored', sessionId: 'S1', kinds: ['operator'], lastMessages: 0, messages: 4, total: 4 }, 'the projection ECHOES the subject it is handed, it does not invent fields')
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

test('the record says how much of the TOOL record the judge was actually shown', async () => {
  // THE SECOND CAP, and it is not `composeMaxChars`. Measured live: a 4,000-char `toolBlockMaxChars` held the FIRST 3
  // of 529 calls and their results, so the tool record reached the judge and the LATER calls -- the ones a question
  // about a failed lookup asks about -- did not. The agent's render and the trace line both say so now.
  const window = [message(1, 'user/message', 'go'), message(2, 'assistant/message', 'ok')]
  for (let i = 1; i <= 40; i += 1) {
    window.push({ seq: i * 10, type: 'tool/call', data: { callId: 'c' + i, name: 'bash', arguments: '{"command":"echo ' + 'x'.repeat(200) + '"}' } })
    window.push({ seq: i * 10 + 1, type: 'tool/result', data: { message: { id: 'm' + i, toolCallId: 'c' + i, content: [{ type: 'text', text: 'y'.repeat(200) }] } } })
  }
  const h = harness({
    stored: async () => ({
      events: window, messages: window.filter((event) => event.type.endsWith('/message')),
      slice: { matched: 2, total: window.length },
      coverage: { events: window.length, messages: 2, chars: 10, toolEvents: 80 },
      session: { id: 'S1' }, problem: null,
    }),
    compose: (events) => composeTurnState({ events, scope: 'session', maxChars: 8000, toolMaxChars: 400 }),
  })
  const out = await h.tool.execute({}, {})
  assert.equal(out.subject.toolCalls.calls, 40, 'every call was collected')
  assert.equal(out.subject.toolCalls.results, 40)
  assert.equal(out.subject.toolCalls.truncated, true, 'and the section was cut')
  assert.ok(out.subject.toolCalls.shown.calls > 0 && out.subject.toolCalls.shown.calls < 40, 'so the record says how many were SHOWN, not how many exist')
  const text = h.tool.output.render({}, out)[0].text
  assert.match(text, /TOOL CALLS shown to the judge: \d+ of 40 call\(s\) and \d+ of 40 result\(s\) -- CUT at `toolBlockMaxChars`/, 'the agent is told in words: ' + text.split('\n')[1])
  assert.match(text, /both ends are kept, so the newest calls survive/, 'and WHICH ENDS survived, because that is what decides whether a question about a late lookup can be answered')
  // AND A SUBJECT WITH NO TOOL CALLS CARRIES NO ZERO OBJECT, so every tool-less turn does not grow a field saying nothing.
  assert.equal((await harness().tool.execute({}, {})).subject.toolCalls, undefined)
})

test('the tool declares its own name and refuses a bad argument against that declaration', async () => {
  const h = harness()
  assert.equal(h.tool.name, EVALUATE_TOOL_NAME)
  assert.throws(() => createEvaluateTool({}), /`settings` must be a function/)
  await assert.rejects(() => h.tool.execute({ lastMessages: 'many' }), /lastMessages/)
})

test('`package: true` writes a package in the SAME call, and says where', async () => {
  // THE WHOLE MECHANICAL WORKFLOW IN ONE CALL. The interpretation is deliberately NOT written here -- prose cannot be
  // derived from numbers -- so this is evaluate+package, and the agent attaches its reading afterwards.
  let asked = 0
  const h = harness({ packageRun: async () => { asked += 1; return { dir: 'data/measurements/ID', files: ['manifest.json', 'report.md', 'readings.json', 'trace.jsonl', 'manifest.sha256'], bytes: 1234 } } })
  const out = await h.tool.execute({ package: true }, {})
  assert.equal(asked, 1, 'the writer ran once')
  assert.equal(out.package.dir, 'data/measurements/ID')
  const text = h.tool.output.render({}, out)[0].text
  assert.match(text, /PACKAGE written to data\/measurements\/ID \(manifest\.json, report\.md/)
  assert.match(text, /attach a reading with system1_measurements \{ action: 'interpret' \}/, 'and it names the next step')
  // WITHOUT THE FLAG, NOTHING IS WRITTEN AND NOTHING IS CLAIMED.
  const plain = harness({ packageRun: async () => { asked += 1; return {} } })
  const bare = await plain.tool.execute({}, {})
  assert.equal(Object.hasOwn(bare, 'package'), false)
  assert.equal(asked, 1, 'the writer was not even called')
  // A WRITER THAT THROWS IS A NAMED PROBLEM, not a lost reading: the evaluation already happened and is still returned.
  const broken = harness({ packageRun: async () => { throw new Error('disk full') } })
  const failed = await broken.tool.execute({ package: true }, {})
  assert.match(failed.package.problem, /packaging failed: disk full/)
  assert.equal(failed.subject.messages, 4, 'and the reading survives the packaging failure')
  assert.match(broken.tool.output.render({}, failed)[0].text, /PACKAGE NOT written: packaging failed/)
  // AND A ROW WITH NO WRITER SAYS SO rather than promising a package it cannot produce.
  const h2 = harness()
  assert.match((await h2.tool.execute({ package: true }, {})).package.problem, /no package writer is wired/)
  // A SEGMENTED RUN PACKAGES TOO, which is the workflow that matters for a large session.
  const big = harness({ packageRun: async () => ({ dir: 'D', files: ['manifest.json'] }) })
  // 20 characters, because THIS fixture's messages are about thirty each -- 250 would hold all four in one segment,
  // and a one-segment "segmented" run proves nothing about the path.
  const wide = await big.tool.execute({ segmentChars: 20, package: true }, {})
  assert.equal(wide.package.dir, 'D', 'the segmented path finishes through the same place')
  assert.equal(wide.subject.segmented.segments >= 2, true, 'and it really was split: ' + wide.subject.segmented.segments)
})
