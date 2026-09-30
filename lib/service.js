// THE OBSERVER AS A SERVICE, so another row can read what this one recorded.
//
// WHY A SERVICE AND NOT A TOOL. A tool is for the model; a service is for other plugins. The act layer's first
// requirement is to compose X from the trace (ROADMAP §9.6), and this repository's readers are modules -- a module
// in this package cannot be reached from another plugin's row. Measured before this file existed: the plugin
// registered NO service at all, so the trace was reachable only through the agent-facing tool and the client card,
// and the act row had nowhere to read from. Silent, like the other two gaps found the same way: the capability
// existed and the consumer that needed it could not reach it.
//
// THE REGISTRATION CALL WAS WRONG TWICE, and both halves are recorded here because a future reader will meet the
// same two names. `ctx.provide(name, value, check)` REGISTERS (`cordis/lib/index.js:800`); `ctx.set(name, value)`
// only REPLACES the value of a service already provided and throws `cannot set property "…" without provide`
// otherwise (`:782`). Using `provide` also means NO import of cordis in this file -- so this costs no new
// dependency and carries none of the module-load risk a top-level harness import would.
//
// READ-ONLY IS THE CONTRACT, and it is in the shape rather than in a promise: every method closes over a reader
// and returns its result, so there is no mutator to forget to guard. `test/service.test.js` asserts the returned
// object is frozen and that none of its members writes, and that a full sweep leaves the trace file's bytes
// identical -- a declaration that cannot be checked is a comment.
import { deriveNudgeLabel } from './nudge-label.js'
import { replayConfig } from './config-event.js'

export const OBSERVER_SERVICE = 'system1Observer'

export function createObserverService({ read, runs, sessions, config, label, replay } = {}) {
    for (const [name, fn] of Object.entries({ read, runs, sessions, config })) {
        if (typeof fn !== 'function') throw new TypeError(`${OBSERVER_SERVICE}: \`${name}\` must be a function.`)
    }
    // THE DERIVED SIGNAL, NOT ONLY THE RECORD. `deriveNudgeLabel` was built, tested and reachable from NOTHING: a
    // module in this package cannot be called from another plugin's row, which is the same gap that made the trace
    // itself unreachable before this service existed. The label is the one signal a consumer needs to check the
    // model's own answer against a fact nobody asked it for, so it is exposed here rather than reimplemented.
    //
    // IT DEFAULTS TO THE REPOSITORY'S OWN DERIVATION, deliberately: an injected override would let a consumer --
    // or a test -- supply a different rule and call it the label, and a label that differs per caller is not a
    // label. The default is the whole point; the parameter exists so a caller can see it is injectable at all.
    const derive = typeof label === 'function' ? label : deriveNudgeLabel
    // Same default rule as the label: a reconstruction that differs per caller is not a reconstruction.
    const fold = typeof replay === 'function' ? replay : replayConfig
    return Object.freeze({
        /** The trace window, as this repository's readers already build it. */
        read: (options) => read(options),
        /** The run ids present in the window. */
        runs: () => runs(),
        /** The configured session(s), and the agents live right now. */
        sessions: () => sessions(),
        /** The mount snapshot: hooks, per-seam sets, provider and model. */
        config: () => config(),
        /** Did the operator have to nudge? Three-valued: true, false, or null when there is no next message. */
        label: (input) => derive(input),
        /**
         * The configuration a sequence of trace lines describes, in order -- the reconstruction that makes a run
         * ATTRIBUTABLE to a config state, which is what the `config` event is for.
         *
         * Exposed for the same reason as the label: it was built and reachable from nothing, so a consumer that
         * wanted to know what was configured when a call was made would have had to reimplement the fold. It takes
         * the LINES rather than reading them, so a caller passes what `read()` already returned.
         */
        replay: (events) => fold(events),
    })
}
