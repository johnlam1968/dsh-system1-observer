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

test('THE VOCABULARY AND THE THRESHOLD ARE THE ROW\u2019S, AND THEY ARE READ LIVE', () => {
  // The behavioural half of the read-ratchet in test/schema.test.js, which can only see that a name is READ
  // SOMEWHERE -- it passed once on a wiring that sat inside an object nothing called. This asserts the other half:
  // that changing the row's configuration changes the label, on the next call, with no re-construction.
  let threshold = 0.5
  let markers = []
  const service = createObserverService({
    read: () => ({ events: [], truncated: false }),
    runs: () => [],
    sessions: () => ({ live: [], configured: null }),
    config: () => ({}),
    vocabulary: () => ({ markers, stopwords: [] }),
    threshold: () => threshold,
  })
  const recurs = { request: 'alpha beta gamma', next: 'alpha beta delta' }
  assert.equal(service.label(recurs).label, true, 'two of three content words shared is above the shipped 0.5')
  threshold = 0.99
  assert.equal(service.label(recurs).label, false, 'the LIVE threshold decides, not the one at construction')
  threshold = 0.5
  // AND THE VOCABULARY, on a pair that shares nothing, so only a marker can carry the label.
  const corrects = { request: 'summarise the deployment logs', next: 'scrap that and start over' }
  assert.equal(service.label(corrects).label, false, 'with no marker configured this is not a nudge')
  markers = ['scrap that']
  assert.equal(service.label(corrects).label, true, 'and the live marker makes it one')
  assert.deepEqual(service.label(corrects).signals.marker, 'scrap that', 'the reason names the marker that fired')
})

test('the service is frozen, named, and exposes exactly the four readers', () => {
  const service = createObserverService(readers())
  assert.equal(OBSERVER_SERVICE, 'system1Observer')
  assert.equal(Object.isFrozen(service), true)
  assert.deepEqual(Object.keys(service).sort(), ['config', 'label', 'read', 'replay', 'runs', 'sessions'])
})

test('a non-function member is refused rather than exposed as a broken method', () => {
  assert.throws(() => createObserverService({ ...readers(), read: 'not a function' }), /`read` must be a function/)
  assert.throws(() => createObserverService({}), /`read` must be a function/)
})

test('`label` and `replay` are optional, and a wrong one is refused rather than silently replaced', () => {
  // They default to the repository's own derivation, and that default is the point -- "a label that differs per
  // caller is not a label". What was missing is the other half: a consumer's non-function override used to be
  // DISCARDED in favour of the default, so a typo became a behaviour change with nothing to notice it.
  assert.throws(() => createObserverService({ ...readers(), label: 'nudge' }), /`label` must be a function when given/)
  assert.throws(() => createObserverService({ ...readers(), replay: 7 }), /`replay` must be a function when given/)
  const defaults = createObserverService(readers())
  assert.equal(typeof defaults.label, 'function', 'omitting them keeps the documented default')
  assert.equal(typeof defaults.replay, 'function')
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
