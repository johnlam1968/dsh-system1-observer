// THE SINK: THE REDACTION CHOKE POINT, THE BOUND, AND THE FILE MODE.
//
// Every line of every event passes through here, so this is where redaction has to be true even for a writer
// that forgot. The other two properties -- rotation and 0600 -- are the ones the live file was missing: it was
// world-readable and unbounded, with thousands of unredacted call lines in it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createEvidence } from '../lib/evidence.js'

function sink(options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'observer-evidence-'))
  const path = join(dir, 'trace.jsonl')
  const evidence = createEvidence({ defaultPath: path, envVar: 'SYSTEM1_OBSERVER_TEST_TRACE_UNSET', ...options })
  return { evidence, path, dir }
}

const lines = (path) => readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))

// THE CHOKE POINT. A writer that hands over an unredacted object still gets a redacted line, because the sink
// sanitizes rather than trusting each caller -- and it deep-clones, so the line cannot mutate what the model holds.
test('a line is redacted at the sink even when the writer did nothing', () => {
  const { evidence, path } = sink()
  const handed = { hook: 'draft', excerpt: 'x', api_key: 'sk-abcdefghijklmnop1234', nested: { token: 'abc' } }
  evidence.trace('call', handed)
  const [line] = lines(path)
  assert.equal(line.api_key, '[REDACTED]')
  assert.equal(line.nested.token, '[REDACTED]')
  assert.equal(line.excerpt, 'x', 'ordinary fields are untouched')
  assert.equal(handed.api_key, 'sk-abcdefghijklmnop1234', 'and the writer keeps what it built')
})

// The sink takes its policy from a GETTER, so a settings change reaches a running row with no restart. Capturing
// it once is the bug this shape exists to prevent: measured earlier in this repository, a captured value made
// every settings save a no-op that the card still reported as "Saved."
test('the redaction policy is read per line, so flipping it off takes effect immediately', () => {
  let enabled = true
  const { evidence, path } = sink({ policy: () => ({ redactEnabled: enabled, redactKeys: [] }) })
  evidence.trace('call', { token: 'sk-abcdefghijklmnop1234' })
  enabled = false
  evidence.trace('call', { token: 'sk-abcdefghijklmnop1234' })
  const [first, second] = lines(path)
  assert.equal(first.token, '[REDACTED]')
  assert.equal(second.token, 'sk-abcdefghijklmnop1234', 'the live switch took effect on the very next line')
})

// A CYCLE IS AN OBSERVATION-LOSS BUG. The sink degrades a throwing field thunk to `fields_unavailable`, so a
// cyclic value would otherwise cost the whole observation rather than just the secret.
test('a circular field yields a line, not fields_unavailable', () => {
  const { evidence, path } = sink()
  const cyclic = { hook: 'draft' }
  cyclic.self = cyclic
  evidence.trace('call', cyclic)
  const [line] = lines(path)
  // The line object is a COPY, so the original cycle shows up one level down and is cut there. What matters is
  // that the line exists, is finite, and says where the cycle was.
  assert.match(JSON.stringify(line), /\[circular\]/)
  assert.ok(JSON.stringify(line).length < 500, 'and it is bounded rather than expanded')
  assert.equal(Object.hasOwn(line, 'fields_unavailable'), false)
  assert.equal(line.event, 'call', 'the event itself is still recorded')
})

test('a throwing field thunk still produces a line, carrying the reason', () => {
  const { evidence, path } = sink()
  evidence.trace('call', () => { throw new Error('boom') })
  const [line] = lines(path)
  assert.equal(line.fields_unavailable, 'boom')
  assert.equal(line.event, 'call')
})

test('a new file is created mode 600, not 644', () => {
  const { evidence, path } = sink()
  evidence.trace('mount', { hooks: [] })
  assert.equal(statSync(path).mode & 0o777, 0o600)
})

test('a file an earlier version created world-readable is tightened on the first line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'observer-mode-'))
  const path = join(dir, 'trace.jsonl')
  writeFileSync(path, '', { mode: 0o644 })
  const evidence = createEvidence({ defaultPath: path, envVar: 'SYSTEM1_OBSERVER_TEST_TRACE_UNSET' })
  evidence.trace('mount', { hooks: [] })
  assert.equal(statSync(path).mode & 0o777, 0o600)
})

// THE BOUND IS A LINE. Upstream has three counters nothing can read; in a JSONL file the counter has to BE a
// line or it inherits exactly that fate.
test('crossing the cap rotates, archives, and says so in the new file', () => {
  const { evidence, path, dir } = sink({ maxBytes: () => 400 })
  for (let i = 0; i < 40; i += 1) evidence.trace('call', { hook: 'draft', excerpt: 'x'.repeat(40), i })
  const rotations = evidence.rotations()
  assert.ok(rotations.count > 0, 'the cap fired')
  const archived = readdirSync(dir).filter(name => name !== 'trace.jsonl')
  assert.equal(archived.length, rotations.count, 'one archive per rotation')
  // The ACTIVE file keeps its name, so every reader that captured `path` keeps following the live file.
  const first = lines(path)[0]
  assert.equal(first.event, 'rotate')
  assert.equal(first.opened, path)
  assert.match(first.closed, /trace\..*\.[0-9]+\.jsonl$/, 'the archive names the run and the rotation, in that order')
  assert.ok(first.bytes > 0)
  assert.ok(first.lines > 0, 'and it says how many lines it closed')
  assert.equal(statSync(path).mode & 0o777, 0o600, 'the new active file is 600 too')
  for (const name of archived) assert.equal(statSync(join(dir, name)).mode & 0o777, 0o600)
})

// A SECOND ROTATION MUST NOT OVERWRITE THE FIRST ARCHIVE: that is not a bound, it is data loss wearing a
// bound's name.
test('each rotation gets its own archive', () => {
  const { evidence, dir } = sink({ maxBytes: () => 300 })
  for (let i = 0; i < 60; i += 1) evidence.trace('call', { excerpt: 'y'.repeat(30), i })
  assert.ok(evidence.rotations().count >= 2, 'the cap fired more than once')
  const archives = readdirSync(dir).filter(name => name !== 'trace.jsonl')
  assert.equal(new Set(archives).size, archives.length, 'no archive was overwritten')
  assert.equal(archives.length, evidence.rotations().count)
})

// A CAP SMALLER THAN A LINE CANNOT BE HONOURED. Without the guard the rotate line's own size pushes the fresh
// file back over the cap, and every line costs a rename: measured at 38 rotations for 40 lines before the fix.
test('a cap below what a line costs still writes lines rather than thrashing', () => {
  const { evidence, path, dir } = sink({ maxBytes: () => 200 })
  for (let i = 0; i < 30; i += 1) evidence.trace('call', { excerpt: 'w'.repeat(40), i })
  // EVERY ARCHIVE IS READ, not just the active file: a rotate line is archived with the file it describes, so
  // counting them in the live file alone counts only the most recent one.
  const everyLine = ['trace.jsonl', ...readdirSync(dir).filter(name => name !== 'trace.jsonl')]
    .flatMap(name => lines(join(dir, name)))
  assert.ok(everyLine.filter(line => line.event === 'call').length === 30, 'every observation was written')
  assert.equal(everyLine.filter(line => line.event === 'rotate').length, evidence.rotations().count, 'and every rotation is a line')
  assert.ok(evidence.rotations().count <= 30, 'at most one rotation per line, so no thrash')
})

test('rotation is off at zero, and nothing is archived', () => {
  const { evidence, path } = sink({ maxBytes: () => 0 })
  for (let i = 0; i < 20; i += 1) evidence.trace('call', { excerpt: 'z'.repeat(50), i })
  assert.equal(evidence.rotations().count, 0)
  assert.equal(lines(path).filter(line => line.event === 'rotate').length, 0)
  assert.equal(lines(path).length, 20)
})

// THE POSTURE IS ON EVERY LINE, FROM THE SINK, so a future writer cannot forget it -- and it is written BEFORE
// the caller's fields, so a caller cannot clobber it either.
test('every line carries the enforcement posture, and a caller cannot overwrite it', () => {
  const { evidence, path } = sink()
  evidence.trace('mount', { hooks: [] })
  evidence.trace('call', { enforcement: 'verified', verified: true, excerpt: 'x' })
  const [mount, call] = lines(path)
  for (const line of [mount, call]) {
    assert.equal(line.enforcement, 'declarative', 'how the invariant is enforced: the code shape')
    assert.equal(line.verified, false, 'and that nobody has observed it holding')
  }
})

// THE TEST THAT SHOULD HAVE EXISTED FIRST, and the reason the reviewer session went looking for it.
//
// Both rotation tests above assert a LOWER bound (`> 0`, `>= 2`). Neither would fail if the thrash guard were
// deleted, and neither failed when it was: measured, 40 lines at a 400-byte cap gave 39 rotations and 39 archives
// WITH the guard, because the `rotate` line is itself larger than such a cap. So the property the guard's comment
// claimed -- "bounds it" -- had no test at all, and did not hold.
test('a cap too small to hold its own rotation record is raised, not thrashed', () => {
  const { evidence, dir } = sink({ maxBytes: () => 400 })
  for (let i = 0; i < 40; i += 1) evidence.trace('call', { hook: 'draft', excerpt: 'x'.repeat(40), i })
  const count = evidence.rotations().count
  assert.ok(count > 0, 'the cap still fires: the record is worth more than the bound')
  // The bound is the whole point. One rename per line is a filesystem cost with no reader benefit, and an archive
  // holding a single body line is not a rotation anyone asked for.
  assert.ok(count <= 5, `40 lines must not produce one archive per line (got ${count})`)
  assert.ok(readdirSync(dir).length - 1 <= 5, 'and not one archive per line either')
})

// AND THE FLOOR IS A FLOOR, NOT A REPLACEMENT: a cap above it is honoured exactly.
test('a cap above the floor is honoured as given', () => {
  const big = sink({ maxBytes: () => 65536 })
  for (let i = 0; i < 40; i += 1) big.evidence.trace('call', { hook: 'draft', excerpt: 'x'.repeat(40), i })
  assert.equal(big.evidence.rotations().count, 0, '64 KB is not crossed by 40 small lines')

  const tiny = sink({ maxBytes: () => 0 })
  for (let i = 0; i < 40; i += 1) tiny.evidence.trace('call', { hook: 'draft', excerpt: 'x'.repeat(40), i })
  assert.equal(tiny.evidence.rotations().count, 0, '0 still means NO cap, not the floor')
})
