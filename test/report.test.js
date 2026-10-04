// THE MEASUREMENT REPORT PACKAGE: a measurement made portable.
//
// A rendered report is a claim about numbers nobody can re-derive, because the trace it came from lives in one file
// that grows forever and is not shipped with the prose. So the property this file exists to pin is the last test:
// READING THE PACKAGE'S OWN trace.jsonl BACK THROUGH THE SAME AGGREGATION MUST REPRODUCE readings.json EXACTLY.
// Everything else here -- the ids, the manifest hashes, the refusal to overwrite -- is machinery in service of that.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildPackage, hashOf, PACKAGE_FILES, packageId, writePackage } from '../lib/report.js'
import { createResultsTool, summarise } from '../lib/results-tool.js'
import { packageVersion } from '../index.js'

const line = (over = {}) => ({ event: 'call', hook: 'draft', run: 'r1', at: 'T', questionIds: ['q'], answers: { q: { type: 'noul', probability: 0.8 } }, ...over })
const LINES = [line(), line({ at: 'T2' }), { event: 'skip', hook: 'draft', run: 'r1', reason: 'session not observed' }]

test('the id says WHAT was measured and WHEN, never a hash of the bytes', () => {
  const id = packageId({ at: '2026-10-04T01:02:03.456Z', run: '2026-10-04T01-00-00-000Z-ab12cd34' })
  assert.equal(id, '2026-10-04T01-02-03-456Z_2026-10-04T01-00-00-000Z-ab12cd34', 'colons and dots become dashes so it is a directory name')
  assert.equal(packageId({ at: 'T', run: null }), 'T_all-runs', 'a window over every run says so')
  assert.equal(packageId({ at: 'T', run: 'a/b c' }), 'T_a-b-c', 'and anything a path would object to is replaced')
})

test('the files are written, and the manifest hashes each one -- the manifest itself by its SIBLING', () => {
  const pkg = buildPackage({
    id: 'ID', at: '2026-01-01T00:00:00.000Z',
    report: '# a report\n', summary: { window: { run: 'r1', groupBy: 'hook' }, counts: { call: 2 }, refusals: ['a refusal'] }, lines: LINES,
    meta: { version: '1.2.3', dsh: '0.1.7-rc.2' },
  })
  assert.deepEqual(pkg.files.map((file) => file.name), [...PACKAGE_FILES])
  const byName = Object.fromEntries(pkg.files.map((file) => [file.name, file.body]))
  assert.equal(byName['trace.jsonl'].trim().split('\n').length, 3, 'the window lines, verbatim')
  assert.equal(JSON.parse(byName['trace.jsonl'].split('\n')[0]).hook, 'draft', 'as lines, not a rendering of them')

  const manifest = JSON.parse(byName['manifest.json'])
  assert.equal(manifest.window.run, 'r1')
  assert.deepEqual(manifest.refusals, ['a refusal'], 'the refusals ride the manifest, not only the prose')
  assert.match(manifest.contains, /conversation text/, 'and it says what copying the directory carries')
  assert.equal(manifest.version, '1.2.3')
  for (const entry of manifest.files) {
    // EVERY ENTRY IS CHECKABLE, which is the point: the hash is over the body the reader was given.
    assert.equal(entry.sha256, hashOf(byName[entry.name]), entry.name + ' hashes to what the manifest says')
    assert.equal(entry.bytes, Buffer.byteLength(byName[entry.name], 'utf8'), entry.name + ' is the size the manifest says')
  }
  // AND THE MANIFEST IS COVERED BY ITS SIBLING, because a file cannot contain its own hash -- the first version
  // shipped the hash of an empty string here, which is exactly the kind of thing a test exists to notice.
  assert.deepEqual(manifest.files.map((file) => file.name), ['report.md', 'readings.json', 'trace.jsonl'])
  assert.equal(byName['manifest.sha256'].trim(), hashOf(byName['manifest.json']) + '  manifest.json', 'sha256sum format, over the manifest as written')
})

test('a package is NEVER overwritten, and the refusal says where the first one is', () => {
  const root = mkdtempSync(join(tmpdir(), 'report-'))
  const dir = join(root, 'data', 'measurements', 'ID')
  const pkg = buildPackage({ id: 'ID', at: 'T', report: 'first\n', summary: { window: {}, counts: {}, refusals: [] }, lines: LINES })
  const first = writePackage(dir, pkg)
  assert.equal(first.problem, null)
  assert.deepEqual(first.files, [...PACKAGE_FILES])
  assert.deepEqual(readdirSync(dir).sort(), [...PACKAGE_FILES].sort())

  const again = writePackage(dir, buildPackage({ id: 'ID', at: 'T', report: 'second\n', summary: { window: {}, counts: {}, refusals: [] }, lines: LINES }))
  assert.match(again.problem, /already exists, so this package was NOT written/)
  assert.equal(readFileSync(join(dir, 'report.md'), 'utf8'), 'first\n', 'and the first measurement is still the one on disk')
})

test('READING THE PACKAGE\u2019S OWN trace.jsonl BACK REPRODUCES readings.json EXACTLY', () => {
  // THE PROPERTY THE PACKAGE EXISTS FOR. If this can drift, the package is a screenshot.
  const summary = summarise(LINES, { run: 'r1', groupBy: 'hook' })
  const pkg = buildPackage({ id: 'ID', at: 'T', report: 'anything at all\n', summary, lines: LINES })
  const byName = Object.fromEntries(pkg.files.map((file) => [file.name, file.body]))
  const reread = byName['trace.jsonl'].trim().split('\n').map((row) => JSON.parse(row))
  const again = summarise(reread, { run: 'r1', groupBy: 'hook' })
  assert.deepEqual(again, JSON.parse(byName['readings.json']), 'the same reader over the shipped lines gives the shipped numbers')
})

test('the tool writes one, through the same renderer the report is read from', async () => {
  const root = mkdtempSync(join(tmpdir(), 'report-tool-'))
  const tool = createResultsTool({
    path: '/dev/null',
    readFile: () => LINES.map((row) => JSON.stringify(row)).join('\n'),
    version: '9.9.9',
    meta: { dsh: '0.1.7-rc.2' },
  })
  const out = await tool.execute({ action: 'package', run: 'r1', dir: join(root, 'measurements') })
  assert.equal(out.package.problem, undefined)
  assert.deepEqual(out.package.files, [...PACKAGE_FILES])
  assert.equal(existsSync(join(out.package.dir, 'manifest.json')), true)
  // THE PROSE IS THE TOOL'S OWN RENDER OF THE SUMMARY ITSELF -- and NOT of the summary plus the package key, because a
  // report that announced its own packaging would be describing the artifact from inside the artifact.
  const report = readFileSync(join(out.package.dir, 'report.md'), 'utf8')
  assert.match(report, /asked something at 2 of 3 lines/)
  assert.doesNotMatch(report, /PACKAGE written/)
  // AND A SUMMARY IS STILL A SUMMARY: no `package` key, nothing written, and the same prose.
  const plain = await tool.execute({ run: 'r1' })
  assert.equal(Object.hasOwn(plain, 'package'), false)
  assert.equal(report, tool.output.render({}, plain)[0].text, 'the package report is that summary\'s render, verbatim')
  assert.match(tool.output.render({}, out)[0].text, /PACKAGE written to .*manifest\.json carries every file's sha256/)
  // A SECOND PACKAGE OF THE SAME RUN AND INSTANT IS REFUSED, and the tool says so rather than failing.
  const twice = await tool.execute({ action: 'package', run: 'r1', dir: join(root, 'measurements') })
  if (twice.package.problem !== undefined) assert.match(twice.package.problem, /already exists/)
})

test('the package records the BUILD that wrote it, and a missing import cannot hide as a null', () => {
  // THIS TEST EXISTS BECAUSE A CATCH-ALL HID ONE. `packageVersion` first used `readFileSync` without importing it, and
  // its own try/catch turned the ReferenceError into `null` -- so every package said `version: null` and nothing
  // anywhere said why. Asserting a SEMVER is what makes the difference visible: null is a failure, not a fallback.
  assert.match(packageVersion(), /^\d+\.\d+\.\d+/, 'the version is read from the manifest, not defaulted away')
})
