// THE WIRING, ASSERTED. test/service.test.js proves the SERVICE MODULE has the right shape; it cannot prove the
// ROW provides it, and a green gate with the provide call deleted would look identical. So this file mounts the
// row with its own context and config -- self-contained on purpose, so it cannot disturb the shared stubs that
// five other test files lean on -- and asserts what the row hands to `provide`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../index.js'
import { OBSERVER_SERVICE } from '../lib/service.js'

const accessor = (value) => ({ get: () => value })

/** A Cordis-shaped context: it subscribes, it injects, and it records what was provided. */
function recordingCtx() {
  const handlers = new Map()
  const provided = new Map()
  return {
    handlers,
    provided,
    on(event, handler) { handlers.set(event, handler); return () => handlers.delete(event) },
    inject() {},
    provide(name, value) { provided.set(name, value); return () => provided.delete(name) },
    agents: { currentInitiator: () => ({ id: 'agent-1' }) },
  }
}

test('apply provides the observer service, with its readers, the derived signals, and a freeze', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'observer-wiring-'))
  const ctx = recordingCtx()
  await apply(ctx, {
    hooks: accessor(['admit']),
    tracePath: accessor(join(dir, 'trace.jsonl')),
    sessions: accessor(['agent-1']),
    wireUrl: accessor('http://127.0.0.1:9'),
    timeoutMs: accessor(200),
    turnEveryNTurns: accessor(3),
    questions: { turn: [{ id: 'a_noul', type: 'noul', instructions: 'Is this true?' }] },
  })

  const service = ctx.provided.get(OBSERVER_SERVICE)
  assert.notEqual(service, undefined, 'the row must provide the service under its declared name')
  assert.deepEqual(Object.keys(service).sort(), ['config', 'label', 'questionSets', 'read', 'replay', 'runs', 'sessions', 'storedSessions', 'subject'])
  assert.equal(Object.isFrozen(service), true, 'a consumer must not be handed something it can mutate')
  // The readers answer rather than throw, which is the property a consumer depends on.
  assert.equal(Array.isArray(service.read({}).events), true)
  assert.equal(Array.isArray(service.runs()), true)
  assert.equal(typeof service.sessions(), 'object')
  const config = service.config()
  assert.deepEqual(config.hooks, ['admit'], 'the mount snapshot reaches the consumer')
  assert.equal(config.provider, null)
  // A COUNT OF ANSWERS IS NOT INTERPRETABLE WITHOUT THE QUESTIONS THEY ANSWER.
  assert.deepEqual(config.questionIds, ['a_noul'], 'the questions the row is configured to ask reach the consumer')
  assert.equal(config.turnEveryNTurns, 3)
  // THE SIGNAL THE RECORD ALONE CANNOT GIVE, reachable now instead of only from a test file in this package.
  const nudged = service.label({ request: 'Find dsh plugins related to system1.', next: 'You should mutate the keywords and search again.' })
  assert.equal(nudged.label, true, 'a correction marker is a nudge')
  const absent = service.label({ request: 'anything' })
  assert.equal(absent.label, null, 'and no next message is NO EVIDENCE, not "no nudge"')
  // THE RECONSTRUCTION, from lines the caller already has: a run is attributable to a config state only if the
  // state can be recovered from the record, and the fold was reachable from nothing before this.
  const replayed = service.replay([
    { event: 'mount', hooks: ['admit'] },
    { event: 'config', action: 'set', knob: 'turnEveryNTurns', to: 5 },
    { event: 'config', action: 'disable', knob: 'admit' },
  ])
  assert.deepEqual(replayed.knobs, { turnEveryNTurns: 5, admit: false }, 'the last write to a knob wins')
  assert.deepEqual(replayed.unusable, [], 'and nothing in the record was unreadable')
})
