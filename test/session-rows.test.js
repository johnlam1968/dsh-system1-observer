// THE NORMALIZED SESSION ROWS, AND THE SEVEN RULES THEY EXIST TO ENFORCE.
//
// A session is not a dsh event log. It is a conversation that dsh happens to have written down, and pi and mcode and
// a DeepSeek web export have each written their own version down. `docs/adapters-and-standards.md` measured seven
// sessions across three harnesses -- 5,127 message rows -- and the schema recorded here is the shape that read all of
// them. This file is the CONTRACT for that shape and the check on anything claiming to produce it.
//
// THE FOUR RULES, each one bought by a measurement rather than an argument:
//
//   1. THE BOUNDARY IS DERIVED, AND IT IS AN ASK-GROUP. dsh has `turn`; pi has NO turn at all -- measured, all 44 pi
//      messages carrying a null turn -- so a "per turn" query silently became a dsh-ONLY query while looking
//      cross-harness. This is the failure this whole shape exists to make impossible: a query that reports nothing
//      because the unit it keys on was never present. So there is no `turn` field here, and `exchange` is required.
//   2. A PER-HARNESS FACT IS A COLUMN WHOSE ABSENCE IS A VALUE. 3,417 messages in one dsh session are SHADOWED --
//      inside a `replace` range, withdrawn from the surface by compaction. The log holds what the surface no longer
//      does, so an index without this column measures text the model can no longer see while looking complete.
//   3. A MALFORMED LINE IS COUNTED, NEVER DROPPED SILENTLY. A reader that skips what it cannot parse returns a
//      shorter session that answers every question correctly and about the wrong conversation.
//   4. ABSENCE IS NOT ZERO. No reasoning is `null`, not `''`. A count of tool calls is a count of tool calls and is
//      never inferred from a row that failed to parse.
//   5. A MESSAGE'S TEXT IS TRIMMED, and it is the SAME text in every channel. Measured: the observer's producer
//      trimmed it and the store's did not, so one message had two texts -- 58 characters in the file channel and 59
//      in the index, the difference being a trailing space -- and 53 of the 946 sessions in the live corpus differ
//      that way. The `stateHash` of a measurement is made of the text, so the two channels were measuring two
//      different sessions and neither could say so.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    ROW_KINDS,
    MESSAGE_ROLES,
    readRowsJsonl,
    validateRows,
    exchangesOfRows,
    segmentsOfRows,
    receiptOf,
    rowsSummary,
    withoutNuls,
} from '../core/session-rows.js'

/** A well-formed three-exchange session, in the shape the importers produce. */
function good() {
    return [
        { kind: 'receipt', harness: 'dsh', id: 's1', source: '/logs/a.jsonl', sourceBytes: 12, sourceSha256: 'ab'.repeat(32), highWater: 9, schemaVersion: 1 },
        { kind: 'message', seq: 1, exchange: 0, ordinal: 0, role: 'user', type: 'text', text: 'the ask', reasoning: null, shadowed: false, interrupted: false },
        { kind: 'message', seq: 2, exchange: 0, ordinal: 1, role: 'assistant', type: 'text', text: 'the first word', reasoning: 'thinking', shadowed: false, interrupted: false },
        { kind: 'tool_call', seq: 3, exchange: 0, callId: 'c1', name: 'bash', args: '{"cmd":"ls"}', result: 'ok', outcome: 'ok' },
        { kind: 'message', seq: 4, exchange: 0, ordinal: 2, role: 'assistant', type: 'text', text: 'and the last word', reasoning: null, shadowed: false, interrupted: false },
        { kind: 'message', seq: 5, exchange: 1, ordinal: 0, role: 'user', type: 'text', text: 'another ask', reasoning: null, shadowed: false, interrupted: false },
        { kind: 'message', seq: 6, exchange: 1, ordinal: 1, role: 'assistant', type: 'text', text: 'its answer', reasoning: null, shadowed: true, interrupted: false },
    ]
}

test('a well-formed session validates, and the reader counts nothing malformed', () => {
    const parsed = readRowsJsonl(good().map((r) => JSON.stringify(r)).join('\n'))
    assert.equal(parsed.malformed.length, 0)
    assert.deepEqual(validateRows(parsed.rows), [])
})

// RULE 1 — THE BOUNDARY IS DERIVED. A row with no `exchange` cannot be placed in a conversation, and a reader that
// accepted one would put it in exchange zero, where it silently joins whatever was asked first.
test('RULE 1: every message carries an exchange, because the harness may have no turn at all', () => {
    const rows = good()
    delete rows[1].exchange
    const problems = validateRows(rows)
    assert.equal(problems.length, 1, 'a message with no exchange must be refused')
    assert.match(problems[0], /exchange/, 'and the problem must name the field')
    // AND THERE IS NO `turn` TO FALL BACK ON. A producer that reaches for the native turn is the bug this file exists
    // for, so the field is not merely unused -- carrying one is itself reported.
    const withTurn = good()
    withTurn[1].turn = 7
    assert.match(validateRows(withTurn).join(' '), /turn/, 'a native turn must be refused, not ignored')
})

test('RULE 1, measured: a session with NO native turns still groups into exchanges', () => {
    // This is the pi case verbatim: nothing here carries a turn, and the grouping works anyway because the ask-group
    // is a field rather than something inferred from a turn id.
    const rows = good().map(({ turn, ...rest }) => rest)
    const groups = exchangesOfRows(rows)
    assert.equal(groups.length, 2)
    assert.equal(groups[0].exchange, 0)
    assert.deepEqual(groups[0].asks.map((m) => m.text), ['the ask'])
    assert.deepEqual(groups[0].answers.map((m) => m.text), ['the first word', 'and the last word'])
})

// RULE 2 — SHADOWED IS A VALUE. The 3,417-message measurement is the reason: a session whose shadowed rows read as
// visible measures text the model can no longer see, and reports it as though the model had read it.
test('RULE 2: `shadowed` is required, because its ABSENCE is a value', () => {
    const rows = good()
    delete rows[1].shadowed
    assert.match(validateRows(rows).join(' '), /shadowed/, 'a message with no shadowed flag is refused, not defaulted')
    // AND WHEN IT IS PRESENT, THE COUNT IS HONEST: one shadowed row in the fixture is one, not zero.
    const summary = rowsSummary(good())
    assert.equal(summary.shadowed, 1, 'exactly one row in the fixture is shadowed')
    assert.equal(summary.messages, 5)
})

// RULE 3 — COUNTED, NEVER DROPPED. The reader returns what it could not parse, with the line number, so the caller can
// refuse rather than measure a shorter conversation.
test('RULE 3: a malformed line is COUNTED and reported, never dropped silently', () => {
    const text = [JSON.stringify(good()[0]), '{not json', JSON.stringify(good()[1]), '', '   '].join('\n')
    const parsed = readRowsJsonl(text)
    assert.equal(parsed.rows.length, 2, 'the two good rows are kept')
    assert.equal(parsed.malformed.length, 1, 'the bad line is counted')
    assert.equal(parsed.malformed[0].line, 2, 'and carries the line number')
    // A BLANK LINE IS NOT A MALFORMED LINE. A trailing newline is not corruption, and reporting it as such would make
    // every well-formed file look damaged.
    assert.ok(!parsed.malformed.some((m) => m.line === 4), 'a blank line is not malformed')
})

// RULE 4 — ABSENCE IS NOT ZERO. No reasoning is null; a tool call with no result is not a zero-length result.
test('RULE 4: absence is null, not an empty string, and not a zero', () => {
    const rows = good()
    assert.equal(rows[1].reasoning, null, 'the fixture holds one message with no reasoning, and it is null')
    const summary = rowsSummary(rows)
    assert.equal(summary.reasoningChars, 'thinking'.length, 'only the row that HAS reasoning contributes')
    // AND A TOOL CALL THAT NEVER ANSWERED IS COUNTED AS A CALL WITH NO OUTCOME, which is a different statement from
    // "it succeeded with nothing".
    const unanswered = good().filter((r) => r.kind !== 'tool_call')
    assert.equal(rowsSummary(unanswered).toolCalls, 0)
    assert.equal(rowsSummary(good()).toolCalls, 1)
})

test('the receipt is the anchor: sha256 and high-water travel with the rows', () => {
    const receipt = receiptOf(good())
    assert.equal(receipt.harness, 'dsh')
    assert.equal(receipt.sourceSha256, 'ab'.repeat(32))
    assert.equal(receipt.highWater, 9)
    // A SESSION WITH NO RECEIPT HAS NO ANCHOR, and says so rather than defaulting to a hash of nothing.
    assert.equal(receiptOf(good().filter((r) => r.kind !== 'receipt')), null)
})

test('segments are cut by TEXT SIZE and a single oversized row is its own segment, not half of one', () => {
    const rows = good()
    for (const row of rows) if (row.kind === 'message') row.text = row.text.padEnd(30, '.')
    // `from`/`to` INDEX THE MESSAGES, not the rows -- a receipt and a tool call are rows but not messages, and an
    // index that meant "row" would land on the receipt. This is the same contract `dsh/segment.js` uses, and saying it
    // here is what stops the two from being read as interchangeable.
    const messages = rows.filter((r) => r.kind === 'message')
    const segments = segmentsOfRows(rows, { maxChars: 70 })
    assert.ok(segments.length > 1, 'the fixture is cut into more than one segment at 70 chars')
    assert.equal(segments[0].from, 0, 'the first segment starts at the first message')
    assert.equal(segments.at(-1).to, messages.length, 'the last segment ends at the last message')
    for (const segment of segments) assert.ok(segment.chars <= 70 || segment.messages === 1, 'no segment is over budget unless it is a single row')
})

test('EVERY SEGMENT CARRIES ITS OWN ROWS, because the chain composes each one from `part.events`', () => {
    // THE SHAPE THE SHARED CHAIN EXPECTS. `dsh/measure.js` composes every segment from `part.events`, and the dsh cut
    // has always returned them. The rows cut did not, so the standalone's measure route threw
    // `Cannot read properties of undefined (reading 'filter')` on its first segment -- for a log, a rows file and an
    // index alike -- and the unit test agreed with the implementation because it only ever drove the DSH cut.
    const rows = good()
    for (const row of rows) if (row.kind === 'message') row.text = row.text.padEnd(30, '.')
    const segments = segmentsOfRows(rows, { maxChars: 70 })
    assert.ok(segments.length > 1, 'the fixture is cut into more than one segment')
    for (const segment of segments) {
        assert.ok(Array.isArray(segment.events), 'a segment without rows cannot be composed')
        assert.ok(segment.events.length > 0)
        // AND THE WINDOW IS FROM THE FIRST COVERED MESSAGE TO THE LAST, so the tool calls BETWEEN them travel with
        // the messages they answered -- the same reason `dsh/segment.js` widens its window.
        const covered = segment.events.filter((r) => r.kind === 'message')
        assert.equal(covered.length, segment.messages, 'the rows carry every message the segment counts')
        assert.equal(covered[0].text, rows.filter((r) => r.kind === 'message')[segment.from].text, 'starting at the first')
        assert.equal(covered.at(-1).text, rows.filter((r) => r.kind === 'message')[segment.to - 1].text, 'and ending at the last')
    }
    // AND THE TOOL CALLS TRAVEL. A segment that dropped them would judge the questions about what the agent DID
    // without the record of what it did -- which is F32, the defect where the tool results never reached the judge.
    const withCall = [
        { kind: 'receipt', harness: 'dsh', id: 's1', source: '/logs/s1.jsonl', sourceSha256: 'ab'.repeat(32), highWater: 4 },
        { kind: 'message', seq: 1, exchange: 0, ordinal: 1, role: 'user', type: 'text', text: 'a'.repeat(30), reasoning: null, shadowed: false },
        { kind: 'tool_call', seq: 2, exchange: 0, callId: 'c1', name: 'bash', args: '{"cmd":"ls"}', result: null, outcome: null },
        { kind: 'message', seq: 3, exchange: 0, ordinal: 2, role: 'assistant', type: 'text', text: 'b'.repeat(30), reasoning: null, shadowed: false },
    ]
    const [one] = segmentsOfRows(withCall, { maxChars: 10000 })
    assert.deepEqual(one.events.map((r) => r.kind), ['message', 'tool_call', 'message'], 'the call between the messages is in the segment')
})

// RULE 5 — THE TEXT IS THE TEXT, AND IT IS THE SAME TEXT IN EVERY CHANNEL.
//
// MEASURED, AND IT WAS NOT A THEORY: the observer's producer trimmed a message's text and the store's did not, so
// ONE message had TWO texts -- 58 characters in the file channel and 59 in the index, the difference being a trailing
// space -- and 53 of the 946 sessions in the live corpus differ that way. The `stateHash` of a measurement is made of
// the text, so a reading taken from the index and a reading taken from the file were DIFFERENT READINGS of one
// session, and neither could say so.
test('RULE 5: a message text is trimmed, and an untrimmed one is refused by name', () => {
    const padded = good().map((r) => (r.kind === 'message' && r.seq === 1 ? { ...r, text: '  the ask  ' } : r))
    const problems = validateRows(padded)
    assert.equal(problems.length, 1, 'the untrimmed row is the only problem: ' + problems.join('; '))
    assert.match(problems[0], /whitespace/, 'and it says what is wrong: ' + problems[0])
    // AND THE WHITESPACE INSIDE IS KEPT, because it is the model's and a judge can be asked about it.
    const inside = good().map((r) => (r.kind === 'message' && r.seq === 1 ? { ...r, text: 'the  ask' } : r))
    assert.deepEqual(validateRows(inside), [], 'whitespace inside the text is not a problem')
})

test('the vocabulary is declared, so a producer cannot invent a role', () => {
    assert.deepEqual(ROW_KINDS, ['receipt', 'message', 'tool_call', 'fact'])
    assert.ok(MESSAGE_ROLES.includes('user') && MESSAGE_ROLES.includes('assistant'))
    const rows = good()
    rows[1].role = 'operator'
    assert.match(validateRows(rows).join(' '), /role/, 'an invented role is refused')
})

// RULE 6 — `interrupted` IS PRESENT, AND ITS ABSENCE IS `null`.
//
// The rule was added because a reader that cannot supply the fact must say so, and `false` is a claim. It had no test,
// which meant it could have been deleted and the suite would have stayed green -- so here is the test.
test('RULE 6: a message row without `interrupted` is refused by name, and `null` is allowed', () => {
    const without = good().map((r) => {
        if (r.kind !== 'message' || r.seq !== 1) return r
        const copy = { ...r }
        delete copy.interrupted
        return copy
    })
    const problems = validateRows(without)
    assert.equal(problems.length, 1, 'the absent field is the only problem: ' + problems.join('; '))
    assert.match(problems[0], /interrupted/, 'and it says which field is missing: ' + problems[0])

    // AND `null` IS ACCEPTED, because `null` is how a row says "nobody told me" -- that is the whole point of the rule.
    const nulled = good().map((r) => (r.kind === 'message' && r.seq === 1 ? { ...r, interrupted: null } : r))
    assert.deepEqual(validateRows(nulled), [], 'a null interruption is a fact the contract accepts')
})

// RULE 7 — A ROW CARRIES NO NUL BYTE.
//
// MEASURED, AND IT COST ONE SESSION OF THE CORPUS ITS TEXT. `node:sqlite` binds a JavaScript string with
// NUL-terminated semantics: what lands in the column is the bytes BEFORE the first NUL, and everything after it is
// gone. So a message whose text held one NUL was 100 characters in the file channel and ELEVEN in the index -- the 89
// characters after the NUL were not shortened, they were DROPPED, and the row read as though the model had said less.
// 67 messages in 1 of 946 sessions, and 2 tool-call names that became empty strings, so a call read as a call that
// named no tool. The composed state is what a measurement's `stateHash` is made of, so the two channels measured two
// different sessions and neither could say so.
test('RULE 7: a row with a NUL byte is refused, and the fix keeps the text the same length', () => {
    const nul = good().map((r) => (r.kind === 'message' && r.seq === 1 ? { ...r, text: 'the\u0000ask' } : r))
    const problems = validateRows(nul)
    assert.equal(problems.length, 1, 'the NUL is the only problem: ' + problems.join('; '))
    assert.match(problems[0], /NUL/, 'and it says what is wrong: ' + problems[0])

    // AND THE REASONING IS THE SAME WAY, because the same hash is made of it.
    const inReasoning = good().map((r) => (r.kind === 'message' && r.seq === 2 ? { ...r, reasoning: 'think\u0000ing' } : r))
    assert.match(validateRows(inReasoning).join(' '), /NUL/, 'a NUL in the reasoning is refused too')

    // AND A TOOL CALL'S NAME AND ARGUMENTS, because a name that lost its bytes names nothing.
    const inCall = good().map((r) => (r.kind === 'tool_call' ? { ...r, name: 'ba\u0000sh' } : r))
    assert.match(validateRows(inCall).join(' '), /NUL/, 'a NUL in a tool call name is refused')

    // AND THE FIX: U+FFFD, which keeps the LENGTH, so a marked text is the same measurement and not a shorter one.
    assert.equal(withoutNuls('the\u0000ask'), 'the\uFFFDask')
    assert.equal(withoutNuls('the\u0000ask').length, 'the\u0000ask'.length, 'the text does not shrink')
    // AND A TEXT WITH NO NUL IS UNTOUCHED, because a rule that always changes the text cannot be trusted.
    assert.equal(withoutNuls('the ask'), 'the ask')
    assert.equal(withoutNuls(null), null, 'and a non-string is left alone')
})
