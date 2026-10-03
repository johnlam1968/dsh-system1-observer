// THE SETTINGS TOOL. The property that matters is the ORDER: a record written AFTER the change would pass a naive
// "both happened" assertion and fail the requirement, so the order is what is asserted.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createConfigTool, CONFIG_TOOL_NAME } from '../lib/config-tool.js'
import { replayConfig } from '../lib/config-event.js'
import { Config } from '../index.js'

function harness({ knobs = ['provider', 'turn'], state = { provider: 'typesafe', turn: false }, schema } = {}) {
  const order = []
  const lines = []
  let current = { ...state }
  const tool = createConfigTool({
    read: () => ({ ...current }),
    write: ({ knob, value }) => { order.push('write:' + knob); current[knob] = value },
    record: (line) => { order.push('record:' + line.knob); lines.push(line) },
    knobs,
    ...(schema === undefined ? {} : { schema }),
  })
  return { tool, order, lines, current: () => current }
}

test('reading is free: no record and no write for list or get', async () => {
  const h = harness()
  assert.deepEqual(await h.tool.execute({ action: 'list' }), { knobs: { provider: 'typesafe', turn: false }, schema: {}, recorded: false })
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

// THE DESCRIPTOR, AND THE REFUSALS IT MAKES POSSIBLE. `set` used to hand whatever it was given to the editor and let
// the editor's error come back one round trip later. A model with the wrong JSON type, a number below its minimum, or
// a mount-bound field was spending a call to learn something the schema already knew.
const SCHEMA = () => ({
  provider: { type: 'string', meta: { volatile: true } },
  turn: { type: 'boolean', meta: { volatile: true, default: false } },
  maxFieldChars: { type: 'number', meta: { volatile: true, min: 1, max: 100000, default: 20000 } },
  hooks: { type: 'array', inner: { type: 'string' }, meta: { volatile: true } },
  tracePath: { type: 'string', meta: {} },
})
const described = () => harness({ knobs: Object.keys(SCHEMA()), schema: SCHEMA })

test('`list` reports what each setting IS, not only its value', async () => {
  const out = await described().tool.execute({ action: 'list' })
  assert.deepEqual(out.schema.maxFieldChars, { type: 'number', writable: true, default: 20000, min: 1, max: 100000 })
  assert.equal(out.schema.tracePath.writable, false, 'a mount-bound setting is readable and not writable')
  assert.equal(out.schema.hooks.itemType, 'string', 'and a list says what its items are')
})

test('a wrong type is refused, naming the setting and what it is', async () => {
  const h = described()
  await assert.rejects(() => h.tool.execute({ action: 'set', knob: 'maxFieldChars', value: true }), /`maxFieldChars` is a number/)
  await assert.rejects(() => h.tool.execute({ action: 'set', knob: 'hooks', value: 'admit' }), /`hooks` is a list/)
  assert.deepEqual(h.order, [], 'and nothing was recorded or written')
})

test('a number outside its bounds is refused, naming the bound', async () => {
  const h = described()
  await assert.rejects(() => h.tool.execute({ action: 'set', knob: 'maxFieldChars', value: 0 }), /must be at least 1/)
  await assert.rejects(() => h.tool.execute({ action: 'set', knob: 'maxFieldChars', value: 100001 }), /must be at most 100000/)
})

test('`enable` on a number says to use `set`, rather than writing `true`', async () => {
  await assert.rejects(() => described().tool.execute({ action: 'enable', knob: 'maxFieldChars' }),
    /needs a boolean setting; `maxFieldChars` is a number/)
})

test('a mount-bound setting can be READ and refuses to be written, with the reason', async () => {
  const h = harness({ knobs: ['tracePath'], state: { tracePath: '/tmp/trace.jsonl' }, schema: SCHEMA })
  assert.equal((await h.tool.execute({ action: 'get', knob: 'tracePath' })).value, '/tmp/trace.jsonl')
  await assert.rejects(() => h.tool.execute({ action: 'set', knob: 'tracePath', value: '/tmp/other.jsonl' }),
    /mount-bound.*cordis\.patch\.yml/)
  assert.deepEqual(h.order, [], 'a refused write records nothing: the line would measure a change that did not happen')
})

// AN INDEPENDENT REVIEW OF THIS TOOL FOUND THREE HOLES, and each has a test here because each was a case where the
// tool accepted something the schema rejects -- one round trip later than it needed to.
test('a union reports its CHOICES, and a value outside them is refused', async () => {
  // `set pathMode: "absolute"` was accepted (it is a string, and the type check stopped there) and refused by the
  // editor. The choices come from Schemastery's const nodes, so this test also pins that extraction: if it stops
  // working, the failure is here rather than in a tool that quietly stops checking.
  const tool = createConfigTool({ read: () => ({}), write: async () => {}, record: () => {}, schema: () => Config.dict })
  const out = await tool.execute({ action: 'list' })
  assert.deepEqual(out.schema.pathMode.choices, ['full', 'basename', 'omit'], 'the union names its choices')
  await assert.rejects(() => tool.execute({ action: 'set', knob: 'pathMode', value: 'absolute' }),
    /is one of "full", "basename", "omit"/)
  assert.equal((await tool.execute({ action: 'set', knob: 'pathMode', value: 'basename' })).value, 'basename')
})

test('a list checks its ITEMS, not only that it is a list', async () => {
  // `set hooks: ["admit", 42]` was accepted while the item schema would have refused 42. `sessions` declares `any`
  // items on purpose, so an `any` item type stays unchecked -- the check is skipped, not loosened.
  const h = described()
  await assert.rejects(() => h.tool.execute({ action: 'set', knob: 'hooks', value: ['admit', 42] }),
    /is a list of string; got 42/)
  assert.deepEqual(h.order, [], 'and a refused write records nothing')
})

test('every schema field TYPE is one the refusals know, so a new type cannot slip through unchecked', async () => {
  // The coverage ratchet polices which FIELDS the descriptor sees. This polices the other half, which the review
  // named: a field whose type has no branch in `refuseValue` would be described, then accepted whatever it was given.
  const HANDLED = ['boolean', 'number', 'string', 'array', 'object', 'union', 'any']
  const types = [...new Set(Object.values(Config.dict).map((field) => field.type))]
  const unhandled = types.filter((type) => !HANDLED.includes(type))
  assert.deepEqual(unhandled, [], 'these field types would bypass every refusal: ' + unhandled.join(', '))
})

test('EVERY mount-bound field is described as unwritable and REFUSES a write, naming the reason', async () => {
  // The other half of "the tool covers every setting": a field a live save cannot reach must be READABLE and must
  // refuse a write with the reason, or an agent is left believing it changed something. Driven from the schema, so a
  // field that becomes mount-bound later is covered without touching this test.
  const tool = createConfigTool({ read: () => ({}), write: async () => {}, record: () => {}, schema: () => Config.dict })
  const out = await tool.execute({ action: 'list' })
  const mountBound = Object.keys(Config.dict).filter((field) => Config.dict[field].meta?.volatile !== true)
  assert.ok(mountBound.length > 0, 'a vacuous test is worse than none; found: ' + mountBound.join(', '))
  for (const field of mountBound) {
    assert.equal(out.schema[field].writable, false, field + ' must be described as unwritable')
    await assert.rejects(() => tool.execute({ action: 'set', knob: field, value: 'anything' }), /mount-bound/,
      field + ' must refuse a write, naming why')
    assert.equal((await tool.execute({ action: 'get', knob: field })).knob, field, field + ' must still be readable')
  }
})

test('THE DESCRIPTOR COVERS THE PLUGIN SCHEMA EXACTLY -- the ratchet for "the tool covers every setting"', async () => {
  // Digested from the real schema, so a field added there shows up in `list` with no change to this file; what this
  // asserts is that the two SETS agree, which is what "the agent tool covers all the settings" has to mean to be
  // checkable. The digest is a view of the schema, never a second copy of it.
  const tool = createConfigTool({ read: () => ({}), write: async () => {}, record: () => {}, schema: () => Config.dict })
  const out = await tool.execute({ action: 'list' })
  const fields = Object.keys(Config.dict)
  assert.deepEqual(Object.keys(out.schema).sort(), [...fields].sort(), 'every field of the plugin schema is a knob')
  for (const field of fields) {
    assert.equal(out.schema[field].writable, Config.dict[field].meta?.volatile === true,
      `${field}'s reported writability must match the schema's own flag, not a second opinion`)
  }
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

