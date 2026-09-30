// THE SETTINGS TOOL. The property that matters is the ORDER: a record written AFTER the change would pass a naive
// "both happened" assertion and fail the requirement, so the order is what is asserted.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createConfigTool, CONFIG_TOOL_NAME } from '../lib/config-tool.js'
import { replayConfig } from '../lib/config-event.js'

function harness({ knobs = ['provider', 'turn'], state = { provider: 'typesafe', turn: false } } = {}) {
  const order = []
  const lines = []
  let current = { ...state }
  const tool = createConfigTool({
    read: () => ({ ...current }),
    write: ({ knob, value }) => { order.push('write:' + knob); current[knob] = value },
    record: (line) => { order.push('record:' + line.knob); lines.push(line) },
    knobs,
  })
  return { tool, order, lines, current: () => current }
}

test('reading is free: no record and no write for list or get', () => {
  const h = harness()
  assert.deepEqual(h.tool.execute({ action: 'list' }), { knobs: { provider: 'typesafe', turn: false }, recorded: false })
  assert.deepEqual(h.tool.execute({ action: 'get', knob: 'provider' }), { knob: 'provider', value: 'typesafe', recorded: false })
  assert.deepEqual(h.order, [], 'a read must not touch the record it exists to keep honest')
})

test('a change is RECORDED BEFORE it takes effect', () => {
  const h = harness()
  const out = h.tool.execute({ action: 'set', knob: 'provider', value: 'laya' })
  assert.deepEqual(h.order, ['record:provider', 'write:provider'], 'the order is the contract')
  assert.deepEqual(out, { knob: 'provider', from: 'typesafe', value: 'laya', recorded: true })
  assert.equal(h.current().provider, 'laya')
})

test('enable and disable switch a knob to a boolean, and say what it was', () => {
  const h = harness()
  assert.deepEqual(h.tool.execute({ action: 'enable', knob: 'turn' }), { knob: 'turn', from: false, value: true, recorded: true })
  assert.deepEqual(h.tool.execute({ action: 'disable', knob: 'turn' }), { knob: 'turn', from: true, value: false, recorded: true })
})

test('an unknown action or knob is refused, naming what is known', () => {
  const h = harness()
  assert.throws(() => h.tool.execute({ action: 'mutate', knob: 'provider' }), /not one of list, get, set, enable, disable/)
  assert.throws(() => h.tool.execute({ action: 'set', knob: 'tracePath' }), /is not a knob of this plugin. Known: provider, turn/)
  assert.throws(() => h.tool.execute({ action: 'set' }), /`knob` is required/)
  assert.deepEqual(h.order, [], 'a refused change writes nothing')
})

test('the lines it writes replay to the state it produced', () => {
  const h = harness()
  h.tool.execute({ action: 'set', knob: 'provider', value: 'laya' })
  h.tool.execute({ action: 'enable', knob: 'turn' })
  const { knobs, applied, unusable } = replayConfig(h.lines)
  assert.deepEqual(unusable, [], 'every line the tool writes must be readable by the reader')
  assert.equal(applied, 2)
  assert.deepEqual(knobs, { provider: 'laya', turn: true }, 'the record reconstructs the configuration')
  assert.deepEqual(knobs, h.current())
})

test('the definition is one tool over an action, not a family of tools', () => {
  const { tool } = harness()
  assert.equal(tool.name, CONFIG_TOOL_NAME)
  assert.deepEqual(tool.parameters.required, ['action'])
  assert.deepEqual(tool.parameters.properties.action.enum, ['list', 'get', 'set', 'enable', 'disable'])
  assert.equal(typeof tool.execute, 'function')
})
