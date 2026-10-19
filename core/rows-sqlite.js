// THE NORMALIZED ROWS, READ BACK OUT OF A SQLITE INDEX.
//
// The other two readers are JSONL and a producer in-process. This one exists because FINDING a session and MEASURING
// it are different problems with different costs: `dsh-session-index` answers "which sessions" in a query, where
// walking a directory of logs does not, and the gap between those two is where the slow path lives. So the same rows
// have to come out of the index that went into the log, or a measurement taken from the index would not be comparable
// with one taken from the file.
//
// IT IS ITS OWN FILE FOR ONE REASON: `node:sqlite` prints an ExperimentalWarning on import, and the routes that never
// touch a database should not pay for it. `scripts/ask.mjs` reaches this by a DYNAMIC import on the `--from-sqlite`
// path only, which keeps `--list`, `--state` and `--file` as quiet as they were.
//
// THE COLUMNS ARE NAMED, NEVER POSITIONAL. `dsh-session-index`'s own `messages` row is positional and inserting a
// column there shifted `shadowed` from index 7 to 8 without the code that wrote it noticing -- a corruption its own
// suite agreed with, because the test used the same wrong index. A reader written against column NAMES cannot be
// broken that way by a producer adding a column, and that asymmetry is the whole argument for names.

import { DatabaseSync } from 'node:sqlite'

/** The session table's columns this reader needs, and nothing more. */
const SESSION_COLUMNS = 'id, format, path, bytes, source_sha256, high_water, created_at, cwd'

/**
 * THE INDEX NAMES THE HARNESS IN ITS OWN WORD, and the contract has no such word.
 *
 * `dsh-session-index` writes a `role` of `harness` for every event that is not a human message and not an assistant
 * message -- a goal, a skill catalogue, a runtime context, an agent instruction. Those are real messages: they were on
 * the surface and the agent read them. But `core/session-rows.js` allows `user`, `assistant`, `system`, `developer`
 * and `tool`, and it is right to: a role is a claim about who spoke, and the harness speaking IS the system.
 *
 * So the reader translates, and the translation is the same one the log producer makes -- a harness-sourced
 * `user/message` is `system` there too, which is what makes a measurement taken from the index comparable with one
 * taken from the file. An index built before the `exchange` column existed cannot be read at all; an index that
 * carries a role this reader does not recognise is passed through unchanged, so the CONTRACT names it rather than
 * this reader inventing a meaning for it.
 */
const ROLE_OF_INDEX = new Map([['harness', 'system']])

/** The index's role, in the contract's vocabulary. */
function roleOfIndex(role) {
    if (role === null || role === undefined) return null
    return ROLE_OF_INDEX.get(role) ?? role
}

/**
 * Read one session out of an index, as normalized rows.
 *
 * @param {string} path  the `.db` file
 * @param {string} sessionId
 * @returns {{ rows: object[], receipt: object|null, problem: string|null }}
 */
export function rowsFromSqlite(path, sessionId) {
    let db
    try {
        db = new DatabaseSync(path, { readOnly: true })
    } catch (error) {
        return { rows: [], receipt: null, problem: `could not open ${path}: ${error.message}` }
    }
    try {
        // WHAT THIS INDEX ACTUALLY HAS. Naming a column protects against a producer ADDING one -- the rows here cannot
        // be broken by a reordering, which is the corruption `dsh-session-index` had when `exchange` was inserted at
        // index 3 and `shadowed` stayed at 7. It does NOT protect against a column being ABSENT: `SELECT seq, turn,
        // exchange` against an index built before `exchange` existed raises "no such column" and takes the reader with
        // it. So the shape is asked for rather than assumed, and a missing field is reported as null -- which the rows
        // contract then names, instead of the reader inventing a boundary it cannot see.
        const columnsOf = (table) => new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name))
        const has = (set, name) => set.has(name)
        const messageColumns = columnsOf('messages')
        const hasTable = (name) => db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name) !== undefined
        const hasTurns = hasTable('turns')
        const hasCalls = hasTable('tool_calls')

        const session = db.prepare(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE id = ?`).get(sessionId)
        if (session === undefined) {
            // A SESSION THAT IS NOT THERE IS NOT AN EMPTY SESSION. The two read identically downstream -- both produce
            // rows a measurement would find nothing in -- and one of them means the index is stale.
            return { rows: [], receipt: null, problem: `no session ${sessionId} in ${path}: the index may not have been rebuilt` }
        }
        const messages = db.prepare(
            `SELECT seq, ${has(messageColumns, 'turn') ? 'turn' : 'NULL AS turn'}, ${has(messageColumns, 'exchange') ? 'exchange' : 'NULL AS exchange'}, role, kind, text, reasoning, shadowed FROM messages WHERE session_id = ? ORDER BY seq`,
        ).all(sessionId)
        const calls = hasCalls
            ? db.prepare('SELECT seq, call_id, name, args FROM tool_calls WHERE session_id = ? ORDER BY seq').all(sessionId)
            : []
        const turns = hasTurns ? db.prepare('SELECT ordinal FROM turns WHERE session_id = ? ORDER BY ordinal').all(sessionId) : []

        // THE RECEIPT IS THE INDEX'S, not the file's. `source_sha256` and `high_water` describe what was INDEXED, and
        // that is the evidence a measurement made from this reader rests on -- so it is carried through unaltered
        // rather than recomputed from something that is not here.
        const receipt = {
            kind: 'receipt',
            harness: session.format === null || session.format === undefined ? 'unknown' : `dsh:${session.format}`,
            id: session.id,
            source: session.path,
            sourceBytes: session.bytes ?? null,
            sourceSha256: session.source_sha256 ?? null,
            highWater: session.high_water ?? null,
            schemaVersion: 1,
            // WHERE THESE ROWS CAME FROM, which is not the same as where the conversation happened. A reader that
            // cannot tell the two will describe a stale index as a current conversation.
            indexedFrom: path,
            exchanges: turns.length,
            // WHAT THIS INDEX COULD NOT SUPPLY. A reader that silently returned nulls for a field it never asked for
            // would produce a measurement of the wrong thing with nothing in it saying so.
            missing: [
                ...(has(messageColumns, 'exchange') ? [] : ['messages.exchange']),
                ...(hasTurns ? [] : ['turns']),
                ...(hasCalls ? [] : ['tool_calls']),
            ],
        }
        const rows = [receipt]
        for (const row of messages) {
            rows.push({
                kind: 'message',
                seq: row.seq ?? null,
                exchange: row.exchange ?? null,
                ordinal: rows.length,
                role: roleOfIndex(row.role) ?? null,
                type: 'text',
                // THE TEXT IS TRIMMED HERE, and not because the index stores it that way. The rows contract says the
                // text of a message is trimmed, and this reader PRODUCES rows -- so it obeys the contract itself, and an
                // index built before the rule existed cannot hand it a row that breaks it. The store's own producer
                // trims too, so the two agree; and a stale index is corrected at the boundary rather than refused at
                // the door, which would take the whole `--from-sqlite` route down for a whitespace.
                // AND THE TYPE IS CHECKED, because SQLite is dynamically typed and a value that is not text would make
                // `.trim()` THROW -- and this reader has no catch, so the error would escape it rather than become the
                // `problem` string every other failure here becomes. A reader that cannot read a column says so; it
                // does not throw at the caller.
                text: typeof row.text === 'string' ? row.text.trim() : '',
                // NULL, NOT ''. An empty string and an absent answer are different facts, and the rows contract
                // refuses the one that conflates them.
                reasoning: typeof row.reasoning !== 'string' || row.reasoning === '' ? null : row.reasoning.trim(),
                shadowed: row.shadowed === 1,
                // THE INDEX DOES NOT CARRY THIS, so the reader does not know it -- and `null` is how a row says "nobody
                // told me", where `false` would be a claim that the message was not interrupted. The producer knows; the
                // index has no column for it; and the difference between "not interrupted" and "not known" is the one
                // the contract calls absence.
                interrupted: null,
            })
        }
        // A TOOL CALL BELONGS TO THE GROUP OF THE MESSAGE BEFORE IT, and the index does not store that: `tool_calls`
        // carries no exchange column. So it is derived here, by the same rule the group itself uses -- everything after
        // an ask belongs to it until the next ask -- and a call before the first ask joins group 0 for the reason the
        // producer does. A null here would be a row in no group, which the contract now refuses.
        const exchangeAtOrBefore = (seq) => {
            let found = 0
            for (const row of messages) {
                if (typeof row.seq !== 'number' || typeof seq !== 'number') continue
                if (row.seq <= seq && row.exchange !== null && row.exchange !== undefined) found = row.exchange
            }
            return found
        }
        for (const call of calls) {
            rows.push({
                kind: 'tool_call',
                seq: call.seq ?? null,
                exchange: exchangeAtOrBefore(call.seq ?? 0),
                callId: call.call_id ?? null,
                name: call.name ?? null,
                args: call.args ?? null,
                result: null,
                outcome: null,
            })
        }
        return { rows, receipt, problem: null }
    } finally {
        db.close()
    }
}
