// THE SINK, AND WHAT A MOUNT-BOUND SETTING COSTS. The plan's section 4 wanted a trace-path change recorded in the sink
// being LEFT as well as the new one. That property is UNREACHABLE while `tracePath` is mount-bound, and this test
// used to enshrine the opposite: it drove `set tracePath` through the tool and required a `config` line in the old
// sink. But the settings host refuses a write to a non-volatile field, so that route could only ever fail at the
// editor -- AFTER the tool had written a line recording a change that never landed. The refusal now comes before the
// record, and this pins that, naming what would make the original property reachable again: `docs/settings.md` §4
// item 9, a reopen-and-rotate story for the trace path.
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

  // THE REFUSAL COMES FIRST, AND THAT IS THE FIX. A line written for a change that cannot land is a measurement of
  // something that did not happen -- which is what the old assertion here required, one layer down.
  await assert.rejects(() => tool.execute({ action: 'set', knob: 'tracePath', value: newPath }), /mount-bound/)
  assert.equal(existsSync(newPath), false, 'nothing was created at the new path by this call')
  assert.deepEqual(readLines(oldPath).filter((line) => line.event === 'config'), [],
    'and nothing recorded a move that could not land')

  // IT IS STILL A KNOB: "the tool covers all settings" means every field can be READ, and only the writable ones can
  // be written. A mount-bound field that vanished from the tool would be a setting the agent cannot see at all.
  const read = await tool.execute({ action: 'get', knob: 'tracePath' })
  assert.equal(read.value, oldPath, 'a mount-bound setting is readable')
})
