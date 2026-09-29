// THE READER IS A PROGRAM, so it is tested by RUNNING it and reading what a person would see.
//
// The trace is append-only across restarts and holds several runs; one subagent produced ~500
// identical skips in a row. Both facts are the reader's whole job, so both are asserted here
// against a fixture that has them -- a unit test of a formatting function would have said nothing
// about the output a human actually reads.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const READER = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'trace.mjs')

const mount = (run, at) => ({ at, run, event: 'mount', hooks: ['admit', 'draft'], transport: 'service', provider: 'typesafe', model: 'jev-latest', questionIds: ['probe'], tracePath: '/tmp/x.jsonl' })
const call = (run, at, hook, label) => ({
  at, run, event: 'call', hook, hostEvent: 'llm/stream', agentId: 'session-aaaa', ms: 210, transport: 'service',
  provider: 'typesafe', model: 'jev-latest', excerpt: `text for ${hook}`, state: { hook, text: `text for ${hook}` },
  questions: { probe: { type: 'choice', instructions: 'Which part of an agent loop produced this text?', criteria: { model_output: 'a', unclear: 'b' } } },
  answer: { kind: 'answers', answers: { probe: { type: 'choice', label, confidence: 0.8, answerConfidence: 0.9 } }, envelope: { requested: { provider: 'typesafe', model: 'jev-latest' }, executed: { provider: 'typesafe', model: 'typesafe/jev-1.13-20260917' }, usage: { inputTokens: 10, outputTokens: 2 }, durationMs: 209.6 } },
  truncated: false,
})
const skip = (run, at, reason) => ({ at, run, event: 'skip', hook: 'admit', hostEvent: 'agent/pre-step', agentId: 'session-aaaa', reason })
const fail = (run, at) => ({ at, run, event: 'error', hook: 'pre_execute', hostEvent: 'tools/pre-execute', agentId: 'session-aaaa', ms: 8000, error: 'the request timed out after 8000 ms' })

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'observer-trace-'))
  const path = join(dir, 'trace.jsonl')
  const lines = [
    mount('RUN-OLD', '2026-01-01T00:00:00.000Z'),
    call('RUN-OLD', '2026-01-01T00:00:01.000Z', 'draft', 'model_output'),
    mount('RUN-NEW', '2026-01-02T00:00:00.000Z'),
    call('RUN-NEW', '2026-01-02T00:00:01.000Z', 'pre_execute', 'before_a_tool_call'),
    skip('RUN-NEW', '2026-01-02T00:00:02.000Z', 'subagent session'),
    skip('RUN-NEW', '2026-01-02T00:00:03.000Z', 'subagent session'),
    skip('RUN-NEW', '2026-01-02T00:00:04.000Z', 'subagent session'),
    fail('RUN-NEW', '2026-01-02T00:00:05.000Z'),
  ]
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  return path
}

function run(...args) {
  const done = spawnSync(process.execPath, [READER, ...args], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } })
  return { out: `${done.stdout}${done.stderr}`, status: done.status }
}

test('it reads the NEWEST run, and says so', () => {
  const { out, status } = run('--file', fixture())
  assert.equal(status, 0)
  assert.match(out, /run RUN-NEW/)
  assert.doesNotMatch(out, /text for draft/, 'the older run must not be rendered')
})

test('--list names every run in the file, oldest first', () => {
  const { out } = run('--file', fixture(), '--list')
  assert.match(out, /2 run\(s\), oldest first/)
  assert.ok(out.indexOf('RUN-OLD') < out.indexOf('RUN-NEW'), 'oldest first')
})

test('a call shows its hook, its excerpt and the answer a person reads', () => {
  const { out } = run('--file', fixture())
  assert.match(out, /CALL\s+pre_execute/)
  assert.match(out, /text for pre_execute/)
  assert.match(out, /before_a_tool_call p=0\.9/, 'the verdict and its confidence')
})

test('consecutive identical skips collapse to one line carrying a count', () => {
  const { out } = run('--file', fixture())
  const lines = out.split('\n').filter((l) => l.includes('subagent session'))
  assert.equal(lines.length, 1, 'three identical skips must occupy one line')
  assert.match(lines[0], /×3/)
})

test('an error line carries the reason, not a JSON blob', () => {
  const { out } = run('--file', fixture())
  assert.match(out, /ERROR\s+pre_execute\s+.*the request timed out after 8000 ms/)
})

test('--calls hides the skips', () => {
  const { out } = run('--file', fixture(), '--calls')
  assert.doesNotMatch(out, /subagent session/)
  assert.match(out, /CALL/)
})

test('--full prints the question as asked, and the envelope', () => {
  const { out } = run('--file', fixture(), '--full')
  assert.match(out, /question\s+probe \[choice, 2 options\]/)
  assert.match(out, /envelope\s+requested typesafe\/jev-latest · executed typesafe\/jev-1\.13-20260917 · tokens 10\/2/)
  assert.match(out, /210ms in the envelope/, 'a rounded duration, not a float')
})

test('a --file that does not exist fails with the PATH, not a stack trace', () => {
  const missing = join(tmpdir(), 'definitely-not-here.jsonl')
  const { out, status } = run('--file', missing)
  assert.equal(status, 1)
  assert.match(out, /no trace at /)
  assert.match(out, /definitely-not-here\.jsonl/)
  assert.doesNotMatch(out, /at .*\.mjs:\d+/, 'a person should not have to read a stack trace')
})
