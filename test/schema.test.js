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

// THE CARD IS A SUBSET OF THE EDITABLE SET, NOT THE WHOLE OF IT. This test used to enumerate both sets; the walk
// below does that exhaustively now. What it keeps is the direction that matters for a card -- a control rendered for
// a field the host refuses to write fails at the SAVE, so the card may only ever grow into the volatile set, and it
// currently renders seven of the nineteen (O2 in docs/findings.md).
test('the four fields moved on request are volatile, and the resources opened once are not', () => {
  for (const field of ['hooks', 'provider', 'model', 'timeoutMs']) {
    assert.equal(dict[field]?.meta?.volatile, true, `${field} was made volatile so a settings save can reach a running row`)
  }
  // ONE FIELD STILL OWNS SOMETHING OPENED ONCE: the trace writer holds the file and a rotation ledger, so a live
  // change would move where evidence lands mid-run. The caps that also bound held state turned out to be resolvable
  // per record, so they are volatile now and this list is down to `tracePath`.
  for (const field of ['tracePath']) {
    assert.notEqual(dict[field]?.meta?.volatile, true, `${field} owns a resource opened once and stays mount-bound`)
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

// EVERY FIELD IS CLASSIFIED, BY WALKING THE SCHEMA RATHER THAN BY NAMING FIELDS.
//
// The tests above name their fields, which is how a NEW field slips in unclassified: the lists stay green while
// the schema grows a knob that is neither editable nor declared mount-bound. An independent review found the same
// shape of gap from the other side -- defaults asserted for three fields and no walk over the rest -- and the fix
// is a walk, not three more names. Adding a field now means deciding, in this file, whether the card may write it.
test('every declared field is either volatile or declared mount-bound, and none is neither', () => {
  // THE LISTS ARE THE DECISION, AND THE WALK IS THE RATCHET. This test was written with the seven editable fields
  // the older test above names, and it failed on its first run: the schema declares FIFTEEN volatile fields --
  // `turnEveryNTurns`, `redactEnabled`, `redactKeys`, `pathMode`, `redactSessionTelemetry`, `maxQuestionChars`,
  // `pricePerMTokInput` and `maxTraceBytes` are all writable through a live save and were in no list at all. That
  // is the gap this test exists to close: a field added, or a `.volatile()` moved, now fails here until somebody
  // writes down which of the two it is. `turnEveryNTurns` is the subtle one -- its ON/OFF is read at every turn
  // boundary while the interval is read at mount, which is exactly why the schema marks it volatile.
  const EDITABLE = [
    'callsEnabled', 'seamEnabled', 'sessions', 'questions', 'includeNonOperatorFacing', 'observeSubagents',
    'maxFieldChars', 'turnEveryNTurns', 'redactEnabled', 'redactKeys', 'pathMode', 'redactSessionTelemetry',
    'maxQuestionChars', 'pricePerMTokInput', 'maxTraceBytes',
    // EIGHT MORE, made volatile on request: the seam list, the judge's route, the URL and legacy question, and the
    // two sizes of the composed state. Each one's read site had to move with it, or the flag would be a promise the
    // code does not keep.
    'hooks', 'provider', 'model', 'timeoutMs', 'wireUrl', 'question', 'composeMaxChars', 'toolBlockMaxChars', 'calibrationBins', 'maxCompareLanes', 'tailChars', 'idleGapMs',
    // AND THE CAP ON THE EVENT FEED, once it was checked: the cap is consulted on every record, so a live value is
    // natural rather than a rebuild.
    'feedMaxPerSession', 'fsJournalMaxPaths', 'fsJournalMaxPerPath',
  ]
  const MOUNT_BOUND = [
    // ONE LEFT, AND IT OWNS AN OPEN FILE HANDLE: the writer holds the trace open and keeps a rotation ledger, so a
    // live change would move where evidence lands mid-run. Everything else that bounds held state turned out to be
    // resolvable per record, and is volatile.
    'tracePath',
  ]
  const walked = Object.keys(dict)
  assert.ok(walked.length > 0, 'the schema declares no fields at all')
  const editable = walked.filter((field) => dict[field].meta?.volatile === true).sort()
  const mountBound = walked.filter((field) => dict[field].meta?.volatile !== true).sort()
  assert.deepEqual(editable, [...EDITABLE].sort(),
    'the set of live-writable fields is not the declared set: a field was added, removed, or had its `.volatile()` moved')
  assert.deepEqual(mountBound, [...MOUNT_BOUND].sort(),
    'the set of mount-bound fields is not the declared set: a knob the card may write would otherwise be offered as YAML-only, or the reverse')
})

// EVERY DECLARED DEFAULT MATERIALISES. A `.default()` that never reaches the resolved config is a knob whose
// documented behaviour differs from its behaviour, and only three fields were checked before -- by name.
// A VOLATILE FIELD NOTHING READS IS A KNOB THAT DOES NOTHING. Not hypothetical: `idleGapMs` and `maxCompareLanes`
// were declared, marked volatile and reported by the agent's config tool while NO line passed them anywhere -- so the
// host accepted a write, the card would show "Saved", and the report used the constant. Nothing failed, because
// nothing read them. This is the check that would have failed, and it is deliberately a SOURCE scan: the question is
// whether a value is read anywhere, which no unit test of the reading code can answer.
test('every volatile setting is read somewhere, or is named in the exception list with its reason', async () => {
  const { readFileSync, readdirSync } = await import('node:fs')
  const files = ['index.js', ...readdirSync('lib').filter((name) => name.endsWith('.js')).map((name) => 'lib/' + name)]
  const source = files.map((file) => readFileSync(file, 'utf8')).join('\n')
  // THE PATTERN IS DELIBERATELY NARROW: the field name must appear INSIDE a `readConfigValue(...)` call, because the
  // name alone appears in the schema itself and a loose scan would pass on the very definition it polices.
  const readSomewhere = (field) => new RegExp('readConfigValue\\([^\\n]*\\.' + field + '\\b').test(source)
  // THE EXCEPTIONS, each with the reason it needs none: these are read as objects through `plainConfig`, which
  // unwraps every volatile accessor at once. Asserted volatile below, so the list cannot outlive its members.
  const VIA_PLAIN_CONFIG = ['hooks', 'questions', 'seamEnabled']
  const volatile = Object.keys(dict).filter((field) => dict[field].meta?.volatile === true)
  const unread = volatile.filter((field) => !readSomewhere(field) && !VIA_PLAIN_CONFIG.includes(field))
  assert.deepEqual(unread, [], 'these settings are writable and nothing reads them: ' + unread.join(', '))
  for (const field of VIA_PLAIN_CONFIG) {
    assert.equal(dict[field]?.meta?.volatile, true, field + ' is listed as read via plainConfig, so it must be volatile')
  }
})

test('every declared default reaches a resolved config', async () => {
  const { readConfigValue } = await import('../lib/config-value.js')
  const resolved = Config({})
  let checked = 0
  for (const field of Object.keys(dict)) {
    // OBJECT FIELDS ARE SKIPPED, and this is the walk earning its place on its first run: `questions` records `{}`
    // as its own default while the RESOLVED value carries each child's default, so a flat comparison called a
    // correct schema broken. The children are asserted per key by the two tests above, which walk `questions` and
    // `seamEnabled` seam by seam.
    if (dict[field].type === 'object') continue
    const declared = dict[field].meta?.default
    if (declared === undefined) continue
    checked += 1
    assert.deepEqual(readConfigValue(resolved[field]), declared, `${field}'s declared default did not materialise`)
  }
  assert.ok(checked >= 3, `only ${checked} fields declare a default: the walk is not reaching the schema`)
})
