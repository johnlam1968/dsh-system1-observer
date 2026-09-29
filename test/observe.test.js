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

// WHY THESE THREE EXIST: `requested`/`executed` are bound TOP-LEVEL by spec §8, but the runtime's
// ModelResult has no such fields -- they live inside `envelope` (`model/client.ts`, `model/service.ts`).
// The first version read `result?.requested`/`result?.executed`, so every live `call` line carried
// `"requested":null,"executed":null` beside a populated envelope, and no test mentioned either field.
test('a call records requested and executed from the result envelope at the top level', async () => {
  const { lines, trace } = recorder()
  const envelope = {
    requested: { provider: 'typesafe', model: 'jev-latest' },
    executed: { provider: 'typesafe', model: 'typesafe/jev-1.13-20260917' },
  }
  const observer = createObserver({
    decide: async () => ({ kind: 'answers', answers: {}, envelope }),
    trace,
    readConfig: () => config,
  })
  await observer.observe('draft', 'hi', { agentId: 'a1' })
  assert.equal(lines[0].event, 'call')
  assert.deepEqual(lines[0].requested, envelope.requested)
  assert.deepEqual(lines[0].executed, envelope.executed)
})

test('a wire-shaped result projects requested as null and executed from the envelope', async () => {
  const { lines, trace } = recorder()
  // The wire client's ENVELOPE list carries `executed` but not `requested` (`model/client.ts`), so this
  // is the shape the fallback transport really produces: one present, one absent, and the absent one null.
  const envelope = { executed: { provider: 'laya', model: 'auto' }, model: 'auto' }
  const observer = createObserver({
    decide: async () => ({ kind: 'answers', answers: {}, worstCase: 0, envelope, rawAnswers: {} }),
    trace,
    readConfig: () => config,
  })
  await observer.observe('draft', 'hi', { agentId: 'a1' })
  assert.equal(lines[0].requested, null)
  assert.deepEqual(lines[0].executed, envelope.executed)
})

test('a top-level requested/executed is not projected: the envelope is the only source', async () => {
  const { lines, trace } = recorder()
  // A FALLBACK TO THE TOP-LEVEL FIELD IS WHAT CAUSED THE BUG in the first place: a second projection that
  // looks correct while the field it reads is never populated.
  const observer = createObserver({
    decide: async () => ({ kind: 'answers', answers: {}, requested: { provider: 't' }, executed: { provider: 't' } }),
    trace,
    readConfig: () => config,
  })
  await observer.observe('draft', 'hi', { agentId: 'a1' })
  assert.equal(lines[0].requested, null)
  assert.equal(lines[0].executed, null)
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

test('a seam with no text is recorded as a skip and never reaches the model', async () => {
  const { lines, trace } = recorder()
  let called = 0
  const observer = createObserver({
    decide: async () => { called += 1; return { kind: 'answers', answers: {} } },
    trace,
    readConfig: () => config,
  })
  await observer.observe('close', '', { agentId: 'a1' })
  await observer.observe('request', '   ', { agentId: 'a1' })
  assert.equal(called, 0)
  assert.equal(lines.length, 2)
  assert.equal(lines[0].event, 'skip')
  assert.equal(lines[0].hook, 'close')
  assert.equal(lines[0].reason, 'no text at this seam')
  assert.equal(lines[1].event, 'skip')
})

test('a throwing trace cannot fail the turn', async () => {
  const observer = createObserver({
    decide: async () => ({ kind: 'answers', answers: {} }),
    trace: () => { throw new Error('the disk is gone') },
    readConfig: () => config,
  })
  await assert.doesNotReject(() => observer.observe('draft', 'hi', {}))
})
