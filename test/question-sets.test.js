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
import { QUESTION_SCOPES, buildQuestions } from '../lib/questions.js'

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
  assert.deepEqual(readSelectedSet('', ''), { questions: null, hash: '', path: '', scopes: {}, problem: null, selected: false })
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
  // AN EMPTY DIRECTORY IS NOW A COMPOSITION, and a composition with no scope files is a NAMED PROBLEM rather than a
  // set that asks nothing: selecting it would measure nothing at every seam and say nothing about it.
  const listedEmpty = listSets(empty)
  assert.equal(listedEmpty.problem, null)
  assert.equal(listedEmpty.sets.length, 1)
  assert.match(String(listedEmpty.sets[0].problem), /no scope files/)
})

test('the settings are read live, in the volatile accessor shape a running row passes', () => {
  assert.deepEqual(setSettings({}), { dir: '', name: '' })
  assert.deepEqual(setSettings({ questionSetsDir: { get: () => ' /tmp/sets ' }, questionSet: { get: () => ' house ' } }), { dir: '/tmp/sets', name: 'house' })
  // A JUNK VALUE IS THE EMPTY SELECTION, not a path built from a number: the fallback is the inline questions.
  assert.deepEqual(setSettings({ questionSetsDir: 42, questionSet: null }), { dir: '', name: '' })
})

test('EVERY shipped set compiles clean for every scope it keys, and names only declared scopes', async () => {
  // THE SETS WE SHIP ARE WHAT A ROW CAN SELECT, so a set that does not compile is a set whose selection REFUSES the
  // call (`buildQuestions` returns the problem and no question). And a scope key the schema does not declare would be
  // dropped by `projectForm` on the next save of any other field -- the failure the schema's own comment records for
  // `turn`. This is the check that keeps both true for every file in `criteria/`, including the older sets that were
  // authored before the loader existed.
  const dir = new URL('../criteria', import.meta.url).pathname
  const listed = listSets(dir)
  assert.equal(listed.problem, null, 'the directory lists')
  assert.ok(listed.sets.length >= 5, 'the shipped sets were found: ' + listed.sets.length)
  const failures = []
  for (const set of listed.sets) {
    if (set.problem !== null) { failures.push(set.name + ': ' + set.problem); continue }
    const selected = readSelectedSet(dir, set.name)
    for (const scope of Object.keys(selected.questions ?? {})) {
      if (!QUESTION_SCOPES.includes(scope)) {
        failures.push(set.name + ': "' + scope + '" is not a declared scope, so projectForm would drop it')
      }
      const built = buildQuestions({ questions: selected.questions }, scope)
      for (const problem of (built.problems ?? [])) failures.push(set.name + ' @ ' + scope + ': ' + problem)
    }
  }
  assert.deepEqual(failures, [], 'a shipped set that does not compile is one the row refuses: ' + failures.join(' | '))
})

test('a COMPOSITION is one directory, one file per scope, and its hash is its parts', () => {
  // The shape the operator chose: the scope name is the file stem -- spelled once, in the one place a reader looks --
  // and `_`-prefixed files are metadata rather than scopes, which is where a manifest naming a model or a use case
  // will go WITHOUT encoding anything in a filename.
  const dir = mkdtempSync(join(tmpdir(), 'sets-comp-'))
  mkdirSync(join(dir, 'house'))
  writeFileSync(join(dir, 'house', 'draft.json'), JSON.stringify([{ id: 'draft_stands_alone', type: 'noul', instructions: 'standalone?' }]))
  // the one-key map form is accepted when the key IS the file's own scope
  writeFileSync(join(dir, 'house', 'result.json'), JSON.stringify({ result: [{ id: 'result_kept', type: 'noul', instructions: 'kept?' }] }))
  writeFileSync(join(dir, 'house', '_rationale.md'), 'not a scope')
  writeFileSync(join(dir, 'house', '_manifest.json'), JSON.stringify({ appliesTo: { model: 'ministral-3-3b' } }))

  const listed = listSets(dir)
  assert.equal(listed.problem, null)
  assert.deepEqual(listed.sets.map((set) => set.name), ['house'])
  const house = listed.sets[0]
  assert.equal(house.kind, 'composition')
  assert.deepEqual(house.seams, ['draft', 'result'], 'the scopes, sorted, and neither metadata file')
  assert.deepEqual(Object.keys(house.scopeHashes).sort(), ['draft', 'result'])
  assert.equal(house.hash.length, 12)

  const selected = readSelectedSet(dir, 'house')
  assert.equal(selected.problem, null)
  assert.deepEqual(Object.keys(selected.questions).sort(), ['draft', 'result'])
  assert.deepEqual(selected.questions.draft[0].id, 'draft_stands_alone')
  assert.equal(selected.hash, house.hash, 'the composition hash is the same however it is reached')

  // EDITING ONE SCOPE CHANGES THE COMPOSITION, because it is a different instrument -- and the UNTOUCHED scope keeps
  // its own hash, which is what makes a refinement attributable one level finer than the run.
  writeFileSync(join(dir, 'house', 'draft.json'), JSON.stringify([{ id: 'draft_stands_alone', type: 'noul', instructions: 'standalone, really?' }]))
  const after = readSelectedSet(dir, 'house')
  assert.notEqual(after.hash, selected.hash, 'an edited scope is a new composition')
  assert.equal(after.scopes.result, selected.scopes.result, 'and the scope beside it is unchanged, hash and all')

  // A FILE ANSWERING FOR A SCOPE THAT IS NOT ITS OWN IS REFUSED, because a set that means two things cannot be
  // calibrated.
  writeFileSync(join(dir, 'house', 'execute.json'), JSON.stringify({ result: [{ id: 'x', type: 'noul', instructions: 'y' }] }))
  assert.match(String(readSelectedSet(dir, 'house').problem), /must hold a list of specs, or a single key "execute"/)
})

test('a FLAT single-scope file still works, because a trial does not need a directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sets-flat-'))
  writeFileSync(join(dir, 'one-off.json'), JSON.stringify({ turn: [{ id: 'x', type: 'noul', instructions: 'y' }] }))
  const listed = listSets(dir)
  assert.deepEqual(listed.sets.map((set) => [set.name, set.kind]), [['one-off', 'file']])
  assert.deepEqual(Object.keys(readSelectedSet(dir, 'one-off').questions), ['turn'])
})
