// THE CONFORMANCE FIXTURE, and the producer is checked against it.
//
// WHY A FIXTURE AND NOT A CORPUS. The two channels -- the LOG (this repository's producer) and the INDEX (the
// store's producer, read back through `core/rows-sqlite.js`) -- were compared over the whole live corpus, and that
// comparison is what found the five defects this repository's findings register records: about who spoke (**F173**),
// about the digest (**F174**), about the text of a message (**F177**), about a block's `thinking` field (**F179**)
// and about a NUL byte (**F180**). But a corpus cannot be a GATE: it lives on one machine, it changes under you, and a
// test that needs 946 sessions and 1.5 GB of index is a test nobody runs.
//
// So the rules are said ONCE, in the package `dsh-session-rows`, and the FIXTURE says what they produce. This
// repository vendors the fixture and pins its digest, so a fixture that changes in the package cannot be quietly
// different here.
//
// WHAT IS PINNED, and why the digest is over the FILE NAMES as well as their bytes: a digest over the content alone
// would not notice that the two files were swapped.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeEvents } from '../dsh/normalize.js'
import { validateRows } from '../core/session-rows.js'

/** The vendored fixture, and the digest the package computes for it. */
const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/session-rows')

/**
 * THE PINNED DIGEST, and it is the package's own: the package hashes the file NAME and then the bytes, in the order
 * it declares them, so a swapped pair or a renamed file changes it.
 */
const PINNED_DIGEST = '27bb1c0c893adb4f6b52648fdff32cb17b39022f8dbea53451ac5f84058cdb66'

const FIXTURE_FILES = ['fixture/session.v4.jsonl', 'fixture/rows.jsonl']

/** The digest of a fixture held here, computed the way the package computes it. */
const digestOf = (root) => {
    const hash = createHash('sha256')
    for (const file of FIXTURE_FILES) {
        hash.update(file)
        hash.update(readFileSync(join(root, file.split('/').pop())))
    }
    return hash.digest('hex')
}

/** The fixture's events, parsed. */
const eventsOf = () => readFileSync(join(FIXTURE, 'session.v4.jsonl'), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line))

/** The fixture's expected rows, read as they are written. */
const expectedRows = () => readFileSync(join(FIXTURE, 'rows.jsonl'), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line))

test('THE VENDORED FIXTURE IS THE PACKAGE\'S, and the digest says so', () => {
    assert.equal(digestOf(FIXTURE), PINNED_DIGEST, 'the vendored fixture is not the one the package ships; update it and the digest together')
})

test('THIS PRODUCER PRODUCES THE FIXTURE\'S ROWS, byte for byte', () => {
    const rows = normalizeEvents(eventsOf(), {
        harness: 'dsh',
        id: 'conformance-1',
        source: '/fixture/session.v4.jsonl',
        sourceBytes: 1,
        sourceSha256: '0'.repeat(64),
        highWater: 7,
    })
    // THE RECEIPT CARRIES WHAT WAS READ, so it names the file it read and is not part of the fixture -- which is about
    // the ROWS, and about the rows only.
    const produced = rows.filter((row) => row.kind !== 'receipt')
    assert.deepEqual(produced, expectedRows(), 'this producer and the fixture disagree')
})

test('AND THE FIXTURE\'S ROWS SATISFY THE CONTRACT, because the fixture IS the contract', () => {
    const rows = normalizeEvents(eventsOf(), {
        harness: 'dsh', id: 'conformance-1', source: '/fixture/session.v4.jsonl',
        sourceBytes: 1, sourceSha256: '0'.repeat(64), highWater: 7,
    })
    assert.deepEqual(validateRows(rows), [], 'the fixture must satisfy the contract it exists to pin')
})

test('AND THE FIXTURE EXERCISES EVERY RULE, or it is decoration', () => {
    const rows = expectedRows()
    const messages = rows.filter((row) => row.kind === 'message')
    // THE TRAILING SPACE IS GONE, because the text is trimmed.
    assert.ok(messages.some((row) => row.text === 'push this repo'), 'a trimmed text')
    // AND THE NUL BECAME U+FFFD, because SQLite would have kept only the characters before it.
    assert.ok(messages.some((row) => row.text.includes('\uFFFD')), 'a NUL byte, replaced')
    assert.ok(!JSON.stringify(rows).includes('\u0000'), 'and no row carries a NUL')
    // AND THE COMPACTION'S MESSAGE IS SHADOWED, because the log holds what the surface withdrew.
    assert.ok(messages.some((row) => row.shadowed === true), 'a shadowed message')
    // AND THE HARNESS SPEAKING IS `system`, and the human is `user`.
    assert.ok(messages.some((row) => row.role === 'system'), 'the harness speaking')
    assert.ok(messages.some((row) => row.role === 'user'), 'and the human')
    // AND THE INTERRUPTION IS A FACT, and its absence is null.
    assert.ok(messages.some((row) => row.interrupted === true), 'an interrupted message')
    assert.ok(messages.some((row) => row.interrupted === null), 'and one that never said')
    // AND A TOOL CALL IS EVIDENCE, with its name and its arguments.
    const call = rows.find((row) => row.kind === 'tool_call')
    assert.equal(call.name, 'bash')
    assert.match(call.args, /git push/)
})
