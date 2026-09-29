import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../index.js'

// WHY THIS EXISTS: the observer's first live mount wrote 209 `error` lines reading "decide is not a function"
// and no `call` lines at all. Both model factories return a CLIENT object, and `apply` assigned it to `decide`
// and called it. Every unit test passed, because none of them executed `apply`.
function fakeCtx({ inject = () => {} } = {}) {
  const handlers = new Map()
  return {
    handlers,
    on(event, handler) { handlers.set(event, handler); return () => handlers.delete(event) },
    inject,
    agents: { currentInitiator: () => ({ id: 'agent-1' }) },
  }
}

/** The trace is JSONL; a file nothing was written to is an empty list, not an error. */
function readLines(path) {
  if (!existsSync(path)) return []
  const text = readFileSync(path, 'utf8').trim()
  return text === '' ? [] : text.split('\n').map(line => JSON.parse(line))
}

test('apply wires a callable decide, so a streamed reply reaches the transport instead of throwing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'system1-observer-'))
  const tracePath = join(dir, 'trace.jsonl')
  const ctx = fakeCtx()
  await apply(ctx, { hooks: ['draft'], tracePath, wireUrl: 'http://127.0.0.1:9', timeoutMs: 200 })

  const handler = ctx.handlers.get('llm/stream')
  assert.equal(typeof handler, 'function', 'apply did not subscribe the draft seam')

  async function* reply() {
    yield { type: 'text-delta', text: 'hello' }
    yield { type: 'block-end', block: { type: 'text', text: 'hello' } }
  }
  // DRAIN, THEN ASSERT. The briefed form asserted `chunk.type === 'block-end'` for EVERY chunk, but the reply
  // below yields `text-delta` first, so that assertion fired before `tee` ever reached its `onEnd` -- the
  // observer was never called, and the RED would have been the chunk type rather than the defect. Collecting
  // the relayed types keeps the brief's intent (the stream passes through unchanged AND is drained to the end)
  // and lets the observation actually run.
  const relayed = []
  for await (const chunk of handler({ purpose: undefined }, reply)) relayed.push(chunk.type)
  assert.deepEqual(relayed, ['text-delta', 'block-end'], 'the draft seam must relay the reply unchanged')

  const lines = readFileSync(tracePath, 'utf8').trim().split('\n').map(line => JSON.parse(line))
  const observed = lines.find(line => line.event === 'call' || line.event === 'error')
  assert.ok(observed !== undefined, 'no line was written for the draft seam')
  assert.doesNotMatch(String(observed.error ?? ''), /decide is not a function/)
})

// WHY THESE TWO EXIST: the live mount line said `"transport":"wire"` while all 46 call lines and the live
// transport were `service`, and a correction line at 17:20:41.674Z -- 355 ms after the mount -- carried the
// truth in an `event` the spec never defines. `ctx.inject` runs its callback through a cordis fiber, so the
// swap happens after `apply` returns; a microtask cannot fix that. The mount line must be written when the
// transport is known, and the first observation must write it if no service ever arrives.
test('a service arriving after apply writes the mount line as service, and no transport event', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'system1-observer-'))
  const tracePath = join(dir, 'trace.jsonl')
  let arrive
  const ctx = fakeCtx({
    // The shim makes the fiber's asynchrony explicit and lets the test choose when the service lands.
    inject(_services, callback) {
      arrive = () => Promise.resolve().then(() => callback({ get: () => ({ decide: async () => ({ kind: 'answers', answers: {} }) }) }))
    },
  })
  await apply(ctx, { hooks: ['close'], tracePath, wireUrl: 'http://127.0.0.1:9', timeoutMs: 200 })
  await arrive()

  await ctx.handlers.get('agent/turn-stopping')({ agent: { id: 'agent-1' } })

  const lines = readLines(tracePath)
  const mount = lines.find(line => line.event === 'mount')
  assert.equal(mount?.transport, 'service', 'the mount line must state the transport the calls use')
  assert.equal(lines.filter(line => line.event === 'mount').length, 1, 'one mount line per mount')
  assert.equal(lines.some(line => line.event === 'transport'), false, 'the spec defines only call, skip, error and mount')
})

test('when no service ever arrives the first observation writes a wire mount line before its own line', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'system1-observer-'))
  const tracePath = join(dir, 'trace.jsonl')
  const ctx = fakeCtx()   // inject is a no-op: no system1 service ever appears
  await apply(ctx, { hooks: ['close'], tracePath, wireUrl: 'http://127.0.0.1:9', timeoutMs: 200 })

  // NOTHING IS WRITTEN AT APPLY TIME. The live trace shows the service landing 355 ms later, so a mount
  // line written here would say `wire` and stay wrong; the line is deferred until the transport is known
  // or an observation forces the question.
  assert.deepEqual(readLines(tracePath), [], 'the mount line must not be written before the transport is known')

  await ctx.handlers.get('agent/turn-stopping')({ agent: { id: 'agent-1' } })

  const lines = readLines(tracePath)
  const mountIndex = lines.findIndex(line => line.event === 'mount')
  const observedIndex = lines.findIndex(line => line.event === 'call' || line.event === 'error' || line.event === 'skip')
  assert.notEqual(mountIndex, -1, 'the first observation must write a mount line')
  assert.equal(lines[mountIndex].transport, 'wire')
  assert.ok(mountIndex < observedIndex, 'the mount line must precede the observation it belongs to')
  assert.equal(lines.some(line => line.event === 'transport'), false)
})

// THE SUBAGENT KNOB, end to end through `apply` and the real observer. `agent.session.header.origin`
// is the discriminator; `observeSubagents` is off unless it is exactly `true`.
const OPERATOR = { id: 'op-1', session: { header: { origin: 'operator' } } }
const SUBAGENT = { id: 'sub-1', session: { header: { origin: 'subagent' } } }

/** A ctx whose system1 service counts `decide` calls, with a settable current initiator. */
function serviceCtx(decide) {
  const handlers = new Map()
  let current
  return {
    handlers,
    setInitiator(agent) { current = agent },
    on(event, handler) { handlers.set(event, handler); return () => handlers.delete(event) },
    inject(_services, callback) { callback({ get: () => ({ decide }) }) },
    agents: { currentInitiator: () => current },
  }
}

test("by default a subagent's admit, pre_execute and draft are skips and decide is never called", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'system1-observer-'))
  const tracePath = join(dir, 'trace.jsonl')
  let calls = 0
  const ctx = serviceCtx(async () => { calls += 1; return { kind: 'answers', answers: {} } })
  ctx.setInitiator(SUBAGENT)
  await apply(ctx, { hooks: ['admit', 'pre_execute', 'draft'], tracePath })

  const decision = { messages: ['original'] }
  const returned = await ctx.handlers.get('agent/pre-step')({ agent: SUBAGENT, messages: [{ role: 'user', content: [{ type: 'text', text: 'THE WHOLE TASK PROMPT' }] }], turn: 1, step: 1 }, async () => decision)
  assert.equal(returned, decision, 'the decision must be returned unchanged')

  const toolDecision = { allow: true }
  const toolReturned = await ctx.handlers.get('tools/pre-execute')({ agent: SUBAGENT, name: 'bash', arguments: { command: 'ls' } }, async () => toolDecision)
  assert.equal(toolReturned, toolDecision, 'the decision must be returned unchanged')

  async function* reply() {
    yield { type: 'text-delta', text: 'a' }
    yield { type: 'block-end', block: { type: 'text', text: 'a' } }
  }
  const relayed = []
  for await (const chunk of ctx.handlers.get('llm/stream')({ purpose: undefined }, reply)) relayed.push(chunk.type)
  assert.deepEqual(relayed, ['text-delta', 'block-end'], 'a suppressed stream must still be relayed untouched')

  const lines = readLines(tracePath)
  const skips = lines.filter(line => line.event === 'skip')
  assert.deepEqual(skips.map(line => line.hook), ['admit', 'pre_execute', 'draft'])
  assert.ok(skips.every(line => line.reason === 'subagent session'), JSON.stringify(skips))
  assert.equal(lines.some(line => line.event === 'call'), false, 'a subagent must not reach the model')
  assert.equal(calls, 0, 'decide must never be called for a subagent')
  assert.equal(JSON.stringify(lines).includes('THE WHOLE TASK PROMPT'), false, "a subagent's text must not be recorded")
  const mountIndex = lines.findIndex(line => line.event === 'mount')
  assert.ok(mountIndex !== -1 && mountIndex < lines.indexOf(skips[0]), 'the mount line must still be written, before the first skip')
})

test("observeSubagents true calls the model for a subagent's seam", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'system1-observer-'))
  const tracePath = join(dir, 'trace.jsonl')
  let calls = 0
  const ctx = serviceCtx(async () => { calls += 1; return { kind: 'answers', answers: {} } })
  ctx.setInitiator(SUBAGENT)
  await apply(ctx, { hooks: ['pre_execute'], tracePath, observeSubagents: true })

  await ctx.handlers.get('tools/pre-execute')({ agent: SUBAGENT, name: 'bash', arguments: { command: 'ls' } }, async () => ({ allow: true }))

  const lines = readLines(tracePath)
  assert.equal(lines.filter(line => line.event === 'call').length, 1)
  assert.equal(calls, 1)
  assert.equal(lines.some(line => line.event === 'skip'), false)
})

test('a non-subagent is still observed when observeSubagents is off', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'system1-observer-'))
  const tracePath = join(dir, 'trace.jsonl')
  let calls = 0
  const ctx = serviceCtx(async () => { calls += 1; return { kind: 'answers', answers: {} } })
  ctx.setInitiator(OPERATOR)
  await apply(ctx, { hooks: ['pre_execute'], tracePath })

  await ctx.handlers.get('tools/pre-execute')({ agent: OPERATOR, name: 'bash', arguments: { command: 'ls' } }, async () => ({ allow: true }))

  const lines = readLines(tracePath)
  assert.equal(lines.filter(line => line.event === 'call').length, 1)
  assert.equal(calls, 1)
  assert.equal(lines.some(line => line.event === 'skip'), false)
})

test("by default a subagent's assemble seam is a skip and decide is never called", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'system1-observer-'))
  const tracePath = join(dir, 'trace.jsonl')
  let calls = 0
  const ctx = serviceCtx(async () => { calls += 1; return { kind: 'answers', answers: {} } })
  ctx.setInitiator(SUBAGENT)
  await apply(ctx, { hooks: ['assemble'], tracePath })

  const assembly = { sections: [{ name: 's', order: 0, text: 'THE ASSEMBLED PROMPT' }], contexts: [], tools: [], variables: {} }
  const decision = { sections: [{ name: 's', order: 0, text: 'THE ASSEMBLED PROMPT' }], contexts: [], tools: [], variables: {} }
  // The real agent-driven AssembleContext, built the way assembleContextFor builds it.
  const returned = await ctx.handlers.get('system-prompt/assemble')(assembly, { agent: SUBAGENT, scope: SUBAGENT }, async () => decision)
  assert.equal(returned, decision, 'the decision must be returned by reference')

  const lines = readLines(tracePath)
  const skips = lines.filter(line => line.event === 'skip' && line.reason === 'subagent session')
  assert.equal(skips.length, 1)
  assert.equal(skips[0].hook, 'assemble')
  assert.equal(lines.some(line => line.event === 'call'), false, 'a subagent assemble must not reach the model')
  assert.equal(calls, 0, 'decide must never be called for a subagent assemble')
  assert.equal(JSON.stringify(lines).includes('THE ASSEMBLED PROMPT'), false, "a subagent's assembled prompt must not be recorded")
})
