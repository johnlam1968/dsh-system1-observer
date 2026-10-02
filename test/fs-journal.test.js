// THE TWO PROPERTIES THE HARNESS ASKS OF THIS LISTENER, tested rather than commented: it is SYNCHRONOUS (returns
// nothing for the harness to await) and a THROW CANNOT ESCAPE IT (the harness's own words: "throws fail the tool
// call"). The hostile payload exists to make the second FALSIFIABLE -- without a guard the getter would throw
// straight through and break an agent's filesystem call.
//
// THIS TEST IS ALSO THE REASON THE CLAIM CHECK STOPPED ASSERTING A COUNT OF `try` BLOCKS: a grep for the presence of
// a guard is a proxy for a fact this establishes by running it, and the proxy failed on correct code.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../index.js'
import { createFsJournal } from '../lib/host/fs-journal.js'

const accessor = (value) => ({ get: () => value })
const target = (p) => ({ targetKey: 'k', displayPath: p })

test('the journal records positive and negative observations, newest verdict last, and stays bounded', () => {
  const j = createFsJournal({ maxPaths: 2, maxPerPath: 2 })
  assert.equal(j.record(target('/a.txt'), { kind: 'present', version: 'v1' }, null), true)
  assert.equal(j.record(target('/a.txt'), { kind: 'absent' }, null), true)
  assert.equal(j.verdictFor('/a.txt'), 'absent', 'the newest wins -- there and now gone is absent')
  assert.deepEqual(j.observationsFor('/a.txt').map((o) => o.kind), ['present', 'absent'])
  assert.deepEqual(j.observationsFor('/never-seen'), [], 'an unknown path is an empty list, never undefined')
  assert.equal(j.verdictFor('/never-seen'), null, 'and nothing observed is null, not a guess')
  j.record(target('/a.txt'), { kind: 'present', version: 'v2' }, null)
  assert.equal(j.observationsFor('/a.txt').length, 2, 'per-path bound holds')
  j.record(target('/b.txt'), { kind: 'present', version: 'v1' }, null)
  j.record(target('/c.txt'), { kind: 'present', version: 'v1' }, null)
  assert.equal(j.size(), 2, 'path bound holds')
  assert.equal(j.observationsFor('/a.txt').length, 0, 'and the oldest path went first')
})

test('junk is refused rather than recorded, and never thrown on', () => {
  const j = createFsJournal()
  assert.equal(j.record(null, { kind: 'present' }, null), false)
  assert.equal(j.record(target(''), { kind: 'present' }, null), false)
  assert.equal(j.record(target('/x'), { kind: 'maybe' }, null), false)
  assert.equal(j.record(target('/x'), null, null), false)
  assert.equal(j.size(), 0, 'nothing was recorded by any of them')
})

test('the fs/observed listener is SYNCHRONOUS and a throw cannot escape it', async () => {
  const tracePath = join(mkdtempSync(join(tmpdir(), 'fs-journal-')), 'trace.jsonl')
  const agent = { id: 'session-a', session: { snapshotEvents: () => [] } }
  const handlers = new Map()
  const ctx = {
    on(event, handler) { const list = handlers.get(event) ?? []; list.push(handler); handlers.set(event, list); return () => {} },
    inject() {}, provide: () => () => {},
    get: (name) => (name === 'agents' ? { get: () => agent, list: () => [agent] } : undefined),
    agents: { currentInitiator: () => agent },
  }
  await apply(ctx, { hooks: accessor(['admit']), tracePath: accessor(tracePath), sessions: accessor(['*']), turnEveryNTurns: accessor(0), questions: { turn: [] } })
  const listener = handlers.get('fs/observed')?.[0]
  assert.equal(typeof listener, 'function', 'the row subscribes the harness signal')
  assert.equal(listener(target('/real.txt'), { kind: 'present', version: 'v1' }, {}), undefined, 'SYNCHRONOUS: nothing for the harness to await')

  const hostile = { targetKey: 'k', get displayPath() { throw new Error('boom') } }
  assert.doesNotThrow(() => listener(hostile, { kind: 'present', version: 'v1' }, {}), 'a throw must not escape: the harness fails the tool call')
  assert.equal(listener(hostile, { kind: 'present', version: 'v1' }, {}), undefined, 'and it still returns nothing')
  assert.doesNotThrow(() => listener(undefined, undefined, undefined), 'nor on no arguments at all')
})

// THE CAP IS READ ON EVERY RECORD, which is what makes `fsJournalMaxPaths` volatile rather than a promise. The
// per-path cap goes through the same resolver in the module, so this asserts the shape once rather than twice: a
// lowered cap applies on the next observation, and cannot bring back what the old cap already dropped.
test('the path cap is read on every record, so a live change reaches a running journal', () => {
  let cap = 2
  const journal = createFsJournal({ maxPaths: () => cap })
  // THE TARGET IS THE OBJECT THE JOURNAL READS, not a path string: `record` never throws by design, so a wrong
  // shape records nothing and a bare string made this test measure zero. That is what the first version asserted
  // against, and the fix belongs here rather than in the assertion.
  journal.record(target('/a.txt'), { kind: 'present', version: 'v1' }, {})
  journal.record(target('/b.txt'), { kind: 'present', version: 'v1' }, {})
  journal.record(target('/c.txt'), { kind: 'present', version: 'v1' }, {})
  assert.equal(journal.paths().length, 2, 'the cap held while it was 2')
  cap = 1
  journal.record(target('/d.txt'), { kind: 'present', version: 'v1' }, {})
  assert.equal(journal.paths().length, 1, 'a lowered cap applies on the next record, not on a rebuild')
})
