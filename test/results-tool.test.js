// WHAT THIS VIEW MUST NOT LET AN AGENT BELIEVE.
//
// Every test here is a false belief the summary could produce if it were written the obvious way: a rate over three
// answers, a mean of probabilities, a question that never separates passing as a measurement, and 39,400 skips
// disappearing behind 34 answers.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createResultsTool, MIN_N_FOR_RATE, RESULTS_TOOL_NAME, summarise, summariseQuestions } from '../lib/results-tool.js'
// THE READER, THE TALLY AND THE ANSWER EXTRACTOR NOW LIVE IN ONE PLACE, which is the point of the refactor.
import { answerOf, readTraceLines, writerOf } from '../lib/trace-read.js'

const call = (over = {}) => ({
  event: 'call',
  hook: 'draft',
  run: 'r1',
  agentId: 'session-a',
  model: 'jev-latest',
  questions: { q: { id: 'q', type: 'noul', instructions: 'is it?' } },
  answer: { kind: 'answers', answers: { q: { type: 'noul', probability: 0.8 } } },
  ...over,
})

test('a probability is read from the shapes the model actually narrows to', () => {
  assert.deepEqual(answerOf({ type: 'noul', probability: 0.8 }), { value: 0.8, kind: 'probability' })
  assert.deepEqual(answerOf({ type: 'noul', probabilityTrue: 0.2 }), { value: 0.2, kind: 'probability' })
  assert.deepEqual(answerOf({ type: 'choice', label: 'an_answer' }), { value: 'an_answer', kind: 'label' })
  assert.deepEqual(answerOf({ type: 'score', level: 'partly' }), { value: 'partly', kind: 'level' })
  // A CONFIDENCE IS NOT AN ANSWER: a noul that carries only a confidence has no probability to report, and reading
  // the confidence as one would invent a reading.
  assert.equal(answerOf({ type: 'noul', confidence: 1 }), null)
  assert.equal(answerOf(null), null)
  assert.equal(answerOf('0.8'), null)
})

test('probabilities are NEVER averaged, and below the bound they are listed raw', () => {
  const three = summarise([call({ answer: { answers: { q: { probability: 0.9 } } } }), call({ answer: { answers: { q: { probability: 0.1 } } } }), call({ answer: { answers: { q: { probability: 0.5 } } } })])
  const reading = three.groups[0].questions[0]
  assert.equal(reading.probabilities.n, 3)
  assert.equal(reading.probabilities.min, 0.1)
  assert.equal(reading.probabilities.max, 0.9)
  assert.equal(reading.probabilities.atOrAboveHalf, 2, 'two of three are at or above a half')
  assert.deepEqual(reading.probabilities.listed, [0.1, 0.5, 0.9], 'listed, so the spread is visible')
  assert.equal('mean' in reading.probabilities, false, 'a mean describes no answer that was given')
  assert.equal(reading.read < MIN_N_FOR_RATE, true)
  assert.match(reading.note, /below the 5 needed for a rate/)
})

test('a question whose answers never differ is called out, at any n', () => {
  const same = summarise([call({ answer: { answers: { q: { label: 'an_answer' } } } }), call({ answer: { answers: { q: { label: 'an_answer' } } } })])
  const reading = same.groups[0].questions[0]
  assert.equal(reading.separates, false)
  assert.match(reading.note, /not separating/)
  const differing = summarise([call({ answer: { answers: { q: { label: 'an_answer' } } } }), call({ answer: { answers: { q: { label: 'a_tool_call' } } } })])
  assert.equal(differing.groups[0].questions[0].separates, true)
  // ONE ANSWER IS NOT A SEPARATION CLAIM IN EITHER DIRECTION -- and the field is ABSENT rather than null, because
  // the runtime's enforced schema subset takes a scalar `type` and a field that is null half the time cannot be
  // declared honestly.
  const once = summarise([call()])
  assert.equal('separates' in once.groups[0].questions[0], false)
})

test('an unreadable answer is COUNTED, not treated as a value', () => {
  const read = summarise([call({ answer: { answers: { q: { type: 'noul' } } } }), call()])
  const reading = read.groups[0].questions[0]
  assert.equal(reading.read, 1)
  assert.equal(reading.unreadable, 1)
})

test('skips are reported beside the answers, with their reasons, and the share of silence is stated', () => {
  const lines = [
    call(),
    { event: 'skip', hook: 'assemble', reason: 'no question configured for this seam' },
    { event: 'skip', hook: 'admit', reason: 'no question configured for this seam' },
    { event: 'skip', hook: 'close', reason: 'no text at this seam' },
    { event: 'mount', run: 'r1', model: 'jev-latest', provider: 'typesafe', hooks: ['draft'], probeHash: 'abc', sessions: ['s1'] },
  ]
  const summary = summarise(lines)
  // ONE VOCABULARY, from `lib/trace-read.js`: every kind the plugin can write is counted by name.
  assert.deepEqual(summary.counts, { total: 5, broken: 0, call: 1, skip: 3, mount: 1, config: 0, error: 0, rotate: 0, other: 0, secondWriter: 0 })
  assert.deepEqual(summary.skips, [
    { reason: 'no question configured for this seam', n: 2 },
    { reason: 'no text at this seam', n: 1 },
  ])
  assert.equal(summary.mount.model, 'jev-latest')
  const tool = createResultsTool({ path: '/dev/null', readFile: () => lines.map((l) => JSON.stringify(l)).join('\n') })
  const out = tool.execute({})
  return out.then((value) => {
    const rendered = tool.output.render({}, value)[0].text
    assert.match(rendered, /asked something at 1 of 5 lines/)
    assert.match(rendered, /2x no question configured for this seam/)
    assert.match(rendered, /1x no text at this seam/)
    assert.match(rendered, /NOT REPORTED: asked nothing at 3 point/)
  })
})

test('BOTH writers are read, and never pooled (O17)', () => {
  // The first draft of this view COUNTED the turn writer's lines and dropped them. The review's correction: read
  // both shapes into one canonical reading, carry the writer through, and never merge the two groups -- dropping
  // loses evidence, pooling compares two records instead of two measurements.
  const summary = summarise([
    call(),
    { event: 'call', hook: 'turn', run: 'r1', answers: { q: { type: 'noul', probability: 0.7 } }, questionIds: ['q'] },
  ])
  assert.equal(summary.counts.call, 2, 'both are calls and both are counted')
  assert.equal(summary.counts.secondWriter, 1, 'and the turn one is named as the second writer')
  assert.deepEqual(summary.groups.map((g) => g.writer).sort(), ['seam', 'turn'], 'one group per writer')
  assert.equal(summary.groups.every((g) => g.calls === 1), true, 'never pooled')
  assert.equal(summary.groups.find((g) => g.writer === 'turn').questions[0].probabilities.min, 0.7, 'and its answer is READ')
  assert.match(summary.refusals.join(' '), /turn writer/)
  assert.match(summary.refusals.join(' '), /O17/)
})

test('a window spanning backends, truncation, or a config change is refused rather than pooled', () => {
  const twoBackends = summarise([call(), call({ provider: 'other', model: 'other-1' })])
  assert.match(twoBackends.refusals.join(' '), /spans 2 backend\(s\)/)
  const truncated = summarise([call(), call({ truncated: true })])
  assert.match(truncated.refusals.join(' '), /TRUNCATED state/)
  const changed = summarise([call(), { event: 'config', knob: 'calibrationBins', from: 10, to: 20 }])
  assert.match(changed.refusals.join(' '), /configuration change\(s\) fall inside this window \(calibrationBins\)/)
  // and the calibration gap is always named, because an uncalibrated question at any n is weaker evidence
  assert.match(summarise([call()]).refusals.join(' '), /cannot say whether a reading is CALIBRATED/)
})

test('an unattributable reading is refused out loud, and the RUN TABLE is the join that fixes it', () => {
  // (a) nothing declared anywhere: both gaps are named, in the terms a reader can act on.
  const bare = summarise([call(), { event: 'mount', run: 'r1', model: 'm', provider: 'p', hooks: [], probeHash: 'h', sessions: [] }])
  assert.match(bare.refusals.join(' '), /no call line records a harness technique/)
  assert.match(bare.refusals.join(' '), /no mount line records the QUESTION SET/)
  assert.equal(bare.mount.probeHash, 'h')
  assert.deepEqual(bare.runs, [{ run: 'r1', calls: 1, model: 'm' }], 'the run is listed even when it names neither')

  // (b) a row that DOES record them: the runs table joins the reading to the set and the technique, and neither gap
  // is claimed -- which is what makes item 4 of the plan possible at all.
  // THE CALL CARRIES THE AXES TOO, because that is how a real row records them: `observe.js` reads both labels at the
  // point of use, so a call line names the technique and the operator in force when it was asked, and the mount line
  // names what the run started with.
  const attributed = summarise([
    call({ harnessHash: 'abc123abc123', userHash: 'def456def456' }),
    { event: 'mount', run: 'r1', model: 'm', provider: 'p', hooks: [], probeHash: 'h', questionSetHash: 'set123456789', harnessHash: 'abc123abc123', userHash: 'def456def456' },
  ])
  assert.deepEqual(attributed.runs, [{ run: 'r1', calls: 1, model: 'm', questionSetHash: 'set123456789', harnessHash: 'abc123abc123', userHash: 'def456def456' }])
  assert.equal(attributed.refusals.some((r) => /no call line records a harness technique|no mount line records the QUESTION SET/.test(r)), false)
})

test('a window spanning two TECHNIQUES or two OPERATORS is refused rather than pooled', () => {
  const twoTechniques = summarise([call({ harnessHash: 'aaa' }), call({ harnessHash: 'bbb' })])
  assert.match(twoTechniques.refusals.join(' '), /spans 2 harness technique\(s\)/)
  // AND AN UNLABELLED LINE IS A THIRD VALUE, not something to skip: it cannot be assigned to either treatment.
  const mixed = summarise([call({ harnessHash: 'aaa' }), call()])
  assert.match(mixed.refusals.join(' '), /carries NO declared technique, which cannot be assigned/)
  const twoOperators = summarise([call({ userHash: 'aaa' }), call({ userHash: 'bbb' })])
  assert.match(twoOperators.refusals.join(' '), /spans 2 operator\(s\)/)
  assert.match(twoOperators.refusals.join(' '), /only under ONE common question set/)
  // one technique, one operator: no such refusal
  const one = summarise([call({ harnessHash: 'aaa', userHash: 'bbb' }), call({ harnessHash: 'aaa', userHash: 'bbb' })])
  assert.equal(one.refusals.some((r) => /harness technique|operator\(s\)/.test(r)), false)
})

test('grouping by agent keeps two agents apart rather than pooling them', () => {
  const summary = summarise([
    call({ agentId: 'session-a', answer: { answers: { q: { probability: 0.9 } } } }),
    call({ agentId: 'session-b', answer: { answers: { q: { probability: 0.1 } } } }),
  ], { groupBy: 'agent' })
  assert.deepEqual(summary.groups.map((g) => g.key).sort(), ['session-a', 'session-b'])
  assert.equal(summary.groups.find((g) => g.key === 'session-a').questions[0].probabilities.min, 0.9)
  assert.equal(summary.groups.find((g) => g.key === 'session-b').questions[0].probabilities.min, 0.1)
})

test('unparseable lines are counted, not dropped', () => {
  const parsed = readTraceLines('{"event":"call"}\nnot json\n\n{"event":"skip"}')
  assert.equal(parsed.lines.length, 2)
  assert.equal(parsed.broken, 1)
  const summary = summarise(parsed.lines, { broken: parsed.broken })
  assert.equal(summary.counts.broken, 1)
  assert.match(summary.refusals.join(' '), /1 line\(s\) in the file could not be parsed/)
})

test('a missing trace is UNAVAILABLE rather than an empty measurement', async () => {
  const tool = createResultsTool({ path: '/nope/missing.jsonl', readFile: () => { throw new Error('ENOENT') } })
  const out = await tool.execute({})
  assert.match(out.problem, /cannot read/)
  assert.equal(tool.output.render({}, out)[0].text.startsWith('UNAVAILABLE'), true)
})

test('the tool declares what it emits, and its name is the one the registry knows', () => {
  const tool = createResultsTool({ path: '/dev/null', readFile: () => '' })
  assert.equal(tool.name, RESULTS_TOOL_NAME)
  assert.equal(tool.name, 'system1_measurements')
  for (const key of ['window', 'counts', 'skips', 'groups', 'mount', 'refusals', 'problem']) {
    assert.ok(tool.output.schema.properties[key] !== undefined, key + ' is declared')
  }
  return tool.execute({}).then((value) => {
    for (const key of Object.keys(value)) {
      assert.ok(tool.output.schema.properties[key] !== undefined, key + ' is emitted and declared')
    }
  })
})

// REGISTER ROW O18 FROM THE READER'S SIDE. `system1_decide` now records every outcome, including a failure -- so a
// line shape that did not exist before is arriving in the trace. Without this count it would land in `asked` and
// nowhere else: a question asked ten times with three timeouts would report `n=7` and say nothing about the three.
test('a call that FAILED is counted as asked and failed, not silently dropped from n', async () => {
  const lines = [
    call({ at: 'T1' }),
    // The tool writer's shape on a failure: `answers: {}`, the ids asked, and the reason. No `questions` map, because
    // the turn/tool writers record ids.
    { event: 'call', hook: 'tool', run: 'r1', at: 'T2', tool: 'system1-observer', questionIds: ['q'], answers: {}, failure: { reason: 'the service refused' } },
    call({ at: 'T3' }),
  ]
  const summary = summariseQuestions(lines)
  const q = summary.find((entry) => entry.id === 'q')
  assert.equal(q.asked, 3, 'all three were asked')
  assert.equal(q.read, 2, 'two produced an answer')
  assert.equal(q.failed, 1, 'and one produced nothing, which is a fact about the measurement')
  // AND THE REFUSAL ABOUT THE SECOND WRITER DOES NOT CLAIM A TOOL LINE CAME FROM THE TURN WRITER, which is what a
  // shape test did: `answer === undefined && answers !== undefined` is true of every `system1_decide` line too.
  const windowed = summarise([...lines, { event: 'call', hook: 'turn', turn: 5, run: 'r1', at: 'T4', questionIds: ['q'], answers: { q: { type: 'noul', probability: 0.5 } } }])
  assert.equal(windowed.counts.secondWriter, 1, 'one line came from the turn writer')
  assert.match(windowed.refusals.join(' '), /^1 call line\(s\) came from the turn writer/)
  assert.doesNotMatch(windowed.refusals.join(' '), /2 call line\(s\) came from the turn writer/, 'the tool line is not one of them')
  // AND THE RENDER SHOWS THE FAILURE, rather than `n=2` beside three attempts.
  const tool = createResultsTool({ path: '/dev/null', readFile: () => lines.map((l) => JSON.stringify(l)).join('\n') })
  const value = await tool.execute({})
  const text = tool.output.render({}, value)[0].text
  // THE TWO SHAPES ARE NEVER POOLED, so the failure appears in the tool line's own group: `n=0 FAILED=1` beside the
  // seam group's `n=2`. That is the accounting working -- the three attempts are visible and attributed.
  assert.match(text, /q \[\?\]: n=0 FAILED=1 \(asked, no answer/, 'the failure is on the record: ' + (text.split('\n').find((l) => l.includes('FAILED')) ?? '(nothing said FAILED)'))
  assert.match(text, /hook tool \[the `answers` shape -- a tool or evaluation line, NOT the turn writer\]/, 'and a tool line is not labelled the turn writer')
  assert.doesNotMatch(text.split('hook tool')[1].split('\n')[0], /\[the turn writer\]/, 'which is what a shape test used to say about it')
})
