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
