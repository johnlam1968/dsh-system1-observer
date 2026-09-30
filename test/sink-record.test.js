// THE SINK BEING LEFT. The plan's section 4 requires that a trace-path change is written to the sink being LEFT as
// well as the new one, so that moving the record leaves a record of the move. It holds because `evidence` is built at
// MOUNT while the live config reads only the cap, price and the knobs -- a property a refactor could remove without
// noticing. This test is what makes that removal fail loudly.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../index.js'

const accessor = (value) => ({ get: () => value })
const readLines = (path) => {
  if (!existsSync(path)) return []
  const text = readFileSync(path, 'utf8').trim()
  return text === '' ? [] : text.split('\n').map((line) => JSON.parse(line))
}

test("a trace-path change is RECORDED IN THE SINK BEING LEFT, not in the one it creates", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sink-record-'))
  const oldPath = join(dir, 'old.jsonl')
  const newPath = join(dir, 'new.jsonl')
  const registered = []
  const handlers = new Map()
  const ctx = {
    handlers,
    on(event, handler) { const list = handlers.get(event) ?? []; list.push(handler); handlers.set(event, list); return () => {} },
    // The tools callback fires, because this test is about the tool's record, not about registration.
    inject(deps, callback) { if (Array.isArray(deps) && deps.includes('tools')) callback({ get: () => ({ register: (t) => { registered.push(t); return () => {} } }) }) },
    provide: () => () => {},
    get: () => undefined,
    agents: { currentInitiator: () => ({ id: 'agent-1' }) },
  }
  await apply(ctx, {
    hooks: accessor(['admit']),
    tracePath: accessor(oldPath),
    sessions: accessor(['*']),
    turnEveryNTurns: accessor(0),
    wireUrl: accessor('http://127.0.0.1:9'),
    timeoutMs: accessor(200),
  })

  const tool = registered.find((definition) => definition.name === 'system1_observe_config')
  assert.notEqual(tool, undefined, 'the settings tool is registered')

  // No `configEditor` is injected here, so the WRITE cannot be persisted -- and that is the point: the RECORD must
  // already have been written, to the sink the row is still pointing at.
  await assert.rejects(() => tool.execute({ action: 'set', knob: 'tracePath', value: newPath }), /configEditor/)
  assert.equal(existsSync(newPath), false, 'nothing was created at the new path by this call')

  const lines = readLines(oldPath)
  const configLines = lines.filter((line) => line.event === 'config')
  assert.equal(configLines.length, 1, 'the move is recorded in the sink being LEFT')
  assert.equal(configLines[0].knob, 'tracePath')
  assert.equal(configLines[0].to, newPath)
  assert.equal(configLines[0].from, oldPath, 'and it says where the record came from')
})
