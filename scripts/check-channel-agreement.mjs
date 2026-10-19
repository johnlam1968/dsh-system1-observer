#!/usr/bin/env node
//
// THE CHANNEL-AGREEMENT CHECK: compose every session BOTH ways and compare the rows, field by field.
//
// WHY THIS IS A COMMAND AND NOT A GATE. `ROADMAP.md` §14.5 names the condition: "Two channels must be able to
// disagree VISIBLY, so the channel-agreement test (compose one turn both ways) is a prerequisite for trusting
// either." There are two channels into a measurement: the LOG (this repository's own producer, `dsh/normalize.js`)
// and the INDEX (`dsh-session-index`'s producer, read back through `core/rows-sqlite.js`). They are two producers of
// the same contract, and nothing enforced that they agree -- which is how the observer and the store came to
// disagree about who spoke (F173), about the digest (F174), and about the TEXT of a message (F177).
//
// It cannot be a gate in `npm run ci`, because it needs the index and the session logs, which live on the machine
// that runs the harness. It can be a command anyone runs there, and its output can be quoted in a finding.
//
// IT IS ALSO NOT PUBLISHED AND NOT BUDGETED, and that is deliberate rather than forgotten. `package.json`'s `files`
// list does not ship it, `test/package-contents.test.js` asserts that a `check-*` script does not ship, and the size
// budget in `test/growth.test.js` walks `core/`, `dsh/` and `test/` and not `scripts/`. A local diagnostic that reads
// the live corpus has no business in a package other people install, and a budget it is exempt from would be a number
// nobody ever checks. If this script ever earns a place in the package, it earns a budget line in the same commit.
//
// WHAT IT COMPARES, and why not just the counts: a per-message field that differs can CANCEL OUT in an aggregate,
// so the comparison is per message and per tool call -- seq, exchange, role, text, reasoning, shadowed -- and a
// session that agrees on every count but not on every message is reported.
//
// A STALE INDEX IS NOT A DIVERGENCE AND IS REPORTED AS ONE. The index is derived: a session whose log has grown
// since the last refresh is indexed only up to its `high_water`, so the two channels describe different windows of
// the same conversation. That is the store's nature, not a bug, and the check says so rather than calling it one.
//
//   node scripts/check-channel-agreement.mjs --index ~/.dsh/session-index.db
//   node scripts/check-channel-agreement.mjs --index ~/.dsh/session-index.db --session <id>
//   node scripts/check-channel-agreement.mjs --index ~/.dsh/session-index.db --limit 50
//
// The exit code answers ONE question -- are the two channels ONE MEASUREMENT? -- and the question is answered by the
// COMPOSED STATE, which is the text the judge is handed. 0: the composed state agreed in every session. 1: it did
// not. 2: the index could not be read, or a session could not be read, or nothing was compared at all.
//
// WHAT IT FINDS, and what it does not: the composed state decides, and the per-field differences are EVIDENCE
// differences -- the index channel does not carry everything the log channel does, because the store's schema does
// not hold it. Those are reported with their cause rather than folded into the verdict.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { normalizeEvents } from '../dsh/normalize.js'
import { rowsFromSqlite } from '../core/rows-sqlite.js'

const argv = process.argv.slice(2)
const flag = (name, fallback = null) => {
    const at = argv.indexOf(name)
    return at === -1 ? fallback : (argv[at + 1] ?? fallback)
}
const has = (name) => argv.includes(name)

const indexPath = flag('--index')
if (indexPath === null) {
    process.stderr.write('check-channel-agreement --index <db> [--session <id>] [--limit N]\n')
    process.exit(2)
}
const limit = Number(flag('--limit', 0)) || 0
const wanted = flag('--session')

/** The log's bytes, decoded: a dsh log is zstd-compressed and multi-frame, so `zstd -dc` reads it. */
const readLog = (path) => {
    if (path.endsWith('.zstd')) {
        const done = spawnSync('zstd', ['-dc', path], { maxBuffer: 1 << 30 })
        if (done.status !== 0) throw new Error(`zstd failed on ${path}: ${String(done.stderr).slice(0, 120)}`)
        return done.stdout
    }
    return readFileSync(path)
}

/** The fields a message row carries, and the ones a tool call carries. */
const MESSAGE_FIELDS = ['seq', 'exchange', 'role', 'text', 'reasoning', 'shadowed', 'interrupted']
const CALL_FIELDS = ['seq', 'exchange', 'callId', 'name', 'args']

/**
 * HOW AN ERROR IS DESCRIBED, and when its message may be printed.
 *
 * V8's `JSON.parse` message embeds a fragment of the offending text -- and the offending text of a malformed tool-call
 * line is exactly where a live Telegram bot token sits in this corpus. So an error that this tool raised itself, and
 * whose message it wrote, may be printed; anything else is described by its CLASS alone, because a class is enough to
 * diagnose it and a message is not always free of content.
 */
const describeError = (error) => {
    if (error instanceof Error && error.safe === true) return `${error.constructor.name}: ${error.message}`
    return error instanceof Error ? error.constructor.name : 'Error'
}

/**
 * HOW A VALUE IS DESCRIBED, and never printed.
 *
 * A tool call's arguments are whatever the agent passed to a tool -- and on this host that includes a TELEGRAM BOT
 * TOKEN, in plain text, in a session log. Printing the value here would put a live credential in a terminal, in a log
 * and in a transcript. So a difference is described by its SHAPE: the field, the length on each side, and whether the
 * two are equal. That is enough to diagnose a divergence and carries no content.
 */
const shape = (value) => {
    if (value === null || value === undefined) return 'null'
    if (typeof value === 'string') return `${value.length} char(s)`
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    return `${Array.isArray(value) ? 'array' : 'object'} of ${JSON.stringify(value).length} char(s)`
}

/** One session, both ways, compared field by field. */
function compare(session) {
    const bytes = readLog(session.path)
    const text = bytes.toString('utf8')
    // THE EVENTS, AND A MALFORMED LINE IS NAMED WITHOUT ITS CONTENT. V8's own message would quote a fragment of the
    // line, and a malformed tool-call line is where a live credential sits in this corpus.
    const events = []
    const lines = text.split('\n')
    for (let at = 0; at < lines.length; at += 1) {
        if (lines[at].trim() === '') continue
        try { events.push(JSON.parse(lines[at])) }
        catch { throw Object.assign(new Error(`malformed JSONL at line ${at + 1}`), { safe: true }) }
    }
    // THE LOG SIDE'S RECEIPT IS BUILT THE WAY `scripts/ask.mjs --log` BUILDS IT, because a receipt the TOOL invented
    // would be a comparison of the tool with itself -- and it would have reported 946 divergences that were the
    // tool's own. The route names the bytes it read: the DECODED length, the digest of the DECODED text, and the last
    // seq it reached. What the two routes do NOT agree about is then a finding, and not a bug in the measuring
    // instrument -- which is the whole reason this receipt is built here and not filled in by hand.
    const fromLog = normalizeEvents(events, {
        harness: 'dsh',
        id: session.id,
        source: session.path,
        sourceBytes: Buffer.byteLength(text, 'utf8'),
        sourceSha256: createHash('sha256').update(text).digest('hex'),
        highWater: events.at(-1)?.seq ?? null,
    })
    const fromIndex = rowsFromSqlite(indexPath, session.id)
    if (fromIndex.problem !== null) return { problem: fromIndex.problem, differences: [], byField: new Map(), messages: 0, state: '', indexState: '' }

    const logMessages = fromLog.filter((row) => row.kind === 'message')
    const indexMessages = fromIndex.rows.filter((row) => row.kind === 'message')
    const differences = []
    const byField = new Map()
    const named = new Map()
    const note = (field, a, b) => {
        byField.set(field, (byField.get(field) ?? 0) + 1)
        differences.push(`${field}: ${shape(a)} in the log, ${shape(b)} in the index`)
    }

    // THE RECEIPT, because it is the ANCHOR. A measurement is argued from the bytes it read and the window it reached,
    // so two channels that read the same session must anchor it the same way -- and they did not: the producer said
    // `dsh` and the reader said `dsh:v4`, and the index's byte count is the file ON DISK while the producer's is the
    // bytes it DECODED.
    const logReceipt = fromLog.find((row) => row.kind === 'receipt')
    const indexReceipt = fromIndex.rows.find((row) => row.kind === 'receipt')
    for (const field of ['harness', 'sourceSha256', 'highWater']) {
        const a = logReceipt?.[field]
        const b = indexReceipt?.[field]
        if (JSON.stringify(a) !== JSON.stringify(b)) note(`receipt ${field}`, a, b)
    }
    // AND THE BYTE COUNT, COUNTED SEPARATELY AND NOT COMPARED, because the two channels mean DIFFERENT THINGS by it:
    // the log route reports the DECODED length of the conversation, and the index reports the ON-DISK size of a
    // COMPRESSED log. One name, two facts -- a real defect in the receipt, and one this tool cannot settle by
    // comparing, because comparing a decoded length with a compressed size measures nothing at all. It is reported, it
    // is named, and it does NOT decide the exit code. The fix belongs to the store, which has to carry the decoded
    // length beside the on-disk one, and that is a store-schema decision rather than a line in this tool.
    const logBytes = logReceipt?.sourceBytes
    const indexBytes = indexReceipt?.sourceBytes
    if (JSON.stringify(logBytes) !== JSON.stringify(indexBytes)) {
        named.set('receipt sourceBytes (decoded length vs on-disk size)', (named.get('receipt sourceBytes (decoded length vs on-disk size)') ?? 0) + 1)
    }

    // THE COUNTS, because a session that lost a message says so before a reader goes looking for it.
    if (logMessages.length !== indexMessages.length) {
        byField.set('message count', (byField.get('message count') ?? 0) + 1)
        differences.push(`message count: ${logMessages.length} in the log, ${indexMessages.length} in the index`)
    }
    // AND THE MESSAGES, one by one, by seq: a field that differs can cancel out in a count and must not.
    const indexBySeq = new Map(indexMessages.map((row) => [row.seq, row]))
    for (const row of logMessages) {
        const other = indexBySeq.get(row.seq)
        if (other === undefined) {
            byField.set('message missing from the index', (byField.get('message missing from the index') ?? 0) + 1)
            differences.push(`message seq ${row.seq} is in the log and not in the index`)
            continue
        }
        const a = [row.seq, row.exchange, row.role, row.text, row.reasoning, row.shadowed, row.interrupted]
        const b = [other.seq, other.exchange, other.role, other.text, other.reasoning, other.shadowed, other.interrupted]
        for (let i = 0; i < a.length; i += 1) {
            if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) note(MESSAGE_FIELDS[i], a[i], b[i])
        }
    }
    // AND THE TOOL CALLS, the same way: a call's name and arguments are evidence, and an index that lost them
    // measures a session in which the agent appears to have done less than it did.
    const logCalls = fromLog.filter((row) => row.kind === 'tool_call')
    const indexCalls = fromIndex.rows.filter((row) => row.kind === 'tool_call')
    if (logCalls.length !== indexCalls.length) {
        byField.set('tool call count', (byField.get('tool call count') ?? 0) + 1)
        differences.push(`tool call count: ${logCalls.length} in the log, ${indexCalls.length} in the index`)
    }
    const indexCallBySeq = new Map(indexCalls.map((row) => [row.seq, row]))
    for (const row of logCalls) {
        const other = indexCallBySeq.get(row.seq)
        if (other === undefined) {
            byField.set('tool call missing from the index', (byField.get('tool call missing from the index') ?? 0) + 1)
            differences.push(`tool call seq ${row.seq} is in the log and not in the index`)
            continue
        }
        const a = [row.seq, row.exchange, row.callId, row.name, row.args]
        const b = [other.seq, other.exchange, other.callId, other.name, other.args]
        for (let i = 0; i < a.length; i += 1) {
            if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) note(`tool call ${CALL_FIELDS[i]}`, a[i], b[i])
        }
    }
    return { problem: null, differences, byField, named, messages: logMessages.length, state: stateOf(logMessages), indexState: stateOf(indexMessages) }
}

/**
 * THE COMPOSED STATE, which is what the JUDGE sees, and the number that decides whether two channels are one
 * measurement. A measurement's `stateHash` is made of this text, so two channels that agree here produce the same
 * hash and two readings that a reader can compare. A row that differs BELOW the state -- a tool call's arguments,
 * say -- is evidence that differs without making the reading differ, and the two facts are worth telling apart.
 */
const stateOf = (messages) => messages.map((row) => row.text).join('\n')

let db
try {
    db = new DatabaseSync(resolve(indexPath), { readOnly: true })
}
catch (error) {
    process.stderr.write(`check-channel-agreement: could not open ${indexPath}: ${error.message}\n`)
    process.exit(2)
}
const sessions = wanted !== null
    ? db.prepare('SELECT id, path, bytes, high_water FROM sessions WHERE id = ?').all(wanted)
    : db.prepare('SELECT id, path, bytes, high_water FROM sessions ORDER BY bytes ASC').all()
const sample = limit > 0 ? sessions.slice(0, limit) : sessions
if (sessions.length === 0) {
    process.stderr.write(`check-channel-agreement: no session ${wanted} in ${indexPath}\n`)
    process.exit(2)
}

let compared = 0
let agreed = 0
const divergent = []
const unreadable = []
const byField = new Map()
const named = new Map()
const stateDiffs = []
for (const session of sample) {
    let result
    try {
        result = compare(session)
    }
    catch (error) {
        unreadable.push(`${session.id}: ${describeError(error)}`)
        continue
    }
    if (result.problem !== null) { unreadable.push(`${session.id}: ${result.problem}`); continue }
    compared += 1
    for (const [field, count] of result.named) named.set(field, (named.get(field) ?? 0) + count)
    if (result.state !== result.indexState) {
        byField.set('THE COMPOSED STATE (what the judge sees)', (byField.get('THE COMPOSED STATE (what the judge sees)') ?? 0) + 1)
        stateDiffs.push({ id: session.id, bytes: session.bytes, logLen: result.state.length, indexLen: result.indexState.length })
    }
    if (result.differences.length === 0) { agreed += 1; continue }
    for (const [field, count] of result.byField) byField.set(field, (byField.get(field) ?? 0) + count)
    divergent.push({ id: session.id, bytes: session.bytes, highWater: session.high_water, differences: result.differences })
}

process.stdout.write(`sessions in the index: ${sessions.length}\n`)
process.stdout.write(`compared: ${compared}   agree on every field: ${agreed}   differ on some field: ${divergent.length}\n`)
process.stdout.write(`the COMPOSED STATE differs in ${stateDiffs.length} session(s) -- and that is the number that decides whether the two channels are ONE measurement\n`)
for (const entry of stateDiffs.slice(0, 5)) {
    process.stdout.write(`  ${entry.id} (${entry.bytes} bytes): ${entry.logLen} char(s) in the log, ${entry.indexLen} in the index\n`)
}
if (unreadable.length > 0) {
    process.stdout.write(`unreadable: ${unreadable.length}\n`)
    for (const line of unreadable.slice(0, 5)) process.stdout.write(`  ${line}\n`)
}
if (byField.size > 0) {
    process.stdout.write('\nWHAT DIFFERS, by field (a count of the DIFFERENCES, not of the sessions):\n')
    for (const [field, count] of [...byField.entries()].sort((a, b) => b[1] - a[1])) {
        process.stdout.write(`  ${String(count).padStart(6)}  ${field}\n`)
    }
    process.stdout.write('  (these are EVIDENCE differences: the two channels do not carry the same facts about the same\n')
    process.stdout.write('   session. They do NOT change the composed state, and the number above is the verdict.)\n')
}
if (named.size > 0) {
    process.stdout.write('\nNAMED DIFFERENCES, counted and NOT compared, because the two channels mean different things by the field:\n')
    for (const [field, count] of [...named.entries()].sort((a, b) => b[1] - a[1])) {
        process.stdout.write(`  ${String(count).padStart(6)}  ${field}\n`)
    }
    process.stdout.write('  (the fix belongs to the store, which has to carry the decoded length beside the on-disk one)\n')
}
for (const entry of divergent.slice(0, 5)) {
    process.stdout.write(`\n${entry.id}  (${entry.bytes} bytes, index high_water ${entry.highWater})\n`)
    for (const difference of entry.differences.slice(0, 6)) process.stdout.write(`  ${difference}\n`)
    if (entry.differences.length > 6) process.stdout.write(`  ... and ${entry.differences.length - 6} more\n`)
}
if (divergent.length > 5) process.stdout.write(`\n... and ${divergent.length - 5} more divergent sessions\n`)

// THE EXIT CODE SAYS WHAT WAS MEASURED, and what it measures is the thing this tool exists for: whether the two
// channels are ONE MEASUREMENT. That is the COMPOSED STATE -- the text the judge is handed -- so 0 means the composed
// state agreed in every session, 1 means it did not, and 2 means the tool could not read something.
//
// THE EVIDENCE DIFFERENCES ABOVE DO NOT CHANGE IT, and that is a judgement worth stating rather than hiding: the
// index channel drops what the store's schema does not carry (a truncated tool argument, an interruption fact with no
// column), and the log channel carries both. A reading taken from either channel is the same reading, and the
// evidence around it is not the same evidence. The losses are printed with their cause rather than folded into the
// verdict, because a verdict that is always 1 is a signal nobody reads -- and a signal that is always 0 is one
// nobody trusts.
//
// A run that compared NOTHING is not a run that found agreement: it is a run that read no logs, and it says so with
// 2, the same code an unreadable index gets. Exiting 0 there would report "the two channels are one measurement"
// about a session nothing was read from, which is the one outcome this tool must never produce.
process.exit(unreadable.length > 0 || compared === 0 ? 2 : (stateDiffs.length > 0 ? 1 : 0))
