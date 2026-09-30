// THE READER AN AGENT GETS. Like `scripts/trace.mjs`, it is tested by feeding it a real trace file and
// reading what comes back -- a formatter unit-tested on hand-built objects would say nothing about whether
// the file it actually reads parses.
import { test } from 'node:test'
import { PROBE_QUESTION } from '../lib/seams.js'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MAX_TAIL, readTraceWindow, reportTrace, runIds } from '../lib/trace-report.js'

const mount = (run, at) => ({ at, run, event: 'mount', hooks: ['admit', 'draft'], transport: 'service', provider: 'typesafe', model: 'jev-latest', questionIds: ['probe'], tracePath: '/tmp/x.jsonl' })
const call = (run, at, hook, label, ms = 200) => ({
  at, run, event: 'call', hook, hostEvent: 'llm/stream', agentId: 'session-aaaa', ms, transport: 'service',
  provider: 'typesafe', model: 'jev-latest', excerpt: `text for ${hook}`, state: { hook, text: `text for ${hook}` },
  questions: { probe: { type: 'choice', instructions: 'Which part of an agent loop produced this text?', criteria: { model_output: 'a', unclear: 'b' } } },
  answer: { kind: 'answers', answers: { probe: { type: 'choice', label, confidence: 0.8, answerConfidence: 0.9 } }, envelope: { executed: { provider: 'typesafe', model: 'typesafe/jev-1.13-20260917' } } },
  truncated: false,
})
const skip = (run, at, reason) => ({ at, run, event: 'skip', hook: 'execute', agentId: 'session-aaaa', reason })

/** A two-run trace: an older run, then the current one with a call, two skips and an error. */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'observer-report-'))
  const path = join(dir, 'trace.jsonl')
  const lines = [
    mount('RUN-OLD', '2026-01-01T00:00:00.000Z'),
    call('RUN-OLD', '2026-01-01T00:00:01.000Z', 'draft', 'model_output'),
    mount('RUN-NEW', '2026-01-02T00:00:00.000Z'),
    call('RUN-NEW', '2026-01-02T00:00:01.000Z', 'draft', 'model_output', 100),
    call('RUN-NEW', '2026-01-02T00:00:02.000Z', 'draft', 'an_answer', 300),
    skip('RUN-NEW', '2026-01-02T00:00:03.000Z', 'calls disabled at this seam'),
    skip('RUN-NEW', '2026-01-02T00:00:04.000Z', 'calls disabled at this seam'),
    { at: '2026-01-02T00:00:05.000Z', run: 'RUN-NEW', event: 'error', hook: 'pre_execute', error: 'the request timed out after 8000 ms' },
  ]
  writeFileSync(path, `${lines.map(l => JSON.stringify(l)).join('\n')}\n`)
  return path
}

test('the default report is the newest run, and counts every event it saw', () => {
  const out = reportTrace({ path: fixture() })
  assert.match(out, /runs RUN-NEW/, 'the newest run, not the file')
  assert.doesNotMatch(out, /RUN-OLD\n/, 'and not the older one')
  assert.match(out, /5 events · 2 calls · 2 skips · 1 errors/, 'the tally covers the loop events, and the mounts are summarised on their own line')
  assert.match(out, /calls by seam: draft 2/)
  assert.match(out, /skips by reason: calls disabled at this seam 2/)
  assert.match(out, /latency: min 100ms · median 200ms · p95 300ms · max 300ms/)
  assert.match(out, /sessions seen here: session-aaaa 4/, 'the session id is what a session-scoped observer targets')
  assert.match(out, /graded by: typesafe\/jev-1\.13-20260917 2/)
  assert.match(out, /-> probe=model_output p=0\.9/, 'the answer a person reads, with its probability')
})

test('the summary counts cover every event even when only the tail is listed', () => {
  const out = reportTrace({ path: fixture(), tail: 1 })
  assert.match(out, /2 calls/, 'the count is of the run, not of the listing')
  assert.match(out, /last 1 of 5 events/, 'and the listing says how much it left out')
})

test('tail is bounded, so one call cannot put a whole trace into context', () => {
  const out = reportTrace({ path: fixture(), tail: 100000 })
  assert.match(out, new RegExp(`last 5 of 5 events`), 'the fixture is shorter than the cap')
  assert.ok(MAX_TAIL === 200, 'the cap is stated rather than implied')
})

test('--hook is a seam filter, and the header says so', () => {
  const out = reportTrace({ path: fixture(), hook: 'execute' })
  assert.match(out, /filtered to seam execute/)
  assert.match(out, /0 calls · 2 skips/, 'the draft calls are filtered out')
  assert.match(out, /calls disabled at this seam/)
})

test('run all reads every run in the window; a prefix picks one', () => {
  const all = reportTrace({ path: fixture(), run: 'all' })
  assert.match(all, /RUN-OLD, RUN-NEW/)
  const prefixed = reportTrace({ path: fixture(), run: 'RUN-OLD' })
  assert.match(prefixed, /runs RUN-OLD/)
  assert.match(prefixed, /1 calls/)
  const missing = reportTrace({ path: fixture(), run: 'RUN-NOPE' })
  assert.match(missing, /no run matching "RUN-NOPE"/)
  assert.match(missing, /runs present: RUN-OLD, RUN-NEW/, 'a miss says what is there instead of nothing')
})

test('full adds the question as sent and the distribution behind the label', () => {
  const out = reportTrace({ path: fixture(), full: true })
  assert.match(out, /question probe \[choice\] Which part of an agent loop produced this text\?/)
})

test('an error line carries its reason', () => {
  const out = reportTrace({ path: fixture() })
  assert.match(out, /the request timed out after 8000 ms/)
  assert.match(out, /errors: the request timed out after 8000 ms 1/)
})

test('a missing trace says so rather than throwing', () => {
  const out = reportTrace({ path: join(tmpdir(), 'definitely-not-here-observer.jsonl') })
  assert.match(out, /no trace at /)
  assert.match(out, /definitely-not-here-observer\.jsonl/)
})

// THE WINDOW. A trace is append-only and unrotated, so the read has to be bounded -- and a bounded read that
// did not say so would look exactly like a complete one.
test('a window that cuts the file says so, and drops the torn first line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'observer-window-'))
  const path = join(dir, 'trace.jsonl')
  const text = [
    // A LONG FIRST LINE, so a cut 400 bytes from the start lands inside it and the later lines survive whole.
    JSON.stringify({ at: '2026-01-01T00:00:00.000Z', run: 'RUN-OLD', event: 'mount', hooks: [], padding: 'x'.repeat(400) }),
    JSON.stringify({ at: '2026-01-02T00:00:00.000Z', run: 'RUN-NEW', event: 'mount', hooks: ['draft'] }),
    JSON.stringify(call('RUN-NEW', '2026-01-02T00:00:01.000Z', 'draft', 'model_output', 120)),
  ].join('\n') + '\n'
  writeFileSync(path, text)
  const total = Buffer.byteLength(text)
  const windowBytes = total - 400
  const window = readTraceWindow(path, windowBytes)
  assert.equal(window.truncated, true)
  assert.deepEqual(runIds(window.events), ['RUN-NEW'], 'the fragment of the cut line must not become an event')
  const out = reportTrace({ path, windowBytes })
  assert.match(out, new RegExp(`only the last ${windowBytes} bytes of`), 'the report states the window, because a silent one would read as complete')
})

test('a torn last line from a concurrent write is skipped, not fatal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'observer-torn-'))
  const path = join(dir, 'trace.jsonl')
  writeFileSync(path, `${JSON.stringify(mount('RUN-NEW', '2026-01-02T00:00:00.000Z'))}\n{"at":"2026-01-02T00:00:01`)
  const out = reportTrace({ path })
  assert.match(out, /runs RUN-NEW/, 'the readable lines still produce a report')
  assert.match(out, /0 events · 0 calls · 0 skips · 0 errors/, 'the half-written line is not an event')
})

// THE SESSION COLUMN. This observer can be scoped to sessions, so `session not observed` is one of its most
// common lines -- and a skip that does not say WHICH session is a line the reader cannot act on. Measured on a
// real run: every skip was from the one session that had just been removed from the list, and nothing in the
// output said so.
test('every event line names the session it belongs to', () => {
  const dir = mkdtempSync(join(tmpdir(), 'observer-session-col-'))
  const path = join(dir, 'trace.jsonl')
  writeFileSync(path, [
    JSON.stringify(mount('RUN-S', '2026-01-02T00:00:00.000Z')),
    JSON.stringify(skip('RUN-S', '2026-01-02T00:00:01.000Z', 'session not observed')),
    JSON.stringify({ ...skip('RUN-S', '2026-01-02T00:00:02.000Z', 'no text at this seam'), agentId: undefined }),
  ].join('\n') + '\n')
  const out = reportTrace({ path })
  assert.match(out, /SKIP\s+execute\s+session-aaaa/, 'a skip says which session it came from')
  assert.match(out, /\(no session\)/, 'and an unattributable firing says that instead of showing nothing')
})

// A RUN CAN CHANGE SCOPE WHILE IT IS RUNNING, because these fields are live and the mount line is written once.
// Measured: a run whose mounted line said `calls OFF` recorded calls minutes later, after a save. Without the
// caveat the header reads as current fact and the events below read as contradicting it.
test('the mount summary is labelled a snapshot', () => {
  const out = reportTrace({ path: fixture() })
  assert.match(out, /the mounted line is a SNAPSHOT/)
  assert.match(out, /the reason on each event below is authoritative/)
})

// THE TWO HALVES OF THE COMPARISON, SIDE BY SIDE. `graded by` is the judge; `subject model` is the model whose
// text was judged. A trace that names only the first invites the reader to take it for the second -- which is
// exactly the misreading the top-level `provider`/`model` fields already caused.
test('the summary separates the judge from the model that produced the text', () => {
  const dir = mkdtempSync(join(tmpdir(), 'observer-subject-'))
  const path = join(dir, 'trace.jsonl')
  const base = call('RUN-T', '2026-01-02T00:00:01.000Z')
  writeFileSync(path, [
    JSON.stringify(mount('RUN-T', '2026-01-02T00:00:00.000Z')),
    JSON.stringify({ ...base, subject: { provider: 'openrouter', model: 'x/y' }, executed: { provider: 'typesafe', model: 'typesafe/jev-1.13' } }),
    JSON.stringify({ ...base, at: '2026-01-02T00:00:02.000Z', subject: { provider: 'openrouter', model: 'x/y' } }),
    JSON.stringify({ ...skip('RUN-T', '2026-01-02T00:00:03.000Z', 'no text at this seam'), subject: { model: 'z/w' } }),
  ].join('\n') + '\n')
  const out = reportTrace({ path })
  assert.match(out, /graded by: typesafe\/jev-1\.13/, 'the judge')
  assert.match(out, /subject model: openrouter\/x\/y 2 · z\/w 1/, 'and the model being judged, counting skips too')
})

// THE FIGURE THE README PROMISED. It has to be in the READER, not only in a module: a measurement nobody can
// print is a measurement nobody has. The majority-class floor and kappa are printed BESIDE the accuracy because
// the seam mix is skewed by construction -- `pre_execute` and `post_execute` are ~40% of scored calls each, so
// always answering the commonest label already scores 39.94%, and quoting 88.99% against "1 in 9" would
// overstate it roughly eightfold.
test('the report prints the probe accuracy against its floor, with kappa', () => {
  const dir = mkdtempSync(join(tmpdir(), 'observer-probe-'))
  const path = join(dir, 'trace.jsonl')
  const probe = (hook, label) => ({
    at: '2026-01-02T00:00:01.000Z', run: 'RUN-P', event: 'call', hook,
    questions: { probe: PROBE_QUESTION }, answer: { answers: { probe: { type: 'choice', label } } },
  })
  writeFileSync(path, [
    JSON.stringify(mount('RUN-P', '2026-01-02T00:00:00.000Z')),
    JSON.stringify(probe('admit', 'admitting_a_step')),
    JSON.stringify(probe('draft', 'admitting_a_step')),
  ].join('\n') + '\n')
  const out = reportTrace({ path })
  assert.match(out, /probe: 2 calls · 2 scored · 0 unreadable/)
  assert.match(out, /accuracy 50\.00% against a majority-class floor of 50\.00% \(admit\) · kappa 0\.0000/)
  assert.match(out, /admit 100\.00% \(n=1, thin\) · draft 0\.00% \(n=1, thin\)/)
})

// THE INSTRUMENT'S IDENTITY, so two runs of two different questions are not averaged as one.
test('a mount line records the probe fingerprint, and the reader prints it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'observer-probe-hash-'))
  const path = join(dir, 'trace.jsonl')
  writeFileSync(path, JSON.stringify({ ...mount('RUN-Q', '2026-01-02T00:00:00.000Z'), probeHash: 'abc123def456' }) + '\n')
  assert.match(reportTrace({ path }), /· probe abc123def456/)
})

// THE COST OF THE JUDGEMENT, WITH THE PROVENANCE THAT MAKES IT CHECKABLE.
//
// Three honesty constraints, each learned from a competitor getting it wrong: label it as the JUDGE's cost
// (the subject model's tokens are never captured, so a session cost is not computable from this trace); name
// the rate and the date it was transcribed (a bare dollar figure cannot be checked); and count the calls that
// carried no usage (a total that silently omits them is a total that lies).
test('the report prices the judgement and says what the figure does and does not cover', () => {
  const dir = mkdtempSync(join(tmpdir(), 'observer-cost-'))
  const path = join(dir, 'trace.jsonl')
  const judged = (hook, inputTokens, ms, durationMs) => ({
    at: '2026-01-02T00:00:01.000Z', run: 'RUN-C', event: 'call', hook, ms,
    envelope: { usage: { inputTokens, outputTokens: 10 }, durationMs },
    answer: { answers: {} },
  })
  writeFileSync(path, [
    JSON.stringify(mount('RUN-C', '2026-01-02T00:00:00.000Z')),
    JSON.stringify(judged('post_execute', 3_000_000, 500, 400)),
    JSON.stringify(judged('pre_execute', 1_000_000, 100, 100)),
    // A call with no usage at all, so `unpricedCalls` is not zero and the total is visibly partial.
    JSON.stringify({ at: '2026-01-02T00:00:02.000Z', run: 'RUN-C', event: 'call', hook: 'draft', ms: 50, answer: { answers: {} } }),
  ].join('\n') + '\n')
  const out = reportTrace({ path })
  assert.match(out, /cost of judgement: \$0\.168000 for 2 judged call\(s\) · 4000000 in \/ 20 out tokens/)
  assert.match(out, /transcribed 2026-09-28/, 'the rate carries the date it came from')
  assert.match(out, /covers the decision model only/, 'and it is never presented as a session cost')
  assert.match(out, /1 call\(s\) carried no usage/, 'a partial total says so')
  assert.match(out, /post_execute \$0\.126000 \(75\.0%\) · pre_execute \$0\.042000 \(25\.0%\)/)
})

test('the report separates the observer’s clock from the provider’s, and refuses to call it network time', () => {
  const dir = mkdtempSync(join(tmpdir(), 'observer-overhead-'))
  const path = join(dir, 'trace.jsonl')
  writeFileSync(path, [
    JSON.stringify(mount('RUN-O', '2026-01-02T00:00:00.000Z')),
    JSON.stringify({ at: '2026-01-02T00:00:01.000Z', run: 'RUN-O', event: 'call', hook: 'draft', ms: 120, envelope: { usage: { inputTokens: 10 }, durationMs: 100 }, answer: { answers: {} } }),
  ].join('\n') + '\n')
  const out = reportTrace({ path })
  assert.match(out, /client\/transport overhead 20ms total, 20ms\/call/)
  assert.match(out, /NOT network: the default transport is loopback/)
})

test('a configured rate re-prices the report, and is named as configured', () => {
  const dir = mkdtempSync(join(tmpdir(), 'observer-price-'))
  const path = join(dir, 'trace.jsonl')
  writeFileSync(path, [
    JSON.stringify(mount('RUN-P', '2026-01-02T00:00:00.000Z')),
    JSON.stringify({ at: '2026-01-02T00:00:01.000Z', run: 'RUN-P', event: 'call', hook: 'draft', ms: 10, envelope: { usage: { inputTokens: 1_000_000 }, durationMs: 10 }, answer: { answers: {} } }),
  ].join('\n') + '\n')
  const out = reportTrace({ path, pricePerMTokInput: 1 })
  assert.match(out, /cost of judgement: \$1\.000000/)
  assert.match(out, /\$1\/MTok input, configured in this row/, 'a rate that is not the cited one says so')
})
