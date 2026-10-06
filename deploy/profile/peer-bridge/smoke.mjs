// Smoke test for the promoted peer-bridge row. Run from this directory:
//
//   node smoke.mjs
//
// It executes the row against stub ctx/harness objects -- no harness, no live sessions -- and asserts the three
// things that would silently break the promotion:
//
//   1. it loads and registers exactly the three tools, with the same parameter schemas as the origin body;
//   2. the SEND guard admits an allowlisted workspace and refuses one that is not, naming it;
//   3. the READ guard is on the TARGET while the SEND guard is on the CALLER -- the asymmetry the origin body
//      relies on, and the one that decides who can say what to whom.
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

// (2) The guard change, which is the whole point of the promotion.
const send = byName.get('peer_send')
const refused = await send.execute({ sessionId: 'x', text: 'hi' }, caller('/home/john/CodingProjects/some-other-thing'))
assert.match(refused, /^refused: peer_send is limited to allowlisted workspaces/)
assert.match(refused, /some-other-thing/, 'the refusal names the caller cwd')

// An allowlisted caller gets past the guard and fails later, on the absent peer -- which proves admission.
const admitted = await send.execute({ sessionId: 'no-such-session', text: 'hi' }, caller('/home/john/CodingProjects/dsh-system1-observer'))
assert.match(admitted, /is not live in this process/, 'admitted, then refused for the right reason')
console.log('send guard: refuses an unknown workspace, admits dsh-system1-observer')

// (3) The asymmetry: peer_transcript guards the TARGET, so the caller's own cwd is irrelevant to it.
const target = { id: 'session-peer', status: 'running', session: { header: { cwd: '/home/john/CodingProjects/some-other-thing', createdAt: 1 }, seq: 5 } }
const isolated = []
const ctx2 = { get: () => ({ get: () => target, list: () => [target] }), tools: { register: (tool) => { isolated.push(tool); return () => {} } } }
await mod.apply(ctx2, {})
const read = isolated.find(tool => tool.name === 'peer_transcript')
const readRefused = await read.execute({ sessionId: 'session-peer' }, caller('/home/john/CodingProjects/dsh-telegram'))
assert.match(readRefused, /^refused: peer_transcript only reads peer workspaces/)
assert.match(readRefused, /some-other-thing/, 'it names the TARGET cwd, not the caller')
console.log('read guard: on the target, as in the origin body')

// The environment override must be able to widen both lists without an edit.
process.env.PEER_BRIDGE_SEND_MARKS = 'only-this-one'
const fresh = await import('./index.js?fresh=1')
const second = []
await fresh.apply({ get: () => undefined, tools: { register: (tool) => { second.push(tool); return () => {} } } }, {})
const overridden = second.find(tool => tool.name === 'peer_send')
const stillRefused = await overridden.execute({ sessionId: 'x', text: 'hi' }, caller('/home/john/CodingProjects/dsh-system1-observer'))
assert.match(stillRefused, /only-this-one/, 'the override replaces the list, so the default workspace is now refused')
assert.match(stillRefused, /some-other|dsh-telegram|allowlisted/, 'and the refusal names the new list')
console.log('env override: PEER_BRIDGE_SEND_MARKS replaces the list')

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
