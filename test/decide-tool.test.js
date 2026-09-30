// THE TOOL THE REPOSITORY EXPOSES. The interesting property is not that it calls a model -- it is that it takes
// the SAME shape the observer is configured with, so a set file is handed over with no conversion. One test below
// passes the real criteria/helpfulness-set@2.json straight in, which is the only way to show that.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createDecideTool, readSpecs, DECIDE_TOOL_NAME, TOOL_HOOK } from '../lib/decide-tool.js'

const spec = { id: 'asked', type: 'noul', instructions: 'Is this true?' }
const stub = (reply) => {
  const calls = []
  return { calls, decide: async (request) => { calls.push(request); return reply } }
}

test('the definition is the shape the registry requires', () => {
  const tool = createDecideTool({ decide: async () => ({ kind: 'answers', answers: {} }) })
  assert.equal(tool.name, DECIDE_TOOL_NAME)
  assert.equal(tool.parameters.type, 'object')
  assert.deepEqual(tool.parameters.required, ['state', 'questions'])
  assert.equal(tool.parameters.additionalProperties, false)
  assert.equal(typeof tool.output.render, 'function')
  assert.equal(typeof tool.execute, 'function')
})

test('a set file is passed as it is written, with no conversion', async () => {
  const set = JSON.parse(readFileSync(new URL('../criteria/helpfulness-set@2.json', import.meta.url), 'utf8'))
  const { calls, decide } = stub({ kind: 'answers', answers: { request_addressed: { status: 'ok' } }, executed: { provider: 'typesafe' } })
  const tool = createDecideTool({ decide })
  const out = await tool.execute({ state: 'OPERATOR REQUEST: find plugins', questions: set.turn })
  assert.equal(calls.length, 1)
  assert.deepEqual(Object.keys(calls[0].questions).sort(), set.turn.map((q) => q.id).sort(), 'every id in the file reaches the model')
  assert.equal(calls[0].state, 'OPERATOR REQUEST: find plugins')
  assert.deepEqual(out.executed, { provider: 'typesafe' })
})

test('a map from id to spec is accepted, and the ids survive', async () => {
  const { calls, decide } = stub({ kind: 'answers', answers: {} })
  const tool = createDecideTool({ decide })
  await tool.execute({ state: 'x', questions: { asked: { type: 'noul', instructions: 'Is this true?' } } })
  assert.deepEqual(Object.keys(calls[0].questions), ['asked'])
})

test('a malformed question is REFUSED, and the message names it', async () => {
  const { calls, decide } = stub({ kind: 'answers', answers: {} })
  const tool = createDecideTool({ decide })
  await assert.rejects(
    () => tool.execute({ state: 'x', questions: [{ id: 'ladder', type: 'score', instructions: 'How much?', levels: ['only one'] }] }),
    /ladder|at least two/,
  )
  assert.equal(calls.length, 0, 'a refused set never reaches the backend')
})

test('an unusable questions value is refused rather than read as an empty set', async () => {
  assert.throws(() => readSpecs('not a set'), /\`questions\` must be/)
  assert.throws(() => readSpecs(7), /\`questions\` must be/)
  const tool = createDecideTool({ decide: async () => ({ kind: 'answers', answers: {} }) })
  await assert.rejects(() => tool.execute({ state: 'x', questions: 'nope' }), /\`questions\` must be/)
  await assert.rejects(() => tool.execute({ state: '   ', questions: [spec] }), /state.*empty/)
  await assert.rejects(() => tool.execute({ questions: [spec] }), /state.*required/)
})

test('a backend that could not answer is a FAILURE BLOCK, not a thrown error', async () => {
  const tool = createDecideTool({ decide: async () => ({ kind: 'error', reason: 'the service refused' }) })
  const out = await tool.execute({ state: 'x', questions: [spec] })
  assert.deepEqual(out, { failure: { reason: 'the service refused' } })
  assert.match(tool.output.render({}, out)[0].text, /no answer -- the service refused/)
})

test('the tool names the backend its row configures, not a built-in default', () => {
  const tool = createDecideTool({ decide: async () => ({}), provider: 'typesafe', model: 'jev-latest' })
  assert.match(tool.parameters.properties.provider.description, /typesafe/)
  assert.match(tool.parameters.properties.model.description, /jev-latest/)
  assert.equal(TOOL_HOOK, 'call')
})
