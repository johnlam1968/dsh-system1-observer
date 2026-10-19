// THE INDEX READER, AND WHY IT IS A SEPARATE MODULE FROM THE ROWS THEMSELVES.
//
// Three readers of one shape: a producer in-process (`dsh/normalize.js`), JSONL, and SQLite. The last one exists because
// FINDING a session and MEASURING it are different problems with different costs -- the index answers "which sessions"
// in a query where walking a log directory does not.
//
// The two tests that matter here are not about SQL. They are that a session which is NOT IN THE INDEX says so rather
// than reading as an empty session, and that the reader is written against column NAMES, because the producer this reads
// from stores positional rows and has already had one column insertion silently move a field.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rowsFromSqlite } from '../core/rows-sqlite.js'
import { validateRows, rowsSummary, exchangesOfRows } from '../core/session-rows.js'

/** A minimal index carrying the shape `dsh-session-index` writes, built here rather than by that repository. */
function index({ messages, sessions = [{ id: 's1', format: 'v4', path: '/logs/s1.jsonl', bytes: 900, source_sha256: 'ab'.repeat(32), high_water: 4 }] }) {
    const dir = mkdtempSync(join(tmpdir(), 'rows-sqlite-'))
    const path = join(dir, 'index.db')
    const db = new DatabaseSync(path)
    db.exec(`CREATE TABLE sessions(id TEXT PRIMARY KEY, format TEXT, path TEXT, bytes INTEGER, source_sha256 TEXT, high_water INTEGER, created_at INTEGER, cwd TEXT);
      CREATE TABLE messages(session_id TEXT, seq INTEGER, turn INTEGER, exchange INTEGER, role TEXT, kind TEXT, text TEXT, reasoning TEXT, shadowed INTEGER DEFAULT 0);
      CREATE TABLE tool_calls(session_id TEXT, call_id TEXT, name TEXT, args TEXT, seq INTEGER);
      CREATE TABLE turns(session_id TEXT, ordinal INTEGER, ask_seq INTEGER, ask_chars INTEGER, answer_seq INTEGER, answer_chars INTEGER, exchanges INTEGER, shadowed INTEGER DEFAULT 0);`)
    for (const s of sessions) db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?)').run(s.id, s.format, s.path, s.bytes, s.source_sha256, s.high_water, null, null)
    for (const m of messages) db.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?,?)').run('s1', m.seq, m.turn ?? null, m.exchange ?? 0, m.role, m.kind ?? m.role, m.text, m.reasoning ?? null, m.shadowed ?? 0)
    db.prepare('INSERT INTO tool_calls VALUES (?,?,?,?,?)').run('s1', 'c1', 'bash', '{"cmd":"ls"}', 3)
    db.prepare('INSERT INTO turns VALUES (?,?,?,?,?,?,?,?)').run('s1', 0, 1, 6, 2, 11, 1, 0)
    db.close()
    return path
}

const CONVERSATION = [
    { seq: 1, exchange: 0, role: 'user', text: 'the ask', shadowed: 0 },
    { seq: 2, exchange: 0, role: 'assistant', text: 'the answer', reasoning: 'because', shadowed: 1 },
    { seq: 3, exchange: 1, role: 'user', text: 'another ask', shadowed: 0 },
]

test('a session comes back out of the index as rows the SAME contract accepts', () => {
    const { rows, problem } = rowsFromSqlite(index({ messages: CONVERSATION }), 's1')
    assert.equal(problem, null)
    const problems = validateRows(rows).filter((p) => !/sha256|highWater/.test(p))
    assert.deepEqual(problems, [], 'the reader must satisfy the same contract the JSONL reader does')
    const summary = rowsSummary(rows)
    assert.equal(summary.messages, 3)
    assert.equal(summary.exchanges, 2, 'the ask-groups survive the round trip')
    // AND A TOOL CALL IS IN ONE, derived from the LAST MESSAGE AT OR BEFORE IT: the index stores no exchange on
    // tool_calls, and a call in no group is a row the contract now refuses. This call sits at seq 3, the same seq as
    // the SECOND ask, so it belongs to group 1 -- which is the rule stated, not a convenient number.
    const call = rows.find((r) => r.kind === 'tool_call')
    assert.equal(call.exchange, 1, 'the call at seq 3 belongs to the ask at seq 3')
    assert.deepEqual(validateRows(rows), [], 'and the rows satisfy the contract with no exchange field filtered out of the assertion')
    assert.equal(summary.shadowed, 1, 'and so does the shadowed flag')
    assert.equal(summary.reasoningChars, 'because'.length)
})

test('THE INDEX NAMES THE HARNESS IN ITS OWN WORD, and the reader translates it', () => {
    // `dsh-session-index` writes a role of `harness` for every event that is neither a human message nor an assistant
    // message -- a goal, a skill catalogue, a runtime context. Those are real messages that were on the surface, but
    // the rows contract has no `harness` role, and it is right not to: a role is a claim about who spoke, and the
    // harness speaking IS the system. The reader translates, which is the same translation the log producer makes --
    // so a measurement taken from the index is comparable with one taken from the file.
    const { rows, problem } = rowsFromSqlite(index({
        messages: [
            { seq: 1, exchange: 0, role: 'user', kind: 'user', text: 'the ask' },
            { seq: 2, exchange: 0, role: 'harness', kind: 'goal', text: 'GOAL: finish the migration' },
            { seq: 3, exchange: 0, role: 'assistant', kind: 'assistant', text: 'the answer' },
        ],
    }), 's1')
    assert.equal(problem, null)
    const messages = rows.filter((r) => r.kind === 'message')
    assert.deepEqual(messages.map((m) => m.role), ['user', 'system', 'assistant'], 'the index\'s `harness` is read as `system`')
    // AND IT IS NOT AN ASK, which is the whole point: an injection does not open an ask-group and does not count as
    // the operator having asked something.
    const exchanges = exchangesOfRows(rows)
    assert.equal(exchanges.length, 1)
    assert.deepEqual(exchanges[0].asks.map((m) => m.text), ['the ask'], 'the harness row is not an ask')
    assert.deepEqual(validateRows(rows), [], 'and the contract accepts the translated rows')
})

test('THE RECEIPT IS THE INDEX\'S, and it says the rows came from an index', () => {
    const { rows, receipt } = rowsFromSqlite(index({ messages: CONVERSATION }), 's1')
    assert.equal(receipt.sourceSha256, 'ab'.repeat(32), 'the sha256 describes what was INDEXED, unaltered')
    assert.equal(receipt.highWater, 4)
    assert.equal(receipt.indexedFrom.endsWith('index.db'), true, 'and the receipt names where these rows came from')
    assert.equal(rows[0].kind, 'receipt')
})

test('A SESSION THAT IS NOT IN THE INDEX SAYS SO, rather than reading as an empty session', () => {
    // THE DISTINCTION THIS EXISTS FOR. An absent session and an empty one produce the same rows downstream, and both
    // produce a measurement that finds nothing in it. Only one of them means the index is stale -- so the refusal is
    // the answer, and an empty `rows` with a `problem` is not a session anybody should measure.
    const result = rowsFromSqlite(index({ messages: CONVERSATION }), 'no-such-session')
    assert.equal(result.rows.length, 0)
    assert.match(result.problem, /no session no-such-session/)
    assert.match(result.problem, /may not have been rebuilt/, 'and it names the likely cause, because an index is derived')
})

test('an index with no `exchange` column yet still reads, and its rows say what is missing', () => {
    // THE MIGRATION WINDOW. `dsh-session-index` gains `exchange` and `turns` at version 5, and an index built before
    // that has neither. Reading one must not crash: the columns are asked for by NAME, so an absent one is simply
    // absent, and the rows contract then reports the exchange as missing -- which is the honest sentence.
    const dir = mkdtempSync(join(tmpdir(), 'rows-old-'))
    const path = join(dir, 'old.db')
    const db = new DatabaseSync(path)
    db.exec('CREATE TABLE sessions(id TEXT PRIMARY KEY, format TEXT, path TEXT, bytes INTEGER, source_sha256 TEXT, high_water INTEGER, created_at INTEGER, cwd TEXT);')
    db.exec('CREATE TABLE messages(session_id TEXT, seq INTEGER, turn INTEGER, role TEXT, kind TEXT, text TEXT, reasoning TEXT, shadowed INTEGER DEFAULT 0);')
    db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?)').run('s1', 'v4', '/x.jsonl', 1, 'cd'.repeat(32), 2, null, null)
    // ONE MESSAGE, because "the rows report the missing field" is a claim about rows. An index with no messages reports
    // nothing at all, which would make this test pass for the wrong reason.
    db.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?)').run('s1', 1, 1, 'user', 'user', 'the ask', null, 0)
    db.close()
    const result = rowsFromSqlite(path, 's1')
    assert.equal(result.problem, null, 'an older index is readable rather than fatal')
    assert.match(validateRows(result.rows).join(' '), /exchange/, 'and its rows report the missing field instead of inventing one')
})
