// THE THREE THINGS AN AGENT NEEDS BETWEEN "I have an idea for a question" and "I know whether it works", each tested
// for the property that makes it safe rather than for the shape of its output:
//
//   1. `system1_decide` DECLARES a plain array for `questions`. The regression is the `oneOf` this replaced, and the
//      assertion is that a nested array survives the declaration -- because a choice's `options` and a score's `levels`
//      are arrays NESTED INSIDE a spec, and through a `oneOf` they never reached `execute`.
//   2. `lint` catches a question naming a section its scope does not emit -- a question that is well-formed,
//      calibratable-looking, and unanswerable, which `buildQuestions` cannot see.
//   3. `scaffold` writes cases and NEVER an expectation, and an unfilled scaffold is refused by `validate` and `run`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDecideTool } from '../lib/decide-tool.js'
import { createQuestionsTool } from '../lib/questions-tool.js'
import { createBatteryTool } from '../lib/battery-tool.js'
import { lintScope, lintSelection, MACHINE_UNCOVERED } from '../lib/question-lint.js'
import { assertValidOutput } from './tool-output-validated.js'

const rules = (result) => (result.findings ?? []).map((f) => f.rule)

// EVERY VALUE GOES THROUGH THE HARNESS'S OWN OUTPUT VALIDATION, on both new tools. The scaffold's first version
// returned `questions` as an array of id STRINGS while the declaration promises a row object per question, and the
// LIVE call was refused outright -- `value.questions[0] must be an object`. A unit test that only asserted the file's
// contents would have passed: the defect was in the tool's own answer, and only the value catches it.
test('both new actions return a value their own declaration accepts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'output-'))
  mkdirSync(join(dir, 'criteria', 'trial-set'), { recursive: true })
  writeFileSync(join(dir, 'criteria', 'trial-set', 'session.json'), JSON.stringify([
    { id: 'went_well', type: 'noul', instructions: 'Did it go well?' },
  ]))
  mkdirSync(join(dir, 'batteries'), { recursive: true })

  const questions = createQuestionsTool({ dir: join(dir, 'criteria') })
  assertValidOutput(questions, await questions.execute({ action: 'lint', set: 'trial-set' }, {}), 'lint whole set')
  assertValidOutput(questions, await questions.execute({ action: 'lint', scope: 'session', specs: [{ id: 'session_ok', type: 'noul', instructions: 'Does the SESSION TRANSCRIPT show it?' }] }, {}), 'lint inline')
  assertValidOutput(questions, await questions.execute({ action: 'lint', set: 'no-such-set' }, {}), 'lint missing set')

  const battery = createBatteryTool({ dir: () => join(dir, 'batteries'), setsDir: () => join(dir, 'criteria') })
  assertValidOutput(battery, await battery.execute({ action: 'scaffold', battery: 'trial', set: 'trial-set' }, {}), 'scaffold')
  assertValidOutput(battery, await battery.execute({ action: 'scaffold', battery: 'trial', set: 'trial-set' }, {}), 'scaffold refused overwrite')
  assertValidOutput(battery, await battery.execute({ action: 'validate', battery: 'trial', set: 'trial-set' }, {}), 'validate an unfilled scaffold')
  assertValidOutput(battery, await battery.execute({ action: 'list' }, {}), 'list')
})

// ── 1. the declaration ────────────────────────────────────────────────────────────────────────────────

test('`questions` is declared as a plain array, because a `oneOf` lost the nested arrays', () => {
  const tool = createDecideTool({ decide: async () => ({}) })
  const node = tool.parameters.properties.questions
  assert.equal(node.type, 'array', 'the parameter must declare `type`, not `oneOf`')
  assert.equal(node.oneOf, undefined, 'a `oneOf` here is what dropped every nested array in transit')
  assert.equal(node.items?.type, 'object')
})

test('a choice question sent through the tool keeps its options and reaches the model', async () => {
  const seen = []
  const tool = createDecideTool({
    decide: async (request) => { seen.push(request); return { answers: { pick: { type: 'choice', label: 'a' } }, executed: { provider: 'p', model: 'm' } } },
    record: () => {},
  })
  await tool.execute({
    state: 'a claim and its evidence',
    questions: [{ id: 'pick', type: 'choice', instructions: 'Which?', options: [{ label: 'a', criterion: 'first' }, { label: 'none', criterion: 'cannot tell', abstain: true }] }],
  }, {})
  assert.equal(seen.length, 1)
  // The options reach the model as a CRITERIA MAP, which is the wire shape: the conversion is the tool's job.
  assert.deepEqual(Object.keys(seen[0].questions.pick.criteria).sort(), ['a', 'none'])
})

// ── 2. the linter ───────────────────────────────────────────────────────────────────────────────────

test('a question naming a section its scope does not emit is an ERROR, and `buildQuestions` cannot see it', () => {
  const specs = [{ id: 'admit_saw_it', type: 'noul', instructions: 'Does the SESSION TRANSCRIPT show the failure?' }]
  assert.equal(lintScope(specs, 'admit').ok, false, 'a seam carries no named section: the text IS the subject')
  assert.ok(rules(lintScope(specs, 'admit')).includes('scope_state'))
  // THE SAME QUESTION IS LEGAL AT `session`, WHICH EMITS THAT LABEL -- so the finding is about the scope, not the words.
  assert.equal(lintScope(specs, 'session').ok, true)
})

test('each scope is held to the state IT emits: turn cannot name SESSION TRANSCRIPT, session cannot name OPERATOR REQUEST', () => {
  const atTurn = [{ id: 'turn_x', type: 'noul', instructions: 'Does the SESSION TRANSCRIPT show it?' }]
  const atSession = [{ id: 'session_x', type: 'noul', instructions: 'Does the OPERATOR REQUEST state it?' }]
  assert.ok(rules(lintScope(atTurn, 'turn')).includes('scope_state'))
  assert.ok(rules(lintScope(atSession, 'session')).includes('scope_state'))
})

test('a seam the row carries no text for refuses every question rather than asking it anyway', () => {
  const result = lintScope([{ id: 'close_x', type: 'noul', instructions: 'Is the turn closing?' }], 'close')
  assert.ok(rules(result).includes('textless_scope'))
})

test('lint folds in the LOADER\'s own complaints, so it is a superset of validate and cannot drift from it', () => {
  const badChoice = [{ id: 'admit_pick', type: 'choice', instructions: 'Which?', options: [{ label: 'a', criterion: 'first' }] }]
  assert.ok(rules(lintScope(badChoice, 'admit')).includes('loader'), 'one option and no abstain is the loader\'s complaint')
})

test('an id that is not lowercase, is duplicated, or does not carry its scope is named', () => {
  const specs = [
    { id: 'Admit_Bad', type: 'noul', instructions: 'Is it?' },
    { id: 'admit_dup', type: 'noul', instructions: 'Is it?' },
    { id: 'admit_dup', type: 'noul', instructions: 'Is it too?' },
    { id: 'wrong_prefix', type: 'noul', instructions: 'Is it?' },
  ]
  const found = rules(lintScope(specs, 'admit'))
  assert.ok(found.includes('id_shape'))
  assert.ok(found.includes('duplicate_id'))
  assert.ok(found.includes('id_scope_prefix'))
})

test('a noul whose instruction never reads as a predicate is flagged for stating its polarity', () => {
  const predicate = [{ id: 'admit_a', type: 'noul', instructions: 'Does the transcript show it?' }]
  const notPredicate = [{ id: 'admit_a', type: 'noul', instructions: 'The transcript, in this case.' }]
  assert.equal(lintScope(predicate, 'admit').ok, true)
  assert.ok(rules(lintScope(notPredicate, 'admit')).includes('polarity_unstated'))
})

test('every lint says what it did NOT check, so a clean report cannot be read as a pass', () => {
  assert.ok(MACHINE_UNCOVERED.length >= 3)
  assert.ok(MACHINE_UNCOVERED.some((line) => /battery/.test(line)), 'the rule that matters most is that it separates nothing')
  const whole = lintSelection({ admit: [{ id: 'admit_a', type: 'noul', instructions: 'Is it?' }] })
  assert.equal(whole.ok, true)
  assert.deepEqual(whole.machineUncovered, [...MACHINE_UNCOVERED])
})

test('lint reads a whole composition off disk, and says which scopes it covered', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lint-tool-'))
  mkdirSync(join(dir, 'trial-set'), { recursive: true })
  writeFileSync(join(dir, 'trial-set', 'session.json'), JSON.stringify([
    { id: 'session_ok', type: 'noul', instructions: 'Does the SESSION TRANSCRIPT show the request served?' },
    { id: 'session_oops', type: 'noul', instructions: 'Does the OPERATOR NEXT MESSAGE repeat it?' },
  ]))
  const tool = createQuestionsTool({ dir })
  const value = await tool.execute({ action: 'lint', set: 'trial-set' }, {})
  assert.equal(value.checked, 2)
  assert.equal(value.ok, false)
  assert.ok(rules(value).includes('scope_state'))
  assert.ok(value.hash, 'the composition hash comes back, so a report names the instrument it read')
})

// ── 3. the scaffold ─────────────────────────────────────────────────────────────────────────────────

function scaffoldFixture() {
  const root = mkdtempSync(join(tmpdir(), 'scaffold-'))
  const sets = join(root, 'criteria')
  mkdirSync(join(sets, 'trial-set'), { recursive: true })
  writeFileSync(join(sets, 'trial-set', 'session.json'), JSON.stringify([
    { id: 'went_well', type: 'noul', instructions: 'Did it go well?' },
    { id: 'served', type: 'choice', instructions: 'Was it served?', options: [{ label: 'yes', criterion: 'served' }, { label: 'unclear', criterion: 'cannot tell', abstain: true }] },
  ]))
  const batteries = join(root, 'batteries')
  mkdirSync(batteries, { recursive: true })
  return { sets, batteries }
}

test('scaffold writes one case per question at the floor, and labels NOTHING', async () => {
  const { sets, batteries } = scaffoldFixture()
  const tool = createBatteryTool({ dir: () => batteries, setsDir: () => sets })
  const value = await tool.execute({ action: 'scaffold', battery: 'trial', set: 'trial-set' }, {})
  assert.equal(value.labelled, false)
  assert.deepEqual(value.questions.map((q) => q.id).sort(), ['served', 'went_well'])
  const written = JSON.parse(readFileSync(join(batteries, 'trial.battery.json'), 'utf8'))
  assert.equal(written.cases.length, 5, 'the floor is the fewest cases a rate can be published over')
  for (const entry of written.cases) {
    assert.deepEqual(entry.expected, { went_well: null, served: null }, 'an expectation is left to the caller: a scaffold that guessed them would be the answer key it exists to check')
  }
  // NO HASH YET, and that is the honest report rather than a defect: a hash is `batteryHash` over the PARSED battery,
  // and an unfilled scaffold is deliberately not one. The hash appears the moment it becomes a battery -- which is
  // the moment the caller supplies the labels -- and the assertion below watches that happen rather than pretending
  // the file was already an instrument.
  assert.equal(value.battery.hash, '', 'an unlabelled scaffold has no battery hash, because it is not yet a battery')
  const path = join(batteries, 'trial.battery.json')
  for (const entry of written.cases) { entry.expected = { went_well: true, served: 'yes' }; entry.state = 'a conversation' }
  writeFileSync(path, JSON.stringify(written))
  const filled = await tool.execute({ action: 'validate', battery: 'trial', set: 'trial-set' }, {})
  assert.deepEqual(filled.problems, [], 'once the labels are in, it is a battery -- and its hash is an observation')
  assert.ok(filled.battery.hash, 'the hash comes from reading the file back, not from the bytes the tool meant to write')
})

test('an UNFILLED scaffold is refused by validate and by run -- the scaffold is a starting point, not a battery', async () => {
  const { sets, batteries } = scaffoldFixture()
  const tool = createBatteryTool({ dir: () => batteries, setsDir: () => sets })
  await tool.execute({ action: 'scaffold', battery: 'trial', set: 'trial-set' }, {})
  for (const action of ['validate', 'run']) {
    const value = await tool.execute({ action, battery: 'trial', set: 'trial-set' }, {})
    assert.ok((value.problems ?? []).some((p) => /no expectation for/.test(p)), `${action} must refuse a scaffold nobody has answered`)
  }
})

test('scaffold refuses to overwrite a battery whose hash is on a recorded run, unless told to', async () => {
  const { sets, batteries } = scaffoldFixture()
  writeFileSync(join(batteries, 'trial.battery.json'), JSON.stringify({
    cases: Array.from({ length: 5 }, (_, i) => ({ id: 'c' + i, state: 's' + i, expected: { went_well: true, served: 'yes' } })),
  }))
  const tool = createBatteryTool({ dir: () => batteries, setsDir: () => sets })
  const refused = await tool.execute({ action: 'scaffold', battery: 'trial', set: 'trial-set' }, {})
  assert.match(refused.problems[0], /already exists/)
  const forced = await tool.execute({ action: 'scaffold', battery: 'trial', set: 'trial-set', replace: true }, {})
  assert.equal(forced.problems.length, 0)
  assert.equal(forced.labelled, false)
})

test('scaffold writes where a caller can see it, and `cases` is honoured', async () => {
  const { sets, batteries } = scaffoldFixture()
  const tool = createBatteryTool({ dir: () => batteries, setsDir: () => sets })
  const value = await tool.execute({ action: 'scaffold', battery: 'wide', set: 'trial-set', cases: 7 }, {})
  assert.equal(value.battery.cases, 7)
  assert.equal(value.scaffolded, join(batteries, 'wide.battery.json'))
})
