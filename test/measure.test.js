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
