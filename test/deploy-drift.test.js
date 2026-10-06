// THE DEPLOYMENT RECORD, AND THE CHECK THAT KEEPS IT HONEST.
//
// `ROADMAP.md` §14.6 (e): the profile is not under version control and holds three things that exist nowhere else, so
// `deploy/profile/` carries a copy and `npm run check:deploy` compares it with the machine. This test pins the
// COMPARISON, because a check whose own logic is untested agrees with whatever it is given -- and it pins the record's
// completeness, so a file cannot quietly stop being recorded.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RECORDED, bundlesOf, compareDeploy, machineLocalPins, readDeploy } from '../lib/deploy-drift.js'

const ROOT = join(fileURLToPath(import.meta.url), '..', '..')

/** A profile directory with the recorded files, overridable per test. */
function profileDir(files) {
  const dir = mkdtempSync(join(tmpdir(), 'deploy-drift-'))
  // EVERY RECORDED FILE IS PRESENT BY DEFAULT, so a test that overrides one is testing that override rather than the
  // absence of the other six -- which is what the first version of this fixture measured.
  const all = Object.fromEntries(RECORDED.map((name) => [name, name === 'package.json' ? pkg([]) : `// ${name}\n`]))
  for (const [name, text] of Object.entries({ ...all, ...files })) {
    const full = join(dir, name)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, text)
  }
  return dir
}
const pkg = (bundles, dependencies = {}) => JSON.stringify({ name: 'p', dsh: { profile: { bundles } }, dependencies })

test('the record in this repository names every file the check compares', () => {
  // A FILE THAT STOPS BEING RECORDED IS THE DRIFT THIS DIRECTORY EXISTS TO PREVENT, and it would make the comparison
  // pass by asking about less. The list is the contract; the directory must satisfy it.
  const recorded = readDeploy(join(ROOT, 'deploy', 'profile'))
  assert.equal(recorded.exists, true, 'deploy/profile exists')
  const missing = RECORDED.filter((file) => recorded.files[file] === undefined)
  assert.deepEqual(missing, [], 'recorded in deploy/profile: ' + missing.join(', '))
  // AND THE BUNDLE LIST IS THE POINT OF THE COPY, so it must parse and name this plugin.
  const bundles = bundlesOf(recorded.packageJson)
  assert.ok(Array.isArray(bundles) && bundles.length > 0, 'the recorded profile declares its bundles')
  assert.ok(bundles.includes('dsh-system1-observer'), 'and names this plugin')
})

test('a copy that still describes the machine reports no problems', () => {
  const live = profileDir({ 'package.json': pkg(['dsh-base', 'dsh-system1-observer']) })
  try {
    const { problems, absent } = compareDeploy(readDeploy(live), readDeploy(live))
    assert.deepEqual(problems, [])
    assert.equal(absent, false)
  } finally { rmSync(live, { recursive: true, force: true }) }
})

test('a BUNDLE dropped from the profile is named -- the F105 failure, caught by name', () => {
  const recorded = profileDir({ 'package.json': pkg(['dsh-base', 'dsh-system1-observer']) })
  const live = profileDir({ 'package.json': pkg(['dsh-base']) })
  try {
    const { problems } = compareDeploy(readDeploy(recorded), readDeploy(live))
    assert.equal(problems.length, 1, problems.join('; '))
    assert.match(problems[0], /bundle list differs/)
    assert.match(problems[0], /recorded-only \["dsh-system1-observer"\]/)
  } finally { rmSync(recorded, { recursive: true, force: true }); rmSync(live, { recursive: true, force: true }) }
})

test('the ORDER of the bundle list is compared, because a layer order decides the composition', () => {
  const recorded = profileDir({ 'package.json': pkg(['a', 'b']) })
  const live = profileDir({ 'package.json': pkg(['b', 'a']) })
  try {
    assert.match(compareDeploy(readDeploy(recorded), readDeploy(live)).problems[0], /or the ORDER differs/)
  } finally { rmSync(recorded, { recursive: true, force: true }); rmSync(live, { recursive: true, force: true }) }
})

test('an edited FILE is drift, and the byte counts are named', () => {
  const recorded = profileDir({ 'cordis.patch.yml': 'patch\n' })
  const live = profileDir({ 'cordis.patch.yml': 'patch with a row added\n' })
  try {
    const { problems } = compareDeploy(readDeploy(recorded), readDeploy(live))
    assert.equal(problems.length, 1)
    assert.match(problems[0], /cordis\.patch\.yml DIFFERS from the live profile \(6 vs 23 bytes\)/)
  } finally { rmSync(recorded, { recursive: true, force: true }); rmSync(live, { recursive: true, force: true }) }
})

test('a machine with no such profile is NOT CHECKED rather than passed', () => {
  const recorded = profileDir({ 'package.json': pkg(['a']) })
  try {
    const { problems, absent } = compareDeploy(readDeploy(recorded), null)
    assert.deepEqual(problems, [], 'nothing is wrong -- there is nothing to compare')
    assert.equal(absent, true, 'and the caller is told so')
  } finally { rmSync(recorded, { recursive: true, force: true }) }
})

test('a pin no second host can install is REPORTED, not treated as drift', () => {
  // Measured on this host: `dsh-plugin-factory` is `file:/home/john/Downloads/…tgz`. The recorded file is right and the
  // pin is the fact -- so it rides the output as a note, which is where (e)'s "the pin half is half-done" is visible.
  const pins = machineLocalPins({ dependencies: { a: 'file:/tmp/x.tgz', b: '/abs/path', c: '^1.0.0', d: 'github:u/r' } })
  assert.deepEqual(pins.map((pin) => pin.name), ['a', 'b'])
})
