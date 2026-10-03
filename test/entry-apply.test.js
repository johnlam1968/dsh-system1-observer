import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../index.js'
import { PROBE_SEAMS } from '../lib/seams.js'

// WHY THIS EXISTS: the observer's first live mount wrote 209 `error` lines reading "decide is not a function"
// and no `call` lines at all. Both model factories return a CLIENT object, and `apply` assigned it to `decide`
// and called it. Every unit test passed, because none of them executed `apply`.
function fakeCtx({ inject = () => {} } = {}) {
  const handlers = new Map()
  return {
    handlers,
    on(event, handler) { handlers.set(event, handler); return () => handlers.delete(event) },
    inject,
    provide: () => () => {},
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
  await apply(ctx, { hooks: ['draft'], tracePath, sessions: ['agent-1'], wireUrl: 'http://127.0.0.1:9', timeoutMs: 200 })

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
  await apply(ctx, { hooks: ['close'], tracePath, sessions: ['agent-1'], wireUrl: 'http://127.0.0.1:9', timeoutMs: 200 })
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
  await apply(ctx, { hooks: ['close'], tracePath, sessions: ['agent-1'], wireUrl: 'http://127.0.0.1:9', timeoutMs: 200 })

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
    provide: () => () => {},
    agents: { currentInitiator: () => current },
  }
}

test("by default a subagent's admit, pre_execute and draft are skips and decide is never called", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'system1-observer-'))
  const tracePath = join(dir, 'trace.jsonl')
  let calls = 0
  const ctx = serviceCtx(async () => { calls += 1; return { kind: 'answers', answers: {} } })
  ctx.setInitiator(SUBAGENT)
  await apply(ctx, { hooks: ['admit', 'pre_execute', 'draft'], tracePath, sessions: [OPERATOR.id] })

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
  await apply(ctx, { hooks: ['pre_execute'], tracePath, sessions: [SUBAGENT.id], observeSubagents: true })

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
  await apply(ctx, { hooks: ['pre_execute'], tracePath, sessions: [OPERATOR.id] })

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
  await apply(ctx, { hooks: ['assemble'], tracePath, sessions: [SUBAGENT.id] })

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

// MEASURED LIVE, and it cost every assembled prompt: `meta` was built from `args[0]` -- the `PromptAssembly`,
// which carries no `agent` -- while the agent is on `args[1]`. Nothing noticed until a session filter existed,
// because nothing read `meta.agentId` before; then EVERY assemble recorded `session not observed`, including
// inside the session the row was pointed at, and `assemble` could not be observed at all.
test('an assemble in the TARGETED session is attributed to it, not skipped as unattributable', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'system1-observer-'))
  const tracePath = join(dir, 'trace.jsonl')
  let calls = 0
  const ctx = serviceCtx(async () => { calls += 1; return { kind: 'answers', answers: {} } })
  ctx.setInitiator(OPERATOR)
  await apply(ctx, { hooks: ['assemble'], tracePath, sessions: [OPERATOR.id] })

  const assembly = { sections: [{ name: 's', order: 0, text: 'THE ASSEMBLED PROMPT' }], contexts: [], tools: [], variables: {} }
  await ctx.handlers.get('system-prompt/assemble')(assembly, { agent: OPERATOR, scope: OPERATOR }, async () => assembly)

  const lines = readLines(tracePath)
  assert.deepEqual(lines.filter(line => line.event === 'skip').map(line => line.reason), [], 'the agent is on the second argument, and the session filter must read it there')
  const call = lines.find(line => line.event === 'call')
  assert.equal(call?.agentId, OPERATOR.id, 'the call line must name the session it belongs to')
  assert.equal(calls, 1)

  // AND THE FILTER STILL BITES at this seam: a diagnostic assembly carries no agent, so it is unattributable
  // and must be passed over rather than credited to whoever happens to be the initiator.
  await ctx.handlers.get('system-prompt/assemble')(assembly, { scope: OPERATOR }, async () => assembly)
  const after = readLines(tracePath).filter(line => line.event === 'skip')
  assert.deepEqual(after.map(line => line.reason), ['session not observed'])
  assert.equal(calls, 1, 'an unattributable assembly must not reach the model once a session is targeted')
})

// ---------------------------------------------------------------------------------------------
// THE TRACE TOOL. An agent asked to tune the questions has to be able to see what they did, and a path it
// has no reason to know is a path it will not read -- so the row registers a tool whose own description is
// the hint. Registration goes through `ctx.inject(['tools'])`: a hard dependency would leave the whole row
// PENDING on a deployment without the tools service, losing the observation to gain a reader.
// ---------------------------------------------------------------------------------------------
const SCHEMA_KEYWORDS = new Set(['type', 'oneOf', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'description', 'title', 'default', 'examples'])

/** Every keyword used anywhere in a schema, so an unsupported one fails here rather than at `register`. */
function keywordsOf(node, found = new Set()) {
  if (node === null || typeof node !== 'object') return found
  if (Array.isArray(node)) {
    for (const item of node) keywordsOf(item, found)
    return found
  }
  for (const [key, value] of Object.entries(node)) {
    found.add(key)
    if (key === 'properties') {
      for (const child of Object.values(value)) keywordsOf(child, found)
    } else if (key === 'items' || key === 'oneOf') {
      keywordsOf(value, found)
    }
  }
  return found
}

test('apply registers a trace tool, and its schema stays inside the registry subset', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'system1-observer-'))
  const tracePath = join(dir, 'trace.jsonl')
  const registered = []
  const handlers = new Map()
  const ctx = {
      provide: () => () => {},
    on(event, handler) { handlers.set(event, handler); return () => handlers.delete(event) },
    inject(services, callback) {
      // Only the tools service answers here, so the `system1` inject is the no-service path.
      if (services.includes('tools')) {
        callback({ get: () => ({ register(definition) { registered.push(definition); return () => {} } }) })
      }
    },
    agents: { currentInitiator: () => OPERATOR, list: () => [{ id: 'session-aaa' }, { id: 'session-bbb' }] },
  }
  await apply(ctx, { hooks: ['admit'], tracePath, sessions: [OPERATOR.id] })

  // EACH TOOL EXACTLY ONCE, rather than a bare count. The row now registers two -- the trace tool and the
  // repository's own decision tool -- and the property this assertion has always been about is that nothing is
  // registered TWICE, because a duplicate name throws in the registry. A count would have had to be bumped for a
  // legitimate addition while going on passing for an illegitimate duplicate.
  const names = registered.map((definition) => definition.name)
  // FOUR, and O19 is why this list is worth pinning: a schema the registry refuses takes the WHOLE callback down, so
  // the symptom was a missing tool rather than a bad one.
  assert.deepEqual([...names].sort(), ['system1_decide', 'system1_evaluate', 'system1_observe_config', 'system1_questions', 'system1_results', 'system1_trace'], 'every tool, and nothing else')
  assert.equal(new Set(names).size, names.length, 'no name registered twice')
  const tool = registered.find((definition) => definition.name === 'system1_trace')
  assert.match(tool.description, /System One observer trace/, 'the description is the hint the agent reads')
  assert.match(tool.description, /session ids/, 'including where to find what a session-scoped observer targets')
  assert.equal(typeof tool.output.render, 'function', 'register requires an output.render')
  assert.equal(typeof tool.execute, 'function')

  // A KEYWORD OUTSIDE THE SUBSET MAKES `register` THROW, so it is checked here -- `minimum` is the one a
  // tool author reaches for first, and it is not in the subset.
  const unsupported = [...keywordsOf(tool.parameters), ...keywordsOf(tool.output.schema)].filter(key => !SCHEMA_KEYWORDS.has(key))
  assert.deepEqual(unsupported, [], 'the parameter and output schemas must use only supported keywords')
  assert.equal(tool.parameters.type, 'object', 'a tool schema is object-rooted')
  assert.deepEqual(tool.parameters.properties.hook.enum, [...PROBE_SEAMS], 'the seam enum comes from the runtime list')

  // NOTHING OBSERVED YET: a report, not a throw, naming the path it looked at.
  //
  // This asserted the sentence "no trace at <path>", which described a file that did not exist yet. `apply` now
  // PROVES the path at mount by creating it (lib/evidence.js `probe`), so a mounted row always has a trace file and
  // the honest report is "no run matching ... runs present: (none)". The property is unchanged -- a report rather
  // than a throw -- so the assertion now checks the property instead of one of its two wordings.
  const empty = await tool.execute({})
  assert.match(empty.text, /no (trace at|run matching)/, 'a report rather than a throw')
  assert.ok(empty.text.includes('trace.jsonl'), 'and it names the path it looked at: ' + empty.text)

  // THEN A REAL OBSERVATION, through the listener the row registered. `wireUrl` points at a closed port, so
  // the call fails and the trace gets an error line -- which is the point: the tool reads what the row wrote.
  await handlers.get('agent/pre-step')({ agent: OPERATOR, messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }] }, async () => ({}))
  const after = await tool.execute({})
  assert.match(after.text, /trace /)
  assert.match(after.text, /1 errors/, 'the failed call the row recorded is what the agent sees')
  assert.match(after.text, /sessions live now: session-aaa, session-bbb/, 'live sessions come from the agents service')

  // JUNK ARGUMENTS ARE REFUSED. THIS TEST ASSERTED THE OPPOSITE, and the comment above the old line said so:
  // "junk arguments must not throw: execute receives whatever the model sent." That was written before the tool
  // reference was read. `reference/cookbook/adding-a-tool.md:44` makes a raw registration responsible for validating
  // its own arguments, and `tail: 'lots'` being quietly ignored is exactly how a call that LOOKS fulfilled returns
  // the wrong window -- the failure mode this repository keeps finding. `:48` makes a throw the documented failure
  // path: the registry catches it and the model sees `isError`.
  await assert.rejects(tool.execute({ run: 42, tail: 'lots', full: 'yes' }), /must be/, 'a malformed call is refused, not silently adjusted')

  // RENDER TURNS THE VALUE INTO A TEXT BLOCK, which is what the model actually reads.
  const blocks = tool.output.render({}, { text: after.text })
  assert.deepEqual(blocks, [{ type: 'text', text: after.text }])
})

// THE MOUNT LINE MUST SAY WHAT THE RUN WAS ASKED TO DO. Without it a quiet trace is unreadable as a whole:
// "was it scoped, paused, or broken?" is the first question anyone asks of one, and the three fields that
// answer it -- the master switch, the per-seam switches and the session list -- were only ever visible
// per-event, if at all.
test('the mount line records the master switch, the seams that are off, and the session list', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'system1-observer-'))
  const tracePath = join(dir, 'trace.jsonl')
  const ctx = fakeCtx()
  await apply(ctx, {
    hooks: ['draft'],
    tracePath,
    callsEnabled: false,
    sessions: ['session-aaa'],
    seamEnabled: { draft: true, admit: false },
  })
  // The line is written lazily, so an observation is what forces it. `next` is a THUNK returning the stream,
  // which is the harness contract -- passing an already-created generator makes the listener throw.
  async function* reply() { yield { type: 'text-delta', text: 'x' } }
  for await (const _ of ctx.handlers.get('llm/stream')({ purpose: undefined }, reply)) { /* drain */ }

  const mount = readLines(tracePath).find(line => line.event === 'mount')
  assert.ok(mount !== undefined, 'no mount line was written')
  assert.equal(mount.callsEnabled, false)
  assert.deepEqual(mount.sessions, ['session-aaa'], 'the list as written, because [] and [*] are different states')
  assert.deepEqual(mount.seamsOff, ['admit'], 'the DEVIANT set only -- nine booleans would bury the one that is off')
})

test('the mount line records the wildcard rather than rewriting it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'system1-observer-'))
  const tracePath = join(dir, 'trace.jsonl')
  const ctx = fakeCtx()
  await apply(ctx, { hooks: ['draft'], tracePath, sessions: ['*'] })
  async function* reply() { yield { type: 'text-delta', text: 'x' } }
  for await (const _ of ctx.handlers.get('llm/stream')({ purpose: undefined }, reply)) { /* drain */ }

  const mount = readLines(tracePath).find(line => line.event === 'mount')
  assert.deepEqual(mount.sessions, ['*'], 'the wildcard is the distinction between "everything" and "nothing"')
  assert.equal(mount.callsEnabled, true)
  assert.deepEqual(mount.seamsOff, [])
})

// THE INSTRUMENT'S IDENTITY GOES ON THE MOUNT LINE. The probe's question text was authored by intuition, so a
// run with edited instructions is a new measurement rather than a comparison, and the hash is what lets a
// reader tell the two apart instead of averaging them.
test('the mount line records the probe question fingerprint', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'system1-observer-hash-'))
  const tracePath = join(dir, 'trace.jsonl')
  const ctx = fakeCtx()
  await apply(ctx, { hooks: ['draft'], tracePath, sessions: ['agent-1'] })
  async function* reply() { yield { type: 'text-delta', text: 'x' } }
  for await (const _ of ctx.handlers.get('llm/stream')({ purpose: undefined }, reply)) { /* drain */ }

  const mount = readLines(tracePath).find(line => line.event === 'mount')
  assert.match(mount.probeHash, /^[0-9a-f]{12}$/, 'a short, stable fingerprint of the question text')
})

// THE BOUND IS ON THE MOUNT LINE, and that is the only place a run says what it has already rotated away. A cap
// that cannot be read is a cap that cannot be audited -- which is the defect three upstream counters share.
test('the mount line carries the rotation count and the instrument fingerprint', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'system1-observer-rot-'))
  const tracePath = join(dir, 'trace.jsonl')
  const ctx = fakeCtx()
  await apply(ctx, { hooks: ['draft'], tracePath, sessions: ['agent-1'], maxTraceBytes: 0 })
  async function* reply() { yield { type: 'text-delta', text: 'x' } }
  for await (const _ of ctx.handlers.get('llm/stream')({ purpose: undefined }, reply)) { /* drain */ }

  const mount = readLines(tracePath).find(line => line.event === 'mount')
  assert.deepEqual(mount.rotated, { count: 0, lines: 0, bytes: 0, archived: null }, 'nothing rotated yet')
  assert.match(mount.probeHash, /^[0-9a-f]{12}$/, 'and the instrument is named')
})
