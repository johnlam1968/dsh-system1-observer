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

// THE LIVE DEFECT, AS A TEST. The first live call failed with `"value.worstCase" must be an object`: the schema
// declares worstCase an object and the model returned something else. The stub in the other tests returns no
// worstCase, so the property was absent and the schema was satisfied VACUOUSLY -- the same shape as the two
// verifications that passed while proving nothing. So this asserts the type gate directly.
test('a field whose type the schema forbids is DROPPED, not emitted', async () => {
  const wrong = [
    { kind: 'answers', answers: {}, worstCase: null, executed: 'not an object', usage: 7, durationMs: 'soon' },
    { kind: 'answers', answers: {}, worstCase: 'the least favourable reading', executed: {}, usage: {} },
    { kind: 'answers', answers: [1, 2], worstCase: {}, executed: {}, usage: {}, durationMs: Number.NaN },
  ]
  for (const reply of wrong) {
    const tool = createDecideTool({ decide: async () => reply })
    const out = await tool.execute({ state: 'x', questions: [spec] })
    const properties = tool.output.schema.properties
    for (const [key, value] of Object.entries(out)) {
      assert.equal(Object.hasOwn(properties, key), true, `${key} is not in the schema`)
      const declared = properties[key].type
      if (declared === 'object') assert.equal(typeof value === 'object' && value !== null && !Array.isArray(value), true, `${key} must be an object`)
      if (declared === 'number') assert.equal(Number.isFinite(value), true, `${key} must be a finite number`)
    }
    assert.deepEqual(out.answers, Array.isArray(reply.answers) ? {} : {}, 'a non-object answers map is replaced by an empty one')
  }
})

test('a well-formed envelope still comes through intact', async () => {
  const tool = createDecideTool({ decide: async () => ({ kind: 'answers', answers: { a: 1 }, worstCase: { level: 'high' }, executed: { provider: 'typesafe' }, usage: { inputTokens: 10 }, durationMs: 812.5 }) })
  const out = await tool.execute({ state: 'x', questions: [spec] })
  assert.deepEqual(out, { answers: { a: 1 }, executed: { provider: 'typesafe' }, usage: { inputTokens: 10 }, worstCase: { level: 'high' }, durationMs: 812.5 })
})

// THE FIRST LIVE CALL ANSWERED CORRECTLY AND REPORTED IT AS NOTHING: the renderer assumed the BRIDGE's field names
// and printed `undefined true` / `undefined of ?`. A render that loses an answer is a defect in the tool even when
// the judgement was right, so the shapes are recognised by what they carry.
test('the render never prints undefined for an answer shape it did not anticipate', () => {
  const tool = createDecideTool({ decide: async () => ({ kind: 'answers', answers: {} }) })
  const shapes = [
    { type: 'noul', probabilityTrue: 0.92 },
    { type: 'score', value: 1, levels: ['a', 'b'] },
    { type: 'choice', value: 'x', confidence: 0.9 },
    { type: 'noul', noul: 0.4 },
    { something: 'else' },
    'not an object',
  ]
  for (const answer of shapes) {
    const text = tool.output.render({}, { answers: { q: { status: 'ok', answer } } })[0].text
    assert.equal(text.includes('undefined'), false, `rendered ${JSON.stringify(answer)} as ${text}`)
    assert.equal(text.includes('?'), false, `and without a placeholder: ${text}`)
  }
})

// CRITERION 1(b), which the plan wrote and the code did not have: the tool writes its own line naming itself. It
// also has to satisfy the acceptance check, which requires every call line under a NON-SEAM hook to name its
// questions -- so the line carries questionIds, and hook: 'tool' is not a seam.
test('a call through the tool records a line naming the tool and its questions', async () => {
  const lines = []
  const tool = createDecideTool({
    decide: async () => ({ kind: 'answers', answers: { a: 1 }, executed: { provider: 'typesafe' }, durationMs: 812.5 }),
    record: (line) => lines.push(line),
  })
  await tool.execute({ state: 'x', questions: [spec, { id: 'ladder', type: 'score', instructions: 'How much?', levels: ['low', 'high'] }] })
  assert.equal(lines.length, 1)
  assert.equal(lines[0].hook, 'tool')
  assert.equal(lines[0].tool, 'system1-observer')
  assert.deepEqual(lines[0].questionIds, ['asked', 'ladder'])
  assert.deepEqual(lines[0].executed, { provider: 'typesafe' })
  assert.equal(lines[0].durationMs, 812.5)
  const { probeViolations } = await import('../lib/turn-record.js')
  assert.deepEqual(probeViolations(lines), [], 'the line satisfies the acceptance check it could otherwise violate')
})

test('a refused question and a failed judgement both record NOTHING', async () => {
  const refused = []
  await assert.rejects(() => createDecideTool({ decide: async () => ({}), record: (l) => refused.push(l) })
    .execute({ state: 'x', questions: [{ id: 'bad', type: 'score', instructions: 'How?', levels: ['one'] }] }))
  assert.deepEqual(refused, [], 'a refused set never reaches the backend, so there is no measurement to record')

  const failed = []
  const tool = createDecideTool({ decide: async () => ({ kind: 'error', reason: 'the service refused' }), record: (l) => failed.push(l) })
  await tool.execute({ state: 'x', questions: [spec] })
  assert.deepEqual(failed, [], 'a judgement that did not happen is not a measurement')
})

test('a tool constructed with no recorder still works, and records nothing', async () => {
  const tool = createDecideTool({ decide: async () => ({ kind: 'answers', answers: {} }) })
  await tool.execute({ state: 'x', questions: [spec] })
})
