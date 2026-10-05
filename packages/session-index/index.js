// DSH-SESSION-INDEX: a session store of our own, as its own plugin.
//
// WHAT IT IS. A derived SQLite database over the harness's session logs: full-text search (FTS5 over message text,
// reasoning, tool results and tool-call arguments), title/cwd/id lookup, and an INCREMENTAL rebuild. The builder and the
// read side live in `lib/`, the command line in `bin/`, and this file is the row -- it provides the store as a service
// and nothing else, so a plugin that wants a session index depends on the capability rather than on a file path.
//
// WHY IT IS A SEPARATE PACKAGE. It imports NO dsh code at all -- only Node builtins (`node:sqlite`, `node:child_process`,
// `node:fs`, `node:os`, `node:path`, `node:url`) -- so it is a Node program with a SQLite file, and the plugin that
// measures sessions has no business owning a database. Measured on this host: 499 sessions, ~750 MB, a refresh of one
// living session in 21 s (see the repository this was extracted from for the whole cost history).
//
// WHAT IT DELIBERATELY DOES NOT DO: it never writes to a session log, and it holds no state the logs cannot recreate --
// the database is derived, droppable, and rebuilt from the sessions themselves.

import Schema from '@deepseek-ai/schemastery'
import { defaultIndexPath, findSessions, metaOf, searchSessions } from './lib/store.js'
import { refreshIndex } from './lib/refresh.js'
import { buildIndex } from './lib/build.js'

const name = 'session-index'

/** The service name a consumer injects. */
export const SESSION_INDEX_SERVICE = 'localSessionIndex'

const Config = Schema.object({
    path: Schema.string().description('The derived store. Droppable: a refresh recreates it.').default(defaultIndexPath()),
    sessionsDir: Schema.string().description('Where the harness keeps its session logs. Defaults to `$DSH_HOME/sessions`.').default(''),
    tokenizer: Schema.string().description('`trigram` (substring search, largest), `unicode61` (words), or `none` for no mirror.').default('trigram'),
})

/**
 * The capability, as an object a plugin can call.
 *
 * EXACTLY WHAT A CALLER NEEDS, AND NOTHING ABOUT HOW IT IS STORED: no SQL, no table names and no file layout cross this
 * boundary, so a consumer cannot come to depend on the schema -- which is free to change because the store is derived.
 */
export function createSessionIndex({ path = defaultIndexPath(), sessionsDir = undefined, tokenizer = 'trigram' } = {}) {
    const options = sessionsDir === '' || sessionsDir === undefined ? {} : { sessionsDir }
    return {
        path,
        /** Sessions whose text, title, id or directory matches. Reports which mechanism answered. */
        search: (term, { limit = 20 } = {}) => searchSessions(term, { path, limit }),
        /** Sessions whose TITLE, id or working directory matches. */
        find: (term, { limit = 20 } = {}) => findSessions(term, { path, limit }),
        /** What the store says about itself: `text_indexed`, `search_mode`, `tokenizer`, `fts_rows`, `sessions`. */
        meta: () => metaOf(path),
        /** Rebuild incrementally, in a CHILD process, preserving the store's own mode. */
        refresh: ({ timeoutMs = 120000 } = {}) => refreshIndex({ out: path, ...options, timeoutMs }),
        /** Rebuild in THIS process. For a script or a migration, not for a request path: it can take minutes. */
        build: ({ withText = true, incremental = false, tokenizer: wanted = tokenizer } = {}) =>
            buildIndex({ out: path, withText, incremental, tokenizer: wanted, ...options }),
    }
}

function apply(ctx, config) {
    const service = createSessionIndex({
        path: config?.path ?? defaultIndexPath(),
        sessionsDir: config?.sessionsDir ?? undefined,
        tokenizer: config?.tokenizer ?? 'trigram',
    })
    // PROVIDED, NOT SET: a consumer may inject it, and one that does not is unaffected.
    ctx.provide(SESSION_INDEX_SERVICE, service)
}

export { name, Config, apply }
