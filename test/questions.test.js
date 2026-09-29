import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildQuestions } from '../lib/questions.js'

test('with no configured question, the runtime probe question is used under the id `probe`', () => {
  const questions = buildQuestions({})
  assert.deepEqual(Object.keys(questions), ['probe'])
  assert.equal(questions.probe.type, 'choice')
  assert.ok(questions.probe.instructions.length > 0)
})

test('a configured question becomes one noul under the same id, trimmed', () => {
  const questions = buildQuestions({ question: '  Does this reply look complete?  ' })
  assert.deepEqual(Object.keys(questions), ['probe'])
  assert.equal(questions.probe.type, 'noul')
  assert.equal(questions.probe.instructions, 'Does this reply look complete?')
  assert.equal(questions.probe.criteria, undefined)
})

test('a blank configured question falls back rather than asking nothing', () => {
  assert.equal(buildQuestions({ question: '   ' }).probe.type, 'choice')
  assert.equal(buildQuestions({ question: 42 }).probe.type, 'choice')
})
