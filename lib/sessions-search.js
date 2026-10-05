// THE SEARCH ACTION, AND ITS TWO BACKENDS -- one home for "where did this answer come from".
//
// WHY IT IS ITS OWN MODULE. The action has two sources: the harness's own session index
// (`sessionQuery.searchSessions`, which stays current and ranks) and the hand-rolled store this repository builds
// (`lib/session-index.js`, which exists because this deployment leaves that index at `openAt: never` -- `F98`). Two
// backends with a precedence rule and a provenance duty are a policy, not a line in a tool's dispatch, and the tool
// file is over its declared size budget without them.
//
// THE RULE: the harness's index first; the hand-rolled store second; and **which one answered is always stated**. The
// first backend's failure is carried as a problem rather than hidden by the second, because an answer that does not
// say where it came from is the substitution this register keeps recording. `textIndexed: false` is part of that
// honesty: a store built without `--text` holds no conversation text at all, and a reader must not take its "no
// matches" for "the phrase is not in the library".

import { searchLocalIndex } from './session-index.js'

/**
 * Answer one `search` action.
 *
 * @param query      the phrase, as the caller wrote it; passed to the harness as DATA
 * @param limit      how many sessions to return
 * @param service    the mounted `sessionQuery` service, or undefined
 * @param titlesFor  `(ids) => Promise<Map<id, title>>` -- the harness's title reader, supplied by the caller so this
 *                   module needs no opinion about how titles are fetched
 * @param indexPath  the hand-rolled store to read, or null for its default location
 * @returns the complete value a tool returns: `{action, query, usedService, count, total, sessions, problems, ...}`
 */
export async function runSearch({ query, limit, service, titlesFor, indexPath = null } = {}) {
    const problems = []
    let fromService = null
    if (typeof service?.searchSessions === 'function') {
        try {
            const page = await service.searchSessions({ query, limit })
            const hits = Array.isArray(page?.items) ? page.items : []
            const titles = await titlesFor(hits.map((hit) => String(hit?.header?.id ?? '')).filter((id) => id !== ''))
            fromService = []
            for (const hit of hits) {
                const id = String(hit?.header?.id ?? '')
                if (id === '') continue
                const row = { id, live: hit?.live === true, persisted: hit?.persisted === true }
                if (hit?.header?.cwd !== undefined) row.cwd = String(hit.header.cwd)
                if (hit?.header?.createdAt !== undefined) row.createdAt = Number(hit.header.createdAt)
                if (titles.has(id)) row.title = titles.get(id)
                if (typeof hit?.bestMatch?.snippet === 'string') row.snippet = hit.bestMatch.snippet
                fromService.push(row)
            }
        } catch (error) {
            problems.push('the harness session index did not answer: ' + (error instanceof Error ? error.message : String(error)))
        }
    } else {
        problems.push('the mounted session-query service has no `searchSessions`')
    }
    if (fromService !== null) {
        return { action: 'search', query, usedService: 'searchSessions (the harness index)', count: fromService.length, total: fromService.length, sessions: fromService, problems: [] }
    }
    const local = await searchLocalIndex(query, indexPath === null ? { limit } : { path: indexPath, limit })
    if (local.problem !== undefined) {
        problems.push(local.problem)
        return { action: 'search', query, textIndexed: false, usedService: 'none', count: 0, total: 0, sessions: [], problems }
    }
    return {
        action: 'search',
        query,
        usedService: `session-index (hand-rolled, read side${local.searchMode === undefined ? '' : ', ' + local.searchMode.toUpperCase()})`,
        textIndexed: local.textIndexed === true,
        indexPath: local.path,
        count: local.rows.length,
        total: local.total,
        sessions: local.rows,
        problems,
    }
}
