import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readHooks, registerListeners, isSubagent } from '../lib/register.js'

/** A Cordis context, reduced to what this plugin touches. */
function fakeCtx() {
  const handlers = new Map()
  return {
    handlers,
    on(event, handler) { handlers.set(event, handler); return () => handlers.delete(event) },
  }
}

test('an unknown hook refuses, naming it and the known set', () => {
  assert.throws(() => readHooks({ hooks: ['draft', 'nope'] }), /nope/)
})

test('a missing or empty hooks list falls back to the documented default', () => {
  assert.deepEqual(readHooks({}), ['admit', 'draft', 'pre_execute', 'post_execute'])
  assert.deepEqual(readHooks({ hooks: [] }), ['admit', 'draft', 'pre_execute', 'post_execute'])
})

test('only the selected hooks are subscribed', () => {
  const ctx = fakeCtx()
  registerListeners(ctx, ['draft'], { observe: async () => {} })
  assert.deepEqual([...ctx.handlers.keys()], ['llm/stream'])
})

test('a waterfall listener returns the decision it was given, unchanged', async () => {
  const ctx = fakeCtx()
  let called = 0
  registerListeners(ctx, ['admit'], { observe: async () => { called += 1 } })
  const decision = { messages: ['original'] }
  const returned = await ctx.handlers.get('agent/pre-step')({ agent: { id: 'a1' }, messages: [], turn: 1, step: 1 }, async () => decision)
  assert.equal(returned, decision)
  assert.equal(called, 1)
})

// THE SUBAGENT DISCRIMINATOR, confirmed at runtime. `agent.session.header.origin === 'subagent'`:
// `Agent.session` (packages/core/agent/src/runtime-types.ts), `Session.header`
// (packages/core/session/src/index.ts), `SessionHeader.origin` (packages/core/session/src/types.ts).
// Property checks only: a payload with no session is an ordinary agent, never a throw.
const operatorAgent = { id: 'op-1', session: { header: { origin: 'operator' } } }
const subagentAgent = { id: 'sub-1', session: { header: { origin: 'subagent' } } }

test('isSubagent reads the session header origin with property checks and never throws', () => {
  assert.equal(isSubagent(subagentAgent), true)
  assert.equal(isSubagent(operatorAgent), false)
  const odd = [undefined, null, 'agent', 42, {}, { session: null }, { session: {} }, { session: { header: 42 } }, { session: { header: { origin: null } } }]
  for (const payload of odd) {
    // If any of these threw, the call itself would fail the test -- which is the no-throw property.
    assert.equal(isSubagent(payload), false, `isSubagent(${JSON.stringify(payload)}) should be false`)
  }
})

/** The listener dependencies, with `observe`/`skip` reduced to recorders. */
function listenerDeps({ observed, skipped, config = {}, agent = operatorAgent }) {
  return {
    observe: async (hook, text, meta) => { observed.push({ hook, text, meta }) },
    skip: (hook, meta, reason) => { skipped.push({ hook, meta, reason }) },
    readConfig: () => config,
    captureAgent: () => agent,
    meta: (payload) => ({ agentId: payload?.agent?.id ?? null, turn: payload?.turn ?? null, step: payload?.step ?? null }),
  }
}

test("a subagent's waterfall seams record the subagent skip, never observe, and still return the decision", async () => {
  const ctx = fakeCtx()
  const observed = [], skipped = []
  registerListeners(ctx, ['admit', 'pre_execute'], listenerDeps({ observed, skipped }))

  const decision = { messages: ['original'] }
  const returned = await ctx.handlers.get('agent/pre-step')({ agent: subagentAgent, messages: [], turn: 1, step: 1 }, async () => decision)
  assert.equal(returned, decision, 'the decision must be returned unchanged')

  const toolDecision = { allow: true }
  const toolReturned = await ctx.handlers.get('tools/pre-execute')({ agent: subagentAgent, name: 'bash', arguments: { command: 'ls' } }, async () => toolDecision)
  assert.equal(toolReturned, toolDecision, 'the decision must be returned unchanged')

  assert.equal(observed.length, 0, 'the model must never be called for a subagent')
  assert.deepEqual(skipped.map(entry => [entry.hook, entry.reason]), [['admit', 'subagent session'], ['pre_execute', 'subagent session']])
  assert.equal(skipped[0].meta.agentId, 'sub-1')
})

test('a suppressed draft relays every chunk unchanged and in order, and records one skip', async () => {
  const ctx = fakeCtx()
  const observed = [], skipped = []
  registerListeners(ctx, ['draft'], listenerDeps({ observed, skipped, agent: subagentAgent }))

  async function* reply() {
    yield { type: 'text-delta', text: 'a' }
    yield { type: 'text-delta', text: 'b' }
    yield { type: 'block-end', block: { type: 'text', text: 'ab' } }
  }
  const relayed = []
  for await (const chunk of ctx.handlers.get('llm/stream')({ purpose: undefined }, reply)) relayed.push(chunk)

  assert.deepEqual(relayed.map(chunk => chunk.type), ['text-delta', 'text-delta', 'block-end'])
  assert.equal(observed.length, 0, 'a suppressed stream must not reach the model')
  assert.equal(skipped.length, 1)
  assert.equal(skipped[0].hook, 'draft')
  assert.equal(skipped[0].reason, 'subagent session')
  assert.equal(skipped[0].meta.agentId, 'sub-1')
})

test("a subagent's result emit records a skip and never observes", () => {
  const ctx = fakeCtx()
  const observed = [], skipped = []
  registerListeners(ctx, ['result'], listenerDeps({ observed, skipped }))

  ctx.handlers.get('tools/result')({ agent: subagentAgent }, { ok: true })

  assert.equal(observed.length, 0)
  assert.equal(skipped.length, 1)
  assert.equal(skipped[0].hook, 'result')
  assert.equal(skipped[0].reason, 'subagent session')
})

test('observeSubagents true observes a subagent; a non-subagent is observed either way', async () => {
  const onCtx = fakeCtx()
  const observed = [], skipped = []
  registerListeners(onCtx, ['admit'], listenerDeps({ observed, skipped, config: { observeSubagents: true } }))
  await onCtx.handlers.get('agent/pre-step')({ agent: subagentAgent, messages: [{ role: 'user', content: 'hi' }], turn: 1, step: 1 }, async () => ({}))
  assert.equal(skipped.length, 0)
  assert.equal(observed.length, 1)
  assert.equal(observed[0].hook, 'admit')

  const offCtx = fakeCtx()
  const observedOp = [], skippedOp = []
  registerListeners(offCtx, ['admit'], listenerDeps({ observed: observedOp, skipped: skippedOp, agent: operatorAgent }))
  await offCtx.handlers.get('agent/pre-step')({ agent: operatorAgent, messages: [{ role: 'user', content: 'hi' }], turn: 1, step: 1 }, async () => ({}))
  assert.equal(skippedOp.length, 0, 'a non-subagent must never be suppressed')
  assert.equal(observedOp.length, 1)
})

test('the includeNonOperatorFacing gate comes first: a purpose-tagged stream writes no subagent skip', async () => {
  const ctx = fakeCtx()
  const observed = [], skipped = []
  registerListeners(ctx, ['draft'], listenerDeps({ observed, skipped, agent: subagentAgent, config: {} }))

  async function* reply() {
    yield { type: 'text-delta', text: 'a' }
  }
  const relayed = []
  for await (const chunk of ctx.handlers.get('llm/stream')({ purpose: 'title' }, reply)) relayed.push(chunk.type)

  assert.deepEqual(relayed, ['text-delta'], 'the stream must still relay untouched')
  assert.equal(observed.length, 0)
  assert.equal(skipped.length, 0, 'a stream the purpose gate already excludes must not gain a subagent skip')
})

// THE `assemble` SEAM'S AGENT IS ON THE SECOND ARGUMENT. `system-prompt/assemble(assembly, context, next)`:
// args[0] is a `PromptAssembly` {sections, contexts, tools, variables}; the loop builds args[1] with
// `assembleContextFor(agent, signal)` -> {agent, scope: agent} (packages/core/agent/src/dispatch.ts:174,
// called at packages/core/agent-loop/src/agent.ts:272). `agent` reaches `AssembleContext` by MODULE
// AUGMENTATION (packages/core/agent/src/runtime-types.ts:19), so the interface in its OWN package shows only
// {scope, signal} -- which is exactly why reading args[0].agent here looked right and suppressed nothing.
const ASSEMBLY = { sections: [], contexts: [], tools: [], variables: {} }

test("a subagent's assemble seam is suppressed from the second argument and returns the decision by reference", async () => {
  const ctx = fakeCtx()
  const observed = [], skipped = []
  registerListeners(ctx, ['assemble'], listenerDeps({ observed, skipped, agent: subagentAgent }))

  // The REAL agent-driven shape: assembleContextFor sets agent and scope together.
  const context = { agent: subagentAgent, scope: subagentAgent }
  const decision = { sections: [{ name: 's', order: 0, text: 'original' }], contexts: [], tools: [], variables: {} }
  const returned = await ctx.handlers.get('system-prompt/assemble')(ASSEMBLY, context, async () => decision)

  assert.equal(returned, decision, 'the decision must be returned unchanged')
  assert.equal(observed.length, 0, 'the model must never be called for a subagent assemble')
  assert.equal(skipped.length, 1)
  assert.equal(skipped[0].hook, 'assemble')
  assert.equal(skipped[0].reason, 'subagent session')
})

test('observeSubagents true observes the assemble seam', async () => {
  const ctx = fakeCtx()
  const observed = [], skipped = []
  registerListeners(ctx, ['assemble'], listenerDeps({ observed, skipped, agent: subagentAgent, config: { observeSubagents: true } }))

  await ctx.handlers.get('system-prompt/assemble')(ASSEMBLY, { agent: subagentAgent, scope: subagentAgent }, async () => ({}))

  assert.equal(skipped.length, 0)
  assert.equal(observed.length, 1)
  assert.equal(observed[0].hook, 'assemble')
})

test('a diagnostic assemble carries no agent, so it is observed even while a subagent is the initiator', async () => {
  const ctx = fakeCtx()
  const observed = [], skipped = []
  // `captureAgent` says subagent, but the ASSEMBLY says nothing. The event-local field wins: the augmentation
  // documents `agent` as "absent on diagnostics", so an ambient reading would mis-attribute one.
  registerListeners(ctx, ['assemble'], listenerDeps({ observed, skipped, agent: subagentAgent }))

  await ctx.handlers.get('system-prompt/assemble')(ASSEMBLY, { scope: {} }, async () => ({}))

  assert.equal(skipped.length, 0, 'a diagnostic assembly must not be attributed to the ambient initiator')
  assert.equal(observed.length, 1)
})
