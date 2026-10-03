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

// FOUND AGAINST THE REAL RECORD, not imagined. Successive peer-bridge messages share the header
// `[implementer session, dsh-system1-observer (…) via peer-bridge]`, and counting it as content made four unrelated
// coordination messages read as operator nudges at 60-100% recurrence -- the heuristic measuring the envelope
// instead of the message.
// WHAT COUNTS AS A NUDGE IS THE ROW'S TO SAY, and every one of these settings changes a MEASUREMENT: the derived
// label is the ground truth the whole calibration is checked against.
test('an extra marker labels a nudge the shipped vocabulary would miss', () => {
  // THE FIXTURE IS THE TEST. The two messages share no content word, so `recurrence` cannot carry the label and only
  // the marker can -- my first probe used sentences that recursed, and both runs answered `true`, proving nothing.
  const args = { request: 'summarise the deployment logs', next: 'scrap that and start over' }
  assert.equal(deriveNudgeLabel(args).label, false, 'without the marker this is not a nudge')
  assert.equal(deriveNudgeLabel({ ...args, vocabulary: { markers: ['scrap that'] } }).label, true,
    'and with it, it is')
  assert.equal(deriveNudgeLabel({ ...args, vocabulary: { markers: ['SCRAP THAT'] } }).label, true,
    'matched case-insensitively, like the shipped markers')
  assert.deepEqual(deriveNudgeLabel({ ...args, vocabulary: { markers: ['scrap that'] } }).signals.marker, 'scrap that',
    'and the signal names which marker fired, so the reason is auditable')
})

test('an extra stopword removes a word from the content set, which loosens recurrence', () => {
  assert.deepEqual(contentTokens('quarterly appendix', ['appendix']), ['quarterly'], 'the extra word is dropped')
  assert.deepEqual(contentTokens('quarterly appendix'), ['quarterly', 'appendix'], 'the shipped list still applies')
  // ARITHMETIC THAT CAN BE CHECKED BY EYE: one shared word of three is 1/3, below the 0.5 default; remove two of the
  // three content words and the same pair shares 1/1.
  assert.equal(recurrence('alpha beta gamma', 'alpha delta epsilon'), 1 / 3)
  assert.equal(recurrence('alpha beta gamma', 'alpha delta epsilon', ['beta', 'gamma']), 1)
})

test('the threshold is a setting, and a junk one falls back rather than silencing the signal', () => {
  const args = { request: 'alpha beta gamma', next: 'alpha beta delta' }
  assert.equal(deriveNudgeLabel(args).label, true, 'two of three content words shared is above the shipped 0.5')
  assert.equal(deriveNudgeLabel({ ...args, recurrenceThreshold: 0.99 }).label, false, 'raised, it is not a nudge')
  // A THRESHOLD THAT IS NOT A NUMBER MUST NOT MEAN "NOTHING IS EVER A NUDGE". Every comparison would be false and
  // every turn would be reported clean -- a measurement flattering rather than a measurement failing, which is the
  // one direction this repository refuses.
  for (const junk of ['soon', null, undefined, Number.NaN]) {
    assert.equal(deriveNudgeLabel({ ...args, recurrenceThreshold: junk }).label, true,
      'threshold ' + JSON.stringify(junk) + ' must fall back to 0.5')
  }
})

test('a shared transport header is not recurrence', () => {
  const request = '[implementer session, dsh-system1-observer (session-a) via peer-bridge] Here is the plan for review.'
  const next = '[implementer session, dsh-system1-observer (session-a) via peer-bridge] Please review the acceptance criteria.'
  const out = deriveNudgeLabel({ request, next })
  assert.equal(out.label, false, `header alone must not read as a nudge (recurrence was ${out.signals.recurrence})`)
  assert.equal(contentTokens('[from elsewhere] alpha beta')[0], 'alpha', 'and the header is gone from the tokens')
  assert.deepEqual(contentTokens('[a] [b] real content'), ['real', 'content'], 'including several of them')
})

test('a real nudge with the same header is still a nudge', () => {
  const out = deriveNudgeLabel({
    request: '[peer-bridge] Find the plugins related to system1.',
    next: '[peer-bridge] You should mutate the keywords and search again.',
  })
  assert.equal(out.label, true, 'stripping the header must not stop a marker being seen')
  assert.match(out.reason, /corrects/)
})
