// THE COST LINE'S SEMANTICS, AND THE SETTING THAT DECIDES THEM.
//
// This file exists because the previous commit wired a setting that did not exist and NOTHING COULD NOTICE: a grep
// for `costOf`, `activeMs` or `usd` across `test/` matched no file at all, so the cost path was untested from end to
// end. A wiring that reads `undefined` falls back to the module constant and looks exactly like a wiring that works
// -- which is the failure this repository keeps recording, found here by looking for the test rather than assuming.
//
// `activeMs` is not a duration. It is the total of the stretches in which the judge was actually being called, with
// gaps shorter than `idleGapMs` merged, because a raw duration over an hour-scale trace says nothing (see the note
// on `mergeIntervalsTotal`). The gap is therefore a MEASUREMENT DECISION, and it is a setting now.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { IDLE_GAP_MS, costOf, mergeIntervalsTotal } from '../lib/cost.js'

const T0 = Date.parse('2026-01-01T00:00:00.000Z')
const at = (offsetMs) => new Date(T0 + offsetMs).toISOString()
/** One judge call, in the shape the trace writes: it is written when it finishes and says how long it took. */
const call = (offsetMs, ms) => ({
  event: 'call',
  run: 'r-1',
  turn: 1,
  hook: 'draft',
  at: at(offsetMs),
  ms,
  envelope: { usage: { inputTokens: 100 } },
})

test('the gap merges stretches: two calls 30 s apart, each 1 s long', () => {
  // The default counts them as one active stretch; a one-second gap counts them as two. That difference IS what the
  // setting is for, and asserting it here is what makes the setting's effect on `activeMs` a fact rather than a hope.
  const events = [call(0, 1000), call(30_000, 1000)]
  const withDefault = costOf(events, {})
  const withTightGap = costOf(events, { idleGapMs: 1000 })
  assert.equal(withDefault.turns[0].activeMs, 31_000, 'the default gap merges them into one 31 s stretch')
  assert.equal(withTightGap.turns[0].activeMs, 2000, 'a 1 s gap leaves two 1 s stretches, 2 s in total')
})

test('zero is a legitimate gap and means only overlapping calls merge', () => {
  // The fixtures are equal-length on purpose: the first version of this test asserted 2000 for intervals of 1000 and
  // 999 ms, so the assertion was wrong and the CODE was right. A test whose arithmetic has to be trusted is a test
  // that will be re-derived wrongly later.
  assert.equal(mergeIntervalsTotal([[0, 1000], [1000, 2000]], 0), 2000, 'touching counts as one stretch')
  assert.equal(mergeIntervalsTotal([[0, 1000], [1001, 2001]], 0), 2000, 'a millisecond apart is two, 1 s each')
  assert.equal(mergeIntervalsTotal([[0, 1000], [2000, 3000]], 0), 2000, 'and so is a second apart')
})

test('a gap the row cannot use falls back to the constant rather than to zero', () => {
  // A junk value must not silently mean "no merging" -- that would change every deployment's cost line the moment
  // somebody typed a string into a numeric field. The default is the documented behaviour.
  const events = [call(0, 1000), call(30_000, 1000)]
  for (const junk of [undefined, null, 'soon', Number.NaN, -1]) {
    assert.equal(costOf(events, { idleGapMs: junk }).turns[0].activeMs, 31_000, `idleGapMs ${JSON.stringify(junk)} must fall back`)
  }
  assert.equal(IDLE_GAP_MS, 60_000, 'and the constant is a minute')
})

test('the rate and the gap travel together, and both are reported', () => {
  const events = [call(0, 1000), call(30_000, 1000)]
  const priced = costOf(events, { pricePerMTokInput: 1 })
  assert.equal(priced.cost.pricePerMTokInput, 1)
  assert.match(String(priced.cost.priceSource), /configured in this row/, 'a price the row set says so')
  assert.equal(priced.cost.inputTokens, 200, 'two calls at 100 input tokens each')
})
