// THE SESSION INDEX -- a DERIVED, DROPPABLE store over the harness's own session logs.
//
// WHY IT EXISTS. `sessionQuery` can enumerate sessions and read a title per id, but it cannot SEARCH a title, and the
// cost of asking it is the whole library: measured on this host, 505 session files totalling 191 MB, with the largest
// at 32 MB. A `listSessions()` plus a title read per session is a scan of all of it to answer "which session is called
// X", and a live call was aborted mid-flight rather than answering.
//
// WHAT IT IS NOT. It is not a source of truth, and it is not consulted by anything in the live path. The log is the
// evidence; this is a projection of it, rebuildable from scratch, and every row carries the facts that make that
// checkable (the file it came from, its size, the seq it was read to). Delete the file and nothing is lost.
//
// IT READS WHAT THE PLUGIN ALREADY READS. `lib/host/session-format.js` owns the harness's vocabulary -- the event
// names, the two message shapes, which block kinds are text -- and this script is the second consumer of that same
// knowledge rather than a second opinion about it.
//
// Usage:
//   node scripts/session-index.mjs build [--out FILE] [--sessions DIR] [--text]
//   node scripts/session-index.mjs find  <term> [--out FILE] [--limit N]
//   node scripts/session-index.mjs stats [--out FILE]

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/** Where the harness keeps its sessions, unless told otherwise. */
export const DEFAULT_SESSIONS_DIR = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'sessions')
/** The derived store. Droppable: `build` recreates it. */
export const DEFAULT_INDEX = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'session-index.db')

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions(
  id TEXT PRIMARY KEY, path TEXT NOT NULL, format TEXT, cwd TEXT, created_at INTEGER,
  title TEXT, title_source TEXT, title_seqs TEXT, has_title INTEGER NOT NULL DEFAULT 0,
  explicit_rename INTEGER NOT NULL DEFAULT 0,
  events INTEGER NOT NULL DEFAULT 0, messages INTEGER NOT NULL DEFAULT 0,
  asks INTEGER NOT NULL DEFAULT 0, assistant INTEGER NOT NULL DEFAULT 0,
  reasoning_chars INTEGER NOT NULL DEFAULT 0, visible_chars INTEGER NOT NULL DEFAULT 0,
  tool_calls INTEGER NOT NULL DEFAULT 0, shadowed INTEGER NOT NULL DEFAULT 0,
  high_water INTEGER NOT NULL DEFAULT 0, bytes INTEGER NOT NULL DEFAULT 0,
  source_sha256 TEXT, indexed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages(
  session_id TEXT NOT NULL, seq INTEGER, turn INTEGER, role TEXT, kind TEXT,
  text TEXT, reasoning TEXT, shadowed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS tool_calls(session_id TEXT NOT NULL, call_id TEXT, name TEXT, args TEXT);
CREATE INDEX IF NOT EXISTS messages_by_session ON messages(session_id);
`

/**
 * Every `.jsonl` and `.jsonl.zstd` session file under `dir`, one per session.
 *
 * The harness keeps a session in more than one format version while a migration is being carried (`session.v3` and
 * `session.v4` for the same id), so the CURRENT writer wins and the older file is skipped rather than counted twice.
 */
export function sessionFiles(dir = DEFAULT_SESSIONS_DIR) {
    const bySession = new Map()
    const walk = (current) => {
        for (const entry of readdirSync(current, { withFileTypes: true })) {
            const full = join(current, entry.name)
            if (entry.isDirectory()) { walk(full); continue }
            if (!/^session\.v\d+\.jsonl(\.zstd)?$/.test(entry.name)) continue
            const version = Number(/^session\.v(\d+)/.exec(entry.name)[1])
            const id = current.split('/').pop()
            const held = bySession.get(id)
            if (held === undefined || version > held.version) bySession.set(id, { id, path: full, version })
        }
    }
    walk(dir)
    return [...bySession.values()].sort((a, b) => a.id.localeCompare(b.id))
}

/** The decoded lines of one session file. `.zstd` is the harness's own, multi-frame, so `zstd -dc` reads it. */
export function sessionLines(path) {
    if (path.endsWith('.zstd')) {
        const done = spawnSync('zstd', ['-dc', path], { maxBuffer: 1 << 30 })
        if (done.status !== 0) throw new Error(`zstd failed on ${path}: ${String(done.stderr).slice(0, 200)}`)
        return { text: done.stdout.toString('utf8'), sha256: createHash('sha256').update(done.stdout).digest('hex').slice(0, 16) }
    }
    const buf = readFileSync(path)
    return { text: buf.toString('utf8'), sha256: createHash('sha256').update(buf).digest('hex').slice(0, 16) }
}

const blockText = (content, kinds) => {
    // AN UNTYPED STRING IS TEXT, NEVER REASONING. Only a typed block can be reasoning, so a string body must not be
    // counted as both -- which is what happened first, and a fixture caught it: 25 reasoning characters for a 5-char
    // reasoning block, because the 20-char injected summary was added to BOTH counters.
    if (typeof content === 'string') return kinds.includes('text') ? content : ''
    if (!Array.isArray(content)) return ''
    return content.filter((b) => b !== null && typeof b === 'object' && kinds.includes(b.type))
        .map((b) => b.text ?? b.thinking ?? '').join('')
}

/** One row per session, folded from its own events. Pure; never throws. */
export function foldSession({ id, path, version, text, sha256, bytes }) {
    const row = {
        id, path, format: `v${version}`, cwd: null, created_at: null,
        title: null, title_source: null, title_seqs: null, has_title: 0, explicit_rename: 0,
        events: 0, messages: 0, asks: 0, assistant: 0, reasoning_chars: 0, visible_chars: 0,
        tool_calls: 0, shadowed: 0, high_water: 0, bytes, source_sha256: sha256,
    }
    const messages = []
    const calls = []
    const replaced = []
    for (const line of text.split('\n')) {
        if (line === '') continue
        let event
        try { event = JSON.parse(line) } catch { continue }
        row.events += 1
        const data = event.data ?? {}
        if (typeof event.seq === 'number') row.high_water = Math.max(row.high_water, event.seq)
        const op = event.surfaceOp
        if (op !== null && typeof op === 'object' && op.op === 'replace'
            && typeof op.startSeq === 'number' && typeof op.endSeq === 'number') replaced.push([op.startSeq, op.endSeq])
        // THE HEADER IS A RECORD, NOT A `data` PAYLOAD. The first line of a dsh log is
        // `{"type":"session","version":4,"id":…,"createdAt":…,"cwd":"/home/john/…"}` -- `cwd` and `createdAt` sit at the
        // TOP LEVEL, which is the same shape pi writes. Reading only `data.cwd` indexed 0 of 498 sessions with a cwd.
        if (event.type === 'session') {
            if (typeof event.cwd === 'string') row.cwd = event.cwd
            if (typeof event.createdAt === 'number') row.created_at = event.createdAt
            if (typeof event.version === 'number') row.format = `v${event.version}`
            continue
        }
        if (row.cwd === null && typeof data.cwd === 'string') row.cwd = data.cwd
        if (row.created_at === null && typeof event.time === 'number') row.created_at = event.time

        // THE TITLE IS AN EVENT (`session/title`), declared by the harness's session-title package. Its `source` says
        // whether the model, a fallback, or the operator produced it -- and `messageSeqs` names the asks it came from.
        if (event.type === 'session/title') {
            if (typeof data.title === 'string' && data.title !== '') {
                row.title = data.title
                // `source` IS AN OBJECT on a real log: `{kind:'provider', provider:'session-title-first-prompt-llm',
                // model:{…}}` or `{kind:'fallback'}`, and only `{kind:'user'}` is a rename. Storing it only when it was
                // a string lost every real title's provenance.
                row.title_source = typeof data.source === 'string' ? data.source : JSON.stringify(data.source ?? null)
                row.title_seqs = JSON.stringify(data.messageSeqs ?? [])
                row.has_title = 1
                row.explicit_rename = (data.source?.kind ?? data.source) === 'user' ? 1 : 0
            }
            continue
        }
        if (event.type === 'session/header' && typeof data.cwd === 'string') row.cwd = data.cwd
        if (event.type === 'tool/call') {
            row.tool_calls += 1
            calls.push([id, String(data.callId ?? ''), String(data.name ?? ''), String(data.arguments ?? '').slice(0, 4000)])
            continue
        }
        if (event.type !== 'user/message' && event.type !== 'assistant/message') continue
        row.messages += 1
        const content = event.type === 'user/message' ? data.content : (data.message ?? {}).content
        const visible = blockText(content, ['text'])
        const reasoning = blockText(content, ['reasoning', 'thinking'])
        const kind = event.type === 'user/message' ? String((data.source ?? {}).kind ?? 'user') : 'assistant'
        if (event.type === 'user/message' && kind === 'user') row.asks += 1
        if (event.type === 'assistant/message') row.assistant += 1
        row.visible_chars += visible.length
        row.reasoning_chars += reasoning.length
        const seq = event.seq ?? null
        messages.push([id, seq, typeof data.turn === 'number' ? data.turn : null, kind === 'user' ? 'user' : (kind === 'assistant' ? 'assistant' : 'harness'), kind, visible, reasoning, 0])
    }
    // A REPLACEMENT WITHDRAWS EVENTS THAT CAME *BEFORE* IT -- a compaction summary arrives after the span it replaces --
    // so the shadowed flag cannot be decided while walking forward: every event of a replaced range has already been
    // counted by the time the range is known. Measured on this host: deciding inline reported 0 shadowed messages
    // across 498 sessions, where the session this was written in alone holds 3,417.
    for (const message of messages) {
        if (typeof message[1] === 'number' && replaced.some(([a, b]) => message[1] >= a && message[1] <= b)) {
            message[7] = 1
            row.shadowed += 1
        }
    }
    return { row, messages, calls }
}

/** Build the index. Returns what it wrote, so a caller can print it rather than assume it. */
export function buildIndex({ sessionsDir = DEFAULT_SESSIONS_DIR, out = DEFAULT_INDEX, withText = false, onProgress = null } = {}) {
    const db = new DatabaseSync(out)
    db.exec('PRAGMA journal_mode = WAL;')
    db.exec(SCHEMA)
    db.exec('DELETE FROM sessions; DELETE FROM messages; DELETE FROM tool_calls;')
    const insertSession = db.prepare(`INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    const insertMessage = db.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?)')
    const insertCall = db.prepare('INSERT INTO tool_calls VALUES (?,?,?,?)')
    const files = sessionFiles(sessionsDir)
    const now = new Date().toISOString()
    let done = 0
    let titled = 0
    for (const file of files) {
        let lines
        try { lines = sessionLines(file.path) } catch { continue }
        const { row, messages, calls } = foldSession({ ...file, text: lines.text, sha256: lines.sha256, bytes: statSync(file.path).size })
        insertSession.run(row.id, row.path, row.format, row.cwd, row.created_at, row.title, row.title_source, row.title_seqs,
            row.has_title, row.explicit_rename, row.events, row.messages, row.asks, row.assistant, row.reasoning_chars,
            row.visible_chars, row.tool_calls, row.shadowed, row.high_water, row.bytes, row.source_sha256, now)
        if (row.has_title === 1) titled += 1
        if (withText) for (const m of messages) insertMessage.run(...m)
        for (const c of calls) insertCall.run(...c)
        done += 1
        if (onProgress !== null && done % 25 === 0) onProgress(done, files.length)
    }
    db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS titles_fts USING fts5(id UNINDEXED, title, cwd)')
    db.exec('DELETE FROM titles_fts')
    db.exec("INSERT INTO titles_fts(id, title, cwd) SELECT id, COALESCE(title,''), COALESCE(cwd,'') FROM sessions")
    db.close()
    return { sessions: done, titled, untitled: done - titled, out }
}

/**
 * Sessions whose TITLE, id or cwd matches, newest first.
 *
 * A title is matched with `LIKE` rather than FTS on purpose: `LIKE` has no query syntax to escape, and the escaping is
 * exactly the guard the harness's own search performs for us ("interpreted as data, never executable FTS syntax"). At
 * this size it is also faster than nothing.
 */
export function findSessions(term, { out = DEFAULT_INDEX, limit = 20 } = {}) {
    const db = new DatabaseSync(out, { readOnly: true })
    const like = `%${String(term)}%`
    const rows = db.prepare(`
      SELECT id, title, title_source, cwd, created_at, asks, messages, tool_calls, has_title
      FROM sessions
      WHERE title LIKE ? OR cwd LIKE ? OR id LIKE ?
      ORDER BY (title LIKE ?) DESC, created_at DESC
      LIMIT ?`).all(like, like, `${String(term)}%`, like, limit)
    db.close()
    return rows
}

const ms = (t) => `${(Number(process.hrtime.bigint() - t) / 1e6).toFixed(0)} ms`

function main(argv) {
    const [command, ...rest] = argv
    const flag = (name, fallback) => {
        const at = rest.indexOf(`--${name}`)
        return at === -1 ? fallback : rest[at + 1]
    }
    const out = flag('out', DEFAULT_INDEX)
    if (command === 'build') {
        const started = process.hrtime.bigint()
        const result = buildIndex({
            sessionsDir: flag('sessions', DEFAULT_SESSIONS_DIR),
            out,
            withText: rest.includes('--text'),
            onProgress: (done, total) => process.stderr.write(`  ${done}/${total}\r`),
        })
        console.log(`indexed ${result.sessions} session(s) in ${ms(started)} -> ${result.out}`)
        console.log(`  with a session/title event: ${result.titled} | without: ${result.untitled}` +
            (result.untitled > 0 ? ' (those are the ones a title service must fold per request)' : ''))
        console.log(`  size: ${(statSync(out).size / 1048576).toFixed(1)} MB`)
        return 0
    }
    if (command === 'find') {
        const term = rest.find((a) => !a.startsWith('--') && a !== flag('out', null) && a !== flag('limit', null))
        if (term === undefined) { console.error('find needs a term'); return 2 }
        const started = process.hrtime.bigint()
        const rows = findSessions(term, { out, limit: Number(flag('limit', 20)) })
        console.log(`${rows.length} session(s) matching ${JSON.stringify(term)} in ${ms(started)}`)
        for (const row of rows) {
            console.log(`  ${row.id}`)
            console.log(`    title: ${row.title === null ? '(none)' : row.title}${row.title_source === null ? '' : ` [${row.title_source}]`}`)
            console.log(`    cwd:   ${row.cwd ?? '?'}`)
            console.log(`    ${row.asks} asks, ${row.messages} messages, ${row.tool_calls} tool calls, ${new Date(Number(row.created_at ?? 0)).toISOString().slice(0, 16)}`)
        }
        return 0
    }
    if (command === 'stats') {
        const db = new DatabaseSync(out, { readOnly: true })
        const one = db.prepare('SELECT COUNT(*) n, SUM(has_title) titled, SUM(shadowed) shadowed, SUM(asks) asks FROM sessions').get()
        const size = (statSync(out).size / 1048576).toFixed(1)
        console.log(`${one.n} session(s), ${one.titled} titled, ${one.asks} asks, ${one.shadowed} shadowed message(s), ${size} MB`)
        db.close()
        return 0
    }
    console.error('usage: session-index.mjs build|find|stats [--out FILE] [--sessions DIR] [--text] [--limit N]')
    return 2
}

if (process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split('/').pop())) process.exit(main(process.argv.slice(2)))
