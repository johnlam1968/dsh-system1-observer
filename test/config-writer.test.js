// THE WRITE. The property that matters is that it MERGES: `edit` asks for the row's next config, so returning a
// fresh object containing one knob would persist a row that lost every other setting -- silently, with no error.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createConfigWriter, entryIdOf } from '../lib/config-writer.js'
import { createConfigTool } from '../lib/config-tool.js'

/** A configEditor that holds one row's config and answers the way the service does. */
function editor({ rows = [{ id: 'system1-observer' }], config = { hooks: ['admit'], provider: 'typesafe' }, fail = null } = {}) {
  const edits = []
  return {
    edits,
    state: () => ({ ...config }),
    entries: () => rows,
    async edit(entry, change) {
      edits.push({ row: entryIdOf(entry) })
      if (fail !== null) throw new Error(fail)
      const next = change(config, {})
      Object.keys(config).forEach((key) => { if (!(key in next)) delete config[key] })
      Object.assign(config, next)
    },
  }
}

test('an entry id is read tolerantly, and junk is empty rather than a guess', () => {
  assert.equal(entryIdOf({ id: 'a' }), 'a')
  assert.equal(entryIdOf({ patchId: 'b' }), 'b')
  assert.equal(entryIdOf({ name: 'c' }), 'c')
  assert.equal(entryIdOf({ options: { id: 'd' } }), 'd')
  assert.equal(entryIdOf(null), '')
  assert.equal(entryIdOf({ nothing: true }), '')
})

test('a change MERGES into the row, so the settings it did not touch survive', async () => {
  const e = editor()
  const write = createConfigWriter({ editor: e, rowId: 'system1-observer' })
  await write({ knob: 'provider', value: 'laya' })
  assert.deepEqual(e.state(), { hooks: ['admit'], provider: 'laya' }, 'hooks must not be lost')
  assert.deepEqual(e.edits, [{ row: 'system1-observer' }], 'and it edited THIS row')
})

test('a row that cannot be addressed is refused, naming what was available', async () => {
  const write = createConfigWriter({ editor: editor({ rows: [{ id: 'other-row' }] }), rowId: 'system1-observer' })
  await assert.rejects(() => write({ knob: 'provider', value: 'laya' }), /no row with id "system1-observer"; available: other-row/)
})

test('an editor that cannot edit, or no row id, is refused at construction', () => {
  assert.throws(() => createConfigWriter({ editor: {}, rowId: 'r' }), /must be the configEditor service/)
  assert.throws(() => createConfigWriter({ editor: { edit: () => {} }, rowId: 'r' }), /has no `entries`/)
  assert.throws(() => createConfigWriter({ editor: editor(), rowId: '  ' }), /`rowId` is required/)
})

test('a rejected edit propagates rather than silently doing nothing', async () => {
  const write = createConfigWriter({ editor: editor({ fail: 'the loader refused' }), rowId: 'system1-observer' })
  await assert.rejects(() => write({ knob: 'provider', value: 'laya' }), /the loader refused/)
})

test('the tool and the writer together: the record is written, then the row changes', async () => {
  const e = editor()
  const order = []
  const tool = createConfigTool({
    read: () => e.state(),
    record: () => order.push('record'),
    write: async (change) => { order.push('edit'); return createConfigWriter({ editor: e, rowId: 'system1-observer' })(change) },
    knobs: ['provider'],
  })
  const out = await tool.execute({ action: 'set', knob: 'provider', value: 'laya' })
  assert.deepEqual(order, ['record', 'edit'])
  assert.deepEqual(out, { knob: 'provider', from: 'typesafe', value: 'laya', recorded: true })
  assert.equal(e.state().provider, 'laya')
  assert.deepEqual(e.state().hooks, ['admit'], 'the wiring did not cost the row its other settings')
})
