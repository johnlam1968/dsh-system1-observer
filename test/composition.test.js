// THE REAL-COMPOSITION TEST: the plugin mounted into a REAL Cordis context.
//
// WHY THIS EXISTS, IN THE POLICY'S OWN WORDS. `extra/testing.md:38`: "Hand-built ctx.plugin(...) suites are
// insufficient: boot test-only cordis.yml through Loader and app/process, mock only external services or
// nondeterministic inputs, and assert model-visible request/log, durable state, or user-visible output."
//
// Every other test in this repo hands `apply` a hand-written object that IMPLEMENTS this repo's beliefs about
// Cordis. That is how four shape bugs survived 509 passing tests: the double agreed with the code. This file
// mounts the real runtime instead, so the framework itself can disagree. What it exercises that no double can:
//
//   - `inject` is a real contract: the plugin stays PENDING until a service named `agents` exists;
//   - registrations are real effects: a listener stops firing after the fiber is disposed;
//   - `ctx.provide` really registers a service, and disposal really retracts it;
//   - an async `apply` really does reach ACTIVE (the dsh-plugin-authoring skill claims otherwise for one
//     plugin; here the runtime answers instead of an anecdote);
//   - a configuration the plugin cannot honour really does fail the load, and `fiber.await()` throws it.
//
// THE JUDGE IS THE ONLY THING NOT REAL, and it is not reached at all here: the row is mounted with no seam
// hooks, so the seam listeners do not exist and no HTTP call can happen. A seam-firing composition with a stub
// judge server is the next increment, not this one.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from 'node:http'

import plugin from '../index.js'
import { TRACE_TOOL_NAME } from '../lib/tool.js'
import { CONFIG_TOOL_NAME } from '../lib/config-tool.js'
import { DECIDE_TOOL_NAME } from '../lib/decide-tool.js'
import { OBSERVER_SERVICE } from '../lib/service.js'

/**
 * The real Cordis runtime, from the harness install rather than from a dependency of this repo.
 *
 * The plugin is installed in a profile as a bundle, and the harness provides this package to it. A test that
 * declared its own copy would be testing a different Cordis than the one that loads the plugin, so the runtime
 * is resolved from the install. WHEN IT CANNOT BE FOUND THIS TEST FAILS rather than skipping: a skip would read
 * as "checked" in a summary line, and this is the one check that can disagree with everything else here.
 */
async function realCordis() {
  const candidates = []
  // LOCAL FIRST, because this repository now DECLARES the runtime as a devDependency and the suite has to be
  // runnable on a machine with no global harness install. The installed copy and the declared copy are the same
  // version (4.0.4, pinned exactly -- a caret does not resolve an rc on this host), so declaring it does not
  // weaken the point of this file: the runtime is still the real one, and it is the same one the profile loads.
  try {
    candidates.push(createRequire(import.meta.url).resolve('@deepseek-ai/cordis/package.json'))
  } catch { /* not declared as a dependency: fall through to the install */ }
  if (process.env.DSH_CORDIS) candidates.push(process.env.DSH_CORDIS)
  try {
    const root = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim()
    candidates.push(join(root, '@deepseek-ai/dsh/node_modules/@deepseek-ai/cordis/package.json'))
    candidates.push(join(root, '@deepseek-ai/cordis/package.json'))
  } catch { /* no npm on PATH: the declared copy or the env var, or nothing */ }
  for (const manifest of candidates) {
    if (!manifest.includes('package.json') || !existsSync(manifest)) continue
    const entry = createRequire(manifest).resolve('@deepseek-ai/cordis')
    return import(pathToFileURL(entry).href)
  }
  throw new Error(
    'no reachable @deepseek-ai/cordis: declare it as a devDependency, set DSH_CORDIS to its package.json, or install a harness that provides it.\n' +
    `looked in: ${candidates.join(', ') || '(nothing: no declared copy, no DSH_CORDIS and no npm root -g)'}`)
}

const { Context } = await realCordis()

const AGENT = { id: 'session-a', session: { snapshotEvents: () => [] } }

/** Mount the row the way the Loader does — `ctx.plugin(module, config)` — and wait for it to settle. */
async function mount(config) {
  const ctx = new Context()
  // `inject = ['agents']` is a real contract: without this the fiber stays PENDING and `await` never settles.
  ctx.provide('agents', { get: () => AGENT, list: () => [AGENT], currentInitiator: () => AGENT })
  const fiber = ctx.plugin(plugin, config)
  await fiber.await()
  return { ctx, fiber }
}

const configFor = (tracePath) => ({ hooks: [], sessions: ['*'], turnEveryNTurns: 0, questions: { turn: [] }, tracePath })

const lines = (path) => (existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean) : [])
const claim = { agent: AGENT, message: { id: 'peer-x', seq: 42, role: 'user', content: [{ type: 'text', text: 'the claimed one' }] }, turn: 7 }

test('the real runtime mounts the row, and its service is reachable by key', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'composition-'))
  const { ctx, fiber } = await mount(configFor(join(dir, 'trace.jsonl')))
  assert.ok(ctx.get(OBSERVER_SERVICE), `ctx.provide really registers a service other plugins can inject (${OBSERVER_SERVICE})`)
  await fiber.dispose()
})

test('a live event reaches the trace: the world is asserted, not the return value', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'composition-live-'))
  const tracePath = join(dir, 'trace.jsonl')
  const { ctx, fiber } = await mount(configFor(tracePath))

  ctx.emit('agent/inbox/claimed', claim)
  const after = lines(tracePath).map((line) => JSON.parse(line)).filter((line) => line.event === 'claimed')
  assert.equal(after.length, 1, 'the listener the row registered inside the REAL runtime ran: ' + JSON.stringify(lines(tracePath)))
  assert.equal(after[0].turn, 7)

  await fiber.dispose()
})

test('dispose releases everything: the same event no longer reaches the trace (HMR safety)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'composition-dispose-'))
  const tracePath = join(dir, 'trace.jsonl')
  const { ctx, fiber } = await mount(configFor(tracePath))

  ctx.emit('agent/inbox/claimed', claim)
  const before = lines(tracePath).length
  assert.ok(before > 0)

  await fiber.dispose()
  ctx.emit('agent/inbox/claimed', { ...claim, turn: 8 })
  assert.equal(lines(tracePath).length, before,
    'a disposed row must not still be listening: every registration is supposed to be an effect (index.md:42-65)')
  assert.equal(ctx.get(OBSERVER_SERVICE), undefined, 'and its service is retracted, not left dangling')
})

test('a disposed context can mount the row again: apply is re-entrant', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'composition-again-'))
  const tracePath = join(dir, 'trace.jsonl')
  const first = await mount(configFor(tracePath))
  await first.fiber.dispose()

  // The same Context, the same services: a config save replaces the instance, so apply runs again against a
  // context that has already seen it once (and a missing module-level state assumption would show up here).
  const fiber = first.ctx.plugin(plugin, configFor(tracePath))
  await fiber.await()
  assert.ok(first.ctx.get(OBSERVER_SERVICE), 'the second mount registered its service')
  await fiber.dispose()
})

test('a configuration the row cannot honour fails the LOAD, and await() carries the reason', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'composition-fail-'))
  writeFileSync(join(dir, 'blocker'), 'a file where a directory must be\n')
  const ctx = new Context()
  ctx.provide('agents', { get: () => AGENT, list: () => [AGENT], currentInitiator: () => AGENT })
  const fiber = ctx.plugin(plugin, configFor(join(dir, 'blocker', 'trace.jsonl')))

  // framework/index.md:24 -- FAILED is the documented outcome when apply throws; config.md:96-98 makes
  // configuration errors loud. In a real boot this is the non-zero exit extra/testing.md:40 asks for.
  await assert.rejects(fiber.await(), (error) => {
    assert.match(String(error.message), /cannot write the trace/)
    return true
  })
})


/**
 * The harness's OWN tool registry, from the install rather than from a dependency of this repo -- the same rule as
 * `realCordis` above, for the same reason: a different registry would be a different test.
 */
async function realToolRegistry() {
  const candidates = []
  // LOCAL FIRST, by the same rule as `realCordis`: the registry is declared as a devDependency at the exact tested
  // version, so the suite runs without a global harness install -- and this is the second resolver in this file that
  // the hermeticity control found, which is why the control exists rather than a single grep.
  try {
    return import(pathToFileURL(createRequire(import.meta.url).resolve('@deepseek-ai/dsh-tools')).href)
  } catch { /* not declared as a dependency: fall through to the install */ }
  try {
    const root = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim()
    candidates.push(join(root, '@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/package.json'))
    candidates.push(join(root, '@deepseek-ai/dsh-tools/package.json'))
  } catch { /* no npm on PATH */ }
  for (const manifest of candidates) {
    if (!existsSync(manifest)) continue
    const entry = createRequire(manifest).resolve('@deepseek-ai/dsh-tools')
    return import(pathToFileURL(entry).href)
  }
  throw new Error('no reachable @deepseek-ai/dsh-tools: declare it as a devDependency, or install a harness that provides it')
}

const { ToolRuntime } = await realToolRegistry()

/** A systemPrompt stub carrying only what the registry calls on it, taken from its own source. */
const systemPromptStub = () => ({ tools: () => {}, section: () => {}, getSectionOrder: () => 0 })

test('the REAL tool registry registers the row\'s tools, and dispose takes them back out', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'composition-registry-'))
  const ctx = new Context()
  ctx.provide('agents', { get: () => AGENT, list: () => [AGENT], currentInitiator: () => AGENT })
  ctx.provide('systemPrompt', systemPromptStub())

  const registryFiber = ctx.plugin(ToolRuntime)
  await registryFiber.await()
  const registry = ctx.get('tools')
  assert.ok(registry, 'the real registry is mounted as `tools`')

  // THE ROW'S OWN `ctx.inject(['tools'], ...)` IS WHAT PUTS THEM HERE, so this also exercises the optional-access
  // path against a REAL service rather than against a double that always answers.
  const fiber = ctx.plugin(plugin, configFor(join(dir, 'trace.jsonl')))
  await fiber.await()
  for (const name of [TRACE_TOOL_NAME, CONFIG_TOOL_NAME, DECIDE_TOOL_NAME]) {
    assert.ok(registry.get(name), `${name} is registered while the row is mounted`)
  }

  await fiber.dispose()

  // THE HMR-SAFETY ASSERTION FOR THIS REGISTRY, which `extra/testing.md:9` requires of every one of them
  // ("dispose the contributing fiber, assert cleanup"). Disposal is the REGISTRY's work, tracked by Cordis against
  // the contributing fiber -- which is precisely why a hand-written double cannot check it: a double would have to
  // implement the tracking that is under test.
  for (const name of [TRACE_TOOL_NAME, CONFIG_TOOL_NAME, DECIDE_TOOL_NAME]) {
    assert.equal(registry.get(name), undefined, `${name} is gone once the row is disposed`)
  }
  // AND THE REGISTRY IS STILL THERE, which is the control: the three absences above are our disposal, not the whole
  // registry having gone away with the row.
  assert.ok(ctx.get('tools'), 'the registry itself outlives the row it served')

  await registryFiber.dispose()
})


test('a seam fires through the real runtime: the judge answers, the trace records it, and the decision returns BY IDENTITY', async () => {
  // THE JUDGE IS THE ONE EXTERNAL SERVICE, and it is stubbed at the only boundary it has: an HTTP endpoint. This is
  // the composition the plugin exists for -- the harness loop reaching a decision model -- run inside the harness's
  // own runtime rather than against a hand-built context.
  const seen = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      seen.push(JSON.parse(body))
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ answers: { a_noul: { noul: 0.9 } } }))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))

  const dir = mkdtempSync(join(tmpdir(), 'composition-seam-'))
  const tracePath = join(dir, 'trace.jsonl')
  const ctx = new Context()
  ctx.provide('agents', { get: () => AGENT, list: () => [AGENT], currentInitiator: () => AGENT })

  const fiber = ctx.plugin(plugin, {
    hooks: ['admit'], sessions: ['*'], tracePath,
    questions: { admit: [{ id: 'a_noul', type: 'noul', instructions: 'Is this true?' }] },
    wireUrl: `http://127.0.0.1:${server.address().port}`, timeoutMs: 5000, turnEveryNTurns: 0,
  })
  await fiber.await()

  // THE WATERFALL, DISPATCHED THE WAY THE HARNESS DISPATCHES IT (`events.md:70-79`: `next()` is mandatory, and a
  // listener that returns without calling it short-circuits the pipeline).
  const decision = { verdict: 'enter', messages: [{ role: 'user', content: [{ type: 'text', text: 'the request' }] }] }
  const payload = { agent: AGENT, turn: 3, step: 1, messages: decision.messages }
  const returned = await ctx.waterfall('agent/pre-step', payload, async () => decision)

  // IDENTITY, NOT SHAPE. `events.md:68` says a waterfall listener may WRAP the downstream value; the code's own
  // comment claims it returns the same reference and never a copy, "so nothing downstream sees a different object".
  // A deep-equal assertion would pass on a rebuilt object, which is the failure the claim is about.
  assert.equal(returned, decision, 'the downstream decision must come back as the SAME object')

  // THE OBSERVATION IS AWAITED BEFORE THE DECISION IS RETURNED, so the record already exists and this needs no poll:
  // a poll here would hide a listener that returned early and judged afterwards.
  const lines = existsSync(tracePath) ? readFileSync(tracePath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []
  assert.equal(seen.length, 1, 'the judge was called exactly once: ' + JSON.stringify(lines.map((l) => l.event)))
  assert.ok(lines.some((l) => l.event === 'call' || l.hook === 'admit'),
    'the trace records the seam it asked about: ' + JSON.stringify(lines.map((l) => l.event)))

  await fiber.dispose()
  await new Promise((resolve) => server.close(resolve))
})


test('the serial turn trigger returns undefined, so the listeners BEHIND it still run', async () => {
  // `events.md:58-64`: a serial dispatch awaits its listeners in order, and "the first return that is not null, false
  // or undefined TERMINATES the rest". So the row's trigger returning a value would silently suppress every listener
  // registered after it -- which is why the code returns undefined at every gate, and why the consequence is asserted
  // here rather than the return value. A test of the return value alone would pass on a listener that returns
  // `undefined` and still blocks the chain some other way.
  const dir = mkdtempSync(join(tmpdir(), 'composition-serial-'))
  const ctx = new Context()
  ctx.provide('agents', { get: () => AGENT, list: () => [AGENT], currentInitiator: () => AGENT })

  const fiber = ctx.plugin(plugin, configFor(join(dir, 'trace.jsonl')))
  await fiber.await()

  // REGISTERED AFTER THE ROW'S OWN LISTENER, because the row registers at mount -- so this one is behind it in the
  // order the harness dispatches.
  let laterRan = false
  ctx.on('agent/turn-stopping', () => { laterRan = true })

  await ctx.serial('agent/turn-stopping', { agent: AGENT, turn: 5, messages: [{ text: 'the reaction' }] })
  assert.equal(laterRan, true, 'a value returned by an earlier serial listener would have terminated this one')

  await fiber.dispose()
})

test('the REAL registry executes system1_decide and VALIDATES its output -- the check F118 was missing', async () => {
  // The live failure this pins was not a wrong value: it was a value the pipeline REFUSED, because the tool's output
  // declaration closed a map whose keys come from the caller (`answers`) and an envelope another service owns
  // (`executed`, `usage`). Every unit test passed, because they assert the object a body returns and never dispatch it
  // through the registry -- which is the only place a value meets its declaration. This test dispatches it there.
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      void body
      res.setHeader('content-type', 'application/json')
      // THE ENVELOPE SITS AT THE TOP LEVEL for the wire: `projectEnvelope` copies `executed`/`usage` off the REPLY, so a
      // stub that nested them under `meta` would leave the two nodes this test exists for unpopulated (`envelope.js`).
      res.end(JSON.stringify({
        answers: { a_noul: { noul: 0.9 } },
        executed: { provider: 'typesafe', model: 'typesafe/jev-1.13-20260917' },
        usage: { inputTokens: 12, outputTokens: 3 },
      }))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))

  const dir = mkdtempSync(join(tmpdir(), 'composition-output-'))
  const ctx = new Context()
  ctx.provide('agents', { get: () => AGENT, list: () => [AGENT], currentInitiator: () => AGENT })
  ctx.provide('systemPrompt', systemPromptStub())
  const registryFiber = ctx.plugin(ToolRuntime)
  await registryFiber.await()
  const registry = ctx.get('tools')

  const fiber = ctx.plugin(plugin, {
    hooks: [], sessions: ['*'], turnEveryNTurns: 0, questions: { turn: [] },
    tracePath: join(dir, 'trace.jsonl'), wireUrl: `http://127.0.0.1:${server.address().port}`, timeoutMs: 5000,
  })
  await fiber.await()

  // THE EXECUTION SHAPE THE RUNTIME EXPECTS, taken from its own `createExecution`: a call id, the agent it is dispatched
  // for (which is also how it resolves visibility), the arguments, and a signal.
  try {
    const result = await registry.execute({
      // `signal` IS REQUIRED, not optional: the runtime reads `.aborted` off it while preparing the dispatch, and
      // passing `undefined` throws inside the registry rather than reaching the tool (measured).
      name: DECIDE_TOOL_NAME, callId: 'call-1', rootCallId: 'call-1', agent: AGENT,
      signal: new AbortController().signal,
      arguments: { state: 'the operator asked for a typo fix', questions: [{ id: 'a_noul', type: 'noul', instructions: 'Was it done?' }] },
    })

    // A REFUSAL WOULD ARRIVE AS A THROWN `ToolOutputError`, so reaching here is half the assertion; the value is the
    // other half, and `answers`/`executed`/`usage` are the three nodes that made the live call fail.
    assert.equal(result.isError, false, 'the dispatch succeeded: ' + JSON.stringify(result).slice(0, 300))
    assert.deepEqual(Object.keys(result.value.answers), ['a_noul'])
    // THE THREE NODES THAT FAILED LIVE, each asserted POPULATED -- an absent field would satisfy a closed-empty
    // declaration vacuously, which is exactly how this shipped.
    assert.equal(result.value.executed.provider, 'typesafe')
    assert.equal(result.value.usage.inputTokens, 12)
    assert.match(result.content[0].text, /a_noul/)
  } finally {
    // IN A `finally`, BECAUSE A FAILING ASSERTION LEFT THE SERVER AND TWO FIBERS OPEN AND THE WHOLE FILE TOOK 119 s:
    // a test that hangs the suite when it fails is worse than one that fails.
    await fiber.dispose()
    await registryFiber.dispose()
    server.close()
  }
})
