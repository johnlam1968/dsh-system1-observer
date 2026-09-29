import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createObserver } from '../lib/observe.js'

function recorder() {
  const lines = []
  return { lines, trace: (event, fields) => lines.push({ event, ...(typeof fields === 'function' ? fields() : fields) }) }
}

const config = { transport: 'service', provider: 'typesafe', model: 'jev-latest', maxFieldChars: 1000 }

test('a successful call is traced with both halves of the exchange', async () => {
  const { lines, trace } = recorder()
  const answer = { kind: 'answers', answers: { probe: { type: 'choice', label: 'model_output', confidence: 0.9 } } }
  const observer = createObserver({ decide: async () => answer, trace, readConfig: () => config })
  await observer.observe('draft', 'hello', { agentId: 'a1', turn: 1, step: 2, purpose: null })
  assert.equal(lines.length, 1)
  assert.equal(lines[0].event, 'call')
  assert.equal(lines[0].hook, 'draft')
  assert.equal(lines[0].hostEvent, 'llm/stream')
  assert.deepEqual(lines[0].state, { hook: 'draft', text: 'hello' })
  assert.equal(lines[0].questions.probe.type, 'choice')
  assert.deepEqual(lines[0].answer, answer)
  assert.equal(lines[0].transport, 'service')
  assert.equal(lines[0].provider, 'typesafe')
  assert.equal(lines[0].agentId, 'a1')
  assert.equal(lines[0].truncated, false)
  assert.equal(typeof lines[0].ms, 'number')
})

test('a failing decide is traced as an error, never thrown, and never reaches the loop', async () => {
  const { lines, trace } = recorder()
  const observer = createObserver({ decide: async () => { throw new Error('boom') }, trace, readConfig: () => config })
  await observer.observe('pre_execute', 'bash {"command":"ls"}', { agentId: 'a1' })
  assert.equal(lines.length, 1)
  assert.equal(lines[0].event, 'error')
  assert.match(lines[0].error, /boom/)
  assert.equal(lines[0].hook, 'pre_execute')
})

test('a result that is not answers is recorded as a call with that result, not as a failure', async () => {
  const { lines, trace } = recorder()
  const observer = createObserver({ decide: async () => ({ kind: 'error', reason: 'the request timed out' }), trace, readConfig: () => config })
  await observer.observe('draft', 'hi', {})
  assert.equal(lines[0].event, 'call')
  assert.equal(lines[0].answer.kind, 'error')
})

test('a state longer than maxFieldChars is truncated and marked', async () => {
  const { lines, trace } = recorder()
  const observer = createObserver({ decide: async () => ({ kind: 'answers', answers: {} }), trace, readConfig: () => ({ ...config, maxFieldChars: 10 }) })
  await observer.observe('draft', 'x'.repeat(50), {})
  assert.equal(lines[0].state.text.length, 10)
  assert.equal(lines[0].truncated, true)
})

test('a throwing trace cannot fail the turn', async () => {
  const observer = createObserver({
    decide: async () => ({ kind: 'answers', answers: {} }),
    trace: () => { throw new Error('the disk is gone') },
    readConfig: () => config,
  })
  await assert.doesNotReject(() => observer.observe('draft', 'hi', {}))
})
