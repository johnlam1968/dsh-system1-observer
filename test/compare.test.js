// ARE TWO RUNS THE SAME EXPERIMENT?
//
// Ported from a reference that compares sessions by their first user message, with its own stated principle kept
// intact: "a missing first user message is not 'different tasks', it is 'cannot tell' -- the two reasons are kept
// apart". We have no first user message, so the key is the `mount` line's own record of what was asked.
//
// FOUR REASONS, not the three the port notes paraphrase: `single`, `no-task-key`, `same`, `diff`. The order of
// the checks is what makes `single` and `no-task-key` reachable at all.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { KEY_PARTS, MAX_LANES, comparabilityNote, compareRuns, taskComparability, taskKeyOf } from '../lib/compare.js'

/** A mount line as the current code writes one. */
const mount = (over = {}) => ({
    event: 'mount', run: 'RUN', at: '2026-01-02T00:00:00.000Z',
    hooks: ['admit', 'draft'], questionIds: ['probe'], seamsOff: [], callsEnabled: true,
    transport: 'service', provider: 'typesafe', model: 'jev-latest', probeHash: 'abc123abc123',
    ...over,
})

test('the key has the four parts that must match, and a run with no mount has none', () => {
    assert.deepEqual([...KEY_PARTS], ['questions', 'hooks', 'switches', 'instrument'])
    assert.equal(taskKeyOf(undefined), undefined)
    assert.equal(taskKeyOf(null), undefined)
    assert.equal(taskKeyOf('not a mount'), undefined)
    const key = taskKeyOf(mount())
    assert.deepEqual(key.questions, ['probe'])
    assert.deepEqual(key.hooks, ['admit', 'draft'])
    // CONTENT, NOT REPRESENTATION. This asserted the `|`-joined string until that separator turned out to be
    // ambiguous; parsing it means the assertion survives the encoding being changed for a good reason.
    assert.deepEqual(JSON.parse(key.instrument), ['service', 'typesafe', 'jev-latest', 'abc123abc123'])
})

test('the key is order-insensitive, because the order of a hook list is not an experiment', () => {
    assert.deepEqual(taskKeyOf(mount({ hooks: ['draft', 'admit'] })), taskKeyOf(mount({ hooks: ['admit', 'draft'] })))
})

test('fewer than two runs is `single`, before anything else is considered', () => {
    assert.deepEqual(taskComparability([]), { sameTask: false, reason: 'single', differIn: [], missing: [] })
    assert.deepEqual(taskComparability([taskKeyOf(mount())]), { sameTask: false, reason: 'single', differIn: [], missing: [] })
})

test('two identical runs are the same experiment', () => {
    const verdict = taskComparability([taskKeyOf(mount()), taskKeyOf(mount({ run: 'OTHER' }))])
    assert.deepEqual(verdict, { sameTask: true, reason: 'same', differIn: [], missing: [] })
})

// THE DISTINCTION THE REFERENCE INSISTS ON. A run with no mount line cannot be judged, and calling that a
// difference would send an operator looking for a change that nobody made.
test('a run with no mount line is `no-task-key`, not `diff`', () => {
    const verdict = taskComparability([taskKeyOf(mount()), undefined])
    assert.equal(verdict.reason, 'no-task-key')
    assert.equal(verdict.sameTask, false)
    assert.deepEqual(verdict.differIn, [], 'nothing DIFFERS -- something is missing')
    assert.deepEqual(verdict.missing, ['mount'])
})

// THE CASE THIS DEPLOYMENT IS ACTUALLY IN. Mount lines written before the scope fields existed record no
// switches, and treating that silence as agreement reported five runs as "directly comparable" whose seam mixes
// differed by two orders of magnitude -- one ran all seven seams, the others only `draft`.
test('an unrecorded part is `no-task-key`, with the part named', () => {
    const old = mount({ seamsOff: undefined, callsEnabled: undefined })
    const verdict = taskComparability([taskKeyOf(old), taskKeyOf(old)])
    assert.equal(verdict.reason, 'no-task-key')
    assert.deepEqual(verdict.missing, ['switches'], 'and it says WHICH part is missing')
    assert.deepEqual(verdict.differIn, [])
    assert.match(comparabilityNote(verdict, 2), /switches is unrecorded/)
    assert.match(comparabilityNote(verdict, 2), /not a difference, it is a missing record/)
})

test('a difference is named, part by part', () => {
    const base = taskKeyOf(mount())
    const cases = [
        ['questions', mount({ questionIds: ['probe', 'reply_kind'] })],
        ['hooks', mount({ hooks: ['draft'] })],
        ['switches', mount({ seamsOff: ['admit'] })],
        ['instrument', mount({ probeHash: 'different999' })],
    ]
    for (const [part, other] of cases) {
        const verdict = taskComparability([base, taskKeyOf(other)])
        assert.equal(verdict.reason, 'diff', `${part} must make them different experiments`)
        assert.deepEqual(verdict.differIn, [part])
        assert.match(comparabilityNote(verdict, 2), new RegExp(`differ in ${part}`))
    }
})

// A PAUSED RUN DID NOT MEASURE ANYTHING, so it is not the same experiment as a live one even under identical
// questions -- and `callsEnabled` is part of the switch key for exactly that reason.
test('a run with the calls off is a different experiment from one with them on', () => {
    const verdict = taskComparability([taskKeyOf(mount()), taskKeyOf(mount({ callsEnabled: false }))])
    assert.equal(verdict.reason, 'diff')
    assert.deepEqual(verdict.differIn, ['switches'])
})

// --- the lanes -----------------------------------------------------------------------------------------
test('lanes are the newest, capped, and the selection says how many there were', () => {
    const events = []
    for (let r = 0; r < 8; r += 1) {
        const run = `RUN-${r}`
        events.push(mount({ run, at: `2026-01-0${r + 1}T00:00:00.000Z` }))
        events.push({ event: 'call', run, at: `2026-01-0${r + 1}T00:00:01.000Z`, hook: 'draft', ms: 100 })
        events.push({ event: 'skip', run, at: `2026-01-0${r + 1}T00:00:02.000Z`, hook: 'admit', reason: 'no text at this seam' })
    }
    const compare = compareRuns(events)
    assert.equal(compare.limit, MAX_LANES)
    assert.equal(compare.selected, MAX_LANES, 'five lanes')
    assert.equal(compare.total, 8, 'out of eight runs')
    assert.equal(compare.lanes.length, MAX_LANES)
    assert.deepEqual(compare.lanes.map(lane => lane.id), ['RUN-3', 'RUN-4', 'RUN-5', 'RUN-6', 'RUN-7'], 'the newest five')
    assert.equal(compare.lanes[0].calls, 1)
    assert.equal(compare.lanes[0].skips, 1)
    assert.equal(compare.lanes[0].msSum, 100)
    assert.deepEqual(compare.lanes[0].seamMix, [{ key: 'draft', count: 1 }])
})

// THE VERDICT GATES THE READING, and the lanes are shown either way -- the reference's own rule: "not comparable
// -> lanes still side by side, compare kit hidden".
test('a run with no mount line is counted in the total and excluded from the lanes', () => {
    const events = [
        mount({ run: 'A' }),
        { event: 'call', run: 'A', at: '2026-01-02T00:00:01.000Z', hook: 'draft', ms: 5 },
        { event: 'call', run: 'B', at: '2026-01-02T00:00:02.000Z', hook: 'draft', ms: 5 },
    ]
    const compare = compareRuns(events)
    assert.equal(compare.total, 2)
    assert.equal(compare.selected, 1, 'only the run with a mount line is a lane')
    assert.equal(compare.verdict.reason, 'single', 'and one lane is nothing to compare')
    assert.equal(compare.note, 'one run selected: nothing to compare')
})

test('an empty window is not an error', () => {
    const compare = compareRuns([])
    assert.deepEqual(compare.lanes, [])
    assert.equal(compare.verdict.reason, 'single')
    assert.equal(compare.total, 0)
})

test('a note exists for every reason, and never claims more than the verdict', () => {
    for (const reason of ['single', 'no-task-key', 'same', 'diff', undefined]) {
        const note = comparabilityNote({ reason, differIn: ['hooks'], missing: ['mount'] }, 3)
        assert.equal(typeof note, 'string')
        assert.ok(note.length > 0)
    }
    assert.match(comparabilityNote({ reason: 'same', differIn: [] }, 2), /directly comparable/)
    assert.doesNotMatch(comparabilityNote({ reason: 'no-task-key', missing: ['mount'] }, 2), /comparable: /)
})

// FOUND BY THE REVIEWER SESSION, and it is the same error this file exists to prevent.
// The key tested only "BOTH parts missing", so a mount that recorded `seamsOff` but not `callsEnabled` silently
// merged with "calls were on" -- a missing record AGREEING WITH A VALUE. The tell was the asymmetry with
// `instrument`, where a missing `probeHash` counts as a DIFFERENCE. Both cannot be right.
test('a part that is unrecorded refuses, even when its sibling was recorded', () => {
  const partial = taskKeyOf(mount({ seamsOff: [], callsEnabled: undefined }))
  const full = taskKeyOf(mount({ seamsOff: [], callsEnabled: true }))
  assert.notEqual(partial.switches, full.switches, 'absent must not merge with `true`')

  const verdict = taskComparability([partial, full])
  assert.equal(verdict.reason, 'no-task-key', 'it cannot be judged, so it is not judged')
  assert.deepEqual(verdict.missing, ['switches'])
  assert.deepEqual(verdict.differIn, [], 'nothing DIFFERS: something is missing')
})

test('and the same must hold for each part, not just the pair', () => {
  // `seamsOff` recorded, `callsEnabled` recorded, `probeHash` not: the instrument comparison already treats a
  // missing probeHash as a difference, which is the inconsistency that gave the pair test away.
  const noProbe = taskKeyOf(mount({ probeHash: undefined }))
  assert.equal(taskComparability([taskKeyOf(mount()), noProbe]).reason, 'diff')
})

// THE SEPARATOR WAS AMBIGUOUS, and nothing tested that it was not. The instrument was joined with `|` while
// `switches` was already JSON -- two parts of one key disagreeing in kind. Measured before the fix:
//
//   provider 'a|b' + model 'c'    -> "t|a|b|c|d"
//   provider 'a'   + model 'b|c'  -> "t|a|b|c|d"     identical
//
// The fields come from the server, so this is reachable rather than defensive: a model id is whatever the provider
// reported, and the trace's own format is `provider/model`. Found by the reviewer session.
test('a separator inside a field cannot imitate a field boundary', () => {
  const left = taskKeyOf(mount({ provider: 'a|b', model: 'c', probeHash: 'd' }))
  const right = taskKeyOf(mount({ provider: 'a', model: 'b|c', probeHash: 'd' }))
  assert.notEqual(left.instrument, right.instrument, 'these are different instruments')

  const verdict = taskComparability([left, right])
  assert.equal(verdict.reason, 'diff', 'and different instruments are different experiments')
  assert.deepEqual(verdict.differIn, ['instrument'])
})

test('and the separator-free case still compares as the same instrument', () => {
  const verdict = taskComparability([taskKeyOf(mount()), taskKeyOf(mount({ run: 'OTHER' }))])
  assert.equal(verdict.reason, 'same')
})
