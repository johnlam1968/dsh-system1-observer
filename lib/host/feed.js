// THE LIVE EVENT FEED, TAKEN FROM THE HARNESS RATHER THAN POLLED FROM THE SESSION.
//
// WHY THIS EXISTS. `readEvents` currently asks the live session for its events (`agent.session.snapshotEvents()`)
// at the moment a turn is judged. The harness publishes the same thing as it commits it:
//
//   'session/event'(this: Scoped<Session>, session: Session, event: SessionEvent): void      // emit
//
// so the adapter can keep the events rather than ask for them. Two consequences the plan depends on: the feed is
// available for a session that is NOT live (the reason a scope pointing at a closed session went inert), and it is
// the same ordered stream the log records, surface ops included.
//
// WHAT THIS IS NOT. It is not a fold -- `lib/host/surface.js` applies the surface ops. This holds events; that
// decides which of them the model actually saw.
//
// THIS FILE IS THE ADAPTER SEAM, with the fold beside it. `sessionQuery` answers both questions authoritatively
// (`readSession` for the log, `readSurface` for the surface); when the plugin is wired to that, these two modules
// are the ones to delete.
//
// NOT YET WIRED TO A LISTENER. This commit adds the holder and its behaviour; the `ctx.on('session/event', ...)`
// that fills it, and the `readEvents` that reads it, are the next commit. Until then nothing populates it -- said
// plainly rather than implied, because a module with no caller is a capability nobody has.

const DEFAULT_MAX_PER_SESSION = 500

/**
 * A bounded, per-session event holder. Pure: no host calls, no timers, never throws on junk input.
 *
 * Bounded rather than unbounded because this runs inside a listener the harness awaits: an observer that grows
 * without limit on a long session is a memory leak with a friendly name.
 */
export function createEventFeed({ maxPerSession = DEFAULT_MAX_PER_SESSION } = {}) {
    const cap = Number.isFinite(maxPerSession) && maxPerSession > 0 ? Math.floor(maxPerSession) : DEFAULT_MAX_PER_SESSION
    const held = new Map()
    const claimed = new Map()

    const keyOf = (sessionId) => (typeof sessionId === 'string' && sessionId !== '' ? sessionId : null)

    return {
        /** One committed session event. Ignored when it cannot be attributed or is not an object. */
        record(sessionId, event) {
            const key = keyOf(sessionId)
            if (key === null) return false
            if (event === null || typeof event !== 'object') return false
            const list = held.get(key) ?? []
            list.push(event)
            // Drop from the FRONT: the composer reads the newest turns, so the oldest events are the cheapest to lose.
            if (list.length > cap) list.splice(0, list.length - cap)
            held.set(key, list)
            return true
        },
        /** The events held for one session, oldest first. An unknown session is an empty list, never undefined. */
        events(sessionId) {
            const key = keyOf(sessionId)
            return key === null ? [] : (held.get(key) ?? [])
        },
        /** The operator message the harness announced entering a turn -- the reaction, as a fact rather than a search. */
        claim(sessionId, turn, message) {
            const key = keyOf(sessionId)
            if (key === null || message === null || typeof message !== 'object') return false
            claimed.set(key, { turn: typeof turn === 'number' ? turn : null, message })
            return true
        },
        /** The newest announced reaction for one session, or null. */
        reactionFor(sessionId) {
            const key = keyOf(sessionId)
            return key === null ? null : (claimed.get(key) ?? null)
        },
        size(sessionId) {
            const key = keyOf(sessionId)
            return key === null ? 0 : (held.get(key) ?? []).length
        },
        /** For tests and for a session that ends: nothing is retained past this. */
        clear(sessionId) {
            const key = keyOf(sessionId)
            if (key === null) return false
            held.delete(key)
            claimed.delete(key)
            return true
        },
    }
}
