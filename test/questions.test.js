import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildQuestions, questionCap, configuredQuestionIds, hasSpecs, readQuestionConfig } from '../lib/questions.js'

// THE TWO MODES. Legacy is what an unconfigured row does -- and the mode is read from the CONTENT of
// `questions`, not from whether the field exists, because schemastery materialises an unset object into
// `{assemble: [], admit: [], ...}` (measured, 2026-09-29). A test that only ever passes `{}` cannot see
// that, so `allSeamsEmpty()` below is the shape the host actually hands us.
function allSeamsEmpty() {
  const seams = ['assemble', 'admit', 'request', 'draft', 'pre_execute', 'execute', 'post_execute', 'result', 'close']
  return Object.fromEntries(seams.map(seam => [seam, []]))
}

test('with no configured question, the runtime probe question is used under the id `probe`', () => {
  const { questions, problems } = buildQuestions({}, 'admit')
  assert.deepEqual(Object.keys(questions), ['probe'])
  assert.equal(questions.probe.type, 'choice')
  assert.ok(questions.probe.instructions.length > 0)
  assert.deepEqual(problems, [])
})

test('a configured question becomes one noul under the same id, trimmed', () => {
  const { questions } = buildQuestions({ question: '  Does this reply look complete?  ' }, 'admit')
  assert.deepEqual(Object.keys(questions), ['probe'])
  assert.equal(questions.probe.type, 'noul')
  assert.equal(questions.probe.instructions, 'Does this reply look complete?')
  assert.equal(questions.probe.criteria, undefined)
})

test('a blank configured question falls back rather than asking nothing', () => {
  assert.equal(buildQuestions({ question: '   ' }, 'admit').questions.probe.type, 'choice')
  assert.equal(buildQuestions({ question: 42 }, 'admit').questions.probe.type, 'choice')
})

// THE MATERIALISED-EMPTY SHAPE. This is the regression that would have silenced a live trace: if an
// all-empty `questions` were read as "per-seam mode", every seam would ask nothing the moment the field
// existed in the schema, and the trace would simply stop having `call` lines.
test('a questions object with every seam empty is LEGACY, not per-seam silence', () => {
  assert.equal(hasSpecs(allSeamsEmpty()), false)
  const { questions } = buildQuestions({ questions: allSeamsEmpty() }, 'admit')
  assert.deepEqual(Object.keys(questions), ['probe'], 'the probe question must survive an unconfigured row')
})

test('one spec anywhere switches the row to per-seam mode, and other seams ask nothing', () => {
  const config = {
    questions: {
      ...allSeamsEmpty(),
      admit: [{ id: 'opening', type: 'noul', instructions: 'Is this the operator opening a step?' }],
    },
  }
  assert.equal(hasSpecs(readQuestionConfig(config)), true)

  const admit = buildQuestions(config, 'admit')
  assert.deepEqual(Object.keys(admit.questions), ['opening'])
  assert.equal(admit.questions.opening.type, 'noul')
  assert.equal(admit.questions.opening.instructions, 'Is this the operator opening a step?')

  // THE PER-SEAM CONTRACT: a seam with no question is a seam that must NOT be asked the probe question.
  const draft = buildQuestions(config, 'draft')
  assert.deepEqual(draft.questions, {}, 'an unconfigured seam asks nothing once any seam is configured')
  assert.deepEqual(draft.problems, [], 'and asking nothing is not a problem')
})

test('a choice carries its options and its abstain option through to the model', () => {
  const config = {
    questions: {
      ...allSeamsEmpty(),
      draft: [{
        id: 'purpose',
        type: 'choice',
        instructions: 'Which part of an agent loop produced this text?',
        options: [
          { label: 'model_output', criterion: 'text the model produced' },
          { label: 'unclear', criterion: 'none of these fits', abstain: true },
        ],
      }],
    },
  }
  const { questions, problems } = buildQuestions(config, 'draft')
  assert.deepEqual(problems, [])
  assert.deepEqual(questions.purpose, {
    type: 'choice',
    instructions: 'Which part of an agent loop produced this text?',
    criteria: { model_output: 'text the model produced', unclear: 'none of these fits' },
  })
})

test('a score takes its levels in order', () => {
  const config = {
    questions: { ...allSeamsEmpty(), close: [{ id: 'done', type: 'score', instructions: 'How complete?', levels: ['barely', 'partly', 'done'] }] },
  }
  const { questions } = buildQuestions(config, 'close')
  assert.deepEqual(questions.done.criteria, ['barely', 'partly', 'done'])
})

test('two questions at one seam are both asked, under both ids', () => {
  const config = {
    questions: {
      ...allSeamsEmpty(),
      pre_execute: [
        { id: 'safe', type: 'noul', instructions: 'Could this harm somebody?' },
        { id: 'reversible', type: 'noul', instructions: 'Could this be undone?' },
      ],
    },
  }
  const { questions, problems } = buildQuestions(config, 'pre_execute')
  assert.deepEqual(Object.keys(questions), ['safe', 'reversible'])
  assert.deepEqual(problems, [])
})

// A MALFORMED SPEC MUST NOT THROW. `observe` is in the critical path of every turn, and `buildQuestions`
// is called OUTSIDE the try that wraps `decide` -- a throw here reaches the harness listener and fails the
// turn. Every case below is a spec the card can produce or a hand-edited YAML can contain.
test('a spec that cannot become a question is a problem, never a throw', () => {
  const cases = [
    ['not an object', 'nope', /is not an object/],
    ['no id', { type: 'noul', instructions: 'x' }, /needs a non-empty id/],
    ['unknown type', { id: 'q', type: 'magic', instructions: 'x' }, /unknown type "magic"/],
    ['no instructions', { id: 'q', type: 'noul' }, /instructions must be a non-empty string/],
    ['one choice option', { id: 'q', type: 'choice', instructions: 'x', options: [{ label: 'a', criterion: 'b', abstain: true }] }, /at least two options/],
    ['no abstain option', { id: 'q', type: 'choice', instructions: 'x', options: [{ label: 'a', criterion: 'b' }, { label: 'c', criterion: 'd' }] }, /exactly one option must be the abstain option/],
    ['one score level', { id: 'q', type: 'score', instructions: 'x', levels: ['only'] }, /at least two ordered levels/],
    ['empty criteria', { id: 'q', type: 'noul', instructions: 'x', criteria: { true: '', false: 'f' } }, /criteria.true must be a non-empty string/],
  ]
  for (const [name, spec, expected] of cases) {
    const config = { questions: { ...allSeamsEmpty(), admit: [spec] } }
    let result
    assert.doesNotThrow(() => { result = buildQuestions(config, 'admit') }, `${name} must not throw`)
    assert.deepEqual(result.questions, {}, `${name} must not reach the model`)
    assert.equal(result.problems.length, 1, `${name} must record exactly one problem`)
    assert.match(result.problems[0], expected, `${name} must name the reason`)
    assert.match(result.problems[0], /admit\[0\]/, `${name} must say where the problem is`)
  }
})

test('a valid spec beside an invalid one is still asked, with the problem recorded', () => {
  const config = {
    questions: {
      ...allSeamsEmpty(),
      admit: [
        { id: 'good', type: 'noul', instructions: 'Is this the operator?' },
        { id: 'bad', type: 'magic', instructions: 'x' },
      ],
    },
  }
  const { questions, problems } = buildQuestions(config, 'admit')
  assert.deepEqual(Object.keys(questions), ['good'])
  assert.equal(problems.length, 1)
  assert.match(problems[0], /admit\[1\]/)
})

test('two questions with the same id at one seam keep the first and report the second', () => {
  const config = {
    questions: {
      ...allSeamsEmpty(),
      admit: [
        { id: 'same', type: 'noul', instructions: 'first' },
        { id: 'same', type: 'noul', instructions: 'second' },
      ],
    },
  }
  const { questions, problems } = buildQuestions(config, 'admit')
  assert.deepEqual(Object.keys(questions), ['same'])
  assert.equal(questions.same.instructions, 'first')
  assert.match(problems[0], /duplicate question id "same"/)
})

test('configuredQuestionIds reports the ids the mount line must not misreport', () => {
  assert.deepEqual(configuredQuestionIds({}), ['probe'], 'legacy mode asks the probe question')
  assert.deepEqual(configuredQuestionIds({ questions: allSeamsEmpty() }), ['probe'], 'an empty map is still legacy')
  const config = {
    questions: {
      ...allSeamsEmpty(),
      admit: [{ id: 'opening', type: 'noul', instructions: 'x' }],
      draft: [{ id: 'purpose', type: 'choice', instructions: 'y', options: [{ label: 'a', criterion: 'b' }, { label: 'c', criterion: 'd', abstain: true }] }],
    },
  }
  assert.deepEqual(configuredQuestionIds(config), ['opening', 'purpose'])
})

// A TYPO IN A HAND-EDITED YAML MUST NOT READ AS "NO CONFIG". Counting only declared seams would send the
// row back to the probe question everywhere, which is the question the operator believed they had
// replaced -- silently. Any key with a spec takes the row into per-seam mode, so the mismatch is audible.
test('a misspelled seam key switches to per-seam mode rather than quietly restoring the probe question', () => {
  const config = { questions: { ...allSeamsEmpty(), admti: [{ id: 'opening', type: 'noul', instructions: 'x' }] } }
  assert.equal(hasSpecs(readQuestionConfig(config)), true, 'a spec under an unknown key is still a config')
  const { questions } = buildQuestions(config, 'admit')
  assert.deepEqual(questions, {}, 'the seam it was meant for asks nothing rather than asking something else')
  assert.deepEqual(configuredQuestionIds(config), [], 'and the mount line must not claim a question that will never be asked')
})

// REFUSE, DO NOT TRUNCATE. The answer map is keyed by question id and `narrowAnswers` matches an answer to the
// question that was asked -- so a shortened question still produces answers, and they come back keyed to a
// question the row no longer has: a measurement of one thing filed under another. An empty map with a reason is
// the honest outcome, and `problem` is the plumbing that already reaches the line and the report.
test('a question text over the cap is refused whole, with the size and the cap named', () => {
  const long = 'x'.repeat(300)
  const config = {
    questions: { draft: [{ id: 'q', type: 'noul', instructions: long }] },
    maxQuestionChars: 200,
  }
  const built = buildQuestions(config, 'draft')
  assert.deepEqual(built.questions, {}, 'nothing is asked rather than something shorter')
  assert.equal(built.problems.length, 1)
  assert.match(built.problems[0], /serializes to \d+ characters, over the 200-character cap/)
  assert.match(built.problems[0], /refused rather than truncated/)
  assert.match(built.problems[0], /answer map is keyed by question/)
})

test('under the cap, and with no cap configured, the question is asked unchanged', () => {
  const config = { questions: { draft: [{ id: 'q', type: 'noul', instructions: 'is this complete?' }] } }
  const uncapped = buildQuestions(config, 'draft')
  assert.equal(Object.keys(uncapped.questions).length, 1)
  assert.equal(uncapped.problems.length, 0)
  assert.equal(questionCap(config), 4000, 'the default matches the sibling plugin’s hard cap')

  const generous = buildQuestions({ ...config, maxQuestionChars: 100000 }, 'draft')
  assert.equal(Object.keys(generous.questions).length, 1)

  // A cap of zero would refuse every question silently, so it is treated as unset rather than as a cap.
  assert.equal(questionCap({ maxQuestionChars: 0 }), 4000)
  assert.equal(questionCap({ maxQuestionChars: -5 }), 4000)
})

// The cap has to cover the LEGACY path too: the global `question` string is a question text like any other.
test('the legacy global question is capped as well', () => {
  const built = buildQuestions({ question: 'y'.repeat(5000), maxQuestionChars: 100 }, 'draft')
  assert.deepEqual(built.questions, {})
  assert.match(built.problems[0], /over the 100-character cap/)
})
