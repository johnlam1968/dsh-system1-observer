// THE RAW-REGISTRATION OBLIGATION: A RAW TOOL VALIDATES ITS OWN ARGUMENTS.
//
// `reference/cookbook/adding-a-tool.md:44`: `defineTool` validates the model's arguments before `execute` runs --
// "a raw JSON-Schema tool registered directly is responsible for its own input validation." These three tools are
// registered raw (see `lib/tool.js:8` for why), so nothing else stands between a malformed call and a tool that acts
// on it. The record carried that as UNVERIFIED for two rounds with the reason stated: a grep is not a test. This is
// the test.
//
// WHAT COUNTS AS REFUSING. `adding-a-tool.md:48` settles it: "throwing, or returning an invalid value, means
// `isError`" -- the registry catches the throw and the model sees a failure. Throwing is asserted here because it is
// the unambiguous form, and every case below is checked against the tool's OWN declaration: a wrong type, a value
// outside a declared enum, a missing `required` key, and a key the schema says cannot appear.
//
// THE VALID CASE IN EACH GROUP IS NOT DECORATION. Without it, three tools that threw on every call would pass every
// hostile case, and this file would report conformity for a plugin whose tools never worked.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createTraceTool, TRACE_TOOL_NAME } from '../lib/tool.js'
import { createConfigTool } from '../lib/config-tool.js'
import { createDecideTool, DECIDE_TOOL_NAME, TOOL_HOOK } from '../lib/decide-tool.js'

const tracePath = join(mkdtempSync(join(tmpdir(), 'tool-contract-')), 'trace.jsonl')
const trace = createTraceTool({ path: tracePath, runId: () => 'run-1', liveAgents: () => [], price: 0.042 })
const config = createConfigTool({
  read: () => ({ callsEnabled: true }),
  write: () => ({ callsEnabled: false }),
  record: () => {},
})
const decide = createDecideTool({
  decide: async () => ({ kind: 'answers', answers: { asked: { noul: 0.9 } } }),
  record: () => {},
})
const spec = { id: 'asked', type: 'noul', instructions: 'Is this true?' }

const TOOLS = { [TRACE_TOOL_NAME]: trace, [DECIDE_TOOL_NAME]: decide, system1_settings: config }

/** The tool's own declared shape, used to say WHY a call is malformed rather than only that it is. */
const CASES = [
  // ---- trace: run/hook/tail, all optional, additionalProperties false
  { tool: TRACE_TOOL_NAME, args: {}, valid: true, why: 'every parameter is optional' },
  { tool: TRACE_TOOL_NAME, args: { tail: 5, hook: 'assemble' }, valid: true, why: 'a declared integer and a seam name' },
  { tool: TRACE_TOOL_NAME, args: { tail: 'many' }, why: '`tail` is declared integer' },
  { tool: TRACE_TOOL_NAME, args: { run: 42 }, why: '`run` is declared string' },
  { tool: TRACE_TOOL_NAME, args: { hook: 'not-a-seam' }, why: '`hook` is declared as an enum of the seams' },
  { tool: TRACE_TOOL_NAME, args: { extra: true }, why: '`additionalProperties` is declared false' },
  { tool: TRACE_TOOL_NAME, args: { tail: -1 }, why: 'a negative window is not a window' },

  // ---- config: action required and enumerated; knob required for every action but list
  { tool: 'system1_settings', args: { action: 'list' }, valid: true, why: 'the one action that needs nothing else' },
  { tool: 'system1_settings', args: { action: 'get', knob: 'callsEnabled' }, valid: true, why: 'a read with its knob' },
  { tool: 'system1_settings', args: {}, why: '`action` is declared required' },
  { tool: 'system1_settings', args: { action: 'nope' }, why: '`action` is declared as an enum' },
  { tool: 'system1_settings', args: { action: 'get' }, why: 'the declared description says `knob` is required for every action but `list`' },
  { tool: 'system1_settings', args: { action: 'set', knob: 'callsEnabled' }, why: '`set` without a value changes nothing and must not report success' },
  { tool: 'system1_settings', args: { action: 'list', extra: 1 }, why: '`additionalProperties` is declared false' },

  // ---- decide: state and questions required; a set that asks nothing is refused by name
  { tool: DECIDE_TOOL_NAME, args: { state: 'x', questions: [spec] }, valid: true, why: 'one well-formed question' },
  { tool: DECIDE_TOOL_NAME, args: {}, why: '`state` and `questions` are declared required' },
  { tool: DECIDE_TOOL_NAME, args: { state: 'x' }, why: '`questions` is declared required' },
  { tool: DECIDE_TOOL_NAME, args: { state: 'x', questions: 'not a set' }, why: '`readSpecs` accepts an array or a map and refuses anything else by name' },
  { tool: DECIDE_TOOL_NAME, args: { state: 'x', questions: [] }, why: 'an empty set is the state that asks nothing and looks like an answer' },
  { tool: DECIDE_TOOL_NAME, args: { state: 'x', questions: [{ id: 'a', type: 'bogus', instructions: 'x?' }] }, why: 'the question type is an enum in the runtime list' },
  { tool: DECIDE_TOOL_NAME, args: { state: 'x', questions: [spec], extra: 1 }, why: '`additionalProperties` is declared false' },
]

for (const item of CASES) {
  const label = `${item.tool} ${JSON.stringify(item.args)} -- ${item.why}`
  test(`${item.valid === true ? 'accepts' : 'refuses'}: ${label}`, async () => {
    const tool = TOOLS[item.tool]
    assert.ok(tool, `no tool named ${item.tool}`)
    if (item.valid === true) {
      await assert.doesNotReject(tool.execute(item.args, {}), 'a declared-valid call must not be refused: ' + label)
      return
    }
    await assert.rejects(tool.execute(item.args, {}), (error) => {
      // AN ERROR, AND SOMETHING SAID. A refusal that arrives as `undefined`, as an empty object, or as a bare
      // `Error` with no message would satisfy a `rejects` assertion while telling the model nothing.
      assert.ok(error instanceof Error, 'a refusal is an Error, so the registry reports isError: ' + label)
      assert.ok(String(error.message).length > 0, 'and it carries a message the model can read: ' + label)
      return true
    }, 'must refuse: ' + label)
  })
}
