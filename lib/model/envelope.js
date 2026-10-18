// ONE HOME FOR WHAT CROSSES THE TRANSPORT BOUNDARY.
//
// This list used to exist twice, once in the wire client and once in the service client, and the two copies
// drifted: `requested` was lifted out of the service's `meta` and never added to the wire's whitelist. The
// consequence was not a missing field but a LYING one -- `lib/observe.js` reads `envelope.requested`, so every
// wire call recorded `requested: null` beside a populated `envelope`, which is a field that reads as a
// measurement and is not one. The observer had already paid for that mistake once ("a second dead projection is
// what caused this"), and a duplicated list is what let it happen again.
//
// So: one list, both transports, and the whitelist still means what it says -- nothing crosses unless it is
// named here.
import { isRecord } from '../is-record.js';

export const ENVELOPE_KEYS = ['model', 'usage', 'routing', 'executed', 'requested', 'provider'];

/**
 * Copy the listed envelope fields out of a transport reply, or `undefined` when it carried none of them.
 *
 * Deliberately a projection and not a spread: a reply that grows a field must not start writing it into the
 * trace because a server added it.
 */
export function projectEnvelope(body) {
    if (!isRecord(body))
        return undefined;
    const out = {};
    for (const key of ENVELOPE_KEYS)
        if (body[key] !== undefined)
            out[key] = body[key];
    // THE REVISION THAT ANSWERED, NORMALISED FROM A GATEWAY THAT NAMES IT AT THE TOP LEVEL. Measured on the live
    // wire after the service route was cut: `https://openrouter.ai/api/v1/systemone` answers with
    // `{model, answers, usage, id, provider}` and NO `executed`, NO `routing`, NO `requested`. The vendor's shape
    // carries `executed`, and every consumer reads `envelope.executed` -- so on the wire the trace recorded answers
    // with no record of WHICH checkpoint produced them, which is the one provenance field this repository refuses to
    // lose. The fix belongs HERE rather than in each consumer: this file exists so that "the one place that knows where
    // a transport puts its envelope" is a real place, and three consumers reading a field a gateway does not send is
    // the same mistake `result-envelope.js` was written to end.
    if (!isRecord(out.executed) && typeof out.model === 'string' && out.model !== '') {
        out.executed = { model: out.model, ...(typeof out.provider === 'string' && out.provider !== '' ? { provider: out.provider } : {}) };
    }
    return Object.keys(out).length === 0 ? undefined : out;
}
