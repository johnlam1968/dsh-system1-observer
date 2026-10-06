// THE WHOLE PATH, ONCE: a stored session judged through the REAL tool registry, the REAL composer, the REAL
// service-transport shim and the REAL trace writer -- with stubs only at the two boundaries this process cannot own,
// the harness's session store and the model.
//
// IT IS WHAT FOUND O20. The unit tests proved the tool's logic against injected collaborators and could not see that
// the render paths read the key `narrowAnswers` CONSUMES (`noul`) rather than the one it PRODUCES (`probability`), so
// every real evaluation would have shown "(no label)". A live run said so in one line.
//
// THE THREE BOUNDARY SHAPES, all learned the hard way and recorded here:
//   the store   : `readSession(id)` -> `{ session, events }`, events in the composer's own shape
//   the model   : `system1.decide(...)` -> `{ answers, meta }` where the answer is
//                 `{ status: 'ok', answer: { type: 'noul', probabilityTrue: 0.8 } }` (`lib/model/service-answers.js:39`)
//   the envelope: `reply.meta.{executed,requested,usage,durationMs}` (`lib/model/service.js:49`)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import plugin from '../index.js'
import { EVALUATE_TOOL_NAME, REVIEW_HOOK } from '../lib/evaluate-tool.js'
import { probeAnswerOf, probeScore } from '../lib/probe-score.js'

/**
 * The real Cordis and the real tool registry, resolved the way `test/composition.test.js` resolves them.
 *
 * LOCAL FIRST, because this repository DECLARES both as devDependencies and the suite has to be runnable on a machine
 * with no global harness install -- which is what a GitHub runner is. Until this order existed, this file resolved
 * `npm root -g` only, so EVERY CI run failed here while passing on a developer machine with a harness installed
 * (measured: three consecutive red `ci.yml` runs, and the publish workflow refused to release because of it).
 * A failure rather than a skip, deliberately, and for the reason composition.test.js gives: a skip reads as
 * "checked" in a summary line, and this is the one check that can disagree with everything else.
 */
async function real(pkg) {
  const candidates = []
  try {
    candidates.push(createRequire(import.meta.url).resolve(pkg + '/package.json'))
  } catch { /* not declared as a dependency: fall through to the install */ }
  try {
    const root = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim()
    candidates.push(join(root, '@deepseek-ai/dsh/node_modules/@deepseek-ai', pkg.split('/')[1], 'package.json'))
    candidates.push(join(root, '@deepseek-ai', pkg.split('/')[1], 'package.json'))
  } catch { /* no npm on PATH: the declared copy, or nothing */ }
  for (const manifest of candidates) {
    if (!existsSync(manifest)) continue
    return import(pathToFileURL(createRequire(manifest).resolve(pkg)).href)
  }
  throw new Error(
    'no reachable ' + pkg + ': declare it as a devDependency, or install a harness that provides it.\n'
    + `looked in: ${candidates.join(', ') || '(nothing: no declared copy and no npm root -g)'}`)
}

const { Context } = await real('@deepseek-ai/cordis')
const { ToolRuntime } = await real('@deepseek-ai/dsh-tools')

const message = (seq, type, text) => ({
  seq,
  time: seq,
  type,
  data: { message: { role: type.startsWith('user') ? 'user' : 'assistant', content: [{ type: 'text', text }] } },
})
const STORED = [
  message(1, 'user/message', 'please summarise the deployment logs'),
  message(2, 'assistant/message', 'here is the summary'),
  message(3, 'user/message', 'now shorten it'),
  message(4, 'assistant/message', 'shorter'),
]
const AGENT = { id: 'session-live', session: { snapshotEvents: () => [] } }

const readLines = (path) => (existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [])

test('a stored session is judged through the real registry, and its line stays out of the calibration', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'evaluate-live-'))
  const tracePath = join(dir, 'trace.jsonl')
  const ctx = new Context()
  ctx.provide('agents', { get: () => AGENT, list: () => [AGENT], currentInitiator: () => AGENT })
  ctx.provide('systemPrompt', { tools: () => {}, section: () => {}, getSectionOrder: () => 0 })
  // THE HARNESS'S SESSION STORE, stubbed at exactly its two used calls.
  ctx.provide('sessionQuery', {
    listSessions: async () => [{ header: { id: 'S1', cwd: '/tmp/x' }, live: false, persisted: true }],
    readSession: async (id) => {
      if (id !== 'S1') throw new Error('no session with that id')
      return { session: { id: 'S1', cwd: '/tmp/x' }, events: STORED }
    },
  })
  // THE MODEL, stubbed one layer below the tool: the real transport shim, composer and writer all run.
  ctx.provide('system1', {
    // THE SERVICE'S OWN ANSWER SHAPE, which is NOT the wire's: `{ type, value, confidence, probabilities }`,
    // flattened to the wire's shape by `lib/model/service-answers.js` and only then narrowed. Two wrong guesses
    // first -- `{ label, confidence }`, then the WIRE's `{ noul: 0.8 }` -- and both came back `type: 'unreadable'`.
    // The shape is a real boundary rather than a detail: the whole path is under test here.
    decide: async () => ({
      // `lib/model/service-answers.js:39-52` is the authority: `status: 'ok'`, `answer.type`, `answer.probabilityTrue`.
      answers: { review: { status: 'ok', answer: { type: 'noul', probabilityTrue: 0.8 } } },
      // THE SERVICE'S ENVELOPE IS `meta`, not `envelope` -- `lib/model/service.js:49`'s `envelopeOf` reads
      // `reply.meta.{executed,requested,usage,durationMs,requestId}`. A third boundary shape, and the last one.
      meta: { executed: { provider: 'stub', model: 'stub-1' }, usage: { inputTokens: 120 }, durationMs: 7 },
    }),
  })
  await ctx.plugin(ToolRuntime).await()

  const fiber = ctx.plugin(plugin, {
    hooks: [], sessions: ['*'], turnEveryNTurns: 0, tracePath,
    subjectSource: 'stored', subjectSession: 'S1', subjectKinds: ['operator', 'assistant'], subjectLastMessages: 0,
    questions: { turn: [{ id: 'review', type: 'noul', instructions: 'did this conversation go well?' }] },
  })
  await fiber.await()

  // THROUGH THE REGISTRY, not through the module: this is the wiring under test.
  const registry = ctx.get('tools')
  const tool = registry.get(EVALUATE_TOOL_NAME)
  assert.ok(tool, 'the row registers ' + EVALUATE_TOOL_NAME + ' against the real registry')
  const out = await tool.execute({}, {})
  // THE NARROWED SHAPE, which is what the real path produces: `{ type: 'noul', probability, confidence }`. My
  // assertion first read `noul` -- the shape `narrowAnswers` CONSUMES rather than the one it PRODUCES -- and the same
  // mistake was in the render and the card, which is why they would have shown "(no label)" for every real answer.
  assert.equal(out.answers.review?.probability, 0.8, 'the judgement through the real path: ' + JSON.stringify(out).slice(0, 300))
  assert.equal(out.subject.source, 'stored')
  assert.equal(out.subject.sessionId, 'S1')
  assert.equal(out.subject.messages, 4, 'all four messages, since the slice asked for the whole session')
  assert.equal(out.truncated, false)
  assert.equal(out.executed.model, 'stub-1', 'the provenance survives the transport shim')

  // THE LINE IS IN A REAL FILE, and it says what it judged and what it sent.
  const lines = readLines(tracePath)
  const record = lines.find((line) => line.event === 'call' && line.hook === REVIEW_HOOK)
  assert.notEqual(record, undefined, 'the evaluation wrote a call line with its own hook')
  assert.equal(record.tool, 'system1-observer')
  assert.equal(record.subject.source, 'stored')
  assert.equal(record.subject.sessionId, 'S1')
  assert.equal(record.stateHash, out.stateHash, 'the hash on the line is the hash of what was sent')
  assert.deepEqual(record.questionIds, ['review'])
  assert.deepEqual(record.answers, out.answers)

  // AND THE CALIBRATION SEES NONE OF IT -- the end-to-end form of the unit assertion. The line is not a probe call,
  // and removing it from the window changes nothing about the score.
  assert.equal(probeAnswerOf(record), null, 'a session review is not a probe call')
  assert.equal(JSON.stringify(probeScore(lines)), JSON.stringify(probeScore(lines.filter((line) => line !== record))),
    'the evaluation line contributes no probe rows')

  // THE SAME SUBJECT HAS THE SAME IDENTITY: a second evaluation of it is recognisably the same input.
  const again = await tool.execute({}, {})
  assert.equal(again.stateHash, out.stateHash, 'the same conversation composes to the same hash')
  // WHILE A DIFFERENT SLICE IS A DIFFERENT INPUT, which is what makes the hash worth recording.
  const sliced = await tool.execute({ lastMessages: 2 }, {})
  assert.notEqual(sliced.stateHash, out.stateHash, 'a two-message slice is not the same input as the whole session')
  assert.equal(sliced.subject.messages, 2)

  await fiber.dispose()
})

// THE SELECTED SET IS WHAT GETS ASKED, AND THE AGENT SEES THE RESULT -- the two things a live call got wrong while
// every unit test stayed green, and each is a different mistake:
//
//   1. `render` WAS CALLED WITH ONE ARGUMENT HERE AND DECLARED ONE PARAMETER. The host calls
//      `tool.output.render(exec.arguments, value)` (`dsh-tools/lib/index.js:3548`), so a single-parameter render is
//      handed the ARGUMENTS. Measured live: a call whose trace line recorded `"messages":611` displayed
//      `? subject, 0 of 0 message(s), state 0 chars [?]` -- the subject was read, the model answered and was paid,
//      and the agent saw none of it. The assertions below call render the way the host does.
//   2. THE ROW'S `questionSet` WAS INVISIBLE AT THIS CALL SITE. The tool's `questions` closure built
//      `{questions: {session: <inline specs>}}` by hand instead of handing `buildQuestions` the config that NAMES the
//      set, so a row selecting a session set was asked the PROBE question. Measured live: the trace line read
//      `"questionIds":["probe"]` while the row had `agent-helpfulness-session@1` selected.
test('a stored session is asked the SELECTED SET\'s questions, and the render the host calls shows what was judged', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'evaluate-set-'))
  const tracePath = join(dir, 'trace.jsonl')
  // A COMPOSITION, WRITTEN HERE RATHER THAN BORROWED FROM `criteria/`: a test that reads the shipped corpus breaks
  // when somebody edits a question, which is exactly what the corpus is for. One directory per composition, one file
  // per scope, named for the scope (`lib/question-sets.js:198`, `:243`).
  const setsDir = join(dir, 'sets')
  mkdirSync(join(setsDir, 'session-trial'), { recursive: true })
  writeFileSync(join(setsDir, 'session-trial', 'session.json'), JSON.stringify([
    { id: 'went_well', type: 'noul', instructions: 'Did the conversation go well?' },
    { id: 'served', type: 'score', instructions: 'How far was the opening request served?', levels: ['no', 'partly', 'yes'] },
  ], null, 2))

  const ctx = new Context()
  ctx.provide('agents', { get: () => AGENT, list: () => [AGENT], currentInitiator: () => AGENT })
  ctx.provide('systemPrompt', { tools: () => {}, section: () => {}, getSectionOrder: () => 0 })
  ctx.provide('sessionQuery', {
    listSessions: async () => [{ header: { id: 'S1', cwd: '/tmp/x' }, live: false, persisted: true }],
    readSession: async () => ({ session: { id: 'S1', cwd: '/tmp/x' }, events: STORED }),
  })
  ctx.provide('system1', {
    // ONE ANSWER PER QUESTION THE SET ASKS. A stub that answered only `review` would leave this test unable to tell
    // "the set was asked" from "some answer came back".
    decide: async () => ({
      answers: {
        went_well: { status: 'ok', answer: { type: 'noul', probabilityTrue: 0.7 } },
        served: { status: 'ok', answer: { type: 'score', value: 2, levels: ['no', 'partly', 'yes'], probabilities: [0, 0, 1] } },
      },
      meta: { executed: { provider: 'stub', model: 'stub-1' }, durationMs: 5 },
    }),
  })
  await ctx.plugin(ToolRuntime).await()

  const fiber = ctx.plugin(plugin, {
    hooks: [], sessions: ['*'], turnEveryNTurns: 0, tracePath,
    subjectSource: 'stored', subjectSession: 'S1', subjectKinds: ['operator', 'assistant'], subjectLastMessages: 0,
    questionSetsDir: setsDir,
    questionSet: 'session-trial',
  })
  await fiber.await()

  const tool = ctx.get('tools').get(EVALUATE_TOOL_NAME)
  assert.ok(tool, 'the row registers ' + EVALUATE_TOOL_NAME + ' against the real registry')
  const out = await tool.execute({}, {})

  // (1) THE SET'S QUESTIONS, NOT THE PROBE'S. `probe` is the fallback an unconfigured row gets and is exactly what
  // this call asked before the fix -- so its absence is the assertion.
  assert.deepEqual(Object.keys(out.answers).sort(), ['served', 'went_well'], 'the selected set is what was asked: ' + JSON.stringify(out.answers))
  assert.equal(out.answers.went_well.probability, 0.7)
  assert.equal(out.answers.served.level, 2)
  const record = readLines(tracePath).find((line) => line.event === 'call' && line.hook === REVIEW_HOOK)
  assert.deepEqual(record.questionIds.sort(), ['served', 'went_well'], 'the line names the questions the set asked, so a reader can attribute the reading')

  // (2) THE RENDER, CALLED THE WAY THE HOST CALLS IT. `(args, value)` -- and an `args` object that looks nothing like a
  // value, so an implementation reading the first parameter renders the `? subject, 0 of 0` this exists to prevent.
  const args = { sessionId: 'S1', kinds: ['operator', 'assistant'], lastMessages: 0 }
  const blocks = tool.output.render(args, out)
  assert.equal(Array.isArray(blocks), true)
  assert.match(blocks[0].text, /stored subject, 4 of 4 message/, 'the render is handed the VALUE, so it can say what was judged: ' + blocks[0].text)
  assert.match(blocks[0].text, /went_well: p=0\.7/, 'and what the model answered')
  assert.match(blocks[0].text, /served: /)

  await fiber.dispose()
})
