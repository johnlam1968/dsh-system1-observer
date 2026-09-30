import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createObserver } from '../lib/observe.js'
import { exitCodeOf } from '../lib/seams.js'

function recorder() {
  const lines = []
  return { lines, trace: (event, fields) => lines.push({ event, ...(typeof fields === 'function' ? fields() : fields) }) }
}

// OBSERVATION IS OPT-IN PER SESSION, so a test about anything else has to say which session it is -- with no
// session named, EVERY firing is a `session not observed` skip and the gate under test never runs. This helper
// pins the agent to the one session the shared config names, and it is AUTHORITATIVE rather than a default: a
// test's own `agentId` cannot silently point it at a session nobody configured. The session-gate tests call
// `observer.observe` directly, because the id is their whole subject.
const TEST_SESSION = 'session-test'
const config = { transport: 'service', provider: 'typesafe', model: 'jev-latest', maxFieldChars: 1000, sessions: [TEST_SESSION] }

function observed(observer, hook, text, meta = {}) {
  return observer.observe(hook, text, { turn: 1, step: 2, ...meta, agentId: TEST_SESSION })
}

test('a successful call is traced with both halves of the exchange', async () => {
  const { lines, trace } = recorder()
  const answer = { kind: 'answers', answers: { probe: { type: 'choice', label: 'model_output', confidence: 0.9 } } }
  const observer = createObserver({ decide: async () => answer, trace, readConfig: () => config })
  await observed(observer, 'draft', 'hello', { agentId: 'a1', turn: 1, step: 2, purpose: null })
  assert.equal(lines.length, 1)
  assert.equal(lines[0].event, 'call')
  assert.equal(lines[0].hook, 'draft')
  assert.equal(lines[0].hostEvent, 'llm/stream')
  // THE MODEL'S INPUT IS THE EVIDENCE, SO IT WAS WRITTEN TWICE. `excerpt` carries the text the model was
  // asked about, and `state` -- which still reaches `decide()` below -- was the SAME string under another key:
  // measured on all 4,379 call lines across this deployment's two traces, `excerpt === state.text` every time.
  // Call lines were 95.9% of the bytes in the all-seams configuration, so half of that was this duplicate.
  assert.equal(lines[0].excerpt, 'hello')
  assert.equal(Object.hasOwn(lines[0], 'state'), false, 'the excerpt is written once, not twice')
  assert.equal(lines[0].questions.probe.type, 'choice')
  assert.deepEqual(lines[0].answer, answer)
  assert.equal(lines[0].transport, 'service')
  assert.equal(lines[0].provider, 'typesafe')
  assert.equal(lines[0].agentId, TEST_SESSION)
  assert.equal(lines[0].truncated, false)
  assert.equal(typeof lines[0].ms, 'number')
})

test('a failing decide is traced as an error, never thrown, and never reaches the loop', async () => {
  const { lines, trace } = recorder()
  const observer = createObserver({ decide: async () => { throw new Error('boom') }, trace, readConfig: () => config })
  await observed(observer, 'pre_execute', 'bash {"command":"ls"}', { agentId: 'a1' })
  assert.equal(lines.length, 1)
  assert.equal(lines[0].event, 'error')
  assert.match(lines[0].error, /boom/)
  assert.equal(lines[0].hook, 'pre_execute')
})

// WHY THESE THREE EXIST: `requested`/`executed` are bound TOP-LEVEL by spec §8, but the runtime's
// ModelResult has no such fields -- they live inside `envelope` (`model/client.ts`, `model/service.ts`).
// The first version read `result?.requested`/`result?.executed`, so every live `call` line carried
// `"requested":null,"executed":null` beside a populated envelope, and no test mentioned either field.
test('a call records requested and executed from the result envelope at the top level', async () => {
  const { lines, trace } = recorder()
  const envelope = {
    requested: { provider: 'typesafe', model: 'jev-latest' },
    executed: { provider: 'typesafe', model: 'typesafe/jev-1.13-20260917' },
  }
  const observer = createObserver({
    decide: async () => ({ kind: 'answers', answers: {}, envelope }),
    trace,
    readConfig: () => config,
  })
  await observed(observer, 'draft', 'hi', { agentId: 'a1' })
  assert.equal(lines[0].event, 'call')
  assert.deepEqual(lines[0].requested, envelope.requested)
  assert.deepEqual(lines[0].executed, envelope.executed)
})

test('a wire-shaped result projects requested as null and executed from the envelope', async () => {
  const { lines, trace } = recorder()
  // The wire client's ENVELOPE list carries `executed` but not `requested` (`model/client.ts`), so this
  // is the shape the fallback transport really produces: one present, one absent, and the absent one null.
  const envelope = { executed: { provider: 'laya', model: 'auto' }, model: 'auto' }
  const observer = createObserver({
    decide: async () => ({ kind: 'answers', answers: {}, worstCase: 0, envelope, rawAnswers: {} }),
    trace,
    readConfig: () => config,
  })
  await observed(observer, 'draft', 'hi', { agentId: 'a1' })
  assert.equal(lines[0].requested, null)
  assert.deepEqual(lines[0].executed, envelope.executed)
})

test('a top-level requested/executed is not projected: the envelope is the only source', async () => {
  const { lines, trace } = recorder()
  // A FALLBACK TO THE TOP-LEVEL FIELD IS WHAT CAUSED THE BUG in the first place: a second projection that
  // looks correct while the field it reads is never populated.
  const observer = createObserver({
    decide: async () => ({ kind: 'answers', answers: {}, requested: { provider: 't' }, executed: { provider: 't' } }),
    trace,
    readConfig: () => config,
  })
  await observed(observer, 'draft', 'hi', { agentId: 'a1' })
  assert.equal(lines[0].requested, null)
  assert.equal(lines[0].executed, null)
})

// SPEC 6 BINDS: "A timeout, a non-2xx, a malformed body, an unresolvable credential and a throwing trace
// each become an `error` line", and 8 shows that line. The runtime's clients RETURN `{kind:'error', reason}`
// rather than throwing, so an outage was recorded as a `call` line whose `answer.kind` was `'error'` --
// invisible to anyone counting `error` lines. This test used to assert that wrong behaviour.
test('a returned error result is written as an error line with its reason, and no call line', async () => {
  const { lines, trace } = recorder()
  const observer = createObserver({
    decide: async () => ({ kind: 'error', reason: 'the request timed out after 8000 ms' }),
    trace,
    readConfig: () => config,
  })
  await observed(observer, 'draft', 'hi', { agentId: 'a1' })
  assert.equal(lines.length, 1, 'an error result must not also write a call line')
  assert.equal(lines[0].event, 'error')
  assert.equal(lines[0].error, 'the request timed out after 8000 ms')
  assert.equal(lines[0].hook, 'draft')
  assert.equal(lines[0].hostEvent, 'llm/stream')
  assert.equal(typeof lines[0].ms, 'number')
})

test('a returned error result with no reason still writes an error line', async () => {
  const { lines, trace } = recorder()
  const observer = createObserver({ decide: async () => ({ kind: 'error' }), trace, readConfig: () => config })
  await observed(observer, 'draft', 'hi', {})
  assert.equal(lines.length, 1)
  assert.equal(lines[0].event, 'error')
  assert.equal(lines[0].error, 'the model client returned an error')
})

test('a result that is neither answers nor an error is still recorded as a call', async () => {
  const { lines, trace } = recorder()
  // The error branch must not swallow every unreadable result: a result of any other kind keeps the `call`
  // line, which is what today's behaviour does and what the spec's `call` line is for.
  const odd = { kind: 'something-else', detail: 'kept' }
  const observer = createObserver({ decide: async () => odd, trace, readConfig: () => config })
  await observed(observer, 'draft', 'hi', {})
  assert.equal(lines.length, 1)
  assert.equal(lines[0].event, 'call')
  assert.deepEqual(lines[0].answer, odd)
})

test('a state longer than maxFieldChars is truncated and marked', async () => {
  const { lines, trace } = recorder()
  const observer = createObserver({ decide: async () => ({ kind: 'answers', answers: {} }), trace, readConfig: () => ({ ...config, maxFieldChars: 10 }) })
  await observed(observer, 'draft', 'x'.repeat(50), {})
  assert.equal(lines[0].excerpt.length, 10)
  assert.equal(lines[0].truncated, true)
})

test('a seam with no text is recorded as a skip and never reaches the model', async () => {
  const { lines, trace } = recorder()
  let called = 0
  const observer = createObserver({
    decide: async () => { called += 1; return { kind: 'answers', answers: {} } },
    trace,
    readConfig: () => config,
  })
  await observed(observer, 'close', '', { agentId: 'a1' })
  await observed(observer, 'request', '   ', { agentId: 'a1' })
  assert.equal(called, 0)
  assert.equal(lines.length, 2)
  assert.equal(lines[0].event, 'skip')
  assert.equal(lines[0].hook, 'close')
  assert.equal(lines[0].reason, 'no text at this seam')
  assert.equal(lines[1].event, 'skip')
})

test('a throwing trace cannot fail the turn', async () => {
  const observer = createObserver({
    decide: async () => ({ kind: 'answers', answers: {} }),
    trace: () => { throw new Error('the disk is gone') },
    readConfig: () => config,
  })
  await assert.doesNotReject(() => observed(observer, 'draft', 'hi', {}))
})

// THE PER-SEAM MODE, END TO END THROUGH THE OBSERVER. `buildQuestions` lives outside the try that wraps
// `decide`, so these two are about the critical-path contract as much as about the questions: a seam with
// no question must produce a LINE and no HTTP call, and a seam with a broken spec must not throw into the
// harness listener. `allSeamsEmpty` is the shape the host really hands us for an unconfigured row.
function configuredWith(seam, specs) {
  const seams = ['assemble', 'admit', 'request', 'draft', 'pre_execute', 'execute', 'post_execute', 'result', 'close']
  const questions = Object.fromEntries(seams.map(name => [name, []]))
  questions[seam] = specs
  return { ...config, questions }
}

test('a configured seam asks its own question, under its own id', async () => {
  const { lines, trace } = recorder()
  const seen = []
  const observer = createObserver({
    decide: async (request) => { seen.push(request); return { kind: 'answers', answers: {} } },
    trace,
    readConfig: () => configuredWith('draft', [{ id: 'purpose', type: 'noul', instructions: 'Is this the reply?' }]),
  })
  await observed(observer, 'draft', 'hello', {})
  assert.equal(lines.length, 1)
  assert.equal(lines[0].event, 'call')
  assert.deepEqual(Object.keys(lines[0].questions), ['purpose'])
  assert.equal(lines[0].questions.purpose.instructions, 'Is this the reply?')
  assert.deepEqual(seen[0].questions, lines[0].questions, 'the trace must record the questions as sent')
  assert.equal(lines[0].problems, undefined, 'a clean config writes no problems field')
})

test('a seam with no configured question is a skip and never reaches the model', async () => {
  const { lines, trace } = recorder()
  let called = 0
  const observer = createObserver({
    decide: async () => { called += 1; return { kind: 'answers', answers: {} } },
    trace,
    readConfig: () => configuredWith('admit', [{ id: 'opening', type: 'noul', instructions: 'Is this the operator?' }]),
  })
  await observed(observer, 'draft', 'hello', { agentId: 'a1' })
  assert.equal(called, 0, 'a seam with no question must not reach the model')
  assert.equal(lines.length, 1)
  assert.equal(lines[0].event, 'skip')
  assert.equal(lines[0].reason, 'no question configured for this seam')
  assert.equal(lines[0].problems, undefined)
})

test('a broken spec is a skip that names the problem, and never a throw', async () => {
  const { lines, trace } = recorder()
  let called = 0
  const observer = createObserver({
    decide: async () => { called += 1; return { kind: 'answers', answers: {} } },
    trace,
    readConfig: () => configuredWith('admit', [{ id: 'q', type: 'choice', instructions: 'x', options: [{ label: 'a', criterion: 'b', abstain: true }] }]),
  })
  await assert.doesNotReject(() => observed(observer, 'admit', 'hello', {}))
  assert.equal(called, 0)
  assert.equal(lines[0].event, 'skip')
  assert.match(lines[0].reason, /no usable question/)
  assert.match(lines[0].reason, /at least two options/)
  assert.equal(lines[0].problems.length, 1, 'the machine-readable reasons travel beside the reason line')
})

test('a partly broken config still asks the good question and records the problem', async () => {
  const { lines, trace } = recorder()
  const observer = createObserver({
    decide: async () => ({ kind: 'answers', answers: {} }),
    trace,
    readConfig: () => configuredWith('admit', [
      { id: 'good', type: 'noul', instructions: 'Is this the operator?' },
      { id: 'bad', type: 'score', instructions: 'x', levels: ['one'] },
    ]),
  })
  await observed(observer, 'admit', 'hello', {})
  assert.equal(lines[0].event, 'call')
  assert.deepEqual(Object.keys(lines[0].questions), ['good'])
  assert.equal(lines[0].problems.length, 1)
  assert.match(lines[0].problems[0], /admit\[1\]/)
})

test('an unconfigured row keeps asking the probe question -- the upgrade path', async () => {
  const { lines, trace } = recorder()
  const observer = createObserver({ decide: async () => ({ kind: 'answers', answers: {} }), trace, readConfig: () => config })
  await observed(observer, 'draft', 'hello', {})
  assert.equal(lines[0].event, 'call')
  assert.deepEqual(Object.keys(lines[0].questions), ['probe'])
})

// THE KILL SWITCH. It has to stop the request, keep the questions, and leave a line that says why -- and
// an ABSENT field has to mean ON, which is the assertion that matters most: a switch that turns itself off
// when nobody set it would silently stop the observer on every existing install.
test('callsEnabled false records a skip at every seam and makes no request', async () => {
  const { lines, trace } = recorder()
  let called = 0
  const observer = createObserver({
    decide: async () => { called += 1; return { kind: 'answers', answers: {} } },
    trace,
    readConfig: () => ({ ...config, callsEnabled: false, questions: configuredWith('draft', [{ id: 'q', type: 'noul', instructions: 'x' }]).questions }),
  })
  await observed(observer, 'draft', 'hello', { agentId: 'a1' })
  await observed(observer, 'admit', 'hello', { agentId: 'a1' })
  assert.equal(called, 0, 'the switch must stop the model call, not just hide its answer')
  assert.equal(lines.length, 2)
  assert.deepEqual(lines.map(line => line.event), ['skip', 'skip'])
  assert.deepEqual(lines.map(line => line.reason), ['calls disabled', 'calls disabled'])
  assert.equal(lines[0].hook, 'draft', 'the line still says which seam was passed over')
  assert.equal(lines[0].hostEvent, 'llm/stream')
})

test('an absent callsEnabled leaves the observer ON, and true is on too', async () => {
  for (const readConfig of [
    () => config,                                    // the field has never been written
    () => ({ ...config, callsEnabled: true }),
    () => ({ ...config, callsEnabled: 'yes' }),      // not exactly false, so not off
  ]) {
    const { lines, trace } = recorder()
    let called = 0
    const observer = createObserver({ decide: async () => { called += 1; return { kind: 'answers', answers: {} } }, trace, readConfig })
    await observed(observer, 'draft', 'hello', {})
    assert.equal(called, 1, 'only an explicit false may disable the calls')
    assert.equal(lines[0].event, 'call')
  }
})

test('the switch is read at the point of use, so flipping it does not need a re-apply', async () => {
  const { lines, trace } = recorder()
  let enabled = true
  let called = 0
  const observer = createObserver({
    decide: async () => { called += 1; return { kind: 'answers', answers: {} } },
    trace,
    readConfig: () => ({ ...config, callsEnabled: enabled }),
  })
  await observed(observer, 'draft', 'hello', {})
  enabled = false
  await observed(observer, 'draft', 'hello', {})
  enabled = true
  await observed(observer, 'draft', 'hello', {})
  assert.deepEqual(lines.map(line => line.event), ['call', 'skip', 'call'])
  assert.equal(called, 2)
})

// THE PER-SEAM SWITCHES. `undefined` and `true` both mean ON, and the reason for the skip is DIFFERENT from
// the master's: "everything is paused" and "this one seam is off" are different facts about a run.
test('a seam switched off records its own reason and leaves the other seams alone', async () => {
  const { lines, trace } = recorder()
  const called = []
  const observer = createObserver({
    decide: async (request) => { called.push(request.state.hook); return { kind: 'answers', answers: {} } },
    trace,
    readConfig: () => ({ ...config, seamEnabled: { draft: false } }),
  })
  await observed(observer, 'draft', 'hello', {})
  await observed(observer, 'admit', 'hello', {})
  assert.deepEqual(called, ['admit'], 'only the switched-off seam is passed over')
  assert.equal(lines[0].event, 'skip')
  assert.equal(lines[0].reason, 'calls disabled at this seam')
  assert.equal(lines[0].hook, 'draft')
  assert.equal(lines[1].event, 'call')
})

test('an unset or absent seam switch means ON -- the upgrade path', async () => {
  for (const seamEnabled of [
    undefined,                       // the field has never been written
    {},                              // materialised, every key absent
    { admit: true },                 // some other seam named
    { draft: 'yes' },                // not exactly false, so not off
  ]) {
    const { lines, trace } = recorder()
    let calls = 0
    const observer = createObserver({ decide: async () => { calls += 1; return { kind: 'answers', answers: {} } }, trace, readConfig: () => ({ ...config, seamEnabled }) })
    await observed(observer, 'draft', 'hello', {})
    assert.equal(lines[0].event, 'call', `seamEnabled ${JSON.stringify(seamEnabled)} must leave the seam ON`)
    assert.equal(calls, 1)
  }
})

test('the master switch wins over a seam switch that is on', async () => {
  const { lines, trace } = recorder()
  let calls = 0
  const observer = createObserver({
    decide: async () => { calls += 1; return { kind: 'answers', answers: {} } },
    trace,
    readConfig: () => ({ ...config, callsEnabled: false, seamEnabled: { draft: true } }),
  })
  await observed(observer, 'draft', 'hello', {})
  assert.equal(lines[0].reason, 'calls disabled', 'a paused row says so once, not per seam')
  assert.equal(calls, 0)
})

// THE SESSION GATE. `meta.agentId` is the session id and it already reached this far for every seam, so
// targeting costs a comparison -- and the REASON is its own, so "another conversation is running" cannot be
// confused with "I switched this seam off".
test('a firing from another session is a skip with its own reason', async () => {
  const { lines, trace } = recorder()
  const called = []
  const observer = createObserver({
    decide: async (request) => { called.push(request.state.hook); return { kind: 'answers', answers: {} } },
    trace,
    readConfig: () => ({ ...config, sessions: ['session-target'] }),
  })
  await observer.observe('draft', 'hello', { agentId: 'session-other-1' })
  await observer.observe('draft', 'hello', { agentId: 'session-target-abc' })
  assert.deepEqual(called, ['draft'], 'only the targeted session reaches the model')
  assert.equal(lines[0].event, 'skip')
  assert.equal(lines[0].reason, 'session not observed')
  assert.equal(lines[0].agentId, 'session-other-1', 'the line still says which session was passed over')
  assert.equal(lines[1].event, 'call')
})

test('an empty session list observes NOTHING -- opt-in, and off until a session is named', async () => {
  const { lines, trace } = recorder()
  let calls = 0
  const observer = createObserver({ decide: async () => { calls += 1; return { kind: 'answers', answers: {} } }, trace, readConfig: () => ({ ...config, sessions: [] }) })
  await observer.observe('draft', 'hello', { agentId: 'session-anything' })
  assert.equal(lines[0].event, 'skip')
  assert.equal(lines[0].reason, 'session not observed')
  assert.equal(calls, 0)
})

// THE ORDER IS A FEATURE: a session the row does not watch says so at EVERY seam, so a trace from another
// conversation is uniformly `session not observed` rather than a mixture that reads like a broken config.
test('the session gate is decided before the seam gate', async () => {
  const { lines, trace } = recorder()
  const observer = createObserver({
    decide: async () => ({ kind: 'answers', answers: {} }),
    trace,
    readConfig: () => ({ ...config, sessions: ['session-target'], seamEnabled: { draft: false } }),
  })
  await observer.observe('draft', 'hello', { agentId: 'session-other' })
  assert.equal(lines[0].reason, 'session not observed', 'who comes before what')
  await observer.observe('draft', 'hello', { agentId: 'session-target-1' })
  assert.equal(lines[1].reason, 'calls disabled at this seam', 'and inside the target, the seam switch applies')
})

test('the master switch still outranks the session gate', async () => {
  const { lines, trace } = recorder()
  let calls = 0
  const observer = createObserver({
    decide: async () => { calls += 1; return { kind: 'answers', answers: {} } },
    trace,
    readConfig: () => ({ ...config, callsEnabled: false, sessions: ['session-target'] }),
  })
  await observer.observe('draft', 'hello', { agentId: 'session-other' })
  assert.equal(lines[0].reason, 'calls disabled', 'a paused row is paused everywhere, whatever the target')
  assert.equal(calls, 0)
})


// THE SUBJECT RIDES EVERY LINE, not only the calls: "which model's text did we decline to judge" is a question
// a skip line should answer, and a trace where only some lines name the model is one you have to cross-check
// against itself. Absent -- never null -- when the seam does not know.
test('the model that produced the text is recorded on call lines and skip lines alike', async () => {
  const { lines, trace } = recorder()
  const subject = { provider: 'openrouter', model: 'mistralai/ministral-3b-2512' }
  const observer = createObserver({
    decide: async () => ({ kind: 'answers', answers: { probe: { type: 'choice', label: 'model_output', confidence: 0.9 } } }),
    trace,
    readConfig: () => config,
  })
  await observed(observer, 'draft', 'hello', { subject })
  assert.deepEqual(lines[0].subject, subject, 'a call says who wrote the text')

  const { lines: skips, trace: traceSkip } = recorder()
  const quiet = createObserver({ decide: async () => ({ kind: 'answers', answers: {} }), trace: traceSkip, readConfig: () => config })
  await observed(quiet, 'draft', '', { subject })
  assert.equal(skips[0].event, 'skip')
  assert.deepEqual(skips[0].subject, subject, 'and so does a skip')
})

test('a line with no subject omits the field rather than writing null', async () => {
  const { lines, trace } = recorder()
  const observer = createObserver({ decide: async () => ({ kind: 'answers', answers: {} }), trace, readConfig: () => config })
  await observed(observer, 'draft', 'hello')
  assert.equal(Object.hasOwn(lines[0], 'subject'), false, 'an unreadable field is worse than none')
})

// --- REDACTION: the record's copy, never the model's ------------------------------------------------------
// THE TEST THAT PINS THE DESIGN DECISION. `state` is the model's INPUT and `excerpt` is the EVIDENCE, and they
// are built from one source into two objects on purpose: redact the wrong one and the model is asked to classify
// `[REDACTED]`, which turns every accuracy figure in this repository into a figure about the scrubber.
test('the model is handed the RAW secret while the recorded line does not contain it', async () => {
  const { lines, trace } = recorder()
  let handed = null
  const secret = 'sk-live-abc12345xyz99'
  const observer = createObserver({
    decide: async (request) => { handed = request; return { kind: 'answers', answers: {} } },
    trace,
    readConfig: () => ({ ...config, redactEnabled: true }),
  })
  await observed(observer, 'pre_execute', `bash {"api_key":"${secret}","cmd":"ls"}`, {})

  assert.ok(handed !== null, 'the model was asked')
  assert.match(handed.state.text, /sk-live-abc12345xyz99/, 'THE MODEL SEES THE SECRET — its input is raw')
  assert.doesNotMatch(lines[0].excerpt, /sk-live-abc12345xyz99/, 'the RECORD does not')
  assert.match(lines[0].excerpt, /\[REDACTED\]/, 'and says so where the value was')
  assert.match(lines[0].excerpt, /"cmd":"ls"/, 'the rest of the argument survives')
  assert.equal(lines[0].truncated, false)
})

test('a secret longer than the budget is redacted before it is cut, so no prefix survives', async () => {
  const { lines, trace } = recorder()
  const observer = createObserver({ decide: async () => ({ kind: 'answers', answers: {} }), trace, readConfig: () => ({ ...config, maxFieldChars: 18 }) })
  await observed(observer, 'draft', `${'x'.repeat(15)} ghp_abcdefghijklmnopqrstuvwxyz012345`, {})
  assert.doesNotMatch(lines[0].excerpt, /ghp_/, 'the partial token is the whole reason the order matters')
  assert.equal(lines[0].excerpt.length, 18)
  assert.equal(lines[0].truncated, true)
})

test('an error line is redacted and bounded too', async () => {
  const { lines, trace } = recorder()
  const observer = createObserver({
    decide: async () => { throw new Error('401 at https://x/?token=SECRETVALUE') },
    trace,
    readConfig: () => ({ ...config, redactEnabled: true }),
  })
  await observed(observer, 'draft', 'hello', {})
  assert.equal(lines[0].event, 'error')
  assert.doesNotMatch(lines[0].error, /SECRETVALUE/)
  assert.match(lines[0].error, /token=\[REDACTED\]/)
})

test('redactEnabled false lets the secret through but keeps truncation', async () => {
  const { lines, trace } = recorder()
  const secret = 'ghp_abcdefghijklmnopqrstuvwxyz012345'
  const observer = createObserver({ decide: async () => ({ kind: 'answers', answers: {} }), trace, readConfig: () => ({ ...config, redactEnabled: false, maxFieldChars: 20 }) })
  await observed(observer, 'draft', secret, {})
  assert.match(lines[0].excerpt, /^ghp_/, 'the secret survives on purpose')
  assert.equal(lines[0].excerpt.length, 20, 'and the size cap is untouched')
  assert.equal(lines[0].truncated, true)
})

// --- THE TWO FACTS THE RESULT SEAMS DID NOT CARRY ---------------------------------------------------------
// `post_execute` and `result` are asked about the RESULT text alone, so a matrix of results could not say which
// tool produced one. The name is on the payload of every tool seam; recording it is a port, where splitting the
// text on its first space is a heuristic.
test('a tool seam records the tool’s name, and a non-tool seam does not pretend to', async () => {
  const { lines, trace } = recorder()
  const observer = createObserver({ decide: async () => ({ kind: 'answers', answers: {} }), trace, readConfig: () => config })
  await observed(observer, 'post_execute', 'the result\nexit code: 1', { toolName: 'bash' })
  await observed(observer, 'draft', 'prose', {})
  assert.equal(lines[0].tool, 'bash')
  assert.equal(lines[1].tool, null, 'a draft is not a tool call')
})

// THE EXIT CODE IS READ FROM THE UNTRUNCATED TEXT. It is appended to the final line, so a cut landing inside it
// -- or a whitespace collapse merging it into the body -- destroys it before any reader sees it.
test('the exit code is parsed from the untruncated text, and the tail survives a real budget', async () => {
  const { lines, trace } = recorder()
  const observer = createObserver({ decide: async () => ({ kind: 'answers', answers: {} }), trace, readConfig: () => ({ ...config, maxFieldChars: 2000 }) })
  const output = `${'build noise '.repeat(200)}\nexit code: 137`
  await observed(observer, 'result', output, { toolName: 'bash' })
  assert.equal(lines[0].truncated, true, 'the text was cut')
  assert.equal(lines[0].toolExit, 137, 'and the code still came through')
  assert.match(lines[0].excerpt, /exit code: 137$/, 'because the cut now keeps the tail')
})

test('a budget too small for a tail still reports the code it read from the full text', async () => {
  const { lines, trace } = recorder()
  const observer = createObserver({ decide: async () => ({ kind: 'answers', answers: {} }), trace, readConfig: () => ({ ...config, maxFieldChars: 40 }) })
  await observed(observer, 'result', `${'build noise '.repeat(20)}\nexit code: 137`, { toolName: 'bash' })
  assert.equal(lines[0].excerpt.length, 40, 'head-only, because 40 cannot hold a meaningful tail')
  assert.doesNotMatch(lines[0].excerpt, /exit code/, 'the tail is genuinely absent from the record')
  assert.equal(lines[0].toolExit, 137, 'and the parsed code is still there — it was read before the cut')
})

test('the parser accepts the shapes a wrapper actually appends, and invents nothing', () => {
  assert.equal(exitCodeOf('ok\nexit code: 1'), 1)
  assert.equal(exitCodeOf('done\n[exit code: 0]'), 0)
  assert.equal(exitCodeOf('boom, exit code: 137'), 137)
  assert.equal(exitCodeOf('EXIT_CODE=2'), 2)
  assert.equal(exitCodeOf('no code here'), null)
  // A code in the MIDDLE is not the wrapper's marker, and guessing one would be the heuristic this replaces.
  assert.equal(exitCodeOf('exit code: 1\nmore output after it'), null)
  assert.equal(exitCodeOf(undefined), null)
})

test('a non-tool seam never carries an exit code, even when its text ends in one', async () => {
  const { lines, trace } = recorder()
  const observer = createObserver({ decide: async () => ({ kind: 'answers', answers: {} }), trace, readConfig: () => config })
  await observed(observer, 'draft', 'the model said\nexit code: 1', {})
  assert.equal(lines[0].toolExit, null)
  assert.equal(lines[0].tool, null)
})
