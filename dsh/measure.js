// MEASURING A SUBJECT -- the chain, with no harness in it.
//
// WHY THIS FILE EXISTS. `system1_evaluate_session` and a standalone script must judge a session the SAME way, or a
// measurement taken one way is not comparable with one taken the other -- and "comparable" is the whole reason a
// measurement carries a set hash. So the chain lives here once, and both are adapters over it. This is the pattern
// question resolution already uses: `system1_decide` and `scripts/ask.mjs` both go through `core/system1.js`, and a
// test says so. This is that test's other half.
//
// WHAT IS *NOT* HERE, ON PURPOSE. No `ctx`, no row config, no redaction, no schema, no render, no package write, and
// no `child_process`. Those belong to whichever surface is asking: the tool carries the row's settings and the
// harness's schema, and the script carries a credential and a place to print. What is here is the part that would be
// WRONG to have twice -- composing a subject, cutting it into segments, asking each one, and combining the answers in
// code. A tool that spawned this as a subprocess would have to re-read its own configuration from disk to do it, which
// is the coupling `docs/findings.md` F110 spent a pass removing.
//
// EVERY IMPORT HERE IS RELATIVE AND PURE, which is what lets `scripts/ask.mjs` reach this file by a DYNAMIC import on
// its `session` path while `--list`, `--state`, `--file` and `--url` keep resolving nothing outside `core/`. That
// property is checked by `test/instrument-boundary.test.js`, which walks the closure from the script and refuses a
// bare specifier anywhere in it.

import { createHash } from 'node:crypto'
import { isRecord } from '../core/is-record.js'
import { withinStateBudget } from '../core/model/limits.js'
import { aggregateReadings, firstAndLast, segmentsOf } from './segment.js'
import { textOfEvent } from './session-adapter/lib/session-format.js'

/** Why a segment produced no reading. A row carries one instead of an absent entry, so `n` never silently shrinks. */
const failedRow = (part, { reason, chars = 0, stateHash = '' }) => ({
    index: part.index, from: part.from, to: part.to, messages: part.messages, chars, stateHash, failure: { reason },
})

/** The short hash a trace line carries, so two judgements of the same state are recognisable as the same judgement. */
const shortHash = (text) => createHash('sha256').update(text).digest('hex').slice(0, 12)

/**
 * The message of an error, without the stack. A failure recorded on a trace line is a reason a reader can act on, and
 * a stack is a thing they must scroll past.
 *
 * @param {unknown} error
 * @returns {string}
 */
export function messageOf(error) {
    if (error === null || error === undefined) return 'unknown failure'
    return typeof error?.message === 'string' && error.message !== '' ? error.message : String(error)
}

/**
 * HOW BIG EACH SEGMENT MAY BE, and whether the subject segmented ITSELF.
 *
 * A LONG SUBJECT SEGMENTS ITSELF, and this is the failure it prevents: without a segment size a whole session is
 * composed down to the row's cap, the judge answers about a few thousand characters, and the report reads like a
 * session-level judgement. Measured on this repository's own sessions: 855,812 characters of conversation composed to
 * 8,000 and answered anyway. A size the caller named always wins, so a window somebody narrowed on purpose is only
 * segmented when that window is itself too big.
 *
 * @param {{ windowChars: number, askedChars?: number, stateBudgetChars: number, defaultSegmentChars: number }} input
 * @returns {{ segmentChars: number, autoSegmented: boolean }}
 */
export function segmentBudgetFor({ windowChars, askedChars = 0, stateBudgetChars, defaultSegmentChars }) {
    const asked = Number.isInteger(askedChars) && askedChars > 0 ? askedChars : 0
    const autoSegmented = asked === 0 && windowChars > stateBudgetChars
    return { segmentChars: asked > 0 ? asked : (autoSegmented ? defaultSegmentChars : 0), autoSegmented }
}

/**
 * Judge a subject in parts, and COMBINE THE ANSWERS IN CODE.
 *
 * A segment that cannot be composed, cannot be asked, or comes back malformed becomes a row carrying a `failure` --
 * never a missing row. An aggregate that hides its own members cannot be argued with, so a question that failed in
 * some segments reports how many rather than dropping them from `n`.
 *
 * @param {object} input
 * @param {object[]} input.events    the whole window, so tool calls travel with the messages they answered
 * @param {object[]} input.messages  what the caller wants judged
 * @param {number}   input.segmentChars
 * @param {object}   input.questions the built question set
 * @param {(events: object[], max: number, sessionId: string) => Promise<object>} input.compose
 * @param {(request: object, options: object) => Promise<object>} input.decide
 * @param {(line: object) => void} [input.onLine]  called once per segment, for the record
 * @param {(events: object[], messages: object[], opts: object) => object[]} [input.cut]  how to divide the subject
 * @returns {Promise<{ rows: object[], aggregate: object, ends: object, parts: object[], windowChars: number }>}
 */
export async function judgeSegments({
    events, messages, segmentChars, questions, compose, decide, sessionId = '', signal, onLine, budgetChars,
    // `cut` IS HOW A SUBJECT IS DIVIDED, and it is injected because the unit being judged differs by where it came
    // from: a dsh window is cut by `segmentsOf` over its EVENTS, and a normalized session by `segmentsOfRows` over
    // its ROWS. The judging -- compose, ask, keep the failure as a row, combine in code -- is identical for both, and
    // that is the part this module exists to hold once. Defaulting to the dsh cut keeps every existing caller honest.
    cut = segmentsOf,
}) {
    const parts = cut(events, messages, { maxChars: segmentChars })
    const rows = []
    const windowChars = messages.reduce((total, message) => total + textOfEvent(message).length, 0)
    for (const part of parts) {
        // EACH SEGMENT IS COMPOSED WITH THE STATE BUDGET, NOT THE ROW'S WHOLE-SESSION CAP. The segmentation already
        // decided the size; this is the ceiling it was measured against.
        const piece = await compose(part.events, budgetChars, sessionId)
        if (piece?.refused === true) {
            rows.push(failedRow(part, { reason: piece.reason }))
            continue
        }
        const text = String(piece.state ?? '')
        const stateHash = shortHash(text)
        const budget = withinStateBudget(text.length)
        let reply
        try {
            reply = await decide({ state: text, questions }, { signal })
        } catch (error) {
            rows.push(failedRow(part, { reason: messageOf(error), chars: text.length, stateHash }))
            continue
        }
        if (reply === null || typeof reply !== 'object' || reply.kind === 'error') {
            rows.push(failedRow(part, { reason: String(reply?.reason ?? 'the model returned no result'), chars: text.length, stateHash }))
            continue
        }
        rows.push({
            index: part.index, from: part.from, to: part.to, messages: part.messages,
            chars: text.length, stateHash, truncated: piece.truncated === true,
            // WHICH BACKEND ANSWERED, per segment. A reading that does not say who produced it cannot be compared with
            // a reading from another model, and the whole reason a package records a mount is that the numbers and the
            // model that made them travel together.
            ...(reply.executed === undefined ? {} : { executed: reply.executed }),
            // A SEGMENT OVER THE ESTIMATED BUDGET IS REPORTED, NOT HIDDEN: it is the one reading most likely to be
            // about nothing, and it is here because a single message can exceed the budget on its own.
            ...(budget.ok === false ? { overBudget: budget.problem } : {}),
            answers: isRecord(reply.answers) ? reply.answers : {},
        })
        // ONE LINE PER SEGMENT, because each IS a reading -- about that part of the subject, under this hook. And it is
        // written for the FAILURES too: a judgement that timed out was still attempted, and on a metered backend very
        // probably still paid for. A call that leaves no line is present in the world and invisible in the record.
        if (typeof onLine === 'function') {
            onLine({
                segment: { index: part.index, from: part.from, to: part.to, of: parts.length },
                // `messages` travels WITH the segment, not derived from it: the trace line's `subject.messages` is how a
                // reader learns how much conversation this reading was about, and a line that says 0 for a segment of
                // 40 is worse than no line -- it is a line that is confidently wrong.
                messages: part.messages,
                stateHash, answers: isRecord(reply.answers) ? reply.answers : {},
                ...(piece.truncated === true ? { truncated: true } : {}),
                ...(budget.ok === false ? { overBudget: budget.problem } : {}),
            })
        }
    }
    return { rows, aggregate: aggregateReadings(rows, questions), ends: firstAndLast(rows), parts, windowChars }
}

/**
 * Judge a subject in ONE call.
 *
 * COMPOSED AT THE JUDGE'S BUDGET, NOT THE ROW'S CAP. This path once composed against the row's `composeMaxChars`,
 * which defaults to 8,000 -- so every non-segmented measurement this plugin ever took was cut to 8,000 characters
 * regardless of what fitted, and "measure the level whole" was impossible while a legacy display cap silently decided
 * otherwise. Measured: the G0 exchange of a freeciv turn is 10,885 characters whole and was cut to 8,000.
 *
 * @param {object} input
 * @returns {Promise<{ state: string, stateHash: string, answers: object, reply: object|null, failure?: object, composed: object }>}
 */
export async function judgeOnce({ events, questions, compose, decide, sessionId = '', signal, budgetChars, onLine }) {
    const composed = await compose(events, budgetChars, sessionId)
    const state = String(composed?.state ?? '')
    const stateHash = shortHash(state)
    const fail = (reason) => {
        if (typeof onLine === 'function') onLine({ stateHash, failure: { reason } })
        return { state, stateHash, answers: {}, reply: null, failure: { reason }, composed }
    }
    if (composed?.refused === true) return fail(String(composed.reason))
    let reply
    try {
        reply = await decide({ state, questions }, { signal })
    } catch (error) {
        return fail(messageOf(error))
    }
    if (reply === null || typeof reply !== 'object') return fail('the model returned no result')
    if (reply.kind === 'error') return fail(String(reply.reason ?? 'the model could not answer'))
    const answers = isRecord(reply.answers) ? reply.answers : {}
    if (typeof onLine === 'function') onLine({ stateHash, answers })
    return { state, stateHash, answers, reply, composed }
}

/**
 * A measurement, in the shape a PACKAGE EXPECTS.
 *
 * It is built here rather than in the script that writes the package, because the shape is a fact about a measurement
 * and not about a command line -- and because a shape only a caller can reach is a shape no test can check. The tool
 * builds an equivalent over a trace WINDOW; this one is over a subject that was read from a file, and the difference is
 * recorded rather than disguised: `window.run` is `null` and the manifest's trace slice is empty, because there was no
 * harness and so no trace.
 *
 * @param {object} input
 * @returns {object} the summary a package's `readings.json` holds
 */
export function measurementSummary({ receipt, session, judged, set = null, at = null }) {
    const answered = (judged?.rows ?? []).filter((row) => row.failure === undefined)
    const firstExecuted = answered.find((row) => row.executed !== undefined)?.executed ?? null
    return {
        window: { run: null, hook: 'session-review', question: set, groupBy: 'session', tail: at },
        counts: { call: judged?.rows?.length ?? 0, skip: (judged?.rows?.length ?? 0) - answered.length, mount: 1, total: judged?.rows?.length ?? 0 },
        mount: { model: firstExecuted?.model ?? null, provider: firstExecuted?.provider ?? null, probeHash: null },
        groups: [{ questions: Object.entries(judged?.aggregate ?? {}).map(([id, entry]) => ({ id, ...entry })) }],
        // A REFUSAL IS CARRIED INTO THE PACKAGE. A segment that could not be judged is written as a sentence a reader
        // will see, because a package whose `n` quietly shrank reads as a smaller measurement rather than a partial one.
        refusals: (judged?.rows ?? []).filter((row) => row.failure !== undefined).map((row) => `segment ${row.index}: ${row.failure.reason}`),
        subject: {
            harness: receipt?.harness ?? null, id: receipt?.id ?? null,
            sourceSha256: receipt?.sourceSha256 ?? null, highWater: receipt?.highWater ?? null,
            messages: session?.messages ?? null, exchanges: session?.exchanges ?? null,
        },
    }
}
