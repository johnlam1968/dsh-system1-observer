// SYSTEM1_BATTERY, the tool half: it spends model calls, so what matters most is what it refuses BEFORE spending and
// what it writes after. The line is an `experiment` -- a statement about the INSTRUMENT, never a reading about a
// session -- and it carries the two hashes a comparison needs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBatteryTool, BATTERY_TOOL_NAME } from '../lib/battery-tool.js'

/** A criteria directory with one session set of two questions, and a battery directory with one matching battery. */
function fixture({ cases = 5, expected = (i) => ({ went_well: i < 3, served: i < 3 ? 'yes' : 'no' }), setQuestions = 2 } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'battery-tool-'))
  const sets = join(root, 'criteria')
  mkdirSync(join(sets, 'trial-set'), { recursive: true })
  const specs = [
    { id: 'went_well', type: 'noul', instructions: 'Did it go well?' },
    { id: 'served', type: 'choice', instructions: 'Was it served?', options: [{ label: 'yes', criterion: 'served' }, { label: 'no', criterion: 'not served' }, { label: 'unclear', criterion: 'cannot tell', abstain: true }] },
  ].slice(0, setQuestions)
  writeFileSync(join(sets, 'trial-set', 'session.json'), JSON.stringify(specs))
  const batteries = join(root, 'batteries')
  mkdirSync(batteries, { recursive: true })
  writeFileSync(join(batteries, 'trial.battery.json'), JSON.stringify({
    cases: Array.from({ length: cases }, (_, i) => ({ id: 'c' + i, state: 'a conversation, number ' + i, expected: expected(i) })),
  }))
  return { sets, batteries, root }
}

const answerFor = (i) => ({
  went_well: { type: 'noul', probability: i < 3 ? 0.9 : 0.1 },
  served: { type: 'choice', label: i < 3 ? 'yes' : 'no' },
})

test('run scores every case, records ONE experiment line, and publishes a rate per question', async () => {
  const { sets, batteries } = fixture()
  const lines = []
  const asked = []
  const tool = createBatteryTool({
    dir: () => batteries,
    setsDir: () => sets,
    decide: async (request) => { asked.push(request.state); return { answers: answerFor(asked.length - 1) } },
    record: (line) => lines.push(line),
  })
  const out = await tool.execute({ action: 'run', battery: 'trial', set: 'trial-set' })
  assert.deepEqual(out.problems, [])
  assert.equal(asked.length, 5, 'one model call per case, with every question at once')
  assert.deepEqual(out.questions.map((q) => q.id), ['served', 'went_well'])
  assert.equal(out.questions.find((q) => q.id === 'went_well').accuracy, 1, 'the stub answers what the labels say')
  assert.deepEqual(out.wrong, [], 'and nothing is reported wrong')

  assert.equal(lines.length, 1, 'ONE line, not one per case')
  const line = lines[0]
  assert.equal(line.event, 'experiment', 'an experiment, NOT a reading: it is not a hook and enters no calibration')
  assert.equal(line.set, 'trial-set')
  assert.equal(typeof line.setHash, 'string')
  assert.equal(line.scope, 'session')
  assert.equal(line.cases, 5)
  assert.equal(typeof line.batteryHash, 'string')
  assert.equal(line.parent, null, 'a baseline names no parent')
  assert.equal(line.questions.length, 2)
  assert.match(tool.output.render({}, out)[0].text, /went_well \[noul\]: 5\/5 = 100%/)
})

test('a WRONG answer is reported with what was expected, and the rate says so', async () => {
  const { sets, batteries } = fixture()
  const tool = createBatteryTool({
    dir: () => batteries,
    setsDir: () => sets,
    // One case answered against its label: case 0 expects `went_well: true` and gets a low probability.
    decide: async (request) => {
      const i = Number(String(request.state).replace(/[^0-9]/g, ''))
      return { answers: i === 0 ? { went_well: { type: 'noul', probability: 0.1 }, served: { type: 'choice', label: 'yes' } } : answerFor(i) }
    },
    record: () => {},
  })
  const out = await tool.execute({ action: 'run', battery: 'trial', set: 'trial-set' })
  assert.equal(out.questions.find((q) => q.id === 'went_well').correct, 4)
  assert.equal(out.wrong.length, 1)
  assert.equal(out.wrong[0].caseId, 'c0')
  assert.equal(out.wrong[0].wrong[0].expected, true)
  const text = tool.output.render({}, out)[0].text
  assert.match(text, /went_well \[noul\]: 4\/5 = 80%/)
  assert.match(text, /case c0: went_well expected true/)
})

test('it REFUSES BEFORE SPENDING, and says which of the two is wrong', async () => {
  const { sets, batteries } = fixture()
  let calls = 0
  const decide = async () => { calls += 1; return { answers: {} } }
  const tool = createBatteryTool({ dir: () => batteries, setsDir: () => sets, decide, record: () => {} })

  // A SET THAT ASKS A QUESTION THE BATTERY DOES NOT COVER: the run cannot attribute its numbers, so it is refused
  // rather than run and caveated.
  const short = fixture({ setQuestions: 2 })
  writeFileSync(join(short.batteries, 'narrow.battery.json'), JSON.stringify({
    cases: Array.from({ length: 5 }, (_, i) => ({ id: 'c' + i, state: 's' + i, expected: { went_well: i < 3 } })),
  }))
  const narrow = createBatteryTool({ dir: () => short.batteries, setsDir: () => short.sets, decide, record: () => {} })
  const uncovered = await narrow.execute({ action: 'run', battery: 'narrow', set: 'trial-set' })
  assert.match(uncovered.problems.join(' '), /the set asks question\(s\) the battery does not cover: served/)
  assert.equal(calls, 0, 'and NOT ONE model call was made')

  // AN EXPECTATION FOR A QUESTION NOBODY ASKS scores as a permanent miss, so it is refused too.
  writeFileSync(join(short.batteries, 'extra.battery.json'), JSON.stringify({
    cases: Array.from({ length: 5 }, (_, i) => ({ id: 'c' + i, state: 's' + i, expected: { went_well: i < 3, served: 'yes', never_asked: true } })),
  }))
  const extra = await narrow.execute({ action: 'run', battery: 'extra', set: 'trial-set' })
  assert.match(extra.problems.join(' '), /expectations for question\(s\) the set does not ask: never_asked/)

  // A SCOPE THE SET DOES NOT DECLARE, and a battery that is not there at all.
  const wrongScope = await tool.execute({ action: 'run', battery: 'trial', set: 'trial-set', scope: 'turn' })
  assert.match(wrongScope.problems.join(' '), /`turn` is not a scope this set declares \(session\)/)
  const missing = await tool.execute({ action: 'run', battery: 'nope', set: 'trial-set' })
  assert.match(missing.problems.join(' '), /cannot read/)
  assert.equal(calls, 0, 'still nothing spent')

  // AND A `parent` THAT IS NOT A HASH, because a comparison has to say what is compared.
  const badParent = await tool.execute({ action: 'run', battery: 'trial', set: 'trial-set', parent: 'the old one' })
  assert.match(badParent.problems.join(' '), /`parent` must be a set hash/)
  assert.equal(calls, 0)
})

test('`validate` checks a battery against a set WITHOUT calling a model, and `list` shows coverage', async () => {
  const { sets, batteries } = fixture()
  let calls = 0
  const tool = createBatteryTool({ dir: () => batteries, setsDir: () => sets, decide: async () => { calls += 1; return {} }, record: () => {}, })
  const ok = await tool.execute({ action: 'validate', battery: 'trial', set: 'trial-set' })
  assert.deepEqual(ok.problems, [])
  assert.equal(calls, 0, 'validate never spends')
  assert.match(tool.output.render({}, ok)[0].text, /cover each other, and no model call was made/)

  const listed = await tool.execute({ action: 'list' })
  assert.equal(listed.count, 1)
  assert.deepEqual(listed.batteries[0].questions, ['served', 'went_well'])
  assert.equal(listed.batteries[0].cases, 5)
  assert.match(tool.output.render({}, listed)[0].text, /trial \[[0-9a-f]{12}\] 5 case\(s\) covering served, went_well/)
})

test('the tool names itself and declares everything it emits', async () => {
  assert.equal(createBatteryTool({}).name, BATTERY_TOOL_NAME)
  // NO BATTERY DIRECTORY IS CONFIGURED: a named problem rather than a throw, because the row may not have one.
  const bare = createBatteryTool({})
  const listed = await bare.execute({ action: 'list' })
  assert.match(listed.problem, /no battery directory is configured/)
  assert.match(bare.output.render({}, listed)[0].text, /^UNAVAILABLE: /)
})
