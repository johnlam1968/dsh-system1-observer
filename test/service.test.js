// THE SERVICE OTHER PLUGINS READ FROM. The interesting assertions are not that the methods exist -- they are that
// the surface cannot write, and that a full sweep leaves the trace's bytes identical. A read-only service that is
// only *declared* read-only is the kind of claim this repository keeps catching.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createObserverService, OBSERVER_SERVICE } from '../lib/service.js'
import { readTraceWindow, runIds } from '../lib/trace-report.js'

// A path is threaded through because `runs()` takes no arguments and the reader underneath needs one --
// the same asymmetry the real row resolves by closing over `evidence.path`.
const readers = (path) => ({
  read: (options) => readTraceWindow(options?.path ?? path),
  runs: () => runIds(readTraceWindow(path).events ?? []),
  sessions: () => ({ live: [], configured: null }),
  config: () => ({ hooks: [] }),
})

test('the service is frozen, named, and exposes exactly the four readers', () => {
  const service = createObserverService(readers())
  assert.equal(OBSERVER_SERVICE, 'system1Observer')
  assert.equal(Object.isFrozen(service), true)
  assert.deepEqual(Object.keys(service).sort(), ['config', 'read', 'runs', 'sessions'])
})

test('a non-function member is refused rather than exposed as a broken method', () => {
  assert.throws(() => createObserverService({ ...readers(), read: 'not a function' }), /`read` must be a function/)
  assert.throws(() => createObserverService({}), /`read` must be a function/)
})

test('a full sweep of every method leaves the trace file byte-identical', () => {
  const dir = mkdtempSync(join(tmpdir(), 'observer-service-'))
  const path = join(dir, 'trace.jsonl')
  const line = (event, fields) => JSON.stringify({ event, at: '2026-09-30T00:00:00.000Z', ...fields })
  writeFileSync(path, [
    line('mount', { hooks: ['admit'], sessions: ['session-a'] }),
    line('call', { hook: 'admit', agentId: 'session-a' }),
    line('skip', { hook: 'draft', reason: 'session not observed' }),
  ].join('\n') + '\n')
  const before = readFileSync(path)
  const service = createObserverService(readers(path))
  // Every method, called the way a consumer would.
  service.read({ path })
  service.runs()
  service.sessions()
  service.config()
  assert.deepEqual(readFileSync(path), before, 'the service must not touch what it reads')
})

test('the readers a consumer gets back are the ones the repository already has', () => {
  const dir = mkdtempSync(join(tmpdir(), 'observer-service-'))
  const path = join(dir, 'trace.jsonl')
  writeFileSync(path, JSON.stringify({ event: 'mount', at: '2026-09-30T00:00:00.000Z', run: 'r-1' }) + '\n')
  const service = createObserverService({ ...readers() })
  const window = service.read({ path })
  assert.equal(Array.isArray(window.events), true)
  assert.equal(window.events[0].event, 'mount')
})
