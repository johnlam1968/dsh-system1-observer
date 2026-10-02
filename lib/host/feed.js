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
// WIRED, AND WHAT IT HOLDS. The `ctx.on('session/event', ...)` that fills this is in `index.js` (search
// `feed.record`), and `readEvents` reads it back through `feed.events()`. It once also held the harness's announced
// reaction (`claim`/`reactionFor`); an independent review called that dead surface and the repository agreed -- the
// row keeps its own copy, the only caller was the test beside it, and a second unwired holder of one fact is a thing
// a reader has to rule out. Deleted rather than wired, because the row's copy is the one its readers use.

export const DEFAULT_MAX_PER_SESSION = 500

/**
 * A bounded, per-session event holder. Pure: no host calls, no timers, never throws on junk input.
 *
 * Bounded rather than unbounded because this runs inside a listener the harness awaits: an observer that grows
 * without limit on a long session is a memory leak with a friendly name.
 */
export function createEventFeed({ maxPerSession = DEFAULT_MAX_PER_SESSION } = {}) {
    // THE CAP IS RESOLVED ON EVERY RECORD, so a settings save reaches a RUNNING row. `maxPerSession` may be a
    // function (the row passes one, because the field is volatile), a number (every test does), or junk -- in which
    // case the default stands rather than the feed growing without limit. A LOWERED cap trims on the next event; a
    // RAISED one cannot bring back what the old cap already dropped, and nothing claims otherwise.
    const capOf = () => {
        const value = typeof maxPerSession === 'function' ? maxPerSession() : maxPerSession
        return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_MAX_PER_SESSION
    }
    const held = new Map()

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
            const cap = capOf()
            if (list.length > cap) list.splice(0, list.length - cap)
            held.set(key, list)
            return true
        },
        /** The events held for one session, oldest first. An unknown session is an empty list, never undefined. */
        events(sessionId) {
            const key = keyOf(sessionId)
            return key === null ? [] : (held.get(key) ?? [])
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
            return true
        },
    }
}
