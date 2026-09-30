// THE WRITE PATH'S RECORD. Two properties matter and they pull in opposite directions: a change must be
// reconstructable from the lines, and a line that CANNOT be read must be reported rather than skipped -- a write
// that vanishes on the way back is the same defect as one that was never logged, and only one of those is obvious.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { configEvent, replayConfig, CONFIG_EVENT, CONFIG_ACTIONS } from '../lib/config-event.js'

test('an event names the action, the knob, the move and the actor -- and refuses a bad action or knob', () => {
  const line = configEvent({ action: 'set', knob: 'provider', from: 'typesafe', to: 'laya', by: 'agent-1' })
  assert.equal(line.event, CONFIG_EVENT)
  assert.deepEqual(line, { event: 'config', action: 'set', knob: 'provider', from: 'typesafe', to: 'laya', by: 'agent-1' })
  assert.throws(() => configEvent({ action: 'mutate', knob: 'x' }), /not one of/)
  assert.throws(() => configEvent({ action: 'set', knob: '   ' }), /non-empty string/)
  assert.deepEqual([...CONFIG_ACTIONS], ['set', 'enable', 'disable'])
})

test('an absent previous value is carried as null, because "was not set" is not "was set to null"', () => {
  const line = configEvent({ action: 'set', knob: 'model', to: 'jev-latest' })
  assert.equal(line.from, null)
  assert.equal(line.to, 'jev-latest')
  assert.equal(Object.hasOwn(line, 'by'), false, 'an unnamed actor is absent, not an empty string')
})

test('a sequence replays to the state it describes, in order', () => {
  const { knobs, applied, unusable } = replayConfig([
    configEvent({ action: 'set', knob: 'provider', to: 'typesafe' }),
    configEvent({ action: 'enable', knob: 'turn' }),
    configEvent({ action: 'set', knob: 'provider', to: 'laya' }),
    configEvent({ action: 'disable', knob: 'admit' }),
  ])
  assert.deepEqual(knobs, { provider: 'laya', turn: true, admit: false }, 'the LAST write to a knob wins')
  assert.equal(applied, 4)
  assert.deepEqual(unusable, [])
})

test('a config line that cannot be read is REPORTED, and lines of other events are ignored', () => {
  const { knobs, applied, unusable } = replayConfig([
    { event: 'mount', hooks: ['admit'] },
    { event: CONFIG_EVENT, action: 'set', knob: 'turn', to: true },
    { event: CONFIG_EVENT, action: 'shrug', knob: 'provider' },
    { event: CONFIG_EVENT, action: 'set', knob: '' },
    'not an object',
    { event: 'call', hook: 'draft' },
  ])
  assert.deepEqual(knobs, { turn: true })
  assert.equal(applied, 1)
  assert.deepEqual(unusable, [
    { index: 2, reason: 'action "shrug" is not one of set, enable, disable' },
    { index: 3, reason: 'knob is not a non-empty string' },
  ], 'by index, so the offending line can be found in the trace')
})

test('a knob can be switched back on, and the state says so', () => {
  const { knobs } = replayConfig([
    configEvent({ action: 'disable', knob: 'draft' }),
    configEvent({ action: 'enable', knob: 'draft' }),
  ])
  assert.equal(knobs.draft, true)
})

test('replay of nothing is an empty state, not an error', () => {
  assert.deepEqual(replayConfig(), { knobs: {}, applied: 0, unusable: [] })
  assert.deepEqual(replayConfig([]), { knobs: {}, applied: 0, unusable: [] })
})
