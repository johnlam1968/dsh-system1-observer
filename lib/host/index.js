// THE HOST SURFACE THIS PLUGIN DEPENDS ON -- in one place, so porting is a task with a list rather than an
// archaeology exercise.
//
// THE PRINCIPLE, stated by the operator: a plugin to a harness should be a thin adapter over that harness's surface.
// Moving to another harness means finding THAT harness's services and events and re-deriving this file -- not carrying
// a private engine across.
//
// IT IS CHECKED, NOT ASPIRATIONAL: test/host-inventory.test.js greps the source for every `ctx.get(...)`,
// `inject([...])` and `ctx.on(...)` and fails if a literal one is not declared here.
//
// THREE TIERS, BECAUSE THE CODE HAS THREE SHAPES:
//   HOST_SERVICES / HOST_EVENTS   reached by LITERAL; checked strictly in both directions.
//   HOST_SYMBOL_REACHED           reached through a CONSTANT, a VARIABLE, or a TABLE. No regex can resolve these,
//                                 so they are declared with the file and symbol naming them. A check that cannot see
//                                 them must not silently claim they do not exist.
//   ADAPTER_MODULES               the pure modules; checked for containing NO host call at all.
//
// TWO SCANNER BUGS FOUND THE HARD WAY, both in the check that reads this list: the first version scanned `lib/*.js`
// only, so `lib/model/service.js` was invisible; and every extractor used `[A-Za-z]+`, which CANNOT MATCH `system1`
// -- a service name with a digit in it -- so the one dependency that mattered was hidden by a character class.

/** Services reached by literal name, and what each is for. */
export const HOST_SERVICES = Object.freeze({
    agents: 'the live sessions, and the session object the composer reads events from',
    sessionQuery: 'the authoritative session log and surface -- OPTIONAL access, and the ORACLE the fold is checked against',
    tools: 'registering the three tools (trace, decide, observe_config)',
    configEditor: 'the settings tool writing a knob back to the profile',
    system1: 'the decision model, when the profile mounts one; the wire is the fallback',
    tokenMeter: "the SUBJECT's context pressure -- what the observed agent spent",
    workspaceChanges: 'what the files changed, addressed by a workspace/changes event seq',
})

/** Events reached by literal name, and what each is for. */
export const HOST_EVENTS = Object.freeze({
    'session/event': 'the live event feed -- what the harness commits, as it commits it',
    'fs/observed': 'what the filesystem was observed to be: present with a version, or absent',
    'agent/turn-stopping': 'the harness announcing a turn is about to close',
    'agent/inbox/claimed': 'the harness announcing which operator message opens a turn',
    'fs/write-intent': 'the DECISION before a file is written -- single-slot, and not ours to make',
    'fs/edit-intent': 'the DECISION before a file is edited -- single-slot, and not ours to make',
})

/** Reached through a symbol rather than a literal. Declared because the check CANNOT see them. */
export const HOST_SYMBOL_REACHED = Object.freeze({
    'session-telemetry/record': 'subscribed as REDACT_EVENT in lib/telemetry.js',
    'ctx.get(name) in lib/model/service.js': 'the SERVICE KEY IS A VARIABLE there -- the module asks for a name it is given rather than reaching for a property, and says so: "ASKED THROUGH ctx.get(name), NEVER BY PROPERTY. Measured on a live run, and it cost one." So `system1` is named by a literal in the row AND resolved dynamically behind it.',
    'the seam table in lib/seams.js': 'lib/register.js subscribes `ctx.on(event, ...)` for each seam; the seam-to-harness-event map lives in that table rather than at the call site',
})

/** Event MODES that constrain what a listener may do. Each was read from the harness, not assumed. */
export const HOST_EVENT_CONSTRAINTS = Object.freeze({
    'session/event': 'emit -- fire and forget; cannot delay a turn',
    'fs/observed': 'emit -- but a THROW FAILS THE TOOL CALL, so the listener must be a synchronous recorder',
    'agent/turn-stopping': 'serial -- the harness AWAITS it, so no O(surface) work may run inside',
    'agent/inbox/claimed': 'emit -- fire and forget; a throw must not escape into the loop',
    'fs/write-intent': 'waterfall, SINGLE SLOT -- the first listener to RETURN AN INTENT owns the decision. next() yields the provider\'s unconditional write, so a recorder returns next() UNTOUCHED and BY REFERENCE: a reconstructed promise resolving to the same value is still a substitution',
    'fs/edit-intent': 'waterfall, SINGLE SLOT -- the first returned guard wins; same rule as fs/write-intent with `{version}` as the decision',
    'agent/pre-step': 'waterfall -- a listener MUST call next() or the listeners behind it break',
    'session-telemetry/record': 'waterfall -- the rule transforms one record and returns it',
})

/** The adapter modules, which are PURE: no host service, no event subscription. Checked as well. */
export const ADAPTER_MODULES = Object.freeze([
    'lib/host/index.js',
    'lib/host/fs-journal.js',
    // THE SESSION-SHAPED THREE MOVED INTO THEIR OWN PACKAGE, and the check MOVED WITH THEM: `dsh-session-adapter`
    // carries the harness's event vocabulary, the surface fold and the event feed, and it is a package because those
    // modules must be IMPORTABLE -- a composer inside a synchronous path cannot await a Cordis service (`F104`). A
    // check that stopped at `lib/` would have quietly stopped covering them.
    'packages/session-adapter/index.js',
    'packages/session-adapter/lib/session-format.js',
    'packages/session-adapter/lib/surface.js',
    'packages/session-adapter/lib/feed.js',
])
