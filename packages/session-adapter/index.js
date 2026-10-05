// THE DSH SESSION SURFACE, IN ONE PLACE: what a session's events ARE, which of them survive, and what has been seen.
//
// WHY IT IS A PACKAGE RATHER THAN `lib/host/`. Every file here is a PURE MODULE -- the host inventory calls them
// ADAPTER_MODULES and checks that they contain no host call at all -- so they are the half of the session adapter that
// must be IMPORTABLE rather than merely injectable. Measured (`F104`): the composer runs inside a path that cannot
// await a Cordis service, so a plugin whose only surface were a service could not serve it.
//
// WHAT IS NOT HERE YET, and it is the other half of (d) in the plan: the `sessionQuery`-backed reads (live sessions,
// the current surface, titles). Those CALL the host, so they belong to the adapter's plugin half, where a deployment
// can see them in `lib/host/index.js`'s inventory.
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
