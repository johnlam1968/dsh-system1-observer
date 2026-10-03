// THE PROPERTY THAT MATTERS IS NOT THAT A WRITE WORKS -- it is that a REFUSED write leaves the instrument exactly as
// it was. A set's identity is the hash of its bytes, and that hash is on the mount line, so a half-applied or
// silently-overwritten set makes runs incomparable while every call returns success.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createQuestionsTool, QUESTIONS_TOOL_NAME, validateSpecs, WRITABLE_SCOPES } from '../lib/questions-tool.js'
import { listSets, readSelectedSet } from '../lib/question-sets.js'

const noul = (id, instructions = 'is it true?') => ({ id, type: 'noul', instructions })
const choiceWithoutAbstain = () => ({
  id: 'shape', type: 'choice', instructions: 'which?',
  options: [{ label: 'a', criterion: 'first' }, { label: 'b', criterion: 'second' }],
})

/** A composition on disk, made the way the tests before this one establish: one directory, one file per scope. */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'system1-questions-'))
  mkdirSync(join(dir, 'house@1'))
  writeFileSync(join(dir, 'house@1', 'draft.json'), JSON.stringify([noul('draft_stands_alone', 'standalone?')], null, 2) + '\n')
  return dir
}

const toolFor = (dir) => createQuestionsTool({ dir })

test('list reports the compositions, and read returns what is on disk', async () => {
  const dir = fixture()
  const tool = toolFor(dir)
  const listed = await tool.execute({ action: 'list' })
  assert.equal(listed.problem, undefined)
  assert.deepEqual(listed.sets.map((s) => s.name), ['house@1'])
  assert.deepEqual(listed.sets[0].seams, ['draft'])
  assert.equal(listed.sets[0].kind, 'composition')
  assert.equal(listed.sets[0].hash.length, 12)

  const read = await tool.execute({ action: 'read', set: 'house@1', scope: 'draft' })
  assert.deepEqual(read.specs, [noul('draft_stands_alone', 'standalone?')])

  const missing = await tool.execute({ action: 'read', set: 'house@1', scope: 'result' })
  assert.match(missing.problem, /no .*result\.json yet/)
})

test('validate uses the LOADER, so a set that would be refused while running is refused while composing', async () => {
  const dir = fixture()
  const tool = toolFor(dir)
  const bad = await tool.execute({ action: 'validate', set: 'house@1', scope: 'draft', specs: [choiceWithoutAbstain()] })
  assert.equal(bad.problems.length, 1)
  assert.match(bad.problems[0], /exactly one option must be the abstain option/)
  const good = await tool.execute({ action: 'validate', set: 'house@1', scope: 'draft', specs: [noul('x')] })
  assert.deepEqual(good.problems, [])
  // and a scope the loader does not know is a refusal rather than an unreachable file
  const unknown = await tool.execute({ action: 'validate', set: 'house@1', scope: 'drafting', specs: [noul('x')] })
  assert.match(unknown.problem, /is not a scope a set can be written for/)
})

test('an empty list is refused, because it asks nothing and would report nothing', () => {
  assert.match(validateSpecs('draft', [])[0], /an empty list asks nothing/)
  assert.match(validateSpecs('draft', [noul('same'), noul('same')]).join(' '), /two specs share the id `same`/)
  assert.match(validateSpecs('draft', 'not an array')[0], /must be an array of question specs/)
})

test('A REFUSED WRITE LEAVES THE FILE EXACTLY AS IT WAS', async () => {
  const dir = fixture()
  const tool = toolFor(dir)
  const path = join(dir, 'house@1', 'draft.json')
  const before = readFileSync(path, 'utf8')
  const beforeHash = (await tool.execute({ action: 'list' })).sets[0].hash

  // (a) specs the loader refuses
  const invalid = await tool.execute({ action: 'write', set: 'house@1', scope: 'draft', specs: [choiceWithoutAbstain()] })
  assert.match(invalid.problems[0], /abstain/)
  assert.equal(readFileSync(path, 'utf8'), before, 'the bytes are untouched')

  // (b) an overwrite without `replace`
  const overwrite = await tool.execute({ action: 'write', set: 'house@1', scope: 'draft', specs: [noul('changed')] })
  assert.match(overwrite.problems[0], /already exists/)
  assert.match(overwrite.problems[0], /incomparable/, 'and the refusal says why it matters')
  assert.match(overwrite.problems[0], /@next/, 'and offers the new revision')
  assert.equal(readFileSync(path, 'utf8'), before, 'still untouched')
  assert.equal((await tool.execute({ action: 'list' })).sets[0].hash, beforeHash, 'and the composition hash is unchanged')
})

test('a successful write lands, reports the hash READ BACK from disk, and the composition hash changes', async () => {
  const dir = fixture()
  const tool = toolFor(dir)
  const before = (await tool.execute({ action: 'list' })).sets[0].hash
  const written = await tool.execute({ action: 'write', set: 'house@1', scope: 'result', specs: [noul('result_kept', 'kept?')] })
  assert.deepEqual(written.problems, undefined)
  assert.equal(written.replaced, false)
  assert.equal(written.written, join(dir, 'house@1', 'result.json'))
  const listed = await tool.execute({ action: 'list' })
  assert.deepEqual(listed.sets[0].seams, ['draft', 'result'])
  assert.equal(written.hash, listed.sets[0].hash, 'the answer is the hash on disk, not the bytes the tool meant to write')
  assert.notEqual(written.hash, before, 'a new scope is a new instrument')
  // and the loader agrees: the row can select it and get both scopes
  const selected = readSelectedSet(dir, 'house@1')
  assert.deepEqual(Object.keys(selected.questions).sort(), ['draft', 'result'])
})

test('replace: true overwrites knowing the cost, and says it replaced', async () => {
  const dir = fixture()
  const tool = toolFor(dir)
  const before = (await tool.execute({ action: 'list' })).sets[0].hash
  const out = await tool.execute({ action: 'write', set: 'house@1', scope: 'draft', specs: [noul('replaced_question')], replace: true })
  assert.equal(out.replaced, true)
  assert.notEqual(out.hash, before)
  assert.deepEqual((await tool.execute({ action: 'read', set: 'house@1', scope: 'draft' })).specs, [noul('replaced_question')])
})

test('a NEW composition is created by its first write, and a name already taken by a FILE is refused', async () => {
  // The tool used to refuse a missing composition while its refusal advised creating one by writing its first scope
  // file -- advice it then refused to take. Creating a directory cannot damage an existing set, and `@next` is how a
  // revision starts, so the write creates it. Round 4's loop test depends on exactly this step.
  const dir = fixture()
  const tool = createQuestionsTool({ dir })
  const out = await tool.execute({ action: 'write', set: 'nowhere@1', scope: 'draft', specs: [noul('x')] })
  assert.equal(out.created, true)
  assert.deepEqual(out.problems, undefined)
  assert.deepEqual((await tool.execute({ action: 'read', set: 'nowhere@1', scope: 'draft' })).specs, [noul('x')])

  // A NAME ALREADY TAKEN BY A FLAT FILE is refused, because treating it as a composition would put the scope file
  // beside it and leave two things claiming one name.
  writeFileSync(join(dir, 'flat.json'), JSON.stringify({ draft: [noul('y')] }))
  const clash = await tool.execute({ action: 'write', set: 'flat.json', scope: 'draft', specs: [noul('z')] })
  assert.match(String(clash.problems), /flat set file/)
})

test('an unwired directory, and a call with no action at all, are named problems rather than silence', async () => {
  const unwired = await createQuestionsTool({ dir: '' }).execute({ action: 'list' })
  assert.match(unwired.problem, /no `questionSetsDir` is configured/)
  const unknownAction = await createQuestionsTool({ dir: fixture() }).execute({ action: 'compose' })
  assert.equal(unknownAction.problem.includes('unknown parameter') || unknownAction.problem.includes('action'), true)
})

test('the tool declares what it emits, and names the scopes a set may be written for', async () => {
  const tool = toolFor(fixture())
  assert.equal(tool.name, QUESTIONS_TOOL_NAME)
  assert.equal(tool.name, 'system1_questions')
  assert.deepEqual([...WRITABLE_SCOPES].sort(), ['admit', 'assemble', 'close', 'draft', 'execute', 'post_execute', 'pre_execute', 'request', 'result', 'session', 'turn'])
  const value = await tool.execute({ action: 'list' })
  for (const key of Object.keys(value)) {
    assert.ok(tool.output.schema.properties[key] !== undefined, key + ' is emitted and declared')
  }
  assert.match(tool.output.render({}, value)[0].text, /sets in /)
})
