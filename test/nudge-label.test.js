// THE INDEPENDENT LABEL. Its value is that it needs no model, so it can say whether the model was right. The
// property most worth asserting is the THIRD VALUE: no next message is not "no nudge".
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveNudgeLabel, contentTokens, recurrence } from '../lib/nudge-label.js'

test('THE ABSENCE CASE: no next message is null, never false', () => {
  for (const next of [undefined, null, '', '   ']) {
    const out = deriveNudgeLabel({ request: 'Find dsh plugins.', next })
    assert.equal(out.label, null, `next=${JSON.stringify(next)}`)
    assert.match(out.reason, /no evidence either way/)
  }
  // The distinction that matters: `false` would read as "the operator did not have to nudge", which is the
  // flattering reading of an absent fact.
  assert.notEqual(deriveNudgeLabel({ request: 'x', next: '' }).label, false)
})

// THE OBSERVED CASE: the "test session", where the operator's reply was the nudge.
test('the observed nudge is labelled, by marker and not by guesswork', () => {
  const out = deriveNudgeLabel({
    request: 'Find dsh plugins related to "system1", "decision model", "jev".',
    next: 'You should mutate and iterate the keywords and/or combination and use the dsh-find-plugin tool again.',
  })
  assert.equal(out.label, true)
  assert.match(out.reason, /corrects/)
  assert.equal(out.signals.marker, 'you should')
})

test('a request coming back in different words is a nudge even with no marker', () => {
  const out = deriveNudgeLabel({
    request: 'Please check the payments migration schema for missing indexes.',
    next: 'Could you look at the schema changes in the payments migration and find indexes that are missing?',
  })
  assert.equal(out.label, true)
  assert.match(out.reason, /different words/)
  assert.equal(out.signals.marker, null)
})

test('moving on is NOT a nudge, and it is labelled rather than left unknown', () => {
  const out = deriveNudgeLabel({ request: 'Find dsh plugins related to system1.', next: 'Thanks, that is useful.' })
  assert.equal(out.label, false)
  assert.match(out.reason, /does not repeat or correct/)
})

test('an unrelated question is not a nudge either', () => {
  const out = deriveNudgeLabel({ request: 'How is the weather today?', next: 'What tools do you have?' })
  assert.equal(out.label, false)
})

test('tokens drop stopwords and punctuation, and recurrence counts content', () => {
  assert.deepEqual(contentTokens('The quick, brown FOX!'), ['quick', 'brown', 'fox'])
  assert.deepEqual(contentTokens('a of to the'), [])
  assert.deepEqual(contentTokens(undefined), [])
  assert.equal(recurrence('alpha beta gamma', 'alpha beta gamma'), 1)
  assert.equal(recurrence('alpha beta', 'delta epsilon'), 0)
  assert.equal(recurrence('', 'anything'), 0, 'no content on one side is no recurrence, not a division by zero')
})
