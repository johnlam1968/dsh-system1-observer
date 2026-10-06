// PUT A TOOL'S REAL VALUE THROUGH THE HARNESS'S OWN OUTPUT VALIDATION.
//
// WHY THIS IS A MODULE AND NOT A TEST: every tool's own test file is where a FULL value exists -- a fixture session, a
// stub judge, the arguments that reach every branch -- and the failure this guards against is invisible from a
// declaration. `F108` was emitted-but-undeclared; `F118` was DECLARED BUT FORBIDDEN (a closed map over keys that come
// from data); `F119` was DECLARED BUT MISMATCHED (`subject.groups` emitted at all when closed, and a `null` where an
// array was promised). Only running a value through the pipeline catches all three, and only the tool's own tests
// HAVE values.
//
// IT CALLS THE SAME FUNCTION THE PIPELINE CALLS: `ToolRuntime.createSuccessResult` does
// `validateJsonSchemaValue(tool.output.schema, detached, "value")` on the COMPILED schema, and `defineTool` compiles
// ours at construction -- so this is the pipeline's own check, minus the snapshot and freeze.
import assert from 'node:assert/strict'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import { asToolDefinition } from '../lib/tool-definition.js'

/**
 * Assert the harness would ACCEPT this value for this tool, and return it so a caller can keep chaining.
 *
 * THE DECLARATION IS AUTHORED FIRST, because that is what the registry validates against: every tool file here returns
 * a RAW `{ type: 'object', … }` declaration and `index.js` authors it through `asToolDefinition` at registration,
 * which is where `defineTool` COMPILES the value schema. Validating the raw declaration instead is a measured
 * false-positive generator (`F119`): the author-only `type: 'json'` node compiles to an annotation-only `{}` that
 * accepts anything, while the raw node reads to the runtime validator as an unknown type and refuses every present
 * value -- so a gate that skipped the authoring step reported a defect that did not exist.
 *
 * @param definition the raw declaration the tool file returns (what `index.js` hands to `asToolDefinition`)
 * @param value      what `definition.execute(...)` produced
 * @param label      which path the value came from, because a tool has more than one
 */
export function assertValidOutput(definition, value, label = '') {
  const compiled = asToolDefinition(definition)
  const violations = validateJsonSchemaValue(compiled.output.schema, value, 'value')
  assert.deepEqual(violations, [],
    `${definition.name}${label === '' ? '' : ' (' + label + ')'}: the harness would refuse this output: ${violations.join('; ')}`)
  return value
}
