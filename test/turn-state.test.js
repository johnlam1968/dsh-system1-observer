// X ITSELF. The four sections are derived from the admit semantics rather than searched for, so this asserts the
// derivation: the newest operator message is the REACTION, the assistant message before it is the RESPONSE, and
// the operator message before THAT is the REQUEST.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { composeTurnState } from '../dsh/turn-state.js'

// A `user/message` CARRIES ITS SOURCE KIND, and that is what says who wrote it. The harness speaks on the user
// channel too -- a goal, a skill catalogue -- and only `data.source.kind` separates those from a person typing.
// Measured on this host: 180 of 1,501 `user/message` events in real sessions were the harness, not the human. A
// fixture that omits the kind is not a human message, and the composer now reads it as one.
const HUMAN = { kind: 'user' }
const env = (seq, type, content) => ({ seq, type, data: { message: { content }, ...(type === 'user/message' ? { source: HUMAN } : {}) } })
const text = (t) => ({ type: 'text', text: t })

const EXCHANGE = [
  env(1, 'user/message', [text('Find dsh plugins related to system1.')]),
  env(2, 'assistant/message', [text('Searching.'), { type: 'tool_use', name: 'find_dsh_plugin', input: { query: 'system1' } }]),
  env(3, 'user/message', [{ type: 'tool_result', tool_use_id: 't1', content: 'no results' }]),
  env(4, 'assistant/message', [text('No plugins were found. Here is how you can search yourself.')]),
  env(5, 'user/message', [text('You should mutate and iterate the keywords and use the tool again.')]),
]

// THE SCOPE: a stored session has no reaction, so it is composed as a TRANSCRIPT rather than an exchange.
const scoped = (seq, type, text) => ({ seq, time: seq, type, data: type.startsWith('user')
      ? { content: [{ type: 'text', text }], ...(type.startsWith('user') ? { source: HUMAN } : {}) }
      : { message: { role: 'assistant', content: [{ type: 'text', text }] } } })
const SESSION_FIXTURE = [
  scoped(1, 'user/message', 'please summarise the deployment logs'),
  scoped(2, 'assistant/message', 'here is the summary'),
  scoped(3, 'user/message', 'now shorten it'),
  scoped(4, 'assistant/message', 'shorter'),
]

test('scope: the default is the EXCHANGE, so the live path is opt-out rather than changed', () => {
  const out = composeTurnState({ events: SESSION_FIXTURE })
  assert.deepEqual(Object.keys(out.sections), ['OPERATOR REQUEST', 'AGENT RESPONSE', 'TOOL CALLS', 'OPERATOR NEXT MESSAGE'])
  assert.equal(out.sections['OPERATOR NEXT MESSAGE'], 'now shorten it', 'the newest operator message is the reaction')
  assert.doesNotMatch(out.state, /shorter/, 'and the turn after it is outside the exchange -- unchanged behaviour')
})

test('THE HARNESS IS NOT THE OPERATOR -- an injection is not a turn boundary and is not labelled OPERATOR', () => {
  // THE HARNESS SPEAKS ON THE USER CHANNEL. A goal, a skill catalogue, a runtime context: the event type is identical
  // to a person's prompt and only `data.source.kind` separates them. Measured on one real session of 39,098 events:
  // 753 `user/message` events of which **403 were the human and 350 were the harness** -- a `goal` 233 times over.
  // So the operator message the exchange is built around could be a skill catalogue, and the transcript labelled it
  // `OPERATOR`, which is the substitution `dsh/exchange.js` warns about in its own header.
  const injected = (seq, body, kind) => ({ seq, type: 'user/message', data: { message: { content: [text(body)] }, source: { kind } } })
  const events = [
    env(1, 'user/message', [text('the real question')]),
    injected(2, 'GOAL: finish the migration', 'goal'),
    env(3, 'assistant/message', [text('the answer')]),
    injected(4, 'SKILL CATALOGUE: 42 skills', 'skill-catalog'),
    env(5, 'user/message', [text('thanks, that works')]),
  ]

  // THE EXCHANGE: the OPERATOR REQUEST is the human's message, not the goal that arrived after it.
  const exchange = composeTurnState({ events })
  assert.equal(exchange.refused, false, String(exchange.reason))
  assert.equal(exchange.sections['OPERATOR REQUEST'], 'the real question', 'the goal is not the operator request')
  assert.equal(exchange.sections['AGENT RESPONSE'], 'the answer')

  // THE TRANSCRIPT: the injection is KEPT -- the text was on the surface and the agent read it -- but it is labelled
  // for what it is. The question sets name `OPERATOR` and `AGENT`, and neither is renamed here.
  const session = composeTurnState({ events, scope: 'session' })
  assert.match(session.sections['SESSION TRANSCRIPT'], /OPERATOR: the real question/)
  assert.match(session.sections['SESSION TRANSCRIPT'], /HARNESS: GOAL: finish the migration/)
  assert.match(session.sections['SESSION TRANSCRIPT'], /HARNESS: SKILL CATALOGUE: 42 skills/)
  assert.doesNotMatch(session.sections['SESSION TRANSCRIPT'], /OPERATOR: GOAL/, 'a goal is never the operator speaking')
  assert.doesNotMatch(session.sections['SESSION TRANSCRIPT'], /AGENT: GOAL/, 'and it is not the agent speaking either')
})

test('scope: a SESSION is a transcript with labels of its own, and it includes the newest turn', () => {
  // The labels are a contract rather than decoration: a question's criteria name them, which is why a stored
  // judgement needs its own questions rather than the seam's.
  const out = composeTurnState({ events: SESSION_FIXTURE, scope: 'session' })
  assert.deepEqual(Object.keys(out.sections), ['SESSION TRANSCRIPT', 'TOOL CALLS'])
  assert.equal(out.refused, false)
  assert.match(out.sections['SESSION TRANSCRIPT'], /OPERATOR: please summarise the deployment logs/)
  assert.match(out.sections['SESSION TRANSCRIPT'], /AGENT: here is the summary/)
  assert.match(out.sections['SESSION TRANSCRIPT'], /AGENT: shorter/, 'the newest turn is IN it, which is the point')
  const order = ['please summarise', 'here is the summary', 'now shorten it', 'shorter'].map((part) => out.state.indexOf(part))
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'and the messages are in conversation order')
  assert.deepEqual(order.every((at) => at !== -1), true, 'all four are present')
})

test('scope: a session cut keeps BOTH ends, because the newest turns are what a transcript is for', () => {
  const long = [
    scoped(1, 'user/message', 'A'.repeat(400)),
    scoped(2, 'assistant/message', 'MIDDLE-MARKER'),
    scoped(3, 'user/message', 'Z'.repeat(400)),
  ]
  const out = composeTurnState({ events: long, scope: 'session', maxChars: 300, tailChars: 100 })
  assert.equal(out.truncated, true)
  assert.equal(out.state.length, 300, 'the budget is exact')
  assert.match(out.state, /SESSION TRANSCRIPT/, 'the head keeps the labels')
  assert.match(out.state, /Z{10}/, 'and the tail keeps the newest turn')
  assert.doesNotMatch(out.state, /MIDDLE-MARKER/, 'the middle is what gives way')
})

test('scope: an empty session refuses in its own words, not the exchange\u2019s', () => {
  const out = composeTurnState({ events: [], scope: 'session' })
  assert.equal(out.refused, true)
  assert.match(out.reason, /no conversation to judge/)
  const exchange = composeTurnState({ events: [] })
  assert.match(exchange.reason, /no operator message in the window/, 'and the exchange keeps its own refusal')
})

test('the exchange is reconstructed from the event order, with the reaction in the target', () => {
  const out = composeTurnState({ events: EXCHANGE })
  assert.equal(out.refused, false)
  assert.equal(out.sections['OPERATOR REQUEST'], 'Find dsh plugins related to system1.')
  assert.match(out.sections['AGENT RESPONSE'], /Here is how you can search yourself/)
  assert.equal(out.sections['OPERATOR NEXT MESSAGE'], 'You should mutate and iterate the keywords and use the tool again.')
  // The reaction is what makes "did this help?" answerable at all: a target holding only the request cannot say.
  assert.match(out.state, /^OPERATOR REQUEST:/)
  assert.match(out.state, /OPERATOR NEXT MESSAGE:\nYou should mutate/)
})

test('the tool calls of THIS exchange reach the target, with their results', () => {
  const out = composeTurnState({ events: EXCHANGE })
  assert.match(out.sections['TOOL CALLS'], /find_dsh_plugin\(\{"query":"system1"\}\)/)
  assert.match(out.sections['TOOL CALLS'], /-> no results/)
  assert.deepEqual(out.unclassified, {})
})

test('an exchange with no tool calls says (none) rather than leaving the section empty', () => {
  const out = composeTurnState({ events: [env(1, 'user/message', [text('hi')]), env(2, 'assistant/message', [text('hello')]), env(3, 'user/message', [text('thanks')])] })
  assert.equal(out.sections['TOOL CALLS'], '')
  assert.match(out.state, /TOOL CALLS:\n\(none\)/, 'an empty section is indistinguishable from an absent one once it reaches the model')
})

test('no agent response REFUSES rather than judging three empty sections', () => {
  const out = composeTurnState({ events: [env(1, 'user/message', [text('hi')])] })
  assert.equal(out.refused, true)
  assert.match(out.reason, /no agent response in the window/)
  assert.equal(out.state, undefined)
})

test('no operator message REFUSES too', () => {
  const out = composeTurnState({ events: [env(1, 'assistant/message', [text('hello')])] })
  assert.equal(out.refused, true)
  assert.match(out.reason, /no operator message in the window/)
})

test('a request outside the window is said to be outside it, not invented', () => {
  const out = composeTurnState({ events: [env(1, 'assistant/message', [text('a reply')]), env(2, 'user/message', [text('a reaction')])] })
  assert.equal(out.refused, false)
  assert.equal(out.sections['OPERATOR REQUEST'], '(not in the window)')
})

test('the target is capped, and says that it was', () => {
  const out = composeTurnState({ events: EXCHANGE, maxChars: 40 })
  assert.equal(out.truncated, true)
  assert.equal(out.state.length, 40)
})

test('junk events are not evidence and do not throw', () => {
  const out = composeTurnState({ events: [null, 7, 'x', { type: 'other' }, env(1, 'user/message', 'not an array')] })
  assert.equal(out.refused, true)
  assert.equal(composeTurnState().refused, true)
})

// THE RISK THIS CLOSES, found by looking for raw session events and finding none: if the session store types the
// operator's message as anything other than `user/message`, the composition refuses EVERY turn -- silently and
// forever, because a refusal is not an error. `agent/pre-step`'s payload declares `messages: UserMessage[]`, so the
// boundary carries the message whether or not the event stream names it that way.
test('the operator message can come from the CALLER, when the events do not carry it', () => {
  const events = [
    env(1, 'assistant/message', [text('Nothing found; here is how to search.')]),
    env(2, 'user/message', [{ type: 'tool_result', tool_use_id: 't1', content: 'no results' }]),
  ]
  const refused = composeTurnState({ events })
  assert.equal(refused.refused, true, 'without help, the tool delivery leaves no boundary to read')
  const out = composeTurnState({ events, nextMessage: 'You should mutate the keywords and try again.' })
  assert.equal(out.refused, false)
  assert.equal(out.sections['OPERATOR NEXT MESSAGE'], 'You should mutate the keywords and try again.')
  assert.match(out.sections['AGENT RESPONSE'], /here is how to search/)
})

test('a supplied message is taken as text or as a message-like object', () => {
  const events = [env(1, 'assistant/message', [text('a reply')])]
  for (const supplied of ['plain text', { text: 'from a text field' }, { content: [text('from content blocks')] }]) {
    const out = composeTurnState({ events, nextMessage: supplied })
    assert.equal(out.sections['OPERATOR NEXT MESSAGE'], typeof supplied === 'string' ? supplied : supplied.text ?? 'from content blocks')
  }
  assert.equal(composeTurnState({ events, nextMessage: { nope: 1 } }).refused, true, 'an unusable object is no boundary')
})

// A REQUEST WITH NO SEQ. `windowStart` used to fall back to `?? 0`, which anchored the window at the beginning of
// the LOG -- so the TOOL CALLS section quoted every earlier tool call in the session as though it belonged to this
// exchange. Nothing caught it because every fixture drives numeric seqs; an independent review found it by reading
// the line, and the guard this file already used for seq (`typeof … === 'number'`) is what the refusal uses too.
test('an operator request with no seq REFUSES rather than anchoring the window at the start of the log', () => {
  const events = [
    env(null, 'user/message', [text('the request, in a shape that carries no seq')]),
    env(2, 'assistant/message', [text('a reply')]),
    env(3, 'user/message', [text('a reaction')]),
  ]
  const out = composeTurnState({ events })
  assert.equal(out.refused, true)
  assert.match(out.reason, /carries no seq/)
  assert.equal(out.state, undefined, 'a refusal carries no state to judge')
})

// THE FLAT SHAPE: `data` IS THE MESSAGE. `SessionEventMap` declares `'user/message': UserMessage` -- while
// `assistant/message` declares `data.message` -- and the composer reads `data.message?.content ?? data.content` to
// cover both. Every fixture in this file used the NESTED shape, so the flat one, which is the shape the declaration
// names for the operator's own channel, was never driven. An audit found the same asymmetry in the wire envelope:
// two readings of one thing, one of them only ever exercised by accident.
test('an operator message in the FLAT shape is read like the nested one', () => {
  const flat = (seq, body) => ({ seq, type: 'user/message', data: { id: `m${seq}`, role: 'user', content: [body], source: HUMAN } })
  const out = composeTurnState({
    events: [
      flat(1, text('the flat request')),
      env(2, 'assistant/message', [text('a reply')]),
      flat(3, text('the flat reaction')),
    ],
  })
  assert.equal(out.refused, false, 'a shape the event declaration names cannot be a refusal')
  assert.equal(out.sections['OPERATOR REQUEST'], 'the flat request')
  assert.equal(out.sections['AGENT RESPONSE'], 'a reply')
  assert.equal(out.sections['OPERATOR NEXT MESSAGE'], 'the flat reaction')
})

test('a tool result on the user channel is NOT read as the operator reaction', () => {
  // The harness delivers a tool's result as a `user/message`, so "the newest user message" is the tool result half
  // the time. An operator message is one that carries TEXT; a delivery carrying a result is not a turn boundary.
  const flatResult = (seq) => ({ seq, type: 'user/message', data: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'no results' }] } })
  const out = composeTurnState({
    events: [env(1, 'user/message', [text('a request')]), env(2, 'assistant/message', [text('a reply')]), flatResult(3)],
  })
  // With no text-bearing user message after the reply there is no reaction, and it says so rather than reading the
  // tool result as one -- the live failure that moved this search onto text in the first place.
  assert.equal(out.refused, true)
  assert.match(out.reason, /no agent response in the window/)
})
