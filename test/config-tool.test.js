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

test('reading is free: no record and no write for list or get', async () => {
  const h = harness()
  assert.deepEqual(await h.tool.execute({ action: 'list' }), { knobs: { provider: 'typesafe', turn: false }, recorded: false })
  assert.deepEqual(await h.tool.execute({ action: 'get', knob: 'provider' }), { knob: 'provider', value: 'typesafe', recorded: false })
  assert.deepEqual(h.order, [], 'a read must not touch the record it exists to keep honest')
})

test('a change is RECORDED BEFORE it takes effect', async () => {
  const h = harness()
  const out = await h.tool.execute({ action: 'set', knob: 'provider', value: 'laya' })
  assert.deepEqual(h.order, ['record:provider', 'write:provider'], 'the order is the contract')
  assert.deepEqual(out, { knob: 'provider', from: 'typesafe', value: 'laya', recorded: true })
  assert.equal(h.current().provider, 'laya')
})

test('enable and disable switch a knob to a boolean, and say what it was', async () => {
  const h = harness()
  assert.deepEqual(await h.tool.execute({ action: 'enable', knob: 'turn' }), { knob: 'turn', from: false, value: true, recorded: true })
  assert.deepEqual(await h.tool.execute({ action: 'disable', knob: 'turn' }), { knob: 'turn', from: true, value: false, recorded: true })
})

test('an unknown action or knob is refused, naming what is known', async () => {
  const h = harness()
  await assert.rejects(() => h.tool.execute({ action: 'mutate', knob: 'provider' }), /not one of list, get, set, enable, disable/)
  await assert.rejects(() => h.tool.execute({ action: 'set', knob: 'tracePath' }), /is not a knob of this plugin. Known: provider, turn/)
  await assert.rejects(() => h.tool.execute({ action: 'set' }), /`knob` is required/)
  assert.deepEqual(h.order, [], 'a refused change writes nothing')
})

test('the lines it writes replay to the state it produced', async () => {
  const h = harness()
  await h.tool.execute({ action: 'set', knob: 'provider', value: 'laya' })
  await h.tool.execute({ action: 'enable', knob: 'turn' })
  const { knobs, applied, unusable } = replayConfig(h.lines)
  assert.deepEqual(unusable, [], 'every line the tool writes must be readable by the reader')
  assert.equal(applied, 2)
  assert.deepEqual(knobs, { provider: 'laya', turn: true }, 'the record reconstructs the configuration')
  assert.deepEqual(knobs, h.current())
})

test('the definition is one tool over an action, not a family of tools', async () => {
  const { tool } = harness()
  assert.equal(tool.name, CONFIG_TOOL_NAME)
  assert.deepEqual(tool.parameters.required, ['action'])
  assert.deepEqual(tool.parameters.properties.action.enum, ['list', 'get', 'set', 'enable', 'disable'])
  assert.equal(typeof tool.execute, 'function')
})

// THE WRITE IS AWAITED, and this is why: the service it will be wired to persists asynchronously, and an
// un-awaited write would report `recorded: true` for a change that never landed. A success claim the state
// contradicts is worse than a failure, because nothing looks wrong.
test('a write that fails is not reported as a success, and the record still went first', async () => {
  const order = []
  const tool = createConfigTool({
    read: () => ({ provider: 'typesafe' }),
    write: async () => { order.push('write'); throw new Error('the editor refused') },
    record: () => order.push('record'),
    knobs: ['provider'],
  })
  await assert.rejects(() => tool.execute({ action: 'set', knob: 'provider', value: 'laya' }), /the editor refused/)
  assert.deepEqual(order, ['record', 'write'], 'the line is written before the attempt, as the contract says')
})

test('an asynchronous write is awaited, so the change is in force before the result is returned', async () => {
  let current = { provider: 'typesafe' }
  const tool = createConfigTool({
    read: () => current,
    write: async ({ knob, value }) => { await new Promise((r) => setTimeout(r, 5)); current = { ...current, [knob]: value } },
    record: () => {},
    knobs: ['provider'],
  })
  const out = await tool.execute({ action: 'set', knob: 'provider', value: 'laya' })
  assert.equal(current.provider, 'laya', 'the write finished before the result was built')
  assert.deepEqual(out, { knob: 'provider', from: 'typesafe', value: 'laya', recorded: true })
})

// THE FIRST LIVE `list` FAILED WITH `value is not lossless JSON`: the live config holds Volatile ACCESSORS, which
// are functions, and the tool returned it verbatim. The harness validates a tool's output, so this was a live-only
// failure -- a stub of plain values cannot produce it.
test('a knob that arrives as an accessor is unwrapped, and a function is never returned', async () => {
  const tool = createConfigTool({
    read: () => ({ provider: { get: () => 'typesafe' }, turn: { get: () => 0 }, weird: () => {}, missing: undefined, hooks: ['admit'] }),
    write: () => {},
    record: () => {},
  })
  const listed = await tool.execute({ action: 'list' })
  assert.deepEqual(listed.knobs, { provider: 'typesafe', turn: 0, hooks: ['admit'] }, 'accessors unwrapped, functions and undefined dropped')
  assert.equal(JSON.stringify(listed).includes('function'), false)
  const got = await tool.execute({ action: 'get', knob: 'provider' })
  assert.equal(got.value, 'typesafe')
})
