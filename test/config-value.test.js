// WHY THIS FILE EXISTS: a `.volatile()` config field arrives as a `Volatile<T>` ACCESSOR, not as its
// value, and the value is only available through `.get()`. Read one as a plain value and you get the
// object: `=== true` is false, `typeof x === 'string'` is false, `Array.isArray(x)` is false. The
// plugin then runs silently on its defaults while the settings card, the save and the trace all look
// correct -- which is exactly what happened here: the operator flipped `observeSubagents`, the card
// said "Saved.", the profile patch changed, and the running observer kept suppressing subagents.
//
// So the tests below are not about a helper. They assert that a setting the operator can change
// REACHES THE RUNNING ROW, and that it does so WITHOUT the plugin being re-applied -- the harness
// keeps instance identity stable by design, so a value captured once in `apply` would never move.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, resolveTracePath } from '../index.js'
import { plainConfig, readConfigValue } from '../lib/config-value.js'
import { readHooks } from '../lib/register.js'
import { buildQuestions } from '../lib/questions.js'
import { createObserver } from '../lib/observe.js'

const accessor = (value) => ({ get: () => value })
const fakeCtx = () => {
  const handlers = new Map()
  return {
    handlers,
    on(event, handler) { handlers.set(event, handler); return () => handlers.delete(event) },
    inject() {},
    agents: { currentInitiator: () => ({ id: 'agent-1' }) },
  }
}
const readLines = (path) => {
  if (!existsSync(path)) return []
  const text = readFileSync(path, 'utf8').trim()
  return text === '' ? [] : text.split('\n').map((line) => JSON.parse(line))
}
const subagent = { id: 'sub-1', session: { header: { origin: 'subagent' } } }

test('readConfigValue takes the value from an accessor and leaves a plain value alone', () => {
  assert.equal(readConfigValue(accessor('jev-latest')), 'jev-latest')
  assert.equal(readConfigValue(accessor(true)), true)
  assert.equal(readConfigValue('typesafe'), 'typesafe')
  assert.equal(readConfigValue(42), 42)
  assert.equal(readConfigValue(null), null)
  assert.equal(readConfigValue(undefined), undefined)
  // An object with no `get` is a value, not an accessor: a config field whose type is an object must
  // survive. (An object that itself carries a `get` method is indistinguishable from an accessor --
  // the same limitation `dsh-system1` accepts in its own helper.)
  assert.deepEqual(readConfigValue({ a: 1 }), { a: 1 })
})

test('plainConfig unwraps every field, and tolerates a missing config', () => {
  assert.deepEqual(plainConfig({ a: accessor(1), b: 'plain', c: accessor([1, 2]) }), { a: 1, b: 'plain', c: [1, 2] })
  assert.deepEqual(plainConfig(undefined), {})
  assert.deepEqual(plainConfig(null), {})
})

test('the mount-bound fields are unwrapped where they are used', () => {
  // `hooks` decides which listeners exist. Read as a plain value it would fall back to DEFAULT_HOOKS,
  // which are the same four seams -- so the substitution is invisible until another set is configured.
  assert.deepEqual(readHooks({ hooks: accessor(['admit']) }), ['admit'])
  assert.throws(() => readHooks({ hooks: accessor(['admit', 'not-a-seam']) }), /unknown hook/)
  assert.deepEqual(readHooks({ hooks: ['draft'] }), ['draft'])
  assert.equal(resolveTracePath({ tracePath: accessor('/tmp/x.jsonl') }, '/pkg'), '/tmp/x.jsonl')
  assert.equal(resolveTracePath({ tracePath: '/tmp/y.jsonl' }, '/pkg'), '/tmp/y.jsonl')
  assert.equal(resolveTracePath({ tracePath: accessor('   ') }, '/pkg', {}), join('/pkg', 'data', 'system1-observer.jsonl'))
})

test('the call-time fields are unwrapped where they are read', () => {
  const questions = buildQuestions({ question: accessor('  Does this look complete?  ') })
  assert.equal(questions.probe.type, 'noul')
  assert.equal(questions.probe.instructions, 'Does this look complete?')
  assert.equal(buildQuestions({ question: accessor('') }).probe.type, 'choice', 'an empty accessor falls back to the probe')

  const lines = []
  const observer = createObserver({
    decide: async () => ({ kind: 'answers', answers: {}, worstCase: 0, envelope: undefined, rawAnswers: undefined }),
    trace: (event, fields) => lines.push({ event, ...(typeof fields === 'function' ? fields() : fields) }),
    readConfig: () => ({ maxFieldChars: accessor(10), transport: 'service' }),
  })
  return observer.observe('draft', 'x'.repeat(50), { agentId: 'a' }).then(() => {
    assert.equal(lines[0].excerpt.length, 10, 'a maxFieldChars accessor must bound the excerpt')
    assert.equal(lines[0].truncated, true)
  })
})

test('a VOLATILE field written AFTER apply reaches the running row, with no re-application', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'system1-observer-'))
  const tracePath = join(dir, 'trace.jsonl')

  // THE CONFIG AS CORDIS HANDS IT OVER: every field an accessor, and `observeSubagents` mutable
  // underneath, exactly as a settings save rewrites it.
  let observeSubagents = true
  const config = {
    hooks: accessor(['admit']),
    tracePath: accessor(tracePath),
    observeSubagents: { get: () => observeSubagents },
    wireUrl: accessor('http://127.0.0.1:9'),
    timeoutMs: accessor(200),
  }

  const ctx = fakeCtx()
  await apply(ctx, config)
  const handler = ctx.handlers.get('agent/pre-step')
  assert.equal(typeof handler, 'function', 'apply did not subscribe the admit seam')

  // First observation: the accessor answered `true`, so a subagent's seam is OBSERVED.
  await handler({ agent: subagent, turn: 1, step: 1, messages: [{ text: 'do the thing' }] }, async () => ({ kind: 'enter' }))
  const first = readLines(tracePath)
  assert.ok(first.length > 0, 'nothing was written for the first observation')
  assert.equal(first.some((l) => l.event === 'skip' && l.reason === 'subagent session'), false,
    'with observeSubagents true the subagent must NOT be skipped')
  assert.equal(first.some((l) => l.hook === 'admit' && (l.event === 'call' || l.event === 'error')), true,
    'with observeSubagents true the subagent seam must be observed')

  // THE OPERATOR'S SAVE. Nothing is re-applied: `apply` is not called again, and the plugin keeps the
  // `config` object it was handed. Only the value behind the accessor changes.
  observeSubagents = false
  const before = readLines(tracePath).length
  await handler({ agent: subagent, turn: 2, step: 1, messages: [{ text: 'and again' }] }, async () => ({ kind: 'enter' }))

  const after = readLines(tracePath).slice(before)
  assert.ok(after.length > 0, 'the flipped setting produced no line')
  assert.equal(after.some((l) => l.event === 'skip' && l.reason === 'subagent session'), true,
    'the flipped setting must reach the RUNNING row: the subagent seam becomes a skip')
})
