// THE PRODUCER, AND THE FIELD A PROJECTION WOULD GET WRONG.
//
// `normalizeEvents` is the one place that knows a dsh log is a dsh log. Downstream of it everything reads rows and
// nothing knows a harness. So the tests here are about the DERIVATION, not the projection -- three facts that a
// `map()` would get wrong and that this file therefore computes:
//
//   * the exchange is an ASK-GROUP, so a session with no turn at all still groups;
//   * `shadowed` is what the SURFACE withheld, and a `replace` span is how a message stops being visible;
//   * the receipt names the bytes, and its `sha256` is what makes the measurement arguable.
//
// The fourth test is the one that matters most: the rows this produces are validated by the SAME contract the
// standalone reads, so a producer cannot drift from its consumer without a test going red.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeEvents, rowsToJsonl } from '../dsh/normalize.js'
import { EVENT } from '../dsh/session-adapter/lib/session-format.js'
import { readRowsJsonl, validateRows, rowsSummary, exchangesOfRows } from '../core/session-rows.js'

const receipt = { harness: 'dsh', id: 's1', source: '/logs/s1.jsonl', sourceBytes: 100, sourceSha256: 'ab'.repeat(32), highWater: 9 }

// A `user/message` CARRIES ITS SOURCE KIND, and that is what says who wrote it. The harness speaks on the user
// channel too -- a goal, a skill catalogue, a runtime context -- and only `data.source.kind` separates those from
// a person typing. Measured on this host: of 1,501 `user/message` events in 120 real session files, **180 were the
// harness** and not the human. A fixture that omits the kind is therefore not a human message, and the producer
// now treats it as one.
const ask = (seq, text) => ({ type: EVENT.USER_MESSAGE, seq, data: { content: [{ type: 'text', text }], source: { kind: 'user' } } })
// THE HARNESS ON THE USER CHANNEL: the same event type, a different declared author.
const injected = (seq, text, kind = 'goal') => ({ type: EVENT.USER_MESSAGE, seq, data: { content: [{ type: 'text', text }], source: { kind } } })
const answer = (seq, text, reasoning = null) => ({
    type: EVENT.ASSISTANT_MESSAGE, seq,
    data: { message: { content: [{ type: 'text', text }, ...(reasoning === null ? [] : [{ type: 'reasoning', text: reasoning }])] } },
})

test('a dsh log becomes rows that SATISFY THE CONTRACT the standalone reads', () => {
    const rows = normalizeEvents([ask(1, 'the ask'), answer(2, 'the answer', 'thinking')], receipt)
    assert.deepEqual(validateRows(rows), [], 'a producer that drifts from its consumer must be red here')
    const parsed = readRowsJsonl(rowsToJsonl(rows))
    assert.equal(parsed.malformed.length, 0)
    assert.equal(parsed.rows.length, rows.length)
})

test('THE HUMAN IS NOT EVERY `user/message` -- an injection opens no group and is not an ask', () => {
    // THE SHAPE THIS EXISTS FOR. The harness speaks on the user channel: a `goal`, a skill catalogue, a runtime
    // context, an agent instruction. The event type is identical to a person's prompt and only `data.source.kind`
    // separates them. Measured on one real session of 39,098 events: 753 `user/message` events of which **403 were
    // the human and 350 were the harness** -- so counting the type opened an ask-group for every injection and
    // inflated the ask count by 86.8%. The judge was handed skill catalogues as though they were the questions.
    const rows = normalizeEvents([
        ask(1, 'the real question'),
        injected(2, 'GOAL: finish the migration', 'goal'),
        injected(3, 'SKILL CATALOGUE: 42 skills', 'skill-catalog'),
        answer(4, 'the answer'),
    ], receipt)

    const exchanges = exchangesOfRows(rows)
    assert.equal(exchanges.length, 1, 'three user/messages, ONE ask-group: the injections do not open one')
    assert.deepEqual(exchanges[0].asks.map((m) => m.text), ['the real question'], 'and the group holds the human ask, not the injections')
    assert.deepEqual(exchanges[0].answers.map((m) => m.text), ['the answer'])

    // AND THE INJECTION IS NOT AN ASK BY ROLE. It is `system` -- the harness speaking -- because the contract has no
    // `harness` role and the harness speaking IS the system. The row is KEPT: the text was on the surface, the agent
    // read it, and dropping it would lose evidence the group really had.
    const messages = rows.filter((r) => r.kind === 'message')
    assert.deepEqual(messages.map((m) => m.role), ['user', 'system', 'system', 'assistant'])
    assert.deepEqual(messages.map((m) => m.exchange), [0, 0, 0, 0], 'and every one of them is in the group the ask opened')

    // THE CONTRACT STILL HOLDS, because a row the contract refuses is a producer that drifted.
    assert.deepEqual(validateRows(rows), [], 'a producer that drifts from its consumer must be red here')
})

test('the exchange is an ASK-GROUP: two asks make two exchanges, whatever the log calls them', () => {
    const events = [ask(1, 'first'), answer(2, 'one'), ask(3, 'second'), answer(4, 'two')]
    const exchanges = exchangesOfRows(normalizeEvents(events, receipt))
    assert.equal(exchanges.length, 2, 'two asks, two exchanges')
    assert.deepEqual(exchanges[0].asks.map((m) => m.text), ['first'])
    assert.deepEqual(exchanges[1].answers.map((m) => m.text), ['two'])
    // AND NO `turn` SURVIVES, because the rows contract refuses one and a producer carrying it would be rejected.
    assert.ok(normalizeEvents(events, receipt).every((row) => !('turn' in row)))
})

test('SHADOWED IS WHAT THE SURFACE WITHHELD -- the field a projection would default to false', () => {
    // WITHOUT THE OP: everything is on the surface.
    const whole = normalizeEvents([ask(1, 'a'), answer(2, 'b')], receipt)
    assert.deepEqual(whole.filter((r) => r.kind === 'message').map((r) => r.shadowed), [false, false])
    // WITH A `replace` SPAN OVER SEQ 1: the log still HOLDS that message, and the model can no longer see it.
    // This is the 3,417-message case: defaulting it to `false` produces a session that looks complete and measures
    // text nobody could read.
    const compacted = normalizeEvents([
        ask(1, 'a'), answer(2, 'b'),
        // `surfaceOp` is a TOP-LEVEL field of the event, not a member of `data`. Written under `data` it is
        // invisible to `surfaceEvents`, the span never registers, and the message reads as visible -- which is the
        // failure this test exists to catch, arrived at by writing it wrong once.
        { type: EVENT.AGENT_TURN_STOPPING, seq: 3, surfaceOp: { op: 'replace', startSeq: 1, endSeq: 1 } },
    ], receipt)
    const messages = compacted.filter((r) => r.kind === 'message')
    assert.deepEqual(messages.map((r) => r.shadowed), [true, false], 'exactly the replaced message is shadowed')
    const summary = rowsSummary(compacted)
    assert.equal(summary.shadowed, 1)
    assert.ok(summary.shadowedChars > 0, 'and its characters are counted apart from what was visible')
    assert.equal(summary.messages, 2, 'a shadowed message is still a message')
})

test('reasoning is its own field, and its absence is NULL rather than an empty string', () => {
    const rows = normalizeEvents([ask(1, 'a'), answer(2, 'with reasoning', 'because'), answer(4, 'without')], receipt)
    const messages = rows.filter((r) => r.kind === 'message')
    assert.equal(messages[1].reasoning, 'because')
    assert.equal(messages[2].reasoning, null, 'no reasoning is null, so it cannot be confused with reasoning of length zero')
    assert.equal(messages[0].reasoning, null, 'a human ask has no reasoning, and says so')
})

test('the receipt names the bytes, and highWater falls back to what was read', () => {
    const withWatermark = normalizeEvents([ask(1, 'a')], receipt)[0]
    assert.equal(withWatermark.kind, 'receipt')
    assert.equal(withWatermark.sourceSha256, 'ab'.repeat(32))
    assert.equal(withWatermark.highWater, 9)
    // AND WITHOUT ONE, IT IS DERIVED FROM THE WINDOW RATHER THAN INVENTED: the high-water mark of what was actually
    // read is the last seq, and a `0` would claim the log was empty.
    const derived = normalizeEvents([ask(1, 'a'), answer(7, 'b')], { harness: 'dsh', id: 's2' })[0]
    assert.equal(derived.highWater, 7)
})

test('a tool call is a ROW OF ITS OWN, never folded into a message', () => {
    const rows = normalizeEvents([
        ask(1, 'a'), { type: EVENT.TOOL_CALL, seq: 2, data: { callId: 'c1', name: 'bash', arguments: '{"cmd":"ls"}' } }, answer(3, 'done'),
    ], receipt)
    const call = rows.find((r) => r.kind === 'tool_call')
    assert.equal(call.name, 'bash')
    assert.equal(call.callId, 'c1')
    assert.equal(rowsSummary(rows).messages, 2, 'the tool call is not one of the messages')
    assert.equal(rowsSummary(rows).toolCalls, 1)
})
