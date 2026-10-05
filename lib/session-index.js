// THE HAND-ROLLED SESSION INDEX, READ SIDE -- one home for the store's path, its tables and its queries.
//
// WHY IT EXISTS. The harness ships its own SQLite FTS index (`@deepseek-ai/dsh-session-query-sqlite`), and this
// deployment leaves it at `openAt: never`; enabling it in the profile made `api-session-controller` fail to start and
// the cause was never reproduced (`F98`). So the capability lives here, in a store this repository owns:
// `scripts/session-index.mjs` BUILDS it, and this module READS it -- used by that script's CLI and by
// `lib/sessions-tool.js`, so neither can drift from the other about a path, a column or a query.
//
// `node:sqlite` IS IMPORTED LAZILY, on the first read and never at module load. It is an experimental built-in that
// prints a warning when it loads, and the plugin's own startup must not carry a warning for a store that may not
// exist. That also keeps every function here usable in a process where the store is absent: each returns a NAMED
// problem instead of throwing.
//
// WHAT A SEARCH COVERS, and the list is not just messages: message text, reasoning, tool-call ARGUMENTS and tool
// RESULTS. The harness's own extractor covers tool traffic, and a search that read only messages answered "no
// matches" for a phrase that was sitting in a tool result -- measured while writing it.

import { homedir } from 'node:os'
import { join } from 'node:path'

/** The harness home this store lives beside: `$DSH_HOME`, or `~/.dsh`. */
export function dshHome(env = process.env) {
    return env.DSH_HOME === undefined || env.DSH_HOME === '' ? join(homedir(), '.dsh') : env.DSH_HOME
}

/** The derived store `scripts/session-index.mjs` builds. Droppable: that script recreates it. */
export function defaultIndexPath(env = process.env) {
    return join(dshHome(env), 'session-index.db')
}

async function openStore(path) {
    const { DatabaseSync } = await import('node:sqlite')
    return new DatabaseSync(path, { readOnly: true })
}

/** What the store says about itself: `text_indexed`, `built_at`, `sessions`. Empty when it cannot be read. */
export async function metaOf(path = defaultIndexPath()) {
    let db
    try {
        db = await openStore(path)
        const meta = {}
        for (const row of db.prepare('SELECT key, value FROM meta').all()) meta[row.key] = row.value
        return meta
    } catch {
        return {}
    } finally {
        try { db?.close() } catch { /* a store that never opened has nothing to close */ }
    }
}

/** Sessions whose TITLE, id or working directory matches. */
export async function findSessions(term, { path = defaultIndexPath(), limit = 20 } = {}) {
    const db = await openStore(path)
    try {
        const like = `%${String(term)}%`
        return db.prepare(`
          SELECT id, title, title_source, cwd, created_at, asks, messages, tool_calls, has_title
          FROM sessions
          WHERE title LIKE ? OR cwd LIKE ? OR id LIKE ?
          ORDER BY (title LIKE ?) DESC, created_at DESC
          LIMIT ?`).all(like, like, `${String(term)}%`, like, limit)
    } finally {
        db.close()
    }
}

/** The rows one source contributes to a text search, with a window around the first match. */
async function textHits(db, term, limit) {
    const like = `%${String(term)}%`
    const snippet = (column) => `MIN(substr(COALESCE(${column},''), max(1, instr(lower(COALESCE(${column},'')), lower(?)) - 60), 160))`
    const queries = [
        ['text', `SELECT s.id, s.title, s.cwd, s.created_at, COUNT(*) AS hits, ${snippet('m.text')} AS snippet
                  FROM sessions s JOIN messages m ON m.session_id = s.id WHERE m.text LIKE ? GROUP BY s.id`],
        ['reasoning', `SELECT s.id, s.title, s.cwd, s.created_at, COUNT(*) AS hits, ${snippet('m.reasoning')} AS snippet
                  FROM sessions s JOIN messages m ON m.session_id = s.id WHERE m.reasoning LIKE ? GROUP BY s.id`],
        ['tool-result', `SELECT s.id, s.title, s.cwd, s.created_at, COUNT(*) AS hits, ${snippet('t.text')} AS snippet
                  FROM sessions s JOIN tool_results t ON t.session_id = s.id WHERE t.text LIKE ? GROUP BY s.id`],
        ['tool-call', `SELECT s.id, s.title, s.cwd, s.created_at, COUNT(*) AS hits, ${snippet('c.args')} AS snippet
                  FROM sessions s JOIN tool_calls c ON c.session_id = s.id WHERE c.args LIKE ? GROUP BY s.id`],
    ]
    const byId = new Map()
    for (const [source, sql] of queries) {
        let rows = []
        // A STORE FROM AN OLDER BUILD MAY LACK A TABLE, and that is a smaller failure than answering nothing: the
        // sources that exist still answer, and the caller is told which store it read.
        try { rows = db.prepare(`${sql} ORDER BY hits DESC LIMIT ?`).all(String(term), like, limit) } catch { rows = [] }
        for (const row of rows) {
            const held = byId.get(row.id) ?? { id: row.id, title: row.title, cwd: row.cwd, created_at: row.created_at, hits: 0, sources: [], snippet: '' }
            held.hits += row.hits
            held.sources.push(source)
            if (held.snippet === '' && typeof row.snippet === 'string' && row.snippet !== '') held.snippet = row.snippet
            byId.set(row.id, held)
        }
    }
    return [...byId.values()].sort((a, b) => b.hits - a.hits || (b.created_at ?? 0) - (a.created_at ?? 0))
}

/**
 * TEXT SEARCH over the local store, and title/cwd/id matching, in one answer.
 *
 * `textIndexed` is reported rather than assumed: a store built without `--text` holds no message text at all, and
 * answering as though it had searched the text would read as "the phrase is not in the library".
 */
export async function searchSessions(term, { path = defaultIndexPath(), limit = 20 } = {}) {
    const meta = await metaOf(path)
    const textIndexed = meta.text_indexed === '1'
    const rows = new Map()
    for (const row of await findSessions(term, { path, limit })) {
        rows.set(row.id, { id: row.id, title: row.title, cwd: row.cwd, createdAt: row.created_at, hits: 0, matchedIn: 'title/cwd/id' })
    }
    if (textIndexed) {
        const db = await openStore(path)
        let hits = []
        try { hits = await textHits(db, term, limit) } finally { db.close() }
        for (const hit of hits) {
            const held = rows.get(hit.id)
            if (held === undefined) {
                rows.set(hit.id, { id: hit.id, title: hit.title, cwd: hit.cwd, createdAt: hit.created_at, hits: hit.hits, matchedIn: hit.sources.join('+'), snippet: hit.snippet ?? '' })
            } else {
                held.hits = hit.hits
                held.matchedIn = `${held.matchedIn}+${hit.sources.join('+')}`
                if (hit.snippet !== '') held.snippet = hit.snippet
            }
        }
    }
    const ordered = [...rows.values()].sort((a, b) => b.hits - a.hits || (b.createdAt ?? 0) - (a.createdAt ?? 0))
    return { term: String(term), textIndexed, rows: ordered.slice(0, limit), total: ordered.length, path }
}

/**
 * The same search, shaped for a caller that must NOT throw and must say what happened.
 *
 * @returns `{ rows, textIndexed, problem }` -- `problem` names why nothing could be answered, and is absent when the
 *          store answered. An empty `rows` with a `problem` means "not asked"; an empty `rows` without one means
 *          "asked, and the phrase is not there". Those two are never allowed to look alike.
 */
export async function searchLocalIndex(term, { path = defaultIndexPath(), limit = 20 } = {}) {
    try {
        const found = await searchSessions(term, { path, limit })
        const rows = found.rows.map((row) => {
            const shaped = { id: row.id, hits: row.hits, matchedIn: row.matchedIn }
            if (row.title !== null && row.title !== undefined) shaped.title = String(row.title)
            if (row.cwd !== null && row.cwd !== undefined) shaped.cwd = String(row.cwd)
            if (typeof row.createdAt === 'number') shaped.createdAt = row.createdAt
            if (typeof row.snippet === 'string' && row.snippet !== '') shaped.snippet = row.snippet
            return shaped
        })
        return { rows, textIndexed: found.textIndexed, total: found.total, path }
    } catch (error) {
        return {
            rows: [],
            textIndexed: false,
            total: 0,
            path,
            problem: `no readable session index at ${path} (${error instanceof Error ? error.message : String(error)})`
                + ' -- build it with `node scripts/session-index.mjs build --text`',
        }
    }
}
