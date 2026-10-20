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
    // AND THE NEWER COLUMNS ARE NAMED TOO, so a reader that cannot supply them says which ones they are rather than
    // reporting a receipt whose byte count means something else (F182, F184).
    assert.match(result.receipt.missing.join(' '), /sessions\.decoded_bytes/, 'the decoded length is named when it is absent')
    assert.match(result.receipt.missing.join(' '), /messages\.interrupted/, 'and the interruption column is named')
    assert.match(result.receipt.missing.join(' '), /tool_calls\.args_chars/, 'and the arguments length is named')
})

test('AN INDEX AT SCHEMA VERSION 6 SUPPLIES THE RECEIPT AND THE FACTS, and the two channels answer alike', () => {
    // THE FOUR COLUMNS VERSION 6 ADDED, and each one closes a divergence the corpus run measured between the two
    // channels: the receipt's byte count meant two things (F182), the tool arguments were cut with no length beside
    // them, and 120 interruption facts had nowhere to live (F184).
    const dir = mkdtempSync(join(tmpdir(), 'rows-v6-'))
    const path = join(dir, 'v6.db')
    const db = new DatabaseSync(path)
    db.exec(`CREATE TABLE sessions(id TEXT PRIMARY KEY, format TEXT, path TEXT, bytes INTEGER, source_sha256 TEXT, high_water INTEGER, created_at INTEGER, cwd TEXT, corpus TEXT, decoded_bytes INTEGER);
      CREATE TABLE messages(session_id TEXT, seq INTEGER, turn INTEGER, exchange INTEGER, role TEXT, kind TEXT, text TEXT, reasoning TEXT, shadowed INTEGER DEFAULT 0, interrupted INTEGER);
      CREATE TABLE tool_calls(session_id TEXT, call_id TEXT, name TEXT, args TEXT, args_chars INTEGER, seq INTEGER);`)
    db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?,?,?)').run('s1', 'v4', '/x.jsonl', 900, 'ab'.repeat(32), 2, null, null, '--home-john-CodingProjects-x--', 1234)
    // ONE MESSAGE INTERRUPTED and one not: `false` would be a claim the index never checked, and `null` is the answer
    // when the log said nothing about it.
    db.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?,?,?)').run('s1', 1, 1, 0, 'user', 'user', 'the ask', null, 0, null)
    db.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?,?,?)').run('s1', 2, 1, 0, 'assistant', 'assistant', 'the answer', null, 0, 1)
    db.prepare('INSERT INTO tool_calls VALUES (?,?,?,?,?,?)').run('s1', 'c1', 'bash', 'ls', 12000, 3)
    db.close()

    const { rows, receipt, problem } = rowsFromSqlite(path, 's1')
    assert.equal(problem, null)
    // THE RECEIPT NAMES THE BYTES THAT WERE READ, which is the DECODED length -- the same quantity the log route
    // reports. The on-disk size is a different fact about a different thing, and a receipt that carries it under this
    // name disagrees with every other receipt on every session.
    assert.equal(receipt.sourceBytes, 1234, 'the receipt carries the decoded length')
    assert.equal(receipt.corpus, '--home-john-CodingProjects-x--', 'and the corpus the session belongs to')
    // AND NOTHING OF VERSION 6 IS MISSING -- the four columns this reader asked for by name, and no fallback was used
    // for any of them. (The fixture has no `turns` table, so that name is still listed: it is not a version 6 column.)
    const v6 = receipt.missing.filter((name) => /decoded_bytes|corpus|interrupted|args_chars/.test(name))
    assert.deepEqual(v6, [], 'and every version 6 column is read from the index rather than defaulted')

    const messages = rows.filter((r) => r.kind === 'message')
    assert.equal(messages[0].interrupted, null, 'a message that never said is null')
    assert.equal(messages[1].interrupted, true, 'and one the model was cut off in says so')
    // AND THE LENGTH OF THE ARGUMENTS, so a capped copy is not read as a short call.
    const call = rows.find((r) => r.kind === 'tool_call')
    assert.equal(call.argsChars, 12000, 'the full length of the arguments is beside the capped copy')
})
