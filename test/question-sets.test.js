// QUESTION SETS AS FILES: the resolver's contract.
//
// The set's HASH is the load-bearing part: it is what makes a run attributable to the questions it asked, so a changed
// set makes runs honestly incomparable rather than silently averaged (`instrument`, beside `probeHash`). These tests
// therefore check the hash against its own inputs -- the same bytes hash the same, one character different does not --
// rather than against a literal, which would only prove that I can copy a string.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SET_SUFFIX, listSets, readSelectedSet, readSetFile, setHash, setSettings } from '../lib/question-sets.js'

const dirWith = (files) => {
  const dir = mkdtempSync(join(tmpdir(), 'sets-'))
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body)
  return dir
}
const VALID = JSON.stringify({ admit: [{ id: 'go', type: 'noul', instructions: 'did that go well?' }] })

test('a set file is read as a questions map, and its hash is the hash of its BYTES', () => {
  const dir = dirWith({ 'house.json': VALID })
  const read = readSetFile(join(dir, 'house.json'))
  assert.equal(read.problem, null)
  assert.deepEqual(Object.keys(read.questions), ['admit'])
  assert.deepEqual(read.questions.admit[0], { id: 'go', type: 'noul', instructions: 'did that go well?' })
  assert.equal(read.hash, setHash(VALID), 'the hash is a function of the file\u2019s text')
  // ONE CHARACTER IS A DIFFERENT IDENTITY, which is the whole point: a reformatted or edited set is a new experiment.
  assert.notEqual(setHash(VALID), setHash(VALID.replace('well', 'bad ')))
  assert.notEqual(setHash(VALID), setHash(VALID + '\n'), 'and even a trailing newline counts')
})

test('every way a set can be unusable is a NAMED problem, and none of them throws', () => {
  const dir = dirWith({
    'broken.json': '{ not json',
    'listed.json': JSON.stringify({ admit: 'not a list' }),
    'shape.json': JSON.stringify(['not', 'an', 'object']),
  })
  const broken = readSetFile(join(dir, 'broken.json'))
  assert.match(String(broken.problem), /not valid JSON/)
  assert.equal(broken.hash.length, 12, 'a file that does not parse still has an identity, so it can be named')
  assert.match(String(readSetFile(join(dir, 'listed.json')).problem), /"admit" is not a list of questions/)
  assert.match(String(readSetFile(join(dir, 'shape.json')).problem), /is not an object of seams/)
  assert.match(String(readSetFile(join(dir, 'missing.json')).problem), /cannot read/)
  // NOTHING CONFIGURED IS NOT A FAILURE: an unset name means the inline questions, which is what every row does today.
  assert.deepEqual(readSelectedSet('', ''), { questions: null, hash: '', path: '', problem: null, selected: false })
  // BUT A SET SELECTED WITH NOWHERE TO LOOK IS NAMED, because that row expects questions it will not get.
  assert.match(String(readSelectedSet('', 'house').problem), /no `questionSetsDir` is configured/)
  assert.match(String(readSelectedSet(dir, 'absent').problem), /cannot read/)
})

test('listing a directory names each set, its hash and its problem -- and bad entries do not hide the good', () => {
  const dir = dirWith({ 'house.json': VALID, 'broken.json': '{ nope' })
  const listed = listSets(dir)
  assert.equal(listed.problem, null)
  assert.deepEqual(listed.sets.map((set) => set.name), ['broken', 'house'], 'sorted, with the suffix stripped')
  const house = listed.sets.find((set) => set.name === 'house')
  assert.equal(house.hash, setHash(VALID))
  assert.deepEqual(house.seams, ['admit'])
  assert.equal(house.problem, null)
  const broken = listed.sets.find((set) => set.name === 'broken')
  assert.match(String(broken.problem), /not valid JSON/)
  assert.deepEqual(broken.seams, [], 'a set that does not parse declares no seams rather than inventing them')
  // ONLY SET FILES ARE SETS: a note beside them is not a candidate a person can select.
  writeFileSync(join(dir, 'README.md'), 'notes')
  assert.deepEqual(listSets(dir).sets.map((set) => set.name), ['broken', 'house'])
  // AND THE SUFFIX IS THE ONE THIS MODULE DECLARES, so a caller cannot disagree with it.
  assert.equal(SET_SUFFIX, '.json')
})

test('a directory that is missing or is not a directory is a named problem', () => {
  assert.match(String(listSets(join(tmpdir(), 'definitely-not-there-' + Date.now())).problem), /cannot list/)
  assert.ok(String(listSets('').problem).includes('no `questionSetsDir` is configured'), 'an unset directory is named')
  const dir = mkdtempSync(join(tmpdir(), 'sets-file-'))
  const file = join(dir, 'a-file')
  writeFileSync(file, 'x')
  assert.match(String(listSets(file).problem), /is not a directory/)
  // AND A FILE'S PARENT THAT EXISTS BUT HOLDS NO SETS IS AN EMPTY LIST, not a problem.
  const empty = mkdtempSync(join(tmpdir(), 'sets-empty-'))
  mkdirSync(join(empty, 'sub'))
  assert.deepEqual(listSets(empty), { sets: [], problem: null })
})

test('the settings are read live, in the volatile accessor shape a running row passes', () => {
  assert.deepEqual(setSettings({}), { dir: '', name: '' })
  assert.deepEqual(setSettings({ questionSetsDir: { get: () => ' /tmp/sets ' }, questionSet: { get: () => ' house ' } }), { dir: '/tmp/sets', name: 'house' })
  // A JUNK VALUE IS THE EMPTY SELECTION, not a path built from a number: the fallback is the inline questions.
  assert.deepEqual(setSettings({ questionSetsDir: 42, questionSet: null }), { dir: '', name: '' })
})
