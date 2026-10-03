// THE TOOL THE REPOSITORY EXPOSES. The interesting property is not that it calls a model -- it is that it takes
// the SAME shape the observer is configured with, so a set file is handed over with no conversion. One test below
// passes the real criteria/helpfulness-set@2/turn.json straight in, which is the only way to show that.
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
  // A SCOPE FILE HOLDS ITS OWN SPEC LIST, so the file IS the question array -- no key to unwrap.
  const set = JSON.parse(readFileSync(new URL('../criteria/helpfulness-set@2/turn.json', import.meta.url), 'utf8'))
  const { calls, decide } = stub({ kind: 'answers', answers: { request_addressed: { status: 'ok' } }, envelope: { executed: { provider: 'typesafe' } } })
  const tool = createDecideTool({ decide })
  const out = await tool.execute({ state: 'OPERATOR REQUEST: find plugins', questions: set })
  assert.equal(calls.length, 1)
  assert.deepEqual(Object.keys(calls[0].questions).sort(), set.map((q) => q.id).sort(), 'every id in the file reaches the model')
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
    { kind: 'answers', answers: {}, worstCase: null, envelope: { executed: 'not an object', usage: 7, durationMs: 'soon' } },
    { kind: 'answers', answers: {}, worstCase: 'the least favourable reading', envelope: { executed: {}, usage: {} } },
    { kind: 'answers', answers: [1, 2], worstCase: {}, envelope: { executed: {}, usage: {}, durationMs: Number.NaN } },
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
  const tool = createDecideTool({ decide: async () => ({ kind: 'answers', answers: { a: 1 }, worstCase: { level: 'high' }, envelope: { executed: { provider: 'typesafe' }, usage: { inputTokens: 10 }, durationMs: 812.5 } }) })
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
    decide: async () => ({ kind: 'answers', answers: { a: 1 }, envelope: { executed: { provider: 'typesafe' }, durationMs: 812.5 } }),
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

// THE TRANSPORT DIFFERENCE, which cost the provenance silently. `lib/model/service.js` returns the envelope NESTED
// (`{kind, answers, envelope:{executed, usage, durationMs}}`) while the wire spreads it flat -- so reading the top
// level lost `executed`, `usage` and `durationMs` on the service path, which is the one a profile with `system1`
// mounted runs. The tool reported answers with no record of which checkpoint answered them.
test('the provenance is read from a NESTED envelope as well as a flat one', async () => {
  const nested = createDecideTool({ decide: async () => ({ kind: 'answers', answers: { a: 1 }, worstCase: { level: 'high' }, envelope: { executed: { provider: 'typesafe', revision: 'typesafe/jev-1.13' }, usage: { inputTokens: 12 }, durationMs: 812.5 } }) })
  const out = await nested.execute({ state: 'x', questions: [spec] })
  assert.deepEqual(out.executed, { provider: 'typesafe', revision: 'typesafe/jev-1.13' }, 'the checkpoint that answered reaches the caller')
  assert.deepEqual(out.usage, { inputTokens: 12 })
  assert.equal(out.durationMs, 812.5)

  const flat = createDecideTool({ decide: async () => ({ kind: 'answers', answers: { a: 1 }, executed: { provider: 'wire' }, usage: { inputTokens: 1 }, durationMs: 5 }) })
  const flatOut = await flat.execute({ state: 'x', questions: [spec] })
  // ASSERTED AGAINST: the rule is that the envelope is the ONLY source, and the observation path already has a
  // test saying so. Writing mine the other way is why a shared helper was born with a fallback that broke it.
  assert.equal(flatOut.executed, undefined, 'a top-level executed is NOT projected: the envelope is the only source')
  assert.equal(flatOut.durationMs, undefined)
})

// DELTA 6b: THE CALLER'S CANCELLATION. `adding-a-tool.md:49` makes `exec.signal` mandatory rather than advisory,
// and the transport has honoured one since it was written -- these two tests are about the wiring in between,
// which dropped it in three places: the tool's `execute` took only `args`, and both `decide` assignments in
// index.js forwarded the request without the options that carry it.
test('a signal already aborted means the backend is NEVER called', async () => {
  const { calls, decide } = stub({ kind: 'answers', answers: {} })
  const tool = createDecideTool({ decide })
  const controller = new AbortController()
  controller.abort()

  await assert.rejects(tool.execute({ state: 'x', questions: [spec] }, { signal: controller.signal }),
    /cancelled before it started/)
  assert.equal(calls.length, 0, 'a cancelled call must not reach the model at all: ' + JSON.stringify(calls))
})

test('a live signal is handed to the backend, not swallowed', async () => {
  // ITS OWN SPY, because the shared `stub` records only the first argument -- and the signal travels in the
  // SECOND, as `decide(request, options)`. My first version of this test read `calls[0].signal` and failed for
  // exactly that reason: the assertion was wrong about an interface I had just changed.
  const seen = []
  const tool = createDecideTool({
    decide: async (request, options) => { seen.push({ request, options }); return { kind: 'answers', answers: {} } },
  })
  const controller = new AbortController()

  await tool.execute({ state: 'x', questions: [spec] }, { signal: controller.signal })
  assert.equal(seen.length, 1)
  // THE SAME OBJECT, asserted by identity: a copy would satisfy a structural check while separating the caller's
  // controller from the one the transport listens to.
  assert.equal(seen[0].options.signal, controller.signal, "the caller's own signal reaches decide")
})

// DELTA 6b, THE OTHER HALF: what happens when the signal fires DURING the call. Only the wire forwards an external
// abort; the `system1` service path cannot interrupt work in flight, so a cancelled call used to come back looking
// like any other -- an operator who walked away was indistinguishable from one who waited. The answer is kept, since
// the backend was already paid for it; the record now says `cancelled: true`, which is the difference between a lost
// call and an invisible one.
test('a signal aborted DURING the call is recorded, not silently absorbed', async () => {
  const lines = []
  const controller = new AbortController()
  const tool = createDecideTool({
    decide: async () => {
      controller.abort()
      return { kind: 'answers', answers: { asked: { status: 'ok', answer: { type: 'noul', probabilityTrue: 0.9 } } }, envelope: {} }
    },
    record: (line) => lines.push(line),
  })
  const out = await tool.execute({ state: 'x', questions: [spec] }, { signal: controller.signal })
  assert.equal(out.failure, undefined, 'the answer the backend already produced is not thrown away')
  assert.equal(lines.length, 1)
  assert.equal(lines[0].cancelled, true, 'a cancellation the transport could not act on is visible in the record')
  const { probeViolations } = await import('../lib/turn-record.js')
  assert.deepEqual(probeViolations(lines), [], 'and the extra field does not break the acceptance check')
})
