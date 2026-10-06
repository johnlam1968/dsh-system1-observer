// EVERY TOOL'S OUTPUT, VALIDATED THE WAY THE HARNESS VALIDATES IT.
//
// WHY THIS FILE EXISTS, and it is the exact complement of `test/conformance.test.js`: that one checks our DECLARATIONS
// against the harness's schema COMPILER, and this one checks the VALUES a tool actually produces against its compiled
// declaration. The gap between them is where `system1_decide` broke: its output declared `answers`, `executed` and
// `usage` as CLOSED objects with no properties, which compiles cleanly and refuses every non-empty value. The first
// live call after the change answered
//
//   tool "system1_decide" returned invalid output: "value.answers.served_the_request" is not a declared property
//   (additionalProperties: false); "value.executed.provider" …; "value.usage.inputTokens" …
//
// -- a registered tool that could not succeed once (`F118`). Every unit test passed, because they assert the OBJECT
// the body returns and never put it through the pipeline that refuses it.
//
// TWO CHECKS, because they catch different things:
//   1. STATIC: no output node may be a CLOSED object with nothing in it. Its keys can only come from data or from
//      another producer, so declaring it closed refuses everything -- measurably, in five of our eight tools.
//   2. BEHAVIOURAL: for the tools driven here, a REAL value with every field POPULATED goes through the harness's own
//      `validateJsonSchemaValue`, the same function `ToolRuntime.createSuccessResult` calls. The static check cannot
//      see a field declared with the wrong TYPE; this one can.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import { asToolDefinition } from '../lib/tool-definition.js'
import { createDecideTool } from '../lib/decide-tool.js'
import { createEvaluateTool } from '../lib/evaluate-tool.js'
import { createResultsTool } from '../lib/results-tool.js'
import { createSessionsTool } from '../lib/sessions-tool.js'
import { createQuestionsTool } from '../lib/questions-tool.js'
import { createBatteryTool } from '../lib/battery-tool.js'
import { createConfigTool } from '../lib/config-tool.js'
import { createTraceTool } from '../lib/tool.js'
import { createExplainTool } from '../lib/explain-tool.js'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** A factory that returns stubs for whatever the tool asks for; the tools only STORE these. */
const stubDeps = () => new Proxy({}, { get: (_target, key) => (key === 'then' ? undefined : () => undefined) })

/** The eight tools this plugin registers, constructed but never executed. */
function everyTool() {
  return [
    createDecideTool(stubDeps()),
    createEvaluateTool(stubDeps()),
    createResultsTool(stubDeps()),
    createSessionsTool(stubDeps()),
    createQuestionsTool(stubDeps()),
    createBatteryTool(stubDeps()),
    createConfigTool(stubDeps()),
    createTraceTool(stubDeps()),
    // THE BRIEF IS A TOOL LIKE ANY OTHER and its output is validated with them: it reports derived facts, so a field
    // it emits that its declaration does not describe would be refused exactly like any other value (F118's class).
    createExplainTool(),
  ]
}

/** Every node of a compiled output schema, with its path, for the structural check. */
function walk(node, path, visit) {
  if (node === null || typeof node !== 'object') return
  if (Array.isArray(node)) { node.forEach((child, index) => walk(child, `${path}[${index}]`, visit)); return }
  visit(node, path)
  for (const [key, value] of Object.entries(node)) {
    // `description` and `properties` are walked through, but a description is prose: a `"type": "object"` inside one
    // would otherwise be read as a schema node.
    if (key !== 'description') walk(value, `${path}.${key}`, visit)
  }
}

test('no tool declares a CLOSED object with no properties -- the shape that refuses every value', () => {
  const offenders = []
  for (const tool of everyTool()) {
    // AUTHORED FIRST, so this walks what the REGISTRY validates: `defineTool` compiles the declaration, and the
    // author-only `type: 'json'` node becomes an annotation-only `{}` in the process (`F119`).
    walk(asToolDefinition(tool).output.schema, 'output', (node, path) => {
      if (node.type === 'object' && node.additionalProperties === false
        && (node.properties === undefined || Object.keys(node.properties).length === 0)) {
        offenders.push(`${tool.name} at ${path}`)
      }
    })
  }
  assert.deepEqual(offenders, [],
    'these nodes can never validate a non-empty value (their keys come from data or another producer, so they must be open):\n  '
    + offenders.join('\n  '))
})

test('the nine tools are all here, so the check above cannot shrink silently', () => {
  const names = everyTool().map((tool) => tool.name).sort()
  assert.deepEqual(names, ['system1_battery', 'system1_decide', 'system1_evaluate_session', 'system1_explain',
    'system1_measurements', 'system1_question_sets', 'system1_sessions', 'system1_settings', 'system1_trace'].sort())
})

test('a FULL decide answer validates against its own declaration -- the call that failed live', async () => {
  // EVERY FIELD POPULATED, which is the difference from the unit tests this tool already had: a stub returning
  // `answers: {}` satisfies a closed-empty declaration VACUOUSLY, and that is why the breakage shipped.
  const value = await createDecideTool({
    decide: async () => ({
      kind: 'answers',
      answers: { served_the_request: { type: 'noul', probability: 0.9, confidence: 0.82 } },
      worstCase: { served_the_request: 0.82 },
      envelope: {
        executed: { provider: 'typesafe', model: 'typesafe/jev-1.13-20260917' },
        usage: { inputTokens: 635, outputTokens: 60 },
        durationMs: 802,
      },
    }),
    record: () => {},
  }).execute({ state: 'the state', questions: [{ id: 'served_the_request', type: 'noul', instructions: 'Did it?' }] })
  assert.deepEqual(Object.keys(value).sort(), ['answers', 'durationMs', 'executed', 'usage', 'worstCase'])
  assert.deepEqual(validateJsonSchemaValue(asToolDefinition(createDecideTool(stubDeps())).output.schema, value, 'value'), [])
})

test('a RETURNED failure validates, and a THROWN one is recorded and rethrown', async () => {
  // TWO PATHS, BOTH PINNED, because they are different answers: a body that returns nothing usable is a `failure`
  // block a model can read, while a transport that throws is the tool contract's failure path -- recorded first, so
  // the attempt is on the trace, and then rethrown to the caller.
  const returned = createDecideTool({ decide: async () => null, record: () => {} })
  const value = await returned.execute({ state: 'the state', questions: [{ id: 'q', type: 'noul', instructions: 'Did it?' }] })
  assert.deepEqual(value, { failure: { reason: 'the model returned no result' } })
  assert.deepEqual(validateJsonSchemaValue(asToolDefinition(returned).output.schema, value, 'value'), [])

  const lines = []
  const thrown = createDecideTool({ decide: async () => { throw new Error('the wire refused the connection') }, record: (line) => lines.push(line) })
  await assert.rejects(() => thrown.execute({ state: 'the state', questions: [{ id: 'q', type: 'noul', instructions: 'Did it?' }] }), /refused the connection/)
  assert.equal(lines.length, 1, 'the attempt is on the record even though the call threw')
  assert.match(String(lines[0].failure?.reason), /refused the connection/)
})

test('the trace tool\'s CARD data validates, which is the field it could never populate', () => {
  // `data` was a closed-empty object, and `traceData` fills it -- so the tool could return a report (text) and never a
  // card (data). The value is validated here with a real two-line trace, because the empty case is what passed before.
  const dir = mkdtempSync(join(tmpdir(), 'tool-output-'))
  const path = join(dir, 'trace.jsonl')
  writeFileSync(path, [
    JSON.stringify({ event: 'mount', at: new Date().toISOString(), run: 'r1', transport: 'service', hooks: ['draft'] }),
    JSON.stringify({ event: 'call', at: new Date().toISOString(), run: 'r1', hook: 'draft', ms: 120, transport: 'service', provider: 'typesafe', model: 'm', excerpt: 'hello', answer: { kind: 'answers', answers: {} } }),
  ].join('\n') + '\n')
  const tool = createTraceTool({ path, runId: () => 'r1', liveAgents: () => [], price: 0.042 })
  return tool.execute({ tail: 10 }).then((value) => {
    assert.ok(value.data !== undefined, 'the card data is present for a non-empty trace')
    assert.deepEqual(validateJsonSchemaValue(asToolDefinition(tool).output.schema, value, 'value'), [])
  })
})
