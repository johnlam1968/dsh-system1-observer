// THE STAGED PATH, WHICH IS WHAT SURVIVES THE TOOL-CALL BOUNDARY.
//
//   compose as STRINGS  ->  store  ->  ask by NAME
//
// The boundary cannot carry a nested array: a flat `options` array arrives as `[{items:[{item:[...the real
// objects...]}]}]`, of length one, four times out of four (`lib/decide-tool.js` records the measurement and the
// refuted hypothesis). So none of these three stages nests. A question is ONE string; a stored set is a NAME; and
// the questions that cross to the model were built once, on the way in, by the same loader the row uses at a seam.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseQuestion, parseQuestions, formatQuestion, SEPARATOR } from '../lib/question-dsl.js'
import { buildQuestions } from '../lib/questions.js'
import { createDecideTool } from '../lib/decide-tool.js'
import { createQuestionsTool } from '../lib/questions-tool.js'

const CHOICE = [
  'id=admit_relation',
  'type=choice',
  'instructions=Which relation do the excerpts bear to the claim?',
  'option=supported=the excerpt supports the exact claim',
  'option=contradicted=the excerpt contradicts the exact claim',
  'option=unknown=cannot be decided [abstain]',
].join(SEPARATOR)

const LADDER = ['id=draft_directness', 'type=score', 'instructions=How direct is it?', 'level=not at all', 'level=partly', 'level=directly'].join(SEPARATOR)

// ── the format ───────────────────────────────────────────────────────────────────────────────────────

test('one string composes a choice the loader accepts, with its abstain intact', () => {
  const built = buildQuestions({ questions: { admit: parseQuestions([CHOICE]) } }, 'admit')
  assert.deepEqual(built.problems, [], 'a choice the authoring guide would refuse must not get past the DSL')
  const criteria = built.questions.admit_relation.criteria
  assert.deepEqual(Object.keys(criteria).sort(), ['contradicted', 'supported', 'unknown'])
  assert.equal(criteria.unknown, 'cannot be decided', 'the [abstain] marker is a flag, and it must not leak into the criterion')
})

test('a score keeps its ORDER, because the order is what the ladder means', () => {
  const built = buildQuestions({ questions: { draft: parseQuestions([LADDER]) } }, 'draft')
  assert.deepEqual(built.problems, [])
  assert.deepEqual(built.questions.draft_directness.criteria, ['not at all', 'partly', 'directly'])
})

test('a noul takes no array at all, and still carries both readings', () => {
  const built = buildQuestions({ questions: { admit: parseQuestions(['id=admit_x ;; type=noul ;; instructions=Is it so? ;; true=it holds ;; false=it does not']) } }, 'admit')
  assert.deepEqual(built.problems, [])
  assert.deepEqual(built.questions.admit_x.criteria, { true: 'it holds', false: 'it does not' })
})

test('the format WRITES ITSELF BACK, exactly, or it cannot be edited by the next person', () => {
  for (const text of [CHOICE, LADDER]) assert.equal(formatQuestion(parseQuestion(text)), text)
})

test('a malformed question is refused by FIELD, not guessed at', () => {
  const cases = [
    ['id=a ;; type=choice ;; instructions=x ;; option=nolabel', /an option is `label=criterion`/],
    ['id=a ;; type=noul', /no `instructions`/],
    ['type=noul ;; instructions=x', /no `id`/],
    ['id=a ;; instructions=x', /no `type`/],
    ['id=a ;; type=noul ;; instructions=x ;; colour=blue', /unknown field `colour`/],
    ['id=a ;; instructions', /not `key=value`/],
  ]
  for (const [text, pattern] of cases) assert.throws(() => parseQuestion(text), pattern, text)
})

test('the failing question is NAMED BY ITS POSITION, so a set of five says which one', () => {
  assert.throws(() => parseQuestions([CHOICE, 'id=b ;; type=noul']), /question 2:/)
})

// ── the three stages ────────────────────────────────────────────────────────────────────────────────

/** A criteria directory and a batteries directory, for the storing stage. */
function stores() {
  const root = mkdtempSync(join(tmpdir(), 'staged-'))
  mkdirSync(join(root, 'criteria'), { recursive: true })
  return join(root, 'criteria')
}

/** A decide tool whose model answers without spending anything. */
function decider(dir, asked) {
  return createDecideTool({
    setsDir: () => dir,
    record: () => {},
    decide: async (request) => {
      asked.push(request)
      return { kind: 'answers', answers: { admit_relation: { type: 'choice', label: 'supported' } }, executed: { provider: 'p', model: 'm' } }
    },
  })
}

test('COMPOSE AS STRINGS, then STORE, then ASK BY NAME -- nothing in the chain nests', async () => {
  const dir = stores()
  const asked = []

  // 1. COMPOSE + STORE. One question per flag, each a single string.
  const composer = createQuestionsTool({ dir })
  const written = await composer.execute({ action: 'write', set: 'staged@1', scope: 'admit', question: [CHOICE, LADDER.replace('draft_', 'admit_')] }, {})
  assert.deepEqual(written.problems ?? [], [])
  assert.ok(written.hash, 'and the composition hash comes back from disk')

  // 2. ASK BY NAME. A name and a scope; the questions never pass through a tool argument again.
  const value = await decider(dir, asked).execute({ state: 'a claim and an excerpt', set: 'staged@1', scope: 'admit' }, {})
  assert.deepEqual(Object.keys(value.answers), ['admit_relation'])
  assert.equal(asked[0].questions.admit_relation.criteria.supported, 'the excerpt supports the exact claim', 'the stored criterion is what reached the model')

  // 3. THE FILE IS ORDINARY JSON, because it was written by the tool rather than by a caller.
  const stored = JSON.parse(readFileSync(written.written, 'utf8'))
  assert.equal(stored.length, 2)
  assert.equal(stored[0].options[2].abstain, true)
})

test('a set may declare one scope, and then the caller need not name it', async () => {
  const dir = stores()
  const asked = []
  await createQuestionsTool({ dir }).execute({ action: 'write', set: 'single@1', scope: 'admit', question: [CHOICE] }, {})
  await decider(dir, asked).execute({ state: 'text', set: 'single@1' }, {})
  assert.equal(asked.length, 1, 'one declared scope is not ambiguous, so asking for it would be ceremony')
})

test('a set that declares several scopes still has to be narrowed', async () => {
  const dir = stores()
  await createQuestionsTool({ dir }).execute({ action: 'write', set: 'two@1', scope: 'admit', question: [CHOICE] }, {})
  await createQuestionsTool({ dir }).execute({ action: 'write', set: 'two@1', scope: 'draft', question: [LADDER], replace: true }, {})
  await assert.rejects(
    () => decider(dir, []).execute({ state: 'text', set: 'two@1' }, {}),
    /`scope` is required/,
  )
})

test('a name and an inline list together are REFUSED -- they can disagree and nothing would show it', async () => {
  const dir = stores()
  await createQuestionsTool({ dir }).execute({ action: 'write', set: 'staged@1', scope: 'admit', question: [CHOICE] }, {})
  await assert.rejects(
    () => decider(dir, []).execute({ state: 'x', set: 'staged@1', questions: [{ id: 'other', type: 'noul', instructions: 'y' }] }, {}),
    /not several/,   // ONE refusal now, from the shared module, whatever pair of routes was given
  )
})

test('a stored set that does not exist, and a scope it does not declare, are named', async () => {
  const dir = stores()
  await createQuestionsTool({ dir }).execute({ action: 'write', set: 'staged@1', scope: 'admit', question: [CHOICE] }, {})
  await assert.rejects(() => decider(dir, []).execute({ state: 'x', set: 'nope@9' }, {}))
  await assert.rejects(() => decider(dir, []).execute({ state: 'x', set: 'staged@1', scope: 'result' }, {}), /is not a scope/)
})

test('neither route given says WHICH route to take, and mentions storing first', async () => {
  await assert.rejects(
    () => decider(stores(), []).execute({ state: 'x' }, {}),
    /give `set`.*, `question`.*or `specs`.*survives the tool-call boundary/s,
  )
})

test('composing and storing is REFUSED when both forms are given, rather than merged', async () => {
  const composer = createQuestionsTool({ dir: stores() })
  // The refusal lands in `problem`, the single-reason field, rather than `problems` the list -- and saying which one
  // a caller reads is the difference between a test that pins a behaviour and one that passes beside it.
  const value = await composer.execute({ action: 'write', set: 'both@1', scope: 'admit', question: [CHOICE], specs: [{ id: 'x', type: 'noul', instructions: 'y' }] }, {})
  assert.match(String(value.problem), /not both/)
})

test('`lint` reads the same DSL, so a set is checked in the form it was written', async () => {
  const composer = createQuestionsTool({ dir: stores() })
  // A `draft` question naming SESSION TRANSCRIPT is legal at `session` and unanswerable at a seam. The DSL carries
  // the same text, so the same rule must fire.
  const bad = 'id=session_x ;; type=noul ;; instructions=Does the SESSION TRANSCRIPT show it?'
  const atSeam = await composer.execute({ action: 'lint', scope: 'draft', question: [bad] }, {})
  assert.equal(atSeam.ok, false)
  assert.ok((atSeam.findings ?? []).some((f) => f.rule === 'scope_state'))
  const atSession = await composer.execute({ action: 'lint', scope: 'session', question: [bad] }, {})
  assert.equal(atSession.ok, true, 'the same question is fine at the scope that emits that section')
})

// ── ONE IMPLEMENTATION, TWO CALLERS ───────────────────────────────────────────────────────────────────

test('the tool and the script resolve questions through the SAME module, and say so', async () => {
  const { readFileSync } = await import('node:fs')
  const tool = readFileSync(new URL('../lib/decide-tool.js', import.meta.url), 'utf8')
  const script = readFileSync(new URL('../scripts/ask.mjs', import.meta.url), 'utf8')
  // THE TEST THAT PREVENTS THE DRIFT, rather than describing it after the fact. Both files agreed by eye once and
  // disagreed twice -- the tool took `questions` while the script took a set, and the DSL reached only one of them.
  assert.match(tool, /from '\.\/system1\.js'/, 'the tool must go through the facade')
  assert.match(script, /from '\.\.\/lib\/system1\.js'/, 'and the script must too')
  // AND NEITHER MAY REACH PAST IT for anything about questions: `question-request` is the facade's own primitive.
  assert.equal(/question-request\.js'/.test(tool.replace(/sharedReadSpecs/g, '')), true, 'the tool keeps only the re-export')
  // THE CODE, NOT THE PROSE. The script's header names these modules to explain WHY it needs no dependency, and a
  // substring test over the whole file would read that explanation as a violation of it.
  const scriptCode = script.split('\n').filter((line) => !line.trimStart().startsWith('//')).join('\n')
  assert.equal(/question-lint|question-dsl|question-sets|question-request/.test(scriptCode), false, 'the standalone has no question code of its own')
  // NEITHER MAY GO TO THE MODEL ITS OWN WAY. The standalone used to build its client from `lib/model/client.js`
  // directly; it now asks the facade for one, so the credential and the endpoint are decided in the same place for
  // every surface -- which is the thing a second call site would quietly get wrong.
  assert.match(script, /wireTransport/, 'the standalone gets its transport from the facade too')
})

test('one question means the same thing whichever route carried it', async () => {
  const dir = stores()
  const asked = []
  const composer = createQuestionsTool({ dir })
  // STORED, then INLINE, from the same text -- and the questions that reach the model must be identical.
  await composer.execute({ action: 'write', set: 'same@1', scope: 'admit', question: [CHOICE] }, {})
  await decider(dir, asked).execute({ state: 'text', set: 'same@1' }, {})
  const viaName = JSON.stringify(asked[0].questions)
  await decider(dir, asked).execute({ state: 'text', question: [CHOICE] }, {})
  assert.equal(JSON.stringify(asked[1].questions), viaName, 'a stored set and the same question inline must build the same question')
})

test('both routes given is one refusal, and it names them', async () => {
  await assert.rejects(
    () => decider(stores(), []).execute({ state: 'x', set: 'staged@1', question: [CHOICE], questions: [{ id: 'y', type: 'noul', instructions: 'z' }] }, {}),
    /not several/,
  )
  await assert.rejects(() => decider(stores(), []).execute({ state: 'x' }, {}), /give `set`.*or `specs`.*survives the tool-call boundary/s)
})

// ── THE FIVE SURFACES, AND A SIXTH THAT WOULD BYPASS IT ──────────────────────────────────────────────

test('every surface that resolves questions goes through the facade, and a new one cannot join without it', async () => {
  const { readdirSync, readFileSync } = await import('node:fs')
  // THE SURFACES THE OPERATOR NAMED, and the rule each one breaks by reimplementing.
  const surfaces = {
    'system1_decide (the agent tool)': 'lib/decide-tool.js',
    'system1_battery': 'lib/battery-tool.js',
    'the row, for session measurement': 'index.js',
    'the standalone script': 'scripts/ask.mjs',
  }
  for (const [name, file] of Object.entries(surfaces)) {
    const source = readFileSync(new URL('../' + file, import.meta.url), 'utf8')
    assert.match(source, /system1\.js'/, `${name} must reach questions through lib/system1.js`)
  }

  // AND THE SEAL: a module that builds, loads or lints questions WITHOUT importing the facade is not a surface
  // this rule can see. So the check is over every file in `lib/`, not a list that a sixth file can join between
  // reviews -- the failure mode it prevents is a copy that is correct until it is not.
  const libFiles = readdirSync(new URL('../lib/', import.meta.url)).filter((name) => name.endsWith('.js'))
  const façade = new Set(['system1.js', 'question-request.js', 'questions.js', 'question-dsl.js', 'question-lint.js', 'question-sets.js'])
  // THE CODE, NOT THE COMMENTS. `instrument-input.js` names `buildQuestions` only to explain that the SET LOCATION
  // travels with the questions because the builder reads it -- and a substring test over prose reports an honest
  // explanation as a violation, which is how a seal like this gets switched off.
  const code = (source) => source.split('\n').filter((line) => !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*') && !line.trimStart().startsWith('/*')).join('\n')
  const bypasses = libFiles.filter((name) => !façade.has(name)).filter((name) => {
    const source = readFileSync(new URL('../lib/' + name, import.meta.url), 'utf8')
    const reaches = /buildQuestions|resolveQuestions|readSelectedSet|lintScope|lintSelection|parseQuestions/.test(code(source))
    return reaches && !/from '\.\/system1\.js'/.test(source)
  })
  assert.deepEqual(bypasses, [], `these modules reach questions without the facade: ${bypasses.join(', ')}`)
})

test('the row hands every tool a sets directory that RESOLVES -- the wiring is the part nothing else covered', async () => {
  const { readFileSync } = await import('node:fs')
  const row = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
  // THE DEFECT, and why it needed this test. `setSettings(sets)` takes the SETS and returns `{dir, name}`; passing
  // the whole question group instead reads `.sets` off `undefined` and throws on the first call that asks a set by
  // name. Every tool test injects `setsDir` directly, so 853 passing tests agreed with a row that could not answer a
  // single named-set call -- and it did, on the first live one. The failure is in the WIRING, so the guard reads the
  // wiring.
  // The negative form of this guard -- "no `setSettings(...)` may be followed by `.sets`" -- CANNOT be written, and
  // that is worth recording: the correct call reads `setSettings(questionGroup(cfg).sets).dir`, so it contains `.sets`
  // inside the parentheses too, and any regex for the buggy shape matches the good one. What distinguishes them is
  // whether the argument's own tail is `.sets`, which is not a substring question. So the guard below compares the
  // call SITES against each other instead, and uniformity is what catches the bug.

  // THE GUARD THAT ACTUALLY WORKS, which took three tries to find. The two SUBSTRINGS below differ by one pair of
  // parentheses, and that is the whole defect: `setSettings(questionGroup(cfg).sets)` passes the sets,
  // `setSettings(questionGroup(cfg)).sets` passes the group and then reads a property that is not there. Both forms
  // CONTAIN `.sets`, so a regex for the bad one matches the good one -- which is how the first two attempts at this
  // guard passed with the bug injected, and why it is written as two substring claims and nothing cleverer.
  // THE DISCRIMINATOR IS ONE CHARACTER. `.sets)` is the ARGUMENT -- questionGroup's sets, inside setSettings'
  // parentheses, which is what belongs there. `.sets.dir` or `.sets,` is a property of the RETURN VALUE, and
  // `setSettings` returns `{dir, name}`.
  //
  // This took three attempts, and the first two were WRONG IN A WORTH RECORDING WAY: a balanced-parenthesis regex and
  // then a `)).sets` substring, each of which either matched the good shape as well as the bad one or -- worse --
  // PASSED WITH THE BUG INJECTED, which is the failure mode that makes a guard worse than none, because it is
  // believed. So this was checked the only way that counts: the exact bug was written into `index.js` and the test
  // was watched to go red, then the file was restored and the test watched to go green again.
  const sites = row.split('\n').filter((line) => line.includes('setSettings('))
  assert.ok(sites.length >= 4, `every place the row resolves a sets directory is checked, and ${sites.length} were found`)
  for (const site of sites) {
    assert.ok(site.includes('.sets)'),
      `every setSettings call in the row takes the group's sets as its argument, not a property of its result: ${site.trim()}`)
  }
})



