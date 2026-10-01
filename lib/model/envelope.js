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

export const ENVELOPE_KEYS = ['model', 'usage', 'routing', 'executed', 'requested'];

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
    return Object.keys(out).length === 0 ? undefined : out;
}
