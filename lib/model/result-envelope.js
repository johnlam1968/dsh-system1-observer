// WHERE A TRANSPORT PUTS ITS ENVELOPE -- the one place that knows, so the next consumer does not have to.
//
// WHY THIS FILE EXISTS. `lib/observe.js` found that a `decide` result has no top-level `requested` or `executed` and
// says so at its own call site. Two consumers added LATER read the top level anyway and lost the provenance in
// production, because the lesson lived at one call site. A comment cannot be imported; this can.
//
// THE RULE IS SETTLED BY THE TRANSPORTS, not by preference. `lib/model/client.js` returns an explicit
// `envelope: envelopeOf(posted.body)` -- "usage lives in the envelope", it says -- and `lib/model/service.js` returns
// the same field. So BOTH carry it, the envelope is the only source, and an existing test states it: "a top-level
// requested/executed is not projected: the envelope is the only source". The flat fields a wire result also spreads
// are a convenience for hand-built results, and reading them would let one smuggle a provenance past the rule.
import { isRecord } from '../is-record.js'

/** The envelope of a `decide` result, and NOTHING ELSE. There is deliberately no fall back to the top level. */
export function resultEnvelope(result) {
    return isRecord(result) && isRecord(result.envelope) ? result.envelope : {}
}
