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
/**
 * Where a STANDALONE call posts when the caller names no endpoint.
 *
 * A SECOND ENDPOINT, AND THE DIFFERENCE IS A DEPLOYMENT RATHER THAN A SECOND GUESS. `DEFAULT_WIRE_URL` above is the
 * MOUNTED ROW's default: a loopback gateway that runs beside the harness, because a row inside a harness talks to
 * what that harness serves. A standalone is a script on a machine with no harness, no profile and no gateway, and the
 * credential it reads by default (`OPENROUTER_API_KEY`) belongs to ONE provider -- so its default is that provider's
 * root, and `/v1/systemone` is appended to it like any other.
 *
 * BOTH ARE BOUND ONCE AND BOTH ARE BOUND HERE, so "where does the wire post" is one file to read. They are NOT the same
 * value and must not be made so: pointing a mounted row at a public endpoint would be a behaviour change wearing the
 * costume of a cleanup, and pointing a standalone at a loopback gateway would leave it with nothing to talk to
 * (measured on the host this was written on: nothing listens on 8766).
 *
 * THE STANDALONE HAD NO DEFAULT AT ALL, which is how `undefined/v1/systemone` was ever posted -- see `postSystemone`.
 */
export const DEFAULT_STANDALONE_WIRE_URL = 'https://openrouter.ai/api';

// THE VENDOR'S LIMITS APPLY TO THIS REQUEST AND ARE NOT ENFORCED HERE. `lib/model/limits.js` holds them: 64k tokens per
// request covering the state plus all questions, 32k covering the state plus the single longest question, and
// `docs.typesafe.ai/api.md` for the endpoint, `usage` and the error codes. `jev-1.13` is the frontier System One model
// as of this writing, so its numbers are what this plugin builds to -- and a state over them comes back as answers
// nobody can read (measured: 291,137 characters, eight `unreadable`, `executed` absent). A request that is refused
// should be REPORTED as refused; `lib/model/limits.js`'s `withinStateBudget` is how a caller can say so in advance.
export async function postSystemone({ baseUrl, state, questions, model, apiKey, headers, fetch, timeoutMs = DEFAULT_TIMEOUT_MS, signal }) {
    // THE ENDPOINT, OR A NAMED REFUSAL. `baseUrl` was stringified straight into the URL, so a caller that named none
    // posted to `undefined/v1/systemone` and the answer was `Failed to parse URL from undefined/v1/systemone` -- which
    // arrived as a PER-QUESTION error and read like the model had declined. A missing endpoint is a configuration
    // fault, and it is named as one here, at the layer that would otherwise have posted it. The literal string
    // "undefined" can no longer reach `fetch`.
    if (typeof baseUrl !== 'string' || baseUrl.trim() === '') {
        return { kind: 'error', reason: 'no endpoint was named' };
    }
    const url = `${baseUrl.trim().replace(/\/+$/, '')}/v1/systemone`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const forwardAbort = () => controller.abort();
    if (signal !== undefined)
        signal.addEventListener('abort', forwardAbort);
    try {
        const response = await (fetch ?? globalThis.fetch)(url, {
            method: 'POST',
            // THE CREDENTIAL, WHICH THIS FUNCTION DID NOT SEND AT ALL BEFORE. It posted `content-type` and nothing
            // else, so the TypeSafe path could only ever reach an UNAUTHENTICATED endpoint -- measured 2026-10-18: a
            // fetch to this same URL with an `Authorization` header built from an environment variable answers 200
            // with probabilities, and without one answers 401. The key is a PARAMETER here rather than something this
            // module resolves, so the composing core authenticates for itself and the deployment decides where the key
            // comes from. `headers` is spread last, so a gateway may override anything above it.
            headers: {
                'content-type': 'application/json',
                ...(typeof apiKey === 'string' && apiKey.trim() !== '' ? { Authorization: `Bearer ${apiKey.trim()}` } : {}),
                ...(headers ?? {}),
            },
            // THE MODEL, WHICH THIS BODY ALSO DID NOT SEND. It posted `{state, questions}` and nothing else, because
            // the model block belonged to the host service that used to carry this call -- so `model` in the row's
            // config was RECORDED and never sent, and the endpoint chose for itself. That is invisible while a service
            // is mounted (the service sends its own block and reports back the revision that answered) and is exactly
            // the sort of thing a cut exposes. Omitted when unset, so an endpoint's own default still applies.
            body: JSON.stringify({
                state, questions,
                ...(typeof model === 'string' && model.trim() !== '' ? { model: model.trim() } : {}),
            }),
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
