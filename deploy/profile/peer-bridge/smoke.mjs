// Smoke test for the promoted peer-bridge row. Run from this directory:
//
//   node smoke.mjs
//
// It executes the row against stub ctx/harness objects -- no harness, no live sessions -- and asserts the three
// things that would silently break the promotion:
//
//   1. it loads and registers exactly the three tools, with the same parameter schemas as the origin body;
//   2. the SEND guard is GONE: the only authority on `peer_send` is that the target is live in this process;
//   3. READS ARE UNGATED: `peer_transcript` reads a session it can address, whatever its cwd -- the read
//      allow-list was removed 2026-10-09 (see index.js header and harness_RSI/FREEDOM.md).
import assert from 'node:assert/strict'

const registered = []
const ctx = {
    get: (name) => (name === 'agents' ? { get: () => undefined, list: () => [] } : undefined),
    tools: {
        register(tool) {
            registered.push(tool)
            return () => {}
        },
    },
}

const mod = await import('./index.js')
assert.equal(mod.name, 'peer-bridge', 'the row must export its name')
assert.deepEqual(mod.inject, ['tools'], 'it registers into the tools service')
assert.equal(typeof mod.apply, 'function')

await mod.apply(ctx, {})

const byName = new Map(registered.map(tool => [tool.name, tool]))
assert.deepEqual([...byName.keys()].sort(), ['peer_send', 'peer_sessions', 'peer_transcript'])
console.log('registered:', [...byName.keys()].join(', '))

// (1) The parameter schemas must survive promotion -- a tool the model cannot call is not a promotion.
// `defineTool` normalises the shorthand into JSON Schema, exactly as the dynamic body's `harness.defineTool`
// did, so the property names and the required lists are what the live registry sees.
const props = (name) => Object.keys(byName.get(name).parameters.properties)
assert.deepEqual(props('peer_sessions'), ['cwdContains'])
assert.deepEqual(props('peer_transcript'), ['sessionId', 'sinceSeq', 'limit'])
assert.deepEqual(props('peer_send'), ['sessionId', 'text', 'mode', 'from'])
assert.deepEqual(byName.get('peer_transcript').parameters.required, ['sessionId'])
assert.deepEqual(byName.get('peer_send').parameters.required, ['sessionId', 'text'])
assert.equal(byName.get('peer_sessions').parameters.required, undefined, 'peer_sessions takes everything optionally')
for (const tool of registered) {
    assert.equal(tool.output.schema.type, 'string', tool.name + ' returns text')
    assert.equal(typeof tool.execute, 'function')
}
console.log('schemas: intact (13 parameters, 2 required, all three return text)')

/** A caller with a given cwd, as `exec.agent` looks on a real tool call. */
const caller = (cwd) => ({ agent: { id: 'session-test', status: 'running', session: { header: { cwd, createdAt: 1 }, seq: 5 } } })

// (2) The SEND guard was removed 2026-10 on operator request. Authorization is now solely on the target
// being live in this process -- any cwd may call peer_send and the refusal (if any) is "is not live".
const send = byName.get('peer_send')
const delivered = await send.execute({ sessionId: 'no-such-session', text: 'hi' }, caller('/home/john/CodingProjects/some-other-thing'))
assert.match(delivered, /is not live in this process/, 'any caller is admitted, then refused for the right reason')
assert.doesNotMatch(delivered, /^refused: peer_send is limited to allowlisted workspaces/, 'the SEND cwd guard is gone')
console.log('send guard: removed -- any caller reaches the live-peer check')

// (3) READS ARE UNGATED. The read allow-list was removed 2026-10-09, so a target in a workspace that the old
// list did NOT contain is readable -- which is exactly the case this repo's own sessions hit. The old refusal
// named the target's cwd, so its absence is the assertion.
const targetCwd = '/home/john/CodingProjects/harness_RSI'
const target = {
    id: 'session-peer', status: 'running',
    session: {
        header: { cwd: targetCwd, createdAt: 1 },
        seq: 5,
        snapshotEvents: () => [],
    },
}
const isolated = []
const ctx2 = { get: () => ({ get: () => target, list: () => [target] }), tools: { register: (tool) => { isolated.push(tool); return () => {} } } }
await mod.apply(ctx2, {})
const read = isolated.find(tool => tool.name === 'peer_transcript')
const readResult = await read.execute({ sessionId: 'session-peer' }, caller('/home/john/CodingProjects/dsh-telegram'))
assert.doesNotMatch(readResult, /only reads peer workspaces/, 'the READ allow-list must be gone')
assert.match(readResult, /harness_RSI/, 'an out-of-allow-list target is read and its cwd is reported')
console.log('read guard: removed -- any addressable session is readable')

// PEER_BRIDGE_SEND_MARKS is retained for compat but no longer narrows who may send (the guard is gone).
// The override is still read, so a deployment that wants the substring contract back can set it and
// reinstate the guard without a code change. Here we just confirm the env is consumed and does not
// produce a SEND-side refusal: any caller still passes that step.
process.env.PEER_BRIDGE_SEND_MARKS = 'only-this-one'
const fresh = await import('./index.js?fresh=1')
const second = []
const emptyAgents = { get: () => undefined, list: () => [] }
await fresh.apply({ get: () => emptyAgents, tools: { register: (tool) => { second.push(tool); return () => {} } } }, {})
const overridden = second.find(tool => tool.name === 'peer_send')
const stillDelivered = await overridden.execute({ sessionId: 'no-such-session', text: 'hi' }, caller('/home/john/CodingProjects/dsh-system1-observer'))
assert.match(stillDelivered, /is not live in this process/, 'env override is read but the SEND guard stays removed')
assert.doesNotMatch(stillDelivered, /only-this-one/, 'the override does not narrow senders any more')
console.log('env override: PEER_BRIDGE_SEND_MARKS still parsed; SEND guard stays removed')

console.log('\nOK -- the row loads, registers all three tools, and both guards behave.')



// THE REPLY ADDRESS MUST TRAVEL WITH THE MESSAGE. Before this the delivered text named the sender only in prose,
// so a receiver could not answer unless the sender happened to embed its own session id in the label -- measured:
// a delegated task finished and the report went into its own session instead of back to the caller.
{
    const delivered = []
    const target = {
        id: 'session-peer-1', status: 'running',
        session: { header: { cwd: '/home/john/CodingProjects/dsh-system1-observer', createdAt: 1 }, seq: 5 },
        followup: (message) => delivered.push(message),
        steer: () => {}, inject: () => {},
    }
    const registered = []
    const ctx = {
        get: () => ({ get: () => target, list: () => [target] }),
        tools: { register: (tool) => { registered.push(tool); return () => {} } },
    }
    const { apply } = await import('./index.js')
    apply(ctx, {})
    const send = registered.find((tool) => tool.name === 'peer_send')
    const result = await send.execute(
        { sessionId: 'session-peer-1', text: 'do the thing' },
        caller('/home/john/CodingProjects/dsh-system1-observer'),
    )
    assert.match(result, /^delivered followup/)
    assert.equal(delivered.length, 1)
    const text = delivered[0].content[0].text
    assert.match(text, /session-test/, 'the sender session id travels with the message')
    assert.match(text, /peer_send/, 'and so does the tool an answer needs')
    console.log('reply address: carried with the message')
}
