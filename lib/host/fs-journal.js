// WHAT THE FILESYSTEM ACTUALLY DID, recorded from the harness's own observations.
//
// WHY THIS EXISTS. Two of the plugin's questions read as accusations it cannot support: `done_claim_without_tool_evidence`
// and `specific_detail_absent_from_state`. Both are about whether what the agent SAID matches what happened, and the
// trace has never carried the one record that could settle it -- what was actually observed on disk.
//
//   'fs/observed'(target: { targetKey, displayPath }, observation: { kind: 'present', version } | { kind: 'absent' },
//                 actor: object | undefined): void
//
// THE CONTRACT ADDS A CONSTRAINT THAT CHANGES THE STAKES, quoted from the harness's own declaration: "Listeners must
// be synchronous recorders: THROWS FAIL THE TOOL CALL and returned promises are not awaited." So a bug in this
// listener does not damage the plugin's record -- it BREAKS THE AGENT'S FILESYSTEM CALL. Hence: synchronous, every
// access guarded, and it returns nothing.
//
// `actor` IS KEPT AS AN OPAQUE KEY, NOT INTERPRETED. Its only description is "the observing tool-execution context",
// and no field of it is in the contract; reading `.id` off it would be a guess of exactly the kind that has cost
// this plugin the most rounds. The object identity is held so a later step can correlate it once the shape is known.
//
// THIS FILE IS THE ADAPTER SEAM, like surface.js and feed.js: it reads one host signal and holds it in the shape the
// composer needs.

export const DEFAULT_MAX_PATHS = 200
export const DEFAULT_MAX_PER_PATH = 4

/**
 * A bounded, synchronous journal of filesystem observations, keyed by display path.
 *
 * Bounded twice -- by path and by observations per path -- because it is fed by an emit listener in a long-running
 * session, and an observer that grows without limit is a memory leak with a friendly name.
 */
export function createFsJournal({ maxPaths = DEFAULT_MAX_PATHS, maxPerPath = DEFAULT_MAX_PER_PATH } = {}) {
    // RESOLVED ON EVERY RECORD, like the event feed's cap and for the same reason: both fields are volatile, so a
    // settings save has to reach a running journal. The names are not the parameter names because `paths()` is
    // already this journal's own accessor -- the resolution is `capPaths`/`capPer`.
    const resolve = (value, fallback) => {
        const candidate = typeof value === 'function' ? value() : value
        return Number.isFinite(candidate) && candidate > 0 ? Math.floor(candidate) : fallback
    }
    const capPaths = () => resolve(maxPaths, DEFAULT_MAX_PATHS)
    const capPer = () => resolve(maxPerPath, DEFAULT_MAX_PER_PATH)
    const byPath = new Map()

    return {
        /**
         * One observation. NEVER THROWS: this runs inside a listener whose throw fails an agent's tool call, so it
         * fails quietly and returns false instead. Returns true when something was recorded.
         */
        record(target, observation, actor) {
            try {
                const path = typeof target?.displayPath === 'string' && target.displayPath !== '' ? target.displayPath : null
                if (path === null) return false
                const kind = observation?.kind === 'absent' ? 'absent' : observation?.kind === 'present' ? 'present' : null
                if (kind === null) return false
                const list = byPath.get(path) ?? []
                list.push({ kind, at: Date.now(), actor: actor ?? null, version: kind === 'present' ? String(observation?.version ?? '') : null })
                const perLimit = capPer()
                if (list.length > perLimit) list.splice(0, list.length - perLimit)
                byPath.set(path, list)
                // A WHILE, NOT AN IF. One deletion per record let the journal sit at cap+1, and when a LIVE-LOWERED cap
                // arrived it converged only as fast as new paths were touched -- so the live cap was approximately
                // true, which is the kind of "approximately" this repository keeps finding. The bound is exact now,
                // which is what makes "a lowered cap applies on the next record" a statement rather than a hope.
                // Found by the test for the live cap: it asserted the cap held, and the code disagreed.
                while (byPath.size > capPaths()) {
                    const oldest = byPath.keys().next()
                    if (oldest.done) break
                    byPath.delete(oldest.value)
                }
                return true
            } catch {
                return false
            }
        },
        /** Every observation of one path, oldest first. An unknown path is an empty list, never undefined. */
        observationsFor(displayPath) {
            try {
                return typeof displayPath === 'string' ? (byPath.get(displayPath) ?? []) : []
            } catch {
                return []
            }
        },
        /** The NEWEST verdict for one path -- 'present', 'absent', or null when nothing was observed. */
        verdictFor(displayPath) {
            const list = this.observationsFor(displayPath)
            return list.length === 0 ? null : list[list.length - 1].kind
        },
        paths() {
            return [...byPath.keys()]
        },
        size() {
            return byPath.size
        },
        clear() {
            byPath.clear()
        },
    }
}
