// THE COMPATIBILITY GATE, TESTED, because a gate that nothing checks is a gate that rots.
//
// Two claims that must not be conflated: `engines.node` is what this package SUPPORTS, and
// `dsh.compatibility.testedAgainst` is the line it was RUN against. CI exercises several supported Node lines,
// so a Node difference is a note -- while a DSH version that differs from the tested one is the floating-range
// incident itself, and that fails.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { checkCompatibility, dshCandidates, findInstalledDsh } from '../lib/compat.js'

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

// THE GATE WAS GREEN WITHOUT CHECKING ANYTHING. `require.resolve` from this package sees neither a global install nor
// a profile install, so `npm run ci` printed "note: could not check the DSH line" and exited zero -- a successful
// verification of nothing, which is what this file's own header warns about. The resolution is now a tested function
// rather than a single call in a script.
test('the candidates are ordered so the copy that MATTERS is asked first', () => {
  const candidates = dshCandidates({ execPath: '/node/bin/node', cwd: '/repo', home: '/home/u', readdir: () => ['docdrift', 'web'] })
  assert.equal(candidates[0], '/repo/node_modules/@deepseek-ai/dsh/package.json', 'a local install is the narrowest claim')
  assert.deepEqual(candidates.slice(1, 3), [
    '/home/u/.dsh/profiles/docdrift/node_modules/@deepseek-ai/dsh/package.json',
    '/home/u/.dsh/profiles/web/node_modules/@deepseek-ai/dsh/package.json',
  ], 'then every PROFILE, which is what this plugin mounts into')
  assert.equal(candidates[3], '/node/lib/node_modules/@deepseek-ai/dsh/package.json', 'and the Node global root LAST, as a fallback')
  // A MACHINE WITH NO PROFILES IS NOT AN ERROR: the global fallback is still offered.
  const bare = dshCandidates({ execPath: '/node/bin/node', cwd: '/repo', home: '/home/u', readdir: () => { throw new Error('ENOENT') } })
  assert.equal(bare.length, 2)
})

test('the version is read from the FIRST candidate that parses, and a PROFILE beats the global', () => {
  const read = (path) => {
    if (path.includes('/profiles/docdrift/')) return JSON.stringify({ version: '9.9.9-from-the-profile' })
    if (path.includes('/node/lib/')) return JSON.stringify({ version: '1.1.1-from-the-global' })
    throw new Error('ENOENT ' + path)
  }
  const found = findInstalledDsh({ execPath: '/node/bin/node', cwd: '/repo', home: '/home/u', readdir: () => ['docdrift'], readFile: read })
  assert.equal(found.version, '9.9.9-from-the-profile', 'the profile copy is the one the mount ran against')
  assert.match(found.from, /profiles\/docdrift/)
  // AND NOTHING FOUND IS REPORTED AS NOTHING, with a null source -- so `checkCompatibility` can say it did not check.
  const none = findInstalledDsh({ execPath: '/node/bin/node', cwd: '/repo', home: '/home/u', readdir: () => [], readFile: () => { throw new Error('ENOENT') } })
  assert.deepEqual(none, { version: undefined, from: null })
  // A CANDIDATE THAT EXISTS BUT IS NOT JSON IS SKIPPED, not a crash: a half-written install must not stop the gate.
  const junk = findInstalledDsh({ execPath: '/node/bin/node', cwd: '/repo', home: '/home/u', readdir: () => [], readFile: () => 'not json' })
  assert.equal(junk.version, undefined)
})
