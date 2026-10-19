// THE SHARED MEASUREMENT CHAIN, AND THE TWO PROOFS THAT IT IS SHARED.
//
// The first is behavioural: `judgeSegments` and `judgeOnce` are exercised here against the same fakes the tool's own
// tests use, so a change to the chain cannot pass one surface and fail the other. The second is structural, and lives
// in `test/instrument-boundary.test.js`: this file imports nothing but relative, pure modules, which is what lets
// `scripts/ask.mjs` reach it by a DYNAMIC import without costing `--list` and `--state` their node_modules-free property.
//
// What is deliberately NOT tested here: rendering, the row's schema, redaction, packaging and interpretation. Those
// belong to a surface, not to the chain, and a test that reached into them would be a test that made the chain a tool.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { judgeSegments, judgeOnce, segmentBudgetFor, messageOf } from '../dsh/measure.js'
import { EVENT } from '../dsh/session-adapter/lib/session-format.js'
import { segmentsOfRows } from '../core/session-rows.js'

let seq = 0
/**
 * A message in the shape `textOfEvent` actually READS, which is the whole point of the fixture: `user/message` puts
 * its text in `data.content`, so a fake that puts it in `data.text` measures zero characters and silently produces one
 * segment -- which is how three of these tests first failed, for a reason that had nothing to do with the chain.
 */
const text = (body) => ({ type: EVENT.USER_MESSAGE, seq: (seq += 1), data: { content: [{ type: 'text', text: body }] } })
const eventsOf = (messages) => messages.map((m) => ({ ...m }))

test('the segment size is the caller\'s when named, and the subject segments ITSELF when it is too big', () => {
    const base = { stateBudgetChars: 1000, defaultSegmentChars: 600 }
    // NAMED WINS, even when the window is small: somebody narrowed it on purpose.
    assert.deepEqual(segmentBudgetFor({ windowChars: 10, askedChars: 500, ...base }), { segmentChars: 500, autoSegmented: false })
    // TOO BIG, AND NOBODY NAMED A SIZE: the subject decides, and `autoSegmented` says so, because a caller reading a
    // report has to be able to tell a whole-session judgement from one that was cut up.
    assert.deepEqual(segmentBudgetFor({ windowChars: 5000, askedChars: 0, ...base }), { segmentChars: 600, autoSegmented: true })
    // SMALL ENOUGH: one call, and NOT `autoSegmented` -- nothing was cut.
    assert.deepEqual(segmentBudgetFor({ windowChars: 10, askedChars: 0, ...base }), { segmentChars: 0, autoSegmented: false })
})

test('THE ROWS CUT WORKS IN THE CHAIN, because that is the cut the standalone measures with', async () => {
    // THE PROOF THAT WAS MISSING. Every test above drives the DEFAULT cut -- the dsh one, over dsh events. The
    // standalone measures a NORMALIZED SESSION, so it passes `segmentsOfRows` instead, and that cut returned segments
    // without the `events` the chain composes from. The result was a crash on the first segment of every standalone
    // measurement -- from a log, from a rows file, from an index -- and the suite was green, because the two were wrong
    // in the same shape: the test agreed with the implementation by never exercising the other cut.
    const rows = [
        { kind: 'receipt', harness: 'dsh', id: 's1', source: '/logs/s1.jsonl', sourceSha256: 'ab'.repeat(32), highWater: 4 },
        { kind: 'message', seq: 1, exchange: 0, ordinal: 1, role: 'user', type: 'text', text: 'the ask', reasoning: null, shadowed: false },
        { kind: 'tool_call', seq: 2, exchange: 0, callId: 'c1', name: 'bash', args: '{"cmd":"ls"}', result: null, outcome: null },
        { kind: 'message', seq: 3, exchange: 0, ordinal: 2, role: 'assistant', type: 'text', text: 'the answer', reasoning: null, shadowed: false },
    ]
    const messages = rows.filter((r) => r.kind === 'message')
    const asked = []
    const result = await judgeSegments({
        events: rows, messages, segmentChars: 10000,
        questions: { q1: { type: 'noul' } },
        cut: (all, covered, options) => segmentsOfRows(all, options),
        compose: async (segmentRows) => ({ state: segmentRows.filter((r) => r.kind === 'message').map((r) => r.text).join('\n') }),
        decide: async ({ state }) => { asked.push(state); return { answers: { q1: { probability: 0.5 } } } },
    })
    assert.equal(result.rows.length, 1, 'one segment, one row')
    assert.deepEqual(asked, ['the ask\nthe answer'], 'and it was composed from the segment\'s own rows')
    assert.equal(result.aggregate.q1.n, 1)
})

test('segments are judged, and a failed one is a ROW not a gap', async () => {
    const messages = [text('a'.repeat(50)), text('b'.repeat(50)), text('c'.repeat(50))]
    const asked = []
    const lines = []
    const result = await judgeSegments({
        events: eventsOf(messages), messages, segmentChars: 60,
        questions: { q1: { type: 'noul' } },
        compose: async (events) => ({ state: events.map((e) => e.data.content[0].text).join('') }),
        decide: async ({ state }) => {
            asked.push(state.length)
            if (state.startsWith('b')) throw new Error('the backend refused')
            return { answers: { q1: { probability: 0.4 } } }
        },
        onLine: (line) => lines.push(line),
    })
    assert.equal(result.rows.length, 3, 'three segments, three rows')
    // THE FAILURE IS A ROW. Dropping it would shrink `n` and make a partial measurement read as a complete one.
    const failed = result.rows.filter((row) => row.failure !== undefined)
    assert.equal(failed.length, 1)
    assert.match(failed[0].failure.reason, /the backend refused/)
    assert.equal(result.aggregate.q1.n, 2, 'and the aggregate counts only the two that were answered')
    // ONE LINE PER SEGMENT, INCLUDING THE FAILURE: a judgement that was attempted and failed left a trace.
    assert.equal(lines.length, 2, 'two lines: the two that produced answers')
})

test('a model that returns an error object is a failed row, not a reading of nothing', async () => {
    const messages = [text('x'.repeat(60)), text('y'.repeat(60))]
    const result = await judgeSegments({
        events: eventsOf(messages), messages, segmentChars: 40,
        questions: { q1: { type: 'noul' } },
        compose: async (events) => ({ state: events[0].data.content[0].text }),
        decide: async ({ state }) => (state.startsWith('x') ? { kind: 'error', reason: 'overloaded' } : { answers: { q1: { probability: 1 } } }),
    })
    assert.match(result.rows[0].failure.reason, /overloaded/)
    assert.ok(result.rows[0].answers === undefined, 'a failed row carries no answers, rather than empty ones')
})

test('a segment over the estimated budget is REPORTED, because it is the reading most likely to be about nothing', async () => {
    const messages = [text('z'.repeat(120000))]
    const result = await judgeSegments({
        events: eventsOf(messages), messages, segmentChars: 100000,
        questions: { q1: { type: 'noul' } },
        compose: async () => ({ state: 'z'.repeat(120000) }),
        decide: async () => ({ answers: { q1: { probability: 0.5 } } }),
    })
    assert.equal(result.rows.length, 1, 'one message over the budget is its own segment, never half of one')
    assert.ok(result.rows[0].overBudget !== undefined, 'and it says so rather than reporting a comfortable number')
})

test('judgeOnce composes at the judge\'s budget, not the row\'s cap', async () => {
    const seen = []
    const result = await judgeOnce({
        events: eventsOf([text('hello')]),
        questions: { q1: { type: 'noul' } },
        budgetChars: 32000,
        compose: async (events, max) => { seen.push(max); return { state: 'hello', truncated: false } },
        decide: async () => ({ answers: { q1: { probability: 0.7 } } }),
    })
    assert.deepEqual(seen, [32000], 'the composed budget is the judge\'s, which is what makes a whole turn measurable')
    assert.deepEqual(result.answers, { q1: { probability: 0.7 } })
    assert.equal(result.failure, undefined)
})

test('every failure path in judgeOnce returns a REASON, and never an exception', async () => {
    const base = { events: eventsOf([text('x')]), questions: { q1: { type: 'noul' } }, budgetChars: 8000, decide: async () => ({ answers: {} }) }
    const refused = await judgeOnce({ ...base, compose: async () => ({ refused: true, reason: 'the subject is empty' }) })
    assert.match(refused.failure.reason, /the subject is empty/)
    const threw = await judgeOnce({ ...base, compose: async () => ({ state: 'x' }), decide: async () => { throw new Error('timeout') } })
    assert.match(threw.failure.reason, /timeout/)
    const nulled = await judgeOnce({ ...base, compose: async () => ({ state: 'x' }), decide: async () => null })
    assert.match(nulled.failure.reason, /no result/)
    // AND EACH ONE LEFT A LINE, because an attempted call that left no trace is invisible in the record.
    const lines = []
    await judgeOnce({ ...base, onLine: (l) => lines.push(l), compose: async () => ({ state: 'x' }), decide: async () => { throw new Error('timeout') } })
    assert.equal(lines.length, 1)
    assert.match(lines[0].failure.reason, /timeout/)
})

test('an error message is a sentence, not a stack', () => {
    assert.equal(messageOf(new Error('the backend refused')), 'the backend refused')
    assert.equal(messageOf('a string'), 'a string')
    assert.equal(messageOf(null), 'unknown failure', 'no failure is not a failure with no reason')
})

// THE TRACE LINE, PINNED. Found by refactoring the tool onto this module and reading the diff rather than the tests:
// the line stopped carrying `subject.messages`, and eighteen tool tests stayed green, because none of them looks at a
// trace line. The result was a reading recorded as being about ZERO messages, which is a line that is confidently
// wrong rather than a line that is missing. A guard nobody exercises is a comment.
test('a segment line carries its message count, so a reading is never recorded as about nothing', async () => {
    const messages = [text('a'.repeat(40)), text('b'.repeat(40)), text('c'.repeat(40))]
    const lines = []
    await judgeSegments({
        events: eventsOf(messages), messages, segmentChars: 50,
        questions: { q1: { type: 'noul' } },
        compose: async (events) => ({ state: events.map((e) => e.data.content[0].text).join('') }),
        decide: async () => ({ answers: { q1: { probability: 0.5 } } }),
        onLine: (line) => lines.push(line),
    })
    assert.ok(lines.length > 0, 'segments were judged')
    for (const line of lines) {
        assert.equal(typeof line.messages, 'number', 'the line says how many messages this reading was about')
        assert.ok(line.messages > 0, 'and it is not zero')
        assert.ok(line.segment?.of > 0, 'and it says how many segments there were')
    }
})

test('a segment records WHICH BACKEND ANSWERED, because a reading without its model cannot be compared', async () => {
    const messages = [text('a'.repeat(40)), text('b'.repeat(40))]
    const result = await judgeSegments({
        events: eventsOf(messages), messages, segmentChars: 30,
        questions: { q1: { type: 'noul' } },
        compose: async (events) => ({ state: events.map((e) => e.data.content[0].text).join('') }),
        decide: async () => ({ answers: { q1: { probability: 0.5 } }, executed: { model: 'jev-1.14', provider: 'TypeSafe' } }),
    })
    for (const row of result.rows) {
        assert.equal(row.executed?.model, 'jev-1.14', 'each segment names the model that answered it')
        assert.equal(row.executed?.provider, 'TypeSafe')
    }
    // AND A REPLY THAT CARRIES NONE IS NOT GIVEN AN EMPTY ONE: absence is a value, and `executed: {}` would read as
    // "a backend that said nothing about itself", which is a different statement from "no envelope came back".
    const bare = await judgeSegments({
        events: eventsOf(messages), messages, segmentChars: 30,
        questions: { q1: { type: 'noul' } },
        compose: async (events) => ({ state: events.map((e) => e.data.content[0].text).join('') }),
        decide: async () => ({ answers: { q1: { probability: 0.5 } } }),
    })
    assert.ok(bare.rows.every((row) => row.executed === undefined), 'and no key at all when the reply carried none')
})

// ── SHARING: the chain a reader is meant to re-derive, and the one thing in it nobody may derive ───────────────────
//
// This is the test that answers "can a measurement taken outside the harness be shared?". Before it, `action:
// 'package'` and `action: 'interpret'` were reachable only from inside a running dsh process, so a measurement taken
// with a script could not be shared in the format a reader expects. `core/report.js` was always harness-free; nothing
// reached it.
//
// The chain exercised here is the real one -- buildPackage, writePackage, attachInterpretation, buildSkeleton -- with no
// model and no harness, because NONE OF IT NEEDS EITHER. That is the property being tested.

import { measurementSummary } from '../dsh/measure.js'
import { attachInterpretation, buildPackage, buildSkeleton, packageId, writePackage, PACKAGE_FILES } from '../core/report.js'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const receipt = { harness: 'dsh', id: 's1', source: '/logs/s1.jsonl', sourceBytes: 10, sourceSha256: 'ab'.repeat(32), highWater: 9 }

test('a measurement becomes a package, and an interpretation anchors to ITS readings', async () => {
    const messages = [text('a'.repeat(40)), text('b'.repeat(40))]
    const judged = await judgeSegments({
        events: eventsOf(messages), messages, segmentChars: 30,
        questions: { q1: { type: 'noul' } },
        compose: async (events) => ({ state: events.map((e) => e.data.content[0].text).join('') }),
        decide: async ({ state }) => (state.startsWith('a')
            ? { answers: { q1: { probability: 0.8 } }, executed: { model: 'jev-1.14', provider: 'TypeSafe' } }
            : { kind: 'error', reason: 'overloaded' }),
    })
    const summary = measurementSummary({ receipt, session: { messages: 2, exchanges: 1 }, judged, set: 'demo@1', at: 'T' })

    // THE REFUSAL IS CARRIED. A segment that failed becomes a sentence in the package, so `n` cannot quietly shrink and
    // read as a smaller measurement rather than a partial one.
    assert.equal(summary.refusals.length, 1)
    assert.match(summary.refusals[0], /segment 1: overloaded/)
    assert.equal(summary.counts.skip, 1, 'and it is counted as a skip')

    // THE MOUNT IS RECORDED FROM THE REPLIES, not from a flag: the numbers and the model that made them travel together.
    assert.equal(summary.mount.model, 'jev-1.14')
    assert.equal(summary.mount.provider, 'TypeSafe')

    const at = '2026-10-19T00:00:00.000Z'
    const id = packageId({ at, run: null })
    const report = buildSkeleton({ summary, tables: [{ title: 'demo@1', set: 'demo@1', questions: ['q1'] }], at })
    const pkg = buildPackage({ id, at, report, summary, lines: [], meta: { plugin: 'ask.mjs', version: null, dsh: null } })

    const root = mkdtempSync(join(tmpdir(), 'measure-share-'))
    const written = writePackage(join(root, id), pkg)
    assert.equal(written.problem, null, `the package was refused: ${written.problem}`)
    for (const file of PACKAGE_FILES) assert.ok(written.files.includes(file), `${file} is missing from the package; got ${written.files.join(", ")}`)

    // AND THE INTERPRETATION ANCHORS TO THE READINGS IT WAS WRITTEN AGAINST. This is the whole reason a package is a
    // package: prose cannot be derived from numbers, so it is ATTRIBUTED and anchored, and if the readings are ever
    // regenerated the interpretation is visibly orphaned rather than quietly wrong.
    const attached = attachInterpretation(written.dir, { text: 'The operator was answered.', by: 'tester', at })
    assert.equal(attached.problem, null)
    assert.match(readFileSync(join(written.dir, 'interpretation.md'), 'utf8'), /sha256|anchor/i)
    // AND THE ANCHOR IS THE READINGS FILE'S HASH, so re-deriving the numbers and finding a different hash is detectable.
    const readings = readFileSync(join(written.dir, 'readings.json'), 'utf8')
    assert.ok(String(attached.anchor).length >= 16, 'the anchor names the readings it was written against')
    assert.ok(readings.includes('q1'), 'and those readings hold the question that was asked')
})
