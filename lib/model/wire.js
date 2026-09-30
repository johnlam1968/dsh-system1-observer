// One POST, and every way it can go wrong turned into a result rather than an
// exception the caller might accidentally swallow into a default answer.
export async function postSystemone({ baseUrl, state, questions, fetch, timeoutMs = 5000, signal }) {
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
