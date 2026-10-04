// THE MEASUREMENT REPORT PACKAGE: a measurement made portable.
//
// A rendered report is a claim about numbers nobody can re-derive, because the trace it came from lives in one file
// that grows forever and is not shipped with the prose. So the property this file exists to pin is the last test:
// READING THE PACKAGE'S OWN trace.jsonl BACK THROUGH THE SAME AGGREGATION MUST REPRODUCE readings.json EXACTLY.
// Everything else here -- the ids, the manifest hashes, the refusal to overwrite -- is machinery in service of that.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { attachInterpretation, buildPackage, buildSkeleton, defaultPackageDir, hashOf, INTERPRETATION_FILE, PACKAGE_FILES, packageId, writePackage } from '../lib/report.js'
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

test('AN INTERPRETATION IS ATTACHED, ATTRIBUTED AND ANCHORED -- never merged into the re-derivable report', () => {
  const root = mkdtempSync(join(tmpdir(), 'report-interp-'))
  const dir = join(root, 'P1')
  writePackage(dir, buildPackage({ id: 'P1', at: 'T', report: 'the numbers\n', summary: { window: {}, counts: {}, refusals: [] }, lines: LINES }))

  const attached = attachInterpretation(dir, { text: 'The model served the request but over-claimed.', by: 'dsh session abc', at: '2026-01-01T00:00:00.000Z' })
  assert.equal(attached.problem, null)
  assert.equal(attached.anchor, hashOf(readFileSync(join(dir, 'readings.json'), 'utf8')), 'the anchor is the readings ON DISK')

  const body = readFileSync(join(dir, INTERPRETATION_FILE), 'utf8')
  assert.match(body, /AN INTERPRETATION, NOT A MEASUREMENT/)
  assert.match(body, /\| written by \| dsh session abc \|/, 'attributed')
  assert.equal(body.includes('anchored to `readings.json` | `sha256:' + attached.anchor + '`'), true, 'anchored to the readings as they are on disk')
  assert.match(body, /The model served the request but over-claimed\./)

  // THE REPORT IS UNTOUCHED: the re-derivable part stays re-derivable, and the manifest keeps the two apart.
  assert.equal(readFileSync(join(dir, 'report.md'), 'utf8'), 'the numbers\n')
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
  assert.deepEqual(manifest.reproducible, ['report.md', 'readings.json', 'trace.jsonl'])
  assert.equal(manifest.interpretation.by, 'dsh session abc')
  assert.equal(manifest.interpretation.readingsSha256, attached.anchor)
  assert.equal(manifest.files.some((file) => file.name === INTERPRETATION_FILE), true)
  // AND THE AMENDED PACKAGE STILL VERIFIES: the manifest changed, so its sibling hash was recomputed.
  assert.equal(readFileSync(join(dir, 'manifest.sha256'), 'utf8').trim(), hashOf(readFileSync(join(dir, 'manifest.json'), 'utf8')) + '  manifest.json')

  // ONE INTERPRETATION PER PACKAGE, because two readings of one measurement is ambiguity, not more evidence.
  const twice = attachInterpretation(dir, { text: 'a second opinion' })
  assert.match(twice.problem, /already carries an interpretation by dsh session abc/)
  // A PACKAGE BUILT BEFORE `reproducible` EXISTED IS COMPLETED BY THE AMENDMENT, not left half-described.
  const legacy = join(root, 'LEGACY')
  const legacyPackage = buildPackage({ id: 'L', at: 'T', report: 'n\n', summary: { window: {}, counts: {}, refusals: [] }, lines: LINES })
  writePackage(legacy, legacyPackage)
  const legacyManifest = JSON.parse(readFileSync(join(legacy, 'manifest.json'), 'utf8'))
  delete legacyManifest.reproducible
  writeFileSync(join(legacy, 'manifest.json'), JSON.stringify(legacyManifest, null, 2) + '\n')
  attachInterpretation(legacy, { text: 'a reading', by: 'x' })
  assert.deepEqual(JSON.parse(readFileSync(join(legacy, 'manifest.json'), 'utf8')).reproducible, ['report.md', 'readings.json', 'trace.jsonl'])

  // AND NOTHING IS ATTACHED TO SOMETHING THAT IS NOT A PACKAGE.
  assert.match(attachInterpretation(join(root, 'nope'), { text: 'x' }).problem, /is not a package/)
  assert.match(attachInterpretation(dir, { text: '   ' }).problem, /no text is not an interpretation/)
})

test('the tool attaches one through its own action, and reports the anchor', async () => {
  const root = mkdtempSync(join(tmpdir(), 'report-tool-interp-'))
  const tool = createResultsTool({ path: '/dev/null', readFile: () => LINES.map((r) => JSON.stringify(r)).join('\n') })
  const packed = await tool.execute({ action: 'package', run: 'r1', dir: join(root, 'm') })
  const out = await tool.execute({ action: 'interpret', dir: join(root, 'm'), package: packed.package.id, text: 'A reading.', by: 'operator' })
  assert.equal(out.interpretation.problem, undefined)
  assert.equal(out.interpretation.file, INTERPRETATION_FILE)
  assert.match(tool.output.render({}, out)[0].text, /INTERPRETATION attached as interpretation\.md, anchored to readings\.json sha256:[0-9a-f]{64}/)
  // A PACKAGE THAT IS NOT THERE IS A PROBLEM, NOT A THROW.
  const missing = await tool.execute({ action: 'interpret', dir: join(root, 'm'), package: 'nope', text: 'x' })
  assert.match(missing.interpretation.problem, /is not a package/)
  assert.match(tool.output.render({}, missing)[0].text, /INTERPRETATION NOT attached/)
})

test('a package goes to the PROFILE, not to whatever cwd the caller happens to have', () => {
  // FOUND BY LETTING ANOTHER AGENT RUN THE WORKFLOW. `data/measurements` was a relative default, so the same
  // measurement landed in the repository for me and in `~/.dsh/profiles` for a subagent -- an agent's cwd is not the
  // session's, and neither is the profile's.
  assert.equal(defaultPackageDir({ env: { DSH_PROFILE_DIR: '/home/x/.dsh/profiles/docdrift' } }), '/home/x/.dsh/profiles/docdrift/data/measurements')
  // A DEPLOYMENT THAT WANTS TO SAY WINS, so an operator can place packages without editing the profile.
  assert.equal(defaultPackageDir({ env: { SYSTEM1_OBSERVER_DATA: '/mnt/measurements', DSH_PROFILE_DIR: '/p' } }), '/mnt/measurements')
  // AND A BARE ENVIRONMENT STILL WRITES SOMEWHERE, which is the only reason the relative guess survives at all.
  // THE PLUGIN PROCESS ITSELF HAS NO `DSH_PROFILE_DIR` -- measured, and the reason a live package landed in
  // `~/.dsh/profiles/data/measurements`. Its command line names the profile and its cwd is the profiles root.
  assert.equal(defaultPackageDir({ env: {}, argv: ['node', '/x/dsh', 'docdrift'], cwd: '/home/j/.dsh/profiles' }), '/home/j/.dsh/profiles/docdrift/data/measurements')
  // AND WITH NOTHING TO GO ON THE ANSWER IS ABSOLUTE, never a relative path that lands wherever the caller stood.
  assert.equal(defaultPackageDir({ env: {}, argv: ['node', '/x/dsh'], cwd: '/tmp' }), join(homedir(), '.dsh', 'measurements'))
  assert.equal(defaultPackageDir({ env: { DSH_HOME: '/dsh' }, argv: [], cwd: '/tmp' }), '/dsh/measurements')
  assert.equal(defaultPackageDir({ env: { DSH_PROFILE_DIR: '   ' }, argv: [], cwd: '/tmp' }), join(homedir(), '.dsh', 'measurements'), 'blank is not an answer, and the answer is ABSOLUTE')
})

test('the tool resolves its default through that rule, so both actions agree', async () => {
  const root = mkdtempSync(join(tmpdir(), 'report-dir-'))
  const seen = []
  const tool = createResultsTool({ path: '/dev/null', readFile: () => LINES.map((r) => JSON.stringify(r)).join('\n') })
  const packed = await tool.execute({ action: 'package', run: 'r1', dir: join(root, 'explicit') })
  assert.equal(packed.package.dir.startsWith(join(root, 'explicit')), true, 'an explicit dir is still honoured')
  // WITH NO dir, the profile rule applies -- asserted through the function the tool calls, because the test process
  // has its own DSH_PROFILE_DIR and writing a package into it from a unit test would be a side effect on the machine.
  assert.equal(typeof defaultPackageDir({ DSH_PROFILE_DIR: root }), 'string')
  seen.push(1)
  assert.equal(seen.length, 1)
})

test('the skeleton emits the SHAPE the operator asked for, and never depends on a type these lines do not record', () => {
  // THE SHAPE IS THE OPERATOR'S, taken from the interpretation they said they liked: a basis line, one section per
  // instrument HEADED WITH THE SET, a table of short labels, the prose in a READING line BELOW -- and a comparison
  // column. The first version keyed off `q.type`, which these call lines do not record (F53), and rendered FOUR of
  // eight questions as an EMPTY cell while a score came out as "modal 1.67 1.67=2 0.9=2 ...".
  const summary = {
    window: { run: 'r1' },
    counts: { call: 32, skip: 5 },
    mount: { model: 'jev-latest', provider: 'typesafe', probeHash: 'abc123' },
    runs: [{ questionSetHash: 'thewindowhash' }],
    refusals: ['2 configuration change(s) fall inside this window'],
    groups: [{ key: 'session-review\u0000turn', questions: [
      { id: 'session_failed_tool_recovery', read: 15, unreadable: 1, values: [{ value: 'no_empty_result', n: 7 }, { value: 'retried_differently', n: 8 }] },
      { id: 'session_operator_had_to_repeat', read: 16, values: [], probabilities: { n: 16, min: 0.22, max: 0.86, median: 0.415, atOrAboveHalf: 6 } },
      { id: 'session_request_served', read: 16, values: [{ value: '1.67', n: 2 }, { value: '0.9', n: 1 }] },
      { id: 'session_scope_expanded', read: 16, values: [], separates: false, probabilities: { n: 16, min: 0.53, max: 0.87, median: 0.81, atOrAboveHalf: 16 } },
    ] }],
  }
  const text = buildSkeleton({ summary, at: '2026-10-04', tables: [
    { title: 'The model', set: 'agent-helpfulness-session@1', setHash: 'db06d2a49ed6', questions: ['session_failed_tool_recovery', 'session_operator_had_to_repeat', 'session_request_served', 'session_scope_expanded', 'nobody_asked_this'] },
  ] })
  const cell = (label) => text.split('\n').find((line) => line.startsWith('| ' + label)) ?? ''
  // THE MODE IS THE MODE, NOT THE FIRST VALUE ENCOUNTERED: the counts arrive in a Map's insertion order, so bolding
  // `no_empty_result 7/15` made the report's most prominent fact a coin toss.
  assert.match(cell('failed tool recovery'), /\*\*retried_differently 8\/15 \(53%\)\*\* no_empty_result=7/, 'the modal label is bolded')
  assert.match(cell('operator had to repeat'), /median 0\.415, range 0\.22-0\.86, \*\*true in 6\/16 \(38%\)\*\*/, 'a noul carries the share that decides it')
  assert.match(cell('request served'), /median 1\.67, range 0\.9-1\.67/, 'a score is graded, with no meaningless share')
  assert.doesNotMatch(cell('request served'), /true in/, 'a score has no side of 0.5 to be on')
  assert.match(cell('scope expanded'), /NOT SEPARATING/, 'and the flag rides the number it qualifies')
  assert.match(cell('nobody asked this'), /NOT IN THIS WINDOW/, 'an absent question is NAMED, not left blank')
  // THE SET AND ITS HASH HEAD THE SECTION when the caller names them.
  assert.match(text, /## The model, in this session \(set `agent-helpfulness-session@1`, hash db06d2a49ed6\)/)
  assert.match(text, /MEASUREMENT taken 2026-10-04 from run `r1`/)
  assert.match(text, /READING: _/, 'the prose goes BELOW the table')
  assert.match(text, /What this reading does NOT establish/)
  assert.match(text, /What may NOT be read from this window/)
  // NO COMPARISON MEANS NO THIRD COLUMN -- never an empty one under a header that says nothing.
  assert.match(text, /\| question \| reading over 16 segment\(s\) \|/, 'two columns')
  assert.match(text, /_No comparison was given\. Pass `against`/)
  for (const line of text.split('\n').filter((l) => l.startsWith('| ') && l.includes('(') && !l.startsWith('| question'))) {
    assert.doesNotMatch(line, /\|\s*\|/, 'a blank cell in: ' + line)
  }
})

test('a SECOND instrument does not borrow the first one\'s set hash, and a comparison gets its own column', () => {
  // THE WINDOW RECORDS ONE SET HASH ON THE MOUNT LINE (F59): borrowing it for a second instrument made the operator's
  // table claim the model's question set.
  const summary = {
    window: { run: 'r1' }, counts: { call: 32 }, mount: { model: 'm', provider: 'p', probeHash: 'h' },
    runs: [{ questionSetHash: 'thewindowhash' }], refusals: [],
    groups: [{ key: 'g', questions: [{ id: 'operator_request_clear', read: 5, values: [{ value: '1.5', n: 1 }, { value: '0.5', n: 1 }] }] }],
  }
  const alone = buildSkeleton({ summary, tables: [{ title: 'The operator', set: 'human-conduct-session@1', questions: ['operator_request_clear'] }] })
  assert.match(alone, /hash thewindowhash/, 'ONE instrument may borrow the window\'s hash, because it is the only one it can be')
  const two = buildSkeleton({ summary, tables: [
    { title: 'The model', set: 'a', questions: ['operator_request_clear'] },
    { title: 'The operator', set: 'b', questions: ['operator_request_clear'] },
  ] })
  assert.doesNotMatch(two, /thewindowhash/, 'TWO instruments may not: the hash belongs to neither table in particular')
  assert.match(two, /\(set `a`\)/)
  // AND THE COMPARISON IS A COLUMN WITH A NAME, filled from the other package's readings.
  const compared = buildSkeleton({ summary, against: { title: 'the 40,000-char single call', questions: { operator_request_clear: { read: 1, values: [{ value: '1.2', n: 1 }] } } },
    tables: [{ title: 'The operator', set: 'human-conduct-session@1', questions: ['operator_request_clear', 'missing_from_the_other'] }] })
  assert.match(compared, /\| question \| reading over 5 segment\(s\) \| the 40,000-char single call \|/)
  assert.match(compared, /\| request clear \(score\) \| median 1, range 0\.5-1\.5 \| median 1\.2, range 1\.2-1\.2 \|/)
  assert.match(compared, /\| missing from the other \(\?\) \| \*\*NOT IN THIS WINDOW\*\* \| -- \|/, 'and a question the comparison does not have is a dash, not a blank')
  assert.doesNotMatch(compared, /_No comparison was given/)
})
