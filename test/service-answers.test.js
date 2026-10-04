// THE SERVICE'S ANSWER SHAPE, ADAPTED AT THE BOUNDARY -- and the one case that used to be erased.
//
// `lib/model/service.js` says it: the service answers `{answers: {id: {status, answer}}}`, the wire answers the flat
// shape, and `narrowAnswers` reads the flat one. Three renames and one reshape happen here so the module every gate's
// correctness rests on stays monomorphic.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { serviceAnswers } from '../lib/model/service-answers.js'
import { narrowAnswers } from '../lib/model/narrow.js'
import { noul, score } from '../lib/model/questions.js'

const QUESTIONS = { q: noul('is it?'), s: score('how much?', ['low', 'high']) }

test('the three shapes the service returns are flattened into the wire\u2019s', () => {
  const flat = serviceAnswers({
    answers: {
      q: { status: 'ok', answer: { type: 'noul', probabilityTrue: 0.8, confidence: 0.8 } },
      s: { status: 'ok', answer: { type: 'score', value: 1, levels: ['low', 'high'], probabilities: [0, 1] } },
    },
  })
  assert.equal(flat.answers.q.noul, 0.8)
  assert.equal(flat.answers.s.score, 1)
  assert.deepEqual(flat.answers.s.probabilities, { low: 0, high: 1 })
})

test('AN ANSWER THE PROVIDER REFUSED NAMES THE STATUS, instead of blaming the question\u2019s shape', () => {
  // THIS IS REGISTER ROW F43. A non-`ok` status used to be flattened into an EMPTY RECORD, deliberately, so that
  // `narrowAnswers` would give "its precise reason" -- and the reason it gave was "the answer for q is not a noul
  // probability", which says the answer was the wrong SHAPE. Measured on a 291,137-character state, over jev-1.13's
  // documented 64k-token request limit: every answer came back that way and the reply carried no `executed`
  // provenance, so the one signal that the whole REQUEST had been refused was the one nothing rendered.
  const flat = serviceAnswers({ answers: { q: { status: 'error', error: 'context length exceeded' } } })
  const narrowed = narrowAnswers(flat, QUESTIONS)
  assert.equal(narrowed.answers.q.type, 'unreadable')
  assert.match(narrowed.answers.q.reason, /the provider reported status "error" for this answer: context length exceeded/,
    'the cause is named: ' + narrowed.answers.q.reason)
  assert.doesNotMatch(narrowed.answers.q.reason, /is not a noul probability/, 'and the question is not blamed for it')
  // A STATUS WITH NO DETAIL STILL NAMES THE STATUS, because that is already more than the shape reason said.
  const bare = narrowAnswers(serviceAnswers({ answers: { q: { status: 'error' } } }), QUESTIONS)
  assert.match(bare.answers.q.reason, /status "error"/)
  // AND A QUESTION THE REPLY OMITS ENTIRELY KEEPS ITS OWN REASON, which was always right.
  const missing = narrowAnswers(serviceAnswers({ answers: {} }), QUESTIONS)
  assert.match(missing.answers.q.reason, /the response carried no answer for q/)
})
