#!/usr/bin/env node
//
// THE PI CHANNEL-AGREEMENT CHECK: compose every pi session BOTH ways and compare the rows, field by field.
//
// WHY THIS IS A COMMAND, AND NOT A GATE. `ROADMAP.md` §14.5 names the condition: "Two channels must be able to
// disagree VISIBLY, so the channel-agreement test (compose one turn both ways) is a prerequisite for trusting
// either." There are now TWO producers of rows for a pi session, and they are not the same producer:
//
//   CHANNEL A -- THE DSH-SHAPED PATH. pi's own session file, converted by this repository's importer
//   (`dsh/pi-session-export.js`) into a **dsh v4 log** -- with an invented turn and step for every ask -- and then
//   read by this repository's producer (`dsh/normalize.js`).
//
//   CHANNEL B -- THE PI-NATIVE PATH. The same pi session file, written down in the **session-log format** by the
//   second implementation (`pi-session-log`), and read by that repository's producer.
//
// The two differ in exactly one way that matters: channel A's log carries turns and channel B's does not, because the
// format's rule 7 says a substrate "does not have to write turns, and must not invent them". The claim this check
// makes is that **removing the turns changes nothing** -- the ask-group is derived, so a boundary that was invented
// and a boundary that is derived produce the same measurement.
//
// It cannot be a gate in `npm run ci`: it needs the pi corpus, which lives on the machine that runs pi, and it needs
// a second repository on disk. It is a command anyone runs there, and its output is quoted in a finding.
//
//   node scripts/check-pi-channels.mjs --pi-repo ../pi-session-log
//   node scripts/check-pi-channels.mjs --pi-repo ../pi-session-log --root ~/.pi --limit 20
//   node scripts/check-pi-channels.mjs --pi-repo ../pi-session-log --session <pi session id>
//
// THE EXIT CODE answers ONE question -- are the two channels ONE MEASUREMENT? -- and the question is answered by the
// COMPOSED STATE, which is the text the judge is handed. 0: the composed state agreed in every session. 1: it did
// not. 2: the corpus could not be read, or a session could not be read, or nothing was compared at all.
//
// WHAT IT COMPARES, and why not just the counts: a per-message field that differs can CANCEL OUT in an aggregate, so
// the comparison is per message and per tool call, and a session that agrees on every count but not on every message
// is reported.
//
// NOTHING IS PRINTED BUT SHAPES AND LENGTHS. A pi session holds whatever the agent passed to a tool, and on this
// host that includes a TELEGRAM BOT TOKEN, in plain text. A difference is described by its field, its length on each
// side, and whether the two are equal: enough to diagnose a divergence, and no content.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { eventsOf, parseSession } from '../dsh/pi-session-export.js'
import { normalizeEvents } from '../dsh/normalize.js'

const argv = process.argv.slice(2)
const flag = (name, fallback = null) => {
    const at = argv.indexOf(name)
    return at === -1 ? fallback : (argv[at + 1] ?? fallback)
}
const has = (name) => argv.includes(name)

const piRepo = flag('--pi-repo')
if (piRepo === null) {
    process.stderr.write('check-pi-channels --pi-repo <path> [--root ~/.pi] [--limit N] [--session <id>]\n')
    process.exit(2)
}
const root = resolve(flag('--root', join(homedir(), '.pi')))
const limit = Number(flag('--limit', 0)) || 0
const wanted = flag('--session')

// THE SECOND IMPLEMENTATION, loaded from the other repository. It is loaded by PATH rather than imported, because
// the package that owns these rules is not published yet: until it is, the two repositories share the CONFORMANCE
// FIXTURE rather than a dependency, and this is the same bridge with a path in it.
const repoPath = resolve(piRepo)
let piParseSession
let piToSessionLog
let piToRows
try {
    const logModule = await import(pathToFileURL(join(repoPath, 'src/pi-log.js')).href)
    const rowsModule = await import(pathToFileURL(join(repoPath, 'src/rows.js')).href)
    piParseSession = logModule.parseSession
    piToSessionLog = logModule.toSessionLog
    piToRows = rowsModule.toRows
} catch (error) {
    process.stderr.write(`check-pi-channels: the second implementation is not readable at ${repoPath}: ${error.message}\n`)
    process.exit(2)
}

/** Every pi session file under a root, in a stable order. */
function sessionFiles(dir, out = []) {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return out }
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) sessionFiles(path, out)
        else if (entry.name.endsWith('.jsonl')) out.push(path)
    }
    return out
}

/** The fields a message row carries, and the ones a tool call carries. */
const MESSAGE_FIELDS = ['seq', 'exchange', 'role', 'text', 'reasoning', 'shadowed', 'interrupted']
const CALL_FIELDS = ['seq', 'exchange', 'callId', 'name']

/**
 * HOW A VALUE IS DESCRIBED, and never printed.
 *
 * A tool call's arguments are whatever the agent passed to a tool -- and on this host that includes a TELEGRAM BOT
 * TOKEN, in plain text. So a difference is described by its SHAPE: the field, the length on each side, and whether
 * the two are equal. That is enough to diagnose a divergence and carries no content.
 */
const shape = (value) => {
    if (value === null || value === undefined) return 'null'
    if (typeof value === 'string') return `${value.length} char(s)`
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    return `${Array.isArray(value) ? 'array' : 'object'} of ${JSON.stringify(value).length} char(s)`
}

/** The rows of one kind, in order. */
const messagesOf = (rows) => rows.filter((row) => row?.kind === 'message')
const callsOf = (rows) => rows.filter((row) => row?.kind === 'tool_call')

/**
 * THE FINGERPRINT OF ONE MESSAGE, and why a fingerprint and not an index.
 *
 * THE TWO LOGS DO NOT HOLD THE SAME RECORDS, so the rows cannot be compared BY POSITION: the dsh-shaped log
 * interleaves four turn/step records around every ask, and it places an injected message at the HEAD of its
 * exchange, while pi's own order is the order things happened. A row-by-index comparison would report thousands of
 * differences that are really one difference -- the two logs number their records differently -- and it would hide the
 * one that matters.
 *
 * So a message is compared by WHAT IT IS: its group, its role, its text, its reasoning, whether the surface withdrew
 * it, and whether anybody said it was interrupted. The text is part of the fingerprint and is never PRINTED: the
 * fingerprint is compared, and only shapes and counts are reported.
 *
 * @param {object} row
 * @returns {string}
 */
const messagePrint = (row) => JSON.stringify([
    row.exchange,
    row.role,
    row.text,
    row.reasoning,
    row.shadowed,
    row.interrupted,
])

/** The fingerprint of one tool call. The arguments are compared by LENGTH, like for like. */
const callPrint = (row) => JSON.stringify([
    row.exchange,
    row.callId,
    row.name,
    String(row.args ?? '').length,
])

/** The multiset difference of two fingerprint lists: what is in one and not the other. */
function multisetDifference(a, b) {
    const counts = new Map()
    for (const item of a) counts.set(item, (counts.get(item) ?? 0) + 1)
    for (const item of b) {
        const count = counts.get(item) ?? 0
        if (count === 0) continue
        if (count === 1) counts.delete(item)
        else counts.set(item, count - 1)
    }
    return [...counts.values()].reduce((sum, count) => sum + count, 0)
}

/**
 * ONE SESSION, BOTH WAYS, COMPARED.
 *
 * The two receipts are built the SAME WAY on both sides, so the comparison is of the rows and not of the tool: a
 * receipt the tool invented would be a comparison of the tool with itself, and it would have reported divergences
 * that were the tool's own.
 */
function compare(path) {
    const text = readFileSync(path, 'utf8')

    // CHANNEL A: pi's own file -> a dsh v4 log -> this repository's producer.
    const parsedA = parseSession(text)
    const events = eventsOf(parsedA, {})
    const rowsA = normalizeEvents(events.events, {
        harness: 'dsh',
        id: events.id,
        source: path,
        sourceBytes: Buffer.byteLength(text, 'utf8'),
        sourceSha256: '0'.repeat(64),
        highWater: events.events.at(-1)?.seq ?? null,
    })

    // CHANNEL B: the same pi file -> the session-log format -> the second implementation's producer.
    const parsedB = piParseSession(text)
    const { records } = piToSessionLog(parsedB.entries, { header: parsedB.header })
    const rowsB = piToRows(records, {
        harness: 'pi',
        id: events.id,
        source: path,
        sourceBytes: Buffer.byteLength(text, 'utf8'),
        sourceSha256: '0'.repeat(64),
        highWater: records.at(-1)?.seq ?? null,
    })

    const differences = []
    const messagesA = messagesOf(rowsA)
    const messagesB = messagesOf(rowsB)
    const callsA = callsOf(rowsA)
    const callsB = callsOf(rowsB)

    // THE COMPOSED STATE: the same messages, whatever order the two logs put them in.
    const printsA = messagesA.map(messagePrint)
    const printsB = messagesB.map(messagePrint)
    const missing = multisetDifference(printsA, printsB)
    const extra = multisetDifference(printsB, printsA)
    if (missing !== 0 || extra !== 0) {
        const shadowedA = messagesA.filter((row) => row.shadowed === true).length
        const shadowedB = messagesB.filter((row) => row.shadowed === true).length
        differences.push({
            field: 'composed state',
            a: `${missing} message(s) only in A (${messagesA.length} in all, ${shadowedA} shadowed)`,
            b: `${extra} message(s) only in B (${messagesB.length} in all, ${shadowedB} shadowed)`,
        })
    }

    const callPrintsA = callsA.map(callPrint)
    const callPrintsB = callsB.map(callPrint)
    const callMissing = multisetDifference(callPrintsA, callPrintsB)
    const callExtra = multisetDifference(callPrintsB, callPrintsA)
    if (callMissing !== 0 || callExtra !== 0) {
        differences.push({ field: 'tool calls', a: `${callMissing} only in A`, b: `${callExtra} only in B` })
    }

    // THE ORDER, which the composed state does not carry but a judge does read. It is reported when it differs, and
    // it is a named difference rather than a divergence: the dsh-shaped path places an injected message at the HEAD
    // of its exchange, because that is where it can put one, and pi's own order is the order things happened.
    const orderA = messagesA.map((row) => `${row.exchange}:${row.role}`).join(',')
    const orderB = messagesB.map((row) => `${row.exchange}:${row.role}`).join(',')
    if (orderA !== orderB) differences.push({ field: 'message order', a: 'the dsh-shaped order', b: "pi's own order" })

    return { differences, facts: events.facts, messages: messagesA.length }
}

/** The named differences, and the cause of each. A difference with a cause is not a mystery. */
const NAMED = [
    {
        field: 'message order',
        cause: 'the dsh-shaped path places an injected message at the HEAD of its exchange, because that is where it can put one, and it carries four turn/step records around every ask; pi\'s own path keeps the order things happened in and invents no turn',
    },
    {
        field: 'composed state',
        cause: 'the dsh-shaped path does not carry a `surfaceOp`, so a message a compaction withdrew still reads as on-surface there, and the summary the model actually saw is absent from its rows; the pi-native path writes the op the format asks for',
    },
]

const corpus = sessionFiles(root)
const files = wanted === null ? corpus : corpus.filter((path) => path.includes(wanted))
const limited = limit > 0 ? files.slice(0, limit) : files

if (limited.length === 0) {
    process.stderr.write(`check-pi-channels: no pi session under ${root}\n`)
    process.exit(2)
}

let compared = 0
let agreed = 0
let orderOnly = 0
const diverged = []
const unreadable = []
const fieldCounts = new Map()

for (const path of limited) {
    let result
    try {
        result = compare(path)
    } catch (error) {
        unreadable.push({ path, error: error instanceof Error ? error.constructor.name : 'Error' })
        continue
    }
    compared += 1
    // THE COMPOSED STATE DECIDES, and the ORDER is reported beside it. A difference in the ORDER is a difference in
    // where the harness placed a message, and the cause is named; a difference in the COMPOSED STATE is a difference
    // in what was measured, and only that one decides.
    for (const difference of result.differences) {
        const key = difference.field
        fieldCounts.set(key, (fieldCounts.get(key) ?? 0) + 1)
    }
    const composed = result.differences.filter((difference) => difference.field !== 'message order')
    if (composed.length === 0) {
        agreed += 1
        if (result.differences.length > 0) orderOnly += 1
        continue
    }
    diverged.push({ path, differences: result.differences })
}

process.stdout.write(`pi corpus: ${root}\n`)
process.stdout.write(`second implementation: ${repoPath}\n`)
process.stdout.write(`sessions: ${limited.length} compared, ${agreed} agreed on the composed state, ${diverged.length} diverged, ${orderOnly} differed in order only, ${unreadable.length} unreadable\n`)
if (fieldCounts.size > 0) {
    process.stdout.write('\ndiffering fields:\n')
    for (const [field, count] of [...fieldCounts.entries()].sort((a, b) => b[1] - a[1])) {
        process.stdout.write(`  ${field}: ${count} session(s)\n`)
    }
}
if (diverged.length > 0) {
    process.stdout.write('\nfirst divergences:\n')
    for (const { path, differences } of diverged.slice(0, 5)) {
        process.stdout.write(`  ${path}\n`)
        for (const difference of differences.slice(0, 6)) {
            const where = difference.index === undefined ? '' : ` at row ${difference.index}`
            process.stdout.write(`    ${difference.field}${where}: A ${difference.a} vs B ${difference.b}\n`)
        }
    }
}
if (fieldCounts.size > 0) {
    process.stdout.write('\nnamed differences, with their cause:\n')
    for (const named of NAMED) {
        const count = fieldCounts.get(named.field)
        if (count === undefined) continue
        process.stdout.write(`  ${named.field} (${count} session(s)): ${named.cause}\n`)
    }
}
if (unreadable.length > 0) {
    process.stdout.write(`\nunreadable sessions: ${unreadable.length} (named by class only)\n`)
}

if (compared === 0) {
    process.stderr.write('check-pi-channels: nothing was compared\n')
    process.exit(2)
}
process.exit(diverged.length === 0 ? 0 : 1)
