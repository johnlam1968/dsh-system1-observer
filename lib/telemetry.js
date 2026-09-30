// THE HARNESS'S OWN OUTBOUND TELEMETRY, WHICH IS UNREDACTED ON EVERY SHIPPED PROFILE.
//
// This is not about this plugin's trace. The harness exports session telemetry to a remote endpoint, and it ships
// NO redaction rules: measured against the installed service definition, "with no listener mounted records reach
// the backend as captured, so exported data is exactly as clean as the rules a deployment mounts". A rule costs
// one `ctx.on`, a plain string, zero dependencies and no build step -- and it touches nothing of ours.
//
// TWO PRODUCTS, KEPT SEPARATE IN THE DOCS. One is local evidence (the JSONL trace, which redacts its copy and
// says so); the other is remote egress. This module is the second, and it ships OFF, because a plugin whose
// contract is "it decides nothing" must not silently rewrite a user's telemetry the moment it mounts.
//
// REACHED BY STRING, NEVER BY IMPORT. `SessionTelemetryBackend` extends `Service` from `@deepseek-ai/cordis`, so
// importing or extending it would embed a second Cordis copy and could register into a different context than the
// host's -- the hazard `lib/remote.js` documents for the Typert protocol. Nothing here constructs a Service, so
// nothing here can.
//
// BOTH NAMES ARE PINNED AGAINST THE INSTALLED DECLARATIONS, and both were wrong in shipped documentation: three
// READMEs spell the event `sessionTelemetry/record`, which never fires, and the service's own doc comment claims
// the key is `telemetry` while its constructor registers `sessionTelemetry`.
/** The waterfall event name. KEBAB-CASE, and verified present in this harness build. */
export const REDACT_EVENT = 'session-telemetry/record'
/** The service key, `super(ctx, 'sessionTelemetry')` -- NOT the `telemetry` key the doc comment claims. */
export const TELEMETRY_SERVICE = 'sessionTelemetry'

/**
 * Mount one redaction rule on the harness's telemetry waterfall.
 *
 * @param ctx     the row's context
 * @param scrub   `(record) => record`, PURE: the contract requires a returned record and forbids mutating the one
 *                handed over, which is the coordinator's own deep copy
 * @param readEnabled `() => boolean`, read per record so a saved setting reaches a running row
 * @returns a disposer, so an unload takes the rule with it
 */
export function attachRedactionRule(ctx, { scrub, readEnabled } = {}) {
    let dispose
    // OPTIONAL INJECTION, not a hard dependency. Under `DSH_TELEMETRY_DISABLED` there is no service, and a hard
    // `inject` would leave the whole row PENDING -- running nothing, listeners included. Losing the observer to
    // gain a courtesy is a bad trade.
    ctx.inject([TELEMETRY_SERVICE], (child) => {
        let present
        try {
            present = child.get(TELEMETRY_SERVICE)
        }
        catch {
            present = undefined
        }
        if (present === undefined) return
        dispose = ctx.on(REDACT_EVENT, (record, next) => {
            // THE INNERMOST `next()` IS THE PASS-THROUGH, AND IT IS CALLED FIRST. The waterfall stacks by
            // transforming `next()`'s return value, and RETURNING WITHOUT IT REPLACES EVERY LISTENER BENEATH --
            // which is not ours to do, on a seam we do not own.
            const carried = next()
            // OFF UNLESS ASKED, and read live: a user who never turned this on must get their telemetry exactly
            // as the harness captured it.
            if (readEnabled?.() !== true) return carried
            try {
                return scrub(carried)
            }
            catch {
                // FAIL-CLOSED IS THE SEAM'S CONTRACT, NOT OURS. A throw here withholds that record and BLINDS the
                // user's official telemetry; returning it unchanged is the lesser harm, and this plugin has no
                // business deciding what a user's telemetry may contain.
                return carried
            }
        })
    })
    return () => dispose?.()
}
