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
// IT IS THE HAND-ROLLED ANSWER TO SESSION SEARCH, and it is the one in use. The harness ships its own SQLite FTS
// index (`@deepseek-ai/dsh-session-query-sqlite`), which this profile had configured `openAt: never`; enabling it
// there made `api-session-controller` fail to start, and the cause was never reproduced (a probe of the same profile
// with the same override on another port booted cleanly). See `F98`. So the native route is left at its deployment
// default and this store keeps the capability.
//
// Usage:
//   node scripts/session-index.mjs build  [--out FILE] [--sessions DIR] [--text] [--incremental] [--no-fts]
//   node scripts/session-index.mjs find   <term> [--out FILE] [--limit N]
//   node scripts/session-index.mjs search <phrase> [--out FILE] [--limit N]
//   node scripts/session-index.mjs stats  [--out FILE]

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { defaultIndexPath, findSessions, metaOf, searchSessions } from '../lib/session-index.js'

/** Where the harness keeps its sessions, unless told otherwise. */
export const DEFAULT_SESSIONS_DIR = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'sessions')
/** The derived store, resolved by the read side so both callers agree on one path. */
export const DEFAULT_INDEX = defaultIndexPath()

/**
 * THE STORE'S OWN VERSION, because a receipt is not enough.
 *
 * `mtime`+`bytes` says "this FILE did not change", which is true and useless when the SCHEMA changed: the first
 * incremental run after a column was added skipped all 498 sessions and left the new column empty everywhere, which
 * looks exactly like a store with nothing to say. So the version is stored in the file (`PRAGMA user_version`) and a
 * mismatch throws the receipts away.
 */
export const SCHEMA_VERSION = 3

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
  source_sha256 TEXT, indexed_at TEXT NOT NULL, mtime REAL,
  -- THE DECLARED HEADER FIELDS THE FIRST VERSION OF THIS SCHEMA MISSED. All five are in HeaderLine
  -- (session-persistence-jsonl/lib/types/format.d.ts), which states the first JSONL record exactly: a derived schema
  -- that reads one real file finds cwd and createdAt and never learns that a session can name its PARENT, say it
  -- is a SUBAGENT's, or say how deep the delegation goes.
  parent_session TEXT, origin TEXT, delegation_depth INTEGER, agent_preset TEXT, is_seeded INTEGER
);
CREATE TABLE IF NOT EXISTS messages(
  session_id TEXT NOT NULL, seq INTEGER, turn INTEGER, role TEXT, kind TEXT,
  text TEXT, reasoning TEXT, shadowed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS tool_calls(session_id TEXT NOT NULL, call_id TEXT, name TEXT, args TEXT);
-- WHAT THIS STORE ACTUALLY HOLDS. 'text_indexed' is a MODE receipt: a build without text and a build with it are
-- different stores, and searching the second as if it were the first would report "no matches" for text that was
-- never stored. Same rule as the schema version: a receipt must cover the mode, not only the file.
-- (NO BACKTICKS IN THIS BLOCK: the schema is a JavaScript template literal, and a backtick in a SQL comment ends it.
-- Cost two syntax errors to learn.)
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
-- THE FTS5 MIRROR OF EVERY SEARCHABLE ROW. Not a second store: it is derived from messages, tool_results and
-- tool_calls, so it can be rebuilt from them without re-reading a single session file. It exists because a LIKE scan
-- answers in ~200 ms at 155 MB and FTS5 asks the same question through an inverted index.
CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(body, session_id UNINDEXED, source UNINDEXED, tokenize = 'unicode61');
CREATE TABLE IF NOT EXISTS tool_results(session_id TEXT NOT NULL, call_id TEXT, text TEXT, chars INTEGER NOT NULL DEFAULT 0, is_error INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS results_by_session ON tool_results(session_id);
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
        parent_session: null, origin: null, delegation_depth: null, agent_preset: null, is_seeded: null,
    }
    const messages = []
    const calls = []
    const results = []
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
            if (typeof event.parentSession === 'string') row.parent_session = event.parentSession
            if (typeof event.origin === 'string') row.origin = event.origin
            if (typeof event.delegationDepth === 'number') row.delegation_depth = event.delegationDepth
            if (typeof event.agentPreset === 'string') row.agent_preset = event.agentPreset
            row.is_seeded = event.isSeeded === true ? 1 : 0
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
        // A RESULT'S ID LIVES IN TWO PLACES and both are read here -- `message.toolCallId` and `message.source.callId`.
        // `lib/tool-blocks.js` documents the same rule for the composer, and pairing on one place alone is what left
        // results matched by position there.
        if (event.type === 'tool/result') {
            const message = data.message ?? {}
            const callId = String(data.callId ?? data.toolCallId ?? message.toolCallId ?? (message.source ?? {}).callId ?? '')
            const content = message.content
            const text = typeof content === 'string' ? content
                : Array.isArray(content) ? content.filter((b) => b !== null && typeof b === 'object' && b.type === 'text').map((b) => b.text ?? '').join('') : ''
            // THE CAP IS THE COMPOSER'S OWN ORDER OF MAGNITUDE, and the FULL LENGTH is stored beside it: a truncated
            // result with no length reads as a short result, which is the failure `lib/tool-blocks.js` exists to avoid.
            results.push([id, callId, text.slice(0, 8000), text.length, data.error === undefined && message.isError !== true ? 0 : 1])
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
    return { row, messages, calls, results }
}

/** Build the index. Returns what it wrote, so a caller can print it rather than assume it. */
export function buildIndex({ sessionsDir = DEFAULT_SESSIONS_DIR, out = DEFAULT_INDEX, withText = false, incremental = false, fts = true, onProgress = null } = {}) {
    const db = new DatabaseSync(out)
    db.exec('PRAGMA journal_mode = WAL;')
    // A DERIVED STORE MIGRATES BY BEING THROWN AWAY. `CREATE TABLE IF NOT EXISTS` cannot add a column -- measured here,
    // the first attempt failed with "table tool_results has no column named chars" -- and an ALTER per column would be
    // maintenance for data nobody owns. The version is read BEFORE the schema runs, and a mismatch drops the tables.
    const heldVersion = db.prepare('PRAGMA user_version').get().user_version
    const schemaMoved = heldVersion !== SCHEMA_VERSION
    if (schemaMoved) {
        db.exec('DROP TABLE IF EXISTS sessions; DROP TABLE IF EXISTS messages; DROP TABLE IF EXISTS tool_calls; '
            + 'DROP TABLE IF EXISTS tool_results; DROP TABLE IF EXISTS titles_fts; DROP TABLE IF EXISTS meta; '
            + 'DROP TABLE IF EXISTS search_fts;')
    }
    db.exec(SCHEMA)
    const heldText = db.prepare("SELECT value FROM meta WHERE key = 'text_indexed'").get()?.value ?? ''
    const modeChanged = (heldText === '1') !== withText
    const wantFts = fts && withText
    const receiptsUsable = incremental && !schemaMoved && !modeChanged
    if (!receiptsUsable) {
        db.exec('DELETE FROM sessions; DELETE FROM messages; DELETE FROM tool_calls; DELETE FROM tool_results;')
    }
    const known = new Map()
    if (receiptsUsable) {
        for (const held of db.prepare('SELECT id, mtime, bytes FROM sessions').all()) known.set(held.id, held)
    }
    // COLUMNS ARE NAMED, not positional: `mtime` was added to an existing store by ALTER, and a positional INSERT
    // then failed with "table sessions has 23 columns but 22 values were supplied". Naming them makes the next column
    // an addition rather than a breakage.
    const insertSession = db.prepare(`INSERT INTO sessions
      (id, path, format, cwd, created_at, title, title_source, title_seqs, has_title, explicit_rename, events,
       messages, asks, assistant, reasoning_chars, visible_chars, tool_calls, shadowed, high_water, bytes,
       source_sha256, indexed_at, mtime, parent_session, origin, delegation_depth, agent_preset, is_seeded)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    const insertMessage = db.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?)')
    const insertCall = db.prepare('INSERT INTO tool_calls VALUES (?,?,?,?)')
    const insertResult = db.prepare('INSERT INTO tool_results (session_id, call_id, text, chars, is_error) VALUES (?,?,?,?,?)')
    // A SESSION IS REFOLDED WHEN ITS FILE CHANGED. Appending is the only thing the harness does to a log, and it moves
    // both mtime and size, so the pair is the receipt that makes the second build cheap.
    const dropSession = db.prepare('DELETE FROM messages WHERE session_id = ?')
    const dropCalls = db.prepare('DELETE FROM tool_calls WHERE session_id = ?')
    const dropResults = db.prepare('DELETE FROM tool_results WHERE session_id = ?')
    const files = sessionFiles(sessionsDir)
    const now = new Date().toISOString()
    let done = 0
    let skipped = 0
    let ftsRebuilt0 = false
    for (const file of files) {
        const stat = statSync(file.path)
        const held = known.get(file.id)
        if (held !== undefined && held.mtime === stat.mtimeMs && held.bytes === stat.size) { skipped += 1; continue }
        let lines
        try { lines = sessionLines(file.path) } catch { continue }
        const { row, messages, calls, results } = foldSession({ ...file, text: lines.text, sha256: lines.sha256, bytes: stat.size })
        // REFOLDING REPLACES A SESSION, so every table it appears in is cleared first -- sessions, messages, calls and
        // results. Deleting the session row and then asking for it (which an earlier draft of this did) reads nothing.
        if (held !== undefined) {
            dropSession.run(file.id); dropCalls.run(file.id); dropResults.run(file.id)
            db.prepare('DELETE FROM sessions WHERE id = ?').run(file.id)
        }
        insertSession.run(row.id, row.path, row.format, row.cwd, row.created_at, row.title, row.title_source, row.title_seqs,
            row.has_title, row.explicit_rename, row.events, row.messages, row.asks, row.assistant, row.reasoning_chars,
            row.visible_chars, row.tool_calls, row.shadowed, row.high_water, row.bytes, row.source_sha256, now, stat.mtimeMs,
            row.parent_session, row.origin, row.delegation_depth, row.agent_preset, row.is_seeded)
        if (withText) for (const m of messages) insertMessage.run(...m)
        for (const c of calls) insertCall.run(...c)
        for (const r of results) insertResult.run(...r)
        done += 1
        ftsRebuilt0 = true
        if (onProgress !== null && done % 25 === 0) onProgress(done, files.length)
    }
    db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS titles_fts USING fts5(id UNINDEXED, title, cwd)')
    db.exec('DELETE FROM titles_fts')
    db.exec("INSERT INTO titles_fts(id, title, cwd) SELECT id, COALESCE(title,''), COALESCE(cwd,'') FROM sessions")
    // THE VERSION IS STAMPED LAST. Stamping it before the build marked a store that never finished as current: the next
    // run saw "same version", kept the old tables, and failed on a column that did not exist. A crash must leave the
    // version BEHIND the schema so the following run rebuilds.
    // THE MIRROR IS REBUILT FROM THE TABLES, NOT FROM THE LOGS: every searchable row is already stored, so this costs
    // one INSERT..SELECT per source instead of decoding 499 session files again. The receipt is the row counts: if the
    // mirror and the sources disagree -- or anything was refolded, which changes the sources -- it is rebuilt.
    const searchable = db.prepare(`SELECT
        (SELECT COUNT(*) FROM messages WHERE text IS NOT NULL AND text <> '')
      + (SELECT COUNT(*) FROM messages WHERE reasoning IS NOT NULL AND reasoning <> '')
      + (SELECT COUNT(*) FROM tool_results WHERE text IS NOT NULL AND text <> '')
      + (SELECT COUNT(*) FROM tool_calls WHERE args IS NOT NULL AND args <> '') AS n`).get().n
    let ftsRows = db.prepare('SELECT COUNT(*) AS n FROM search_fts').get().n
    let ftsRebuilt = false
    if (wantFts && (ftsRebuilt0 || ftsRows !== searchable)) {
        db.exec('DELETE FROM search_fts')
        db.exec(`INSERT INTO search_fts (body, session_id, source) SELECT text, session_id, 'text' FROM messages WHERE text IS NOT NULL AND text <> ''`)
        db.exec(`INSERT INTO search_fts (body, session_id, source) SELECT reasoning, session_id, 'reasoning' FROM messages WHERE reasoning IS NOT NULL AND reasoning <> ''`)
        db.exec(`INSERT INTO search_fts (body, session_id, source) SELECT text, session_id, 'tool-result' FROM tool_results WHERE text IS NOT NULL AND text <> ''`)
        db.exec(`INSERT INTO search_fts (body, session_id, source) SELECT args, session_id, 'tool-call' FROM tool_calls WHERE args IS NOT NULL AND args <> ''`)
        ftsRows = db.prepare('SELECT COUNT(*) AS n FROM search_fts').get().n
        ftsRebuilt = true
    } else if (!wantFts && ftsRows > 0) {
        db.exec('DELETE FROM search_fts')
        ftsRows = 0
        ftsRebuilt = true
    }
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
    const stamp = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')
    stamp.run('text_indexed', withText ? '1' : '0')
    stamp.run('search_mode', wantFts ? 'fts5' : 'like')
    stamp.run('fts_rows', String(ftsRows))
    stamp.run('built_at', new Date().toISOString())
    stamp.run('sessions', String(readCounts(out).sessions))
    db.close()
    // THE SUMMARY IS READ BACK FROM THE STORE, not accumulated during the walk: in an incremental run most rows were
    // never walked, so a running counter would describe the refold rather than the index.
    const counts = readCounts(out)
    return { sessions: counts.sessions, refolded: done, skipped, schemaMoved, modeChanged, ftsRebuilt, ftsRows, searchMode: wantFts ? 'fts5' : 'like', titled: counts.titled, untitled: counts.sessions - counts.titled, out }
}

// THE READ SIDE LIVES IN `lib/session-index.js`, so this script and the plugin cannot drift about a path, a column or
// a query: `findSessions`, `metaOf` and `searchSessions` are imported from there, and both callers use the same code.

const ms = (t) => `${(Number(process.hrtime.bigint() - t) / 1e6).toFixed(0)} ms`

/** What the store holds, read back rather than assumed from the number of files walked. */
export function readCounts(out = DEFAULT_INDEX) {
    const db = new DatabaseSync(out, { readOnly: true })
    const row = db.prepare('SELECT COUNT(*) sessions, SUM(has_title) titled, SUM(shadowed) shadowed, SUM(asks) asks FROM sessions').get()
    db.close()
    return { sessions: row.sessions, titled: row.titled ?? 0, shadowed: row.shadowed ?? 0, asks: row.asks ?? 0 }
}

async function main(argv) {
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
            incremental: rest.includes('--incremental'),
            // `--no-fts` builds the same store WITHOUT the mirror: a real store that searches by scan, which is how the
            // scan path stays exercised rather than assumed.
            fts: !rest.includes('--no-fts'),
            onProgress: (done, total) => process.stderr.write(`  ${done}/${total}\r`),
        })
        console.log(`${result.sessions} session(s) in the store; refolded ${result.refolded}, skipped ${result.skipped} unchanged`
            + `${result.schemaMoved ? ' (the SCHEMA moved, so every receipt was void)' : ''}`
            + `${result.modeChanged && !result.schemaMoved ? ' (the TEXT MODE changed, so every receipt was void)' : ''}`
            + `, in ${ms(started)} -> ${result.out}`)
        console.log(`  search: ${result.searchMode}${result.searchMode === 'fts5' ? `, ${result.ftsRows} mirrored row(s)${result.ftsRebuilt ? ' (rebuilt)' : ' (unchanged)'}` : ' -- no FTS5 mirror, text is matched by scan'}`)
        console.log(`  with a session/title event: ${result.titled} | without: ${result.untitled}` +
            (result.untitled > 0 ? ' (those are the ones a title service must fold per request)' : ''))
        console.log(`  size: ${(statSync(out).size / 1048576).toFixed(1)} MB`)
        return 0
    }
    if (command === 'find') {
        const term = rest.find((a) => !a.startsWith('--') && a !== flag('out', null) && a !== flag('limit', null))
        if (term === undefined) { console.error('find needs a term'); return 2 }
        const started = process.hrtime.bigint()
        const rows = await findSessions(term, { path: out, limit: Number(flag('limit', 20)) })
        console.log(`${rows.length} session(s) matching ${JSON.stringify(term)} in ${ms(started)}`)
        for (const row of rows) {
            console.log(`  ${row.id}`)
            console.log(`    title: ${row.title === null ? '(none)' : row.title}${row.title_source === null ? '' : ` [${row.title_source}]`}`)
            console.log(`    cwd:   ${row.cwd ?? '?'}`)
            console.log(`    ${row.asks} asks, ${row.messages} messages, ${row.tool_calls} tool calls, ${new Date(Number(row.created_at ?? 0)).toISOString().slice(0, 16)}`)
        }
        return 0
    }
    if (command === 'search') {
        const term = rest.find((a) => !a.startsWith('--') && a !== flag('out', null) && a !== flag('limit', null))
        if (term === undefined) { console.error('search needs a term'); return 2 }
        const started = process.hrtime.bigint()
        const found = await searchSessions(term, { path: out, limit: Number(flag('limit', 20)) })
        console.log(`${found.total} session(s) matching ${JSON.stringify(found.term)} in ${ms(started)}`
            + (found.textIndexed
                ? ` (${found.searchMode === 'fts5' ? 'FTS5 mirror' : 'LIKE scan'}: message text, reasoning, tool results and tool arguments)`
                : ' -- CONVERSATION TEXT IS NOT INDEXED in this store, so only titles, ids and directories were compared; rebuild with --text to search what was said and what tools returned'))
        for (const row of found.rows) {
            console.log(`  ${row.id}`)
            console.log(`    title: ${row.title === null || row.title === undefined ? '(none)' : row.title}`)
            console.log(`    cwd:   ${row.cwd ?? '?'}`)
            console.log(`    matched in: ${row.matchedIn}${row.hits > 0 ? ` (${row.hits} message(s))` : ''}`)
            if (row.snippet !== undefined && row.snippet !== '') console.log(`    …${row.snippet.split('\n').join(' ')}…`)
        }
        return 0
    }
    if (command === 'stats') {
        const one = readCounts(out)
        const size = (statSync(out).size / 1048576).toFixed(1)
        console.log(`${one.sessions} session(s), ${one.titled} titled, ${one.asks} asks, ${one.shadowed} shadowed message(s), ${size} MB`)
        return 0
    }
    console.error('usage: session-index.mjs build|find|search|stats [--out FILE] [--sessions DIR] [--text] [--incremental] [--limit N]')
    return 2
}

if (process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split('/').pop())) process.exit(await main(process.argv.slice(2)))
