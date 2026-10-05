// THE DSH SESSION SURFACE, IN ONE PLACE: what a session's events ARE, which of them survive, and what has been seen.
//
// WHY IT IS A PACKAGE RATHER THAN `lib/host/`. Every file here is a PURE MODULE -- the host inventory calls them
// ADAPTER_MODULES and checks that they contain no host call at all -- so they are the half of the session adapter that
// must be IMPORTABLE rather than merely injectable. Measured (`F104`): the composer runs inside a path that cannot
// await a Cordis service, so a plugin whose only surface were a service could not serve it.
//
// TWO FORMS, ONE IMPLEMENTATION: the functions above are IMPORTABLE (which the in-band path requires -- `F104`), and
// the same functions are provided as a SERVICE (`ctx.sessionAdapter`) for a consumer that injects rather than imports.
// The host arrives as a PARAMETER either way, so nothing here calls `ctx` and the inventory can assert that.
//
// The three modules, and the question each answers:
//   session-format  what a session event IS -- the harness's vocabulary in one home, so no reader invents its own;
//   surface         which events are in the model's surface, folded from the `surfaceOp: replace` spans in hand (the
//                   FALLBACK for a deployment with no `sessionQuery`; `lib/surface-authority.js` asks the host first);
//   feed            what has been SEEN per session, bounded -- an in-band record, not a fold.

export * from './lib/session-format.js'
export { surfaceEvents } from './lib/surface.js'
export { createEventFeed, DEFAULT_MAX_PER_SESSION } from './lib/feed.js'
export { DEFAULT_KINDS, SUBJECT_KINDS, coverageOf, eventTypesOf, listStoredSessions, readStoredSubject, searchStoredSessions, sliceEvents } from './lib/reader.js'
export { currentSurfaceSeqs } from './lib/surface-authority.js'

/** The row's name, for the Loader and for the plugin manager. */
const name = 'session-adapter'

import Schema from '@deepseek-ai/schemastery'
import { currentSurfaceSeqs } from './lib/surface-authority.js'
import {
    DEFAULT_KINDS, SUBJECT_KINDS, coverageOf, eventTypesOf, listStoredSessions, readStoredSubject, searchStoredSessions, sliceEvents,
} from './lib/reader.js'

/** The service name a consumer injects. */
export const SESSION_ADAPTER_SERVICE = 'sessionAdapter'

/**
 * The package as a row.
 *
 * IT HAS NO KNOBS ON PURPOSE. The window (`kinds`, `lastMessages`, `offset`) is the CALLER's decision -- it is what a
 * measurement asks for, not how the adapter is deployed -- and the data comes from the host. A config here would only
 * be a place for a setting to hide.
 */
const Config = Schema.object({})

/**
 * The capability, over whatever `sessionQuery` the deployment has.
 *
 * `getQuery` is a FUNCTION rather than a service reference because the host service may mount AFTER this row: the
 * observer learned that the hard way (`lib/config-event.js` records the class), so every method reads it at call time.
 * A deployment with no `sessionQuery` is not broken by it -- `readSession` answers with a named problem, `search`
 * returns null, and `currentSurfaceSeqs` returns null, which is what leaves the fold in charge.
 */
export function createSessionAdapter({ getQuery = () => undefined } = {}) {
    const query = () => getQuery()
    return {
        // THE HOST-BACKED READS
        readSession: (sessionId, options = {}) => readStoredSubject({ sessionQuery: query(), sessionId, ...options }),
        listSessions: () => listStoredSessions(query()),
        currentSurfaceSeqs: (sessionId) => currentSurfaceSeqs(query(), sessionId),
        /** The host's own full-text search, or `null` when this deployment has no index to search. */
        search: (request = {}) => searchStoredSessions(query(), request),
        /** WHICH OF THE TWO ANSWERS A CALLER WILL GET, so "no host" is never read as "no results". */
        available: () => typeof query()?.readSession === 'function',
        // THE VOCABULARY AND THE PURE RULES, so a consumer that injects needs no second import to read what it got
        SUBJECT_KINDS,
        DEFAULT_KINDS,
        eventTypesOf,
        sliceEvents,
        coverageOf,
    }
}

function apply(ctx, _config) {
    ctx.provide(SESSION_ADAPTER_SERVICE, createSessionAdapter({
        getQuery: () => (typeof ctx.get === 'function' ? ctx.get('sessionQuery') : undefined),
    }))
}

export { name, Config, apply }
