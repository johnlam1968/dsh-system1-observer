// One POST, and every way it can go wrong turned into a result rather than an
// exception the caller might accidentally swallow into a default answer.
/**
 * THE DEFAULT PER-CALL BOUND, IN ONE PLACE.
 *
 * It was three numbers: this module and `client.js` defaulted to 5000, the row passed `?? 8000`, and the schema
 * declared NO default at all -- so which bound a call actually ran under depended on which layer you asked. The value
 * here is the one that was EFFECTIVE (the row's), because a fix that changed it would be a behaviour change wearing
 * the costume of a cleanup, and 8 s is comfortably above every latency measured in this repository (161 ms median).
 */
export const DEFAULT_TIMEOUT_MS = 8000;
/**
 * Where the wire posts when the row names no `wireUrl`.
 *
 * DECLARED HERE rather than in the schema so the schema's default, the tool's fallback and this module's own idea of
 * a default endpoint are one binding (F125).
 */
export const DEFAULT_WIRE_URL = 'http://127.0.0.1:8766';

// THE VENDOR'S LIMITS APPLY TO THIS REQUEST AND ARE NOT ENFORCED HERE. `lib/model/limits.js` holds them: 64k tokens per
// request covering the state plus all questions, 32k covering the state plus the single longest question, and
// `docs.typesafe.ai/api.md` for the endpoint, `usage` and the error codes. `jev-1.13` is the frontier System One model
// as of this writing, so its numbers are what this plugin builds to -- and a state over them comes back as answers
// nobody can read (measured: 291,137 characters, eight `unreadable`, `executed` absent). A request that is refused
// should be REPORTED as refused; `lib/model/limits.js`'s `withinStateBudget` is how a caller can say so in advance.
export async function postSystemone({ baseUrl, state, questions, fetch, timeoutMs = DEFAULT_TIMEOUT_MS, signal }) {
    const url = `${String(baseUrl).replace(/\/+$/, '')}/v1/systemone`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const forwardAbort = () => controller.abort();
    if (signal !== undefined)
        signal.addEventListener('abort', forwardAbort);
    try {
        const response = await (fetch ?? globalThis.fetch)(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ state, questions }),
            signal: controller.signal,
        });
        if (response.ok !== true) {
            return { kind: 'error', reason: `the decision service answered ${response.status}` };
        }
        let body;
        try {
            body = await response.json();
        }
        catch {
            return { kind: 'error', reason: 'the decision service did not answer with JSON' };
        }
        return { kind: 'ok', body };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (controller.signal.aborted && signal?.aborted !== true) {
            return { kind: 'error', reason: `the request timed out after ${timeoutMs} ms` };
        }
        return { kind: 'error', reason: `the request failed: ${message}` };
    }
    finally {
        clearTimeout(timer);
        if (signal !== undefined)
            signal.removeEventListener('abort', forwardAbort);
    }
}
