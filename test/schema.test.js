import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Config } from '../index.js'
import { PROBE_SEAMS } from '../lib/seams.js'
import { FIREABLE_HOOKS, TURN_HOOK } from '../lib/questions.js'

// WHY THIS EXISTS: the settings host projects a form onto this schema before every read and every write
// (`dsh-settings` `volatileForm` + `projectForm`), and that projection has two silent behaviours that this
// package would otherwise discover in production:
//
//   1. A key UNDER AN OBJECT that the schema does not declare is DROPPED -- not rejected, dropped. So a
//      seam missing here is a seam whose stored questions vanish on the next save by any other field.
//   2. Only a path beneath a `.volatile()` node is writable; `settings.write` refuses anything else with
//      `Config field "x" is not volatile`.
//
// `Schema.any()` for the leaf is deliberate: `projectForm` returns an ARRAY whole rather than projecting
// its items, so a question object keeps `options`/`criteria`/`levels` verbatim, and a spec the host does
// not understand is refused by `lib/questions.js` with a reason instead of by schemastery with a stack.
const dict = Config.dict ?? {}

test('every probe seam is declared under `questions`, so no seam can be silently dropped', () => {
  const questions = dict.questions
  assert.ok(questions !== undefined, 'the Config declares no `questions` field')
  assert.equal(questions.meta?.volatile, true, '`questions` must be volatile or no write can reach it')
  assert.deepEqual(
    Object.keys(questions.dict ?? {}),
    // EVERY FIREABLE HOOK, NOT ONLY THE SEAMS. The turn hook carries a question set and is not a probe seam, so a list
    // of seams alone looks correct while dropping it -- and `turnSpecs` reads `config.questions[TURN_HOOK]`, so an
    // undeclared turn key is a scheduled measurement that cannot be configured at all.
    [...FIREABLE_HOOKS],
    'the schema keys must be every hook that can carry questions, in order -- a hook on one side only is a hook that does not work',
  )
})

test('each seam holds a list, and the list is passed through whole', () => {
  for (const seam of PROBE_SEAMS) {
    const field = dict.questions.dict[seam]
    assert.equal(field.type, 'array', `${seam} must be a list`)
    // NOT `object`: an object schema makes the host project its keys and drop the undeclared ones, which
    // would strip `options` from a choice on the way to the YAML.
    assert.equal(field.inner?.type, 'any', `${seam}'s items must be passed through, not projected`)
  }
})

// THE SAME DRIFT TRAP AS `questions`, and the same assertion: `projectForm` DROPS a key the schema does not
// declare, so a seam missing from `seamEnabled` is a seam whose switch silently vanishes on the next save.
test('every probe seam is declared under `seamEnabled` too, and defaults to ON', () => {
  const field = dict.seamEnabled
  assert.ok(field !== undefined, 'the Config declares no `seamEnabled` field')
  assert.equal(field.meta?.volatile, true, '`seamEnabled` must be volatile or no write can reach it')
  assert.deepEqual(Object.keys(field.dict ?? {}), [...PROBE_SEAMS], 'the two seam lists must match')
  for (const seam of PROBE_SEAMS) {
    assert.equal(field.dict[seam].type, 'boolean', `${seam} must be a boolean switch`)
    // `.default(true)` is what makes the resolved config SAY true rather than say nothing. It is not what
    // makes an absent switch mean ON -- `lib/seams.js` enforces that with `!== false`, because a measured
    // unset volatile object can materialise to absent keys rather than to the defaults.
    assert.equal(field.dict[seam].meta?.default, true, `${seam} must default to on`)
  }
})

test('the editable fields are exactly the ones this card can write', () => {
  for (const field of ['callsEnabled', 'seamEnabled', 'sessions', 'questions', 'includeNonOperatorFacing', 'observeSubagents', 'maxFieldChars']) {
    assert.equal(dict[field]?.meta?.volatile, true, `${field} must be volatile`)
  }
  // A card that rendered one of these would offer a control whose save the host refuses.
  for (const field of ['hooks', 'provider', 'model', 'timeoutMs', 'wireUrl', 'question', 'tracePath']) {
    assert.notEqual(dict[field]?.meta?.volatile, true, `${field} is mount-bound and must stay YAML-only`)
  }
})

// `sessions` is the one list field, and its shape is load-bearing twice over: the session menu appends an
// entry, and `Schema.array` materialising to `[]` is what makes an unconfigured row mean "every session"
// rather than "none".
test('`sessions` is a volatile list of ANYTHING, because an entry may carry a title', () => {
  const field = dict.sessions
  assert.equal(field.type, 'array', 'the session menu appends one entry to a list')
  // NOT `string`: an entry may be `{ id, title }`, and a string item schema would REFUSE that object at
  // resolution -- the row would fail to load the moment the menu wrote one.
  assert.equal(field.inner?.type, 'any', 'an entry is narrowed in `lib/sessions.js`, not by the schema')
  assert.equal(field.meta?.volatile, true)
})


// THE TURN SET SURVIVES A ROUND TRIP THROUGH THE SCHEMA. Every other test of the scheduled measurement passes
// `questions: { turn: [...] }` STRAIGHT to the plugin, which bypasses `projectForm` -- so the one path that drops an
// undeclared key was never exercised, and a configuration the card can write but the schema cannot hold goes
// unnoticed until a save by some other field silently deletes it.
//
// VOLATILITY LIVES ON THE PARENT, not on the leaf array -- my first version asserted it of the leaf and failed, which
// is the same shape of mistake as reading one line of a four-line chain.
test('the turn hook is declared under `questions`, so its stored set can survive a save', () => {
  assert.notEqual(dict.questions.dict?.[TURN_HOOK], undefined, 'the schema declares no key for the turn hook, so its stored set is dropped on the next save')
  assert.equal(dict.questions.meta?.volatile, true, '`questions` must be volatile or no live write can reach any hook, the turn included')
})
