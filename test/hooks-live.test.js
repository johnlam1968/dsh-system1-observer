// A HOOK SWITCHED OFF LIVE MUST STILL LET THE LOOP THROUGH.
//
// `hooks` became volatile so a settings save can change which seams are observed without a re-mount. The dangerous
// half is not the observation -- it is the RETURN. In `draft` a listener that skips `next()` swallows the model's
// stream; in a waterfall or serial seam a listener that skips `next()` short-circuits the loop. That is the one
// thing this plugin must never do, and it is why every seam is now subscribed and gated at its own firing rather
// than registered and unregistered as the list changes. A seam switched off is a seam that does not LOOK; it is
// never a seam that decides.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerListeners } from '../lib/register.js'
import { PROBE_SEAMS } from '../lib/seams.js'
import { probeHook } from '../lib/host-events.js'
import { HOST_EVENT_MODES } from '../lib/host/index.js'

/** One seam, one listener, and a record of everything the observer was asked to record. */
function mounted(seam, hookEnabled) {
  const handlers = new Map()
  const observed = []
  const ctx = {
    on(event, handler) {
      const list = handlers.get(event) ?? []
      list.push(handler)
      handlers.set(event, list)
      return () => {}
    },
  }
  registerListeners(ctx, [seam], {
    observe: async (hook, text, meta) => { observed.push({ hook, text, meta }) },
    skip: async () => {},
    readConfig: () => ({}),
    captureAgent: () => ({ id: 'session-a' }),
    meta: () => ({ agentId: 'session-a' }),
    hookEnabled,
  })
  const [event] = [...handlers.keys()]
  return { observed, fire: (...args) => handlers.get(event)[0](...args) }
}

test('a draft seam switched off RELAYS: the decision is returned and nothing is recorded', async () => {
  const { observed, fire } = mounted('draft', () => false)
  // `next()` IS WHAT PRODUCES THE STREAM, so the assertion that matters is that it was called and its value handed
  // back -- identity, not equality, because a copy would be a different object downstream.
  const produced = (async function* () { yield { type: 'text-delta', text: 'hello' } })()
  let called = 0
  const returned = await fire({ purpose: undefined }, () => { called += 1; return produced })
  assert.equal(called, 1, 'a switched-off draft seam must still run the model call it was wrapping')
  assert.equal(returned, produced, 'and hand back exactly what the loop produced')
  assert.deepEqual(observed, [], 'while recording nothing at all')
})

test('a waterfall seam switched off still takes the decision and returns it untouched', async () => {
  const { observed, fire } = mounted('pre_execute', () => false)
  const decision = { kind: 'allow' }
  let called = 0
  const returned = await fire({ agent: { id: 'session-a' } }, () => { called += 1; return decision })
  assert.equal(called, 1, 'the real decision is taken FIRST and always, switched on or off')
  assert.equal(returned, decision, 'and returned as the same object, never a copy')
  assert.deepEqual(observed, [], 'a disabled seam does not look, and does not record a skip either: the mount line already says it is not in `hooks`')
})

test('and switched ON, both of them do look', async () => {
  const draft = mounted('draft', () => true)
  const stream = await draft.fire({ purpose: undefined }, () => (async function* () { yield { type: 'text-delta', text: 'hello' } })())
  // THE STREAM HAS TO BE DRIVEN. `draft` observes through a tee, so the listener returns before the observation
  // happens: firing it and asserting immediately measured the tee's setup rather than its result, which is what
  // this test failed on first. The fix belongs in the test, not in the assertion.
  for await (const chunk of stream) { void chunk }
  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(draft.observed.length, 1, 'an enabled draft seam observes what it relayed')

  const waterfall = mounted('pre_execute', () => true)
  await waterfall.fire({ agent: { id: 'session-a' } }, () => ({ kind: 'allow' }))
  assert.equal(waterfall.observed.length, 1, 'and so does an enabled waterfall seam')
})

// EVERY SEAM LISTENER, DRIVEN OFF THE HARNESS'S OWN MODE FOR ITS EVENT.
//
// `F107` left "waterfall listeners calling next()" as an UNKNOWN, and the tests above pin only `draft` and
// `pre_execute`. Nothing asserted that the SHAPE of each listener matches the MODE of the event it attaches to: that
// classification is a hand-made transcription in `register.js` (three branches), and getting it wrong produces exactly
// the trap the UNKNOWN names -- a waterfall listener that never calls `next()` swallows every listener behind it, and
// an emit listener that calls one throws. Measured across all nine (2026-10-05, `F111`): no violation.
//
// THE ARGUMENTS ARE THE DOCUMENTED SIGNATURES, per seam (the notes on why `args[0]` was wrong at three of them are in
// `lib/host-payload.js`). Each is built from the `next` under test, so a listener that reaches for the wrong argument
// is measured rather than assumed.
const SEAM_ARGS = Object.freeze({
  assemble: (next) => [{ sections: [], contexts: [] }, { agent: { id: 'session-a' } }, next],
  admit: (next) => [{ agent: { id: 'session-a' }, messages: [{ text: 'the operator message' }] }, next],
  request: (next) => [{ agent: { id: 'session-a' } }, next],
  draft: (next) => [{ purpose: undefined }, next],
  pre_execute: (next) => [{ agent: { id: 'session-a' }, name: 'bash', arguments: { command: 'ls' } }, next],
  execute: (next) => [{ agent: { id: 'session-a' }, name: 'bash', arguments: { command: 'ls' } }, next],
  post_execute: (next) => [{ agent: { id: 'session-a' } }, 'the tool result', next],
  result: () => [{ agent: { id: 'session-a' } }, 'the tool result'],
  close: () => [{ agent: { id: 'session-a' }, turn: 1 }],
})

test('every seam listener matches the harness MODE of the event it attaches to', async () => {
  for (const seam of PROBE_SEAMS) {
    const mode = HOST_EVENT_MODES[probeHook(seam)]
    assert.ok(mode, seam + ' attaches to an event with no mode in the catalogue')
    const { fire } = mounted(seam, () => true)
    let calls = 0
    const decision = { kind: 'what-the-loop-produced' }
    // `draft` is the one waterfall whose continuation PRODUCES the value rather than returning it: `next()` yields the
    // model's stream, and the listener returns a tee of it.
    const next = () => { calls += 1; return seam === 'draft' ? (async function* () { yield 'a chunk' })() : decision }
    const returned = await fire(...SEAM_ARGS[seam](next))
    if (mode === 'waterfall') {
      assert.equal(calls, 1, seam + ' attaches to a waterfall, so next() must be called exactly once')
      if (seam === 'draft') {
        const relayed = []
        for await (const chunk of returned) relayed.push(chunk)
        assert.deepEqual(relayed, ['a chunk'], 'a draft listener relays every chunk the model produced')
      } else {
        assert.equal(returned, decision, seam + ' must hand the loop its OWN decision back, by reference')
      }
    } else {
      assert.equal(calls, 0, seam + ' attaches to a ' + mode + ' event, which hands out no continuation to call')
      assert.equal(returned, undefined, seam + ' must return undefined from a ' + mode + ' event')
    }
  }
})
