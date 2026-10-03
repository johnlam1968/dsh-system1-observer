import { DEFAULT_TIMEOUT_MS, postSystemone } from './wire.js';
import { isRecord } from '../is-record.js';
import { narrowAnswers } from './narrow.js';
import { worstCase } from './escalation.js';
import { projectEnvelope } from './envelope.js';
/** THE WHITELIST IS NOT KEPT HERE ANY MORE. It was, and `lib/model/service.js` kept a second copy, and the two
 * disagreed: `requested` was lifted out of the service's `meta` and never listed here, so `lib/observe.js`'s read of
 * `envelope.requested` recorded `null` on every wire call beside a populated envelope. A field that always reads
 * null is worse than an absent one, because it reads as a measurement. Both transports now project through
 * `lib/model/envelope.js`, and `test/envelope.test.js` fails if either grows its own list again.
 *
 * `executed` is listed there because it is the ONLY field that says which provider and revision graded the
 * subject. `system1_decide`'s own description warns what its absence costs: "A THRESHOLD MEASURED ON ONE SERVER
 * DOES NOT TRANSFER TO ANOTHER ... `unknown` means the server did not say which one it used." It was missing, so a
 * decision could record a revision without recording what produced it -- and measured 2026-09-29, 0 trace records
 * carried `routing`, the one provenance field that was permitted. */
const envelopeOf = projectEnvelope;
// Named explicitly rather than spreading the body: nothing crosses this boundary
// without being listed, so the envelope cannot quietly grow a field that gets used.
export function createModel({ baseUrl, fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    async function decide({ state, questions, signal }) {
        const posted = await postSystemone({ baseUrl, state, questions, fetch, timeoutMs, signal });
        if (posted.kind === 'error')
            return posted;
        if (!isRecord(posted.body))
            return { kind: 'error', reason: 'the response carried no JSON object' };
        const narrowed = narrowAnswers(posted.body, questions ?? {});
        if (narrowed.kind === 'error')
            return narrowed;
        // `envelope` and `rawAnswers` are for OBSERVABILITY ONLY and are never read by
        // any decision. Narrowing deliberately discards them, and the session log never
        // shows them, so without carrying them here the judge's verdicts cannot be
        // diagnosed -- nor its cost measured, since usage lives in the envelope.
        return {
            kind: 'answers',
            answers: narrowed.answers,
            worstCase: worstCase(narrowed.answers),
            envelope: envelopeOf(posted.body),
            rawAnswers: posted.body.answers,
        };
    }
    async function health() {
        try {
            const response = await (fetch ?? globalThis.fetch)(`${String(baseUrl).replace(/\/+$/, '')}/health`, { method: 'GET' });
            return response.ok === true;
        }
        catch {
            return false;
        }
    }
    return { decide, health };
}
