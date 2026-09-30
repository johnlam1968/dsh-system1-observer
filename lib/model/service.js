/**
 * THE SERVICE-BACKED MODEL CLIENT.
 *
 * `dsh-system1` provides `system1`, whose `decide(request)` reaches every registered provider and
 * echoes which one answered. This is the path the runtime should prefer when the service is mounted,
 * because it is the only one that can say WHAT graded a subject -- and because model selection is a
 * provider id rather than a different `baseUrl` per deployment.
 *
 * It returns the SAME `ModelResult` as the wire client, so no caller changes: the gates, the ladder
 * and the judge are untouched by the choice of transport. That is deliberate -- the four measured
 * differences between the wire and the service are transport and envelope, not judgement, and this
 * module exists to absorb exactly those.
 *
 * THE SERVICE IS OPTIONAL, and that is a safety property rather than a convenience. A missing HARD
 * dependency makes a cordis row sit PENDING and run NOTHING -- no allow-list, no ladder, no trace --
 * so naming `system1` in the plugin's `inject` would turn "the judge cannot answer" into "the
 * guardrail does not exist". `selectModel` therefore prefers the service and falls back to the wire,
 * and the no-service path stays what it is today: the judge reports unavailable and the guardrail
 * fails open, which `src/guard/judge.ts` already handles and tests.
 */
import { isRecord } from '../is-record.js';
import { narrowAnswers } from './narrow.js';
import { worstCase } from './escalation.js';
import { serviceAnswers } from './service-answers.js';
import { createModel } from './client.js';
/** Same whitelist as the wire client: nothing crosses the boundary unless it is listed. */
const ENVELOPE = ['model', 'usage', 'routing', 'executed'];
/**
 * The service's provenance, lifted out of `meta`.
 *
 * CAPTURED LIVE 2026-09-29, and the first version of this module got it wrong in a way worth
 * recording: the service's `decide` does NOT answer `{answers, executed, usage}`. It answers
 * `{answers, meta}`, and `executed` lives INSIDE `meta`:
 *
 *   {"answers":{…},
 *    "meta":{"requestId":"c5677dd8-…","requested":{"provider":"typesafe","model":"jev-latest"},
 *            "durationMs":917.7,
 *            "executed":{"provider":"typesafe","model":"typesafe/jev-1.13-20260917"},
 *            "usage":{"inputTokens":635,"outputTokens":60}}}
 *
 * `system1_decide`'s TOOL output flattens `meta` for a model to read, which is where the wrong
 * expectation came from; the service underneath it does not. The first version therefore ran end to
 * end, judged correctly, and recorded `envelope: undefined` -- the provenance this whole change
 * exists to capture was silently absent. `requested` is kept too, because "asked for jev-latest, got
 * the dated snapshot" is exactly the distinction that matters when a threshold is being re-used.
 */
function envelopeOf(reply) {
    if (!isRecord(reply))
        return undefined;
    const out = {};
    const meta = reply.meta;
    if (isRecord(meta)) {
        if (meta.executed !== undefined)
            out.executed = meta.executed;
        if (meta.requested !== undefined)
            out.requested = meta.requested;
        if (meta.usage !== undefined)
            out.usage = meta.usage;
        if (meta.durationMs !== undefined)
            out.durationMs = meta.durationMs;
        if (meta.requestId !== undefined)
            out.requestId = meta.requestId;
    }
    // Also accept a flat reply, so this reader works whichever shape it is handed.
    for (const key of ENVELOPE)
        if (reply[key] !== undefined)
            out[key] = reply[key];
    return Object.keys(out).length === 0 ? undefined : out;
}
export function createServiceModel({ service, provider, model }) {
    async function decide({ state, questions }) {
        let reply;
        try {
            reply = await service.decide({
                state,
                questions,
                ...(provider === undefined && model === undefined
                    ? {}
                    : { model: { ...(provider === undefined ? {} : { provider }), ...(model === undefined ? {} : { model }) } }),
            });
        }
        catch (error) {
            // A rejecting service is a judge that could not answer. Every failure becomes a result rather
            // than an exception, for the same reason the wire does it: the caller must not be able to
            // swallow one into a default answer.
            const message = error instanceof Error ? error.message : String(error);
            return { kind: 'error', reason: `the system1 service failed: ${message}` };
        }
        if (!isRecord(reply))
            return { kind: 'error', reason: 'the system1 service returned no object' };
        // The service's answer envelope differs from the wire's; flatten it before the shared reader sees
        // it. `narrowAnswers` is untouched, because it is the module every gate's correctness rests on.
        const flattened = serviceAnswers(reply);
        const narrowed = narrowAnswers(flattened, questions ?? {});
        if (narrowed.kind === 'error')
            return narrowed;
        return {
            kind: 'answers',
            answers: narrowed.answers,
            worstCase: worstCase(narrowed.answers),
            envelope: envelopeOf(reply),
            rawAnswers: isRecord(flattened) ? flattened.answers : undefined,
        };
    }
    async function health() {
        // The service has no health endpoint of its own; a provider being reachable is the service's
        // business, not this client's. Reporting `true` here would be a claim this module cannot check.
        return false;
    }
    return { decide, health };
}
/**
 * ASKED THROUGH `ctx.get(name)`, NEVER BY PROPERTY. Measured on a live run, and it cost one:
 * cordis's context is a Proxy whose `get` trap THROWS on an undeclared property --
 *
 *     Error: cannot get property "system1" without inject
 *
 * -- and that throw happened inside `apply()`, so the plugin mounted NOTHING: no tools, no
 * allow-list guard, no judge. The session then ran on its preset's own tool list and reached for
 * `grep`, `write` and `glob` with the guard that exists to refuse them never installed. `ctx.get`
 * returns `undefined` for a service nobody provided, which is the question actually being asked.
 */
function asService(value) {
    if (!isRecord(value))
        return undefined;
    const decide = value.decide;
    if (typeof decide !== 'function')
        return undefined;
    // `decide` is called as a METHOD, so `this` must be the service object. Passing the bare function
    // would rebind it and is the classic way this breaks.
    return { decide: (request) => Promise.resolve(decide.call(value, request)) };
}
function serviceOf(ctx) {
    if (!isRecord(ctx))
        return undefined;
    // The real context: ask, do not read.
    if (typeof ctx.get === 'function')
        return asService(ctx.get('system1'));
    // A plain test stub carrying the service as an ordinary property.
    return asService(ctx.system1);
}
export function selectModel(ctx, wire) {
    const service = serviceOf(ctx);
    if (service !== undefined) {
        return createServiceModel({
            service,
            provider: wire.provider,
            model: wire.model,
        });
    }
    return createModel(wire);
}
