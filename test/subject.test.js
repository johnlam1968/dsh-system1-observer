import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeSubject, subjectOfAgent, subjectOfRequest } from '../lib/subject.js'

// THE FACT THE MEASUREMENT WAS MISSING. `provider`/`model` on a trace line are the observer's own config and
// `executed` is the judge -- neither says which model WROTE the excerpt. The same question scores differently
// on different models' output, so without this an accuracy figure is not comparable across sessions.

test('the subject comes from the LLM request at the draft seam, where it is the request as actually sent', () => {
  assert.deepEqual(
    subjectOfRequest({ provider: 'openrouter', model: 'mistralai/ministral-3b-2512', temperature: 0.2, reasoningEffort: 'high' }),
    { provider: 'openrouter', model: 'mistralai/ministral-3b-2512', reasoningEffort: 'high', temperature: 0.2 },
  )
})

test('the subject falls back to the agent route at the seams whose payload carries no request', () => {
  assert.deepEqual(
    subjectOfAgent({ id: 'session-a', options: { provider: 'openrouter', model: 'x/y', maxTokens: 4096 } }),
    { provider: 'openrouter', model: 'x/y', maxTokens: 4096 },
  )
})

// PROPERTY CHECKS ONLY: this crosses a runtime boundary, so a field that is missing or the wrong type must
// produce an ABSENT field rather than a wrong one -- a trace that says the wrong model is worse than one that
// says nothing.
test('nothing recognisable yields nothing, never a guess', () => {
  for (const junk of [undefined, null, 42, 'openrouter', [], true]) {
    assert.equal(subjectOfRequest(junk), undefined)
    assert.equal(subjectOfAgent(junk), undefined)
  }
  assert.equal(subjectOfRequest({}), undefined, 'an empty request has no subject')
  assert.equal(subjectOfAgent({ id: 'a' }), undefined, 'an agent with no options has no subject')
  assert.equal(subjectOfAgent({ options: {} }), undefined)
  assert.equal(subjectOfAgent({ options: { provider: '', model: '   ' } }), undefined, 'blank is not an answer')
  assert.equal(subjectOfAgent({ options: { model: 7 } }), undefined, 'and neither is a non-string')
})

test('an agent may name only one half of the route, and that half is still worth recording', () => {
  assert.deepEqual(subjectOfAgent({ options: { model: 'x/y' } }), { model: 'x/y' })
  assert.deepEqual(subjectOfAgent({ options: { provider: 'openrouter' } }), { provider: 'openrouter' })
})

test('a subject reads as provider/model, and as (unknown) when it cannot', () => {
  assert.equal(describeSubject({ provider: 'openrouter', model: 'x/y' }), 'openrouter/x/y')
  assert.equal(describeSubject({ model: 'x/y' }), 'x/y', 'a bare model is not padded with a question mark')
  assert.equal(describeSubject({ provider: 'openrouter' }), '(unknown)', 'a provider alone names no model')
  assert.equal(describeSubject(undefined), '(unknown)')
})
