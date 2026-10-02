// X ITSELF. The four sections are derived from the admit semantics rather than searched for, so this asserts the
// derivation: the newest operator message is the REACTION, the assistant message before it is the RESPONSE, and
// the operator message before THAT is the REQUEST.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { composeTurnState } from '../lib/turn-state.js'

const env = (seq, type, content) => ({ seq, type, data: { message: { content } } })
const text = (t) => ({ type: 'text', text: t })

const EXCHANGE = [
  env(1, 'user/message', [text('Find dsh plugins related to system1.')]),
  env(2, 'assistant/message', [text('Searching.'), { type: 'tool_use', name: 'find_dsh_plugin', input: { query: 'system1' } }]),
  env(3, 'user/message', [{ type: 'tool_result', tool_use_id: 't1', content: 'no results' }]),
  env(4, 'assistant/message', [text('No plugins were found. Here is how you can search yourself.')]),
  env(5, 'user/message', [text('You should mutate and iterate the keywords and use the tool again.')]),
]

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
  const flat = (seq, text) => ({ seq, type: 'user/message', data: { id: `m${seq}`, role: 'user', content: [text] } })
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
