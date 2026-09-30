// THE COMPATIBILITY GATE, TESTED, because a gate that nothing checks is a gate that rots.
//
// Two claims that must not be conflated: `engines.node` is what this package SUPPORTS, and
// `dsh.compatibility.testedAgainst` is the line it was RUN against. CI exercises several supported Node lines,
// so a Node difference is a note -- while a DSH version that differs from the tested one is the floating-range
// incident itself, and that fails.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { checkCompatibility } from '../lib/compat.js'

const MANIFEST = {
  engines: { node: '^22.19.0 || >=24.0.0' },
  dsh: { compatibility: { testedAgainst: { node: '25.3.0', dsh: '0.1.7-rc.2', note: 're-run npm run ci' } } },
}

test('this package’s own manifest passes its declared line', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const { problems } = checkCompatibility(manifest, { node: process.versions.node, dsh: manifest.dsh.compatibility.testedAgainst.dsh })
  assert.deepEqual(problems, [])
})

test('the supported range and the tested line are separate claims', () => {
  // A DIFFERENT but supported Node is a NOTE: CI runs several, and failing on that would make the gate noise.
  const other = checkCompatibility(MANIFEST, { node: '22.19.0', dsh: '0.1.7-rc.2' })
  assert.deepEqual(other.problems, [], 'a supported Node line is not a drift')
  assert.equal(other.notes.length, 1)
  assert.match(other.notes[0], /the TESTED line is 25\.3\.0/)
})

test('a DSH version outside the tested line FAILS, which is the whole point', () => {
  const drifted = checkCompatibility(MANIFEST, { node: '25.3.0', dsh: '0.1.8' })
  assert.equal(drifted.problems.length, 1)
  assert.match(drifted.problems[0], /DSH 0\.1\.8 is installed, declared tested against 0\.1\.7-rc\.2/)
})

// A CHECKER THAT CANNOT CHECK MUST SAY SO. A silent pass on a machine with no DSH install would be reporting a
// successful verification of nothing.
test('an unresolvable DSH install is a stated note, not a silent pass', () => {
  const unknown = checkCompatibility(MANIFEST, { node: '25.3.0', dsh: undefined })
  assert.deepEqual(unknown.problems, [])
  assert.equal(unknown.notes.length, 1)
  assert.match(unknown.notes[0], /could not check the DSH line/)
})

test('an incomplete declaration cannot pass by being empty', () => {
  assert.match(checkCompatibility({}, {}).problems[0], /is not declared/)
  const partial = { engines: {}, dsh: { compatibility: { testedAgainst: { node: '', dsh: '', note: '' } } } }
  const { problems } = checkCompatibility(partial, { node: '25.3.0', dsh: 'x' })
  assert.equal(problems.length, 4, 'two blank versions, a blank note, and an unstated engines range')
  assert.ok(problems.some(problem => /engines\.node is not declared/.test(problem)))
})
