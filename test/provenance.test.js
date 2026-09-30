// WHICH MODEL GRADED, WHICH WAS ASKED FOR, AND WHETHER THE SERVER SAID HOW IT ROUTED.
//
// System One guidance is explicit on both counts: "a threshold measured on one server does not transfer to
// another", and the one field that says which CHECKPOINT read the text is `routing.detection.is_english` --
// because language picks the checkpoint and the same question can score 0.8912 in English and 0.0162 in Chinese.
//
// So all three are measured rather than assumed. On the deployment this plugin was developed against, `executed`
// names a pinned revision while the request named `jev-latest`, and `routing` came back in 0 of 4,369 calls --
// which means the language guard is NOT AVAILABLE there, and a reader has to be told that rather than left to
// assume a non-English judgement would be visible.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { reportTrace } from '../lib/trace-report.js'
import { traceData } from '../lib/trace-data.js'

const line = (fields) => JSON.stringify(fields)

function traceOf(runs) {
    const dir = mkdtempSync(join(tmpdir(), 'observer-prov-'))
    const path = join(dir, 'trace.jsonl')
    writeFileSync(path, runs.flat().join('\n') + '\n')
    return path
}

const mount = (run) => line({ at: '2026-01-02T00:00:00.000Z', run, event: 'mount', hooks: ['draft'], callsEnabled: true, seamsOff: [] })

/** A call whose envelope carries what a real one does: `requested` and `executed`, and whatever `routing` gave. */
const call = (run, { requested = 'jev-latest', executed = 'typesafe/jev-1.13-20260917', routing } = {}) => line({
    at: '2026-01-02T00:00:01.000Z', run, event: 'call', hook: 'draft', ms: 10,
    answer: { kind: 'answers', answers: {}, envelope: { requested: { provider: 'typesafe', model: requested }, executed: { provider: 'typesafe', model: executed }, ...(routing === undefined ? {} : { routing }) } },
})

test('the revision that graded and the alias that was requested are both recorded', () => {
    const path = traceOf([[mount('R1'), call('R1'), call('R1')]])
    const report = reportTrace({ path, run: 'R1', tail: 1 })
    assert.match(report, /graded by: typesafe\/jev-1\.13-20260917 2/, 'the revision the server actually ran')
    assert.match(report, /requested as jev-latest/, 'and the moving alias that was asked for')
})

test('a server that never reports routing says so, with the consequence spelled out', () => {
    const path = traceOf([[mount('R1'), call('R1'), call('R1')]])
    const report = reportTrace({ path, run: 'R1', tail: 1 })
    assert.match(report, /routing reported in 0 of 2 calls/)
    // THE CONSEQUENCE IS THE POINT. A bare "0" would read as a curiosity; the sentence says what it means for
    // anyone about to auto-clear on these records.
    assert.match(report, /language detection -- the one field that says which checkpoint read the text -- is NOT recorded/)
    assert.match(report, /no threshold should auto-clear on these records/)
})

test('a server that DOES report routing is not accused of silence', () => {
    const path = traceOf([[mount('R1'), call('R1', { routing: { detection: { is_english: true } } }), call('R1')]])
    const report = reportTrace({ path, run: 'R1', tail: 1 })
    assert.match(report, /routing reported in 1 of 2 calls/)
    assert.doesNotMatch(report, /is NOT recorded here/, 'the guard was available, so the warning would be false')
})

test('the structured copy carries the same facts as the text', () => {
    const path = traceOf([[mount('R1'), call('R1'), call('R1', { routing: { detection: { is_english: false } } })]])
    const data = traceData({ path, run: 'R1' })
    assert.deepEqual(data.models, [{ key: 'typesafe/jev-1.13-20260917', count: 2 }])
    assert.equal(data.provenance.routingReported, 1)
    assert.equal(data.provenance.routingCalls, 2)
    assert.equal(data.provenance.routingNote, null, 'a note is for the silent case only')
})

test('a trace with no calls makes no claim about routing at all', () => {
    // NOT "0 of 0" AND NOT A WARNING: with nothing graded there is nothing to have been silent about, and a
    // warning printed over an empty file would be the plugin inventing a defect.
    const path = traceOf([[mount('R1')]])
    const report = reportTrace({ path, run: 'R1', tail: 1 })
    assert.doesNotMatch(report, /graded by:/)
    assert.doesNotMatch(report, /is NOT recorded here/)
    assert.equal(traceData({ path, run: 'R1' }).provenance.routingNote, null)
})
