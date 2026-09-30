// WHAT THE JUDGEMENT COST, AND WHAT IT IS NOT.
//
// Pure aggregation over fields that were already on 4,368 of 4,369 `call` lines. No new capture, no new
// dependency -- and the figure surfaces a fact that is invisible today: `post_execute` is ~60% of the spend at
// 3.1x the tokens per call of `pre_execute`, because it judges the whole tool result where `pre_execute` judges
// only the call text. The two seams have the SAME call count, so that difference is purely payload size.
//
// THREE HONESTY CONSTRAINTS, each of which a competing plugin got wrong:
//
//   (a) THIS IS THE COST OF THE JUDGEMENT, NEVER THE COST OF THE SESSION. `envelope.usage` is the decision
//       model's usage. The subject model's tokens are never captured at all -- `lib/subject.js` records only
//       provider, model, reasoningEffort and temperature -- so a session cost is NOT COMPUTABLE from this trace.
//       A viewer that silently dropped a field would look like it lost data; a viewer that labelled the judge's
//       cost "session cost" would simply be wrong.
//   (b) THE RATE IS A THIRD-PARTY TRANSCRIPTION OF A VENDOR PAGE, so it is named, dated, and configurable rather
//       than inlined at the place that prints money. `dsh-jev-tools` says why: "two copies of a price drift".
//   (c) A TRUNCATED SUM IS NOT A TOTAL. The reader windows the file (`WINDOW_BYTES`), so a rollup can be partial
//       without saying so; every block below carries the provenance that says which subset it covers.
import { readConfigValue } from './config-value.js'

/**
 * USD per million input tokens, and the date it was transcribed.
 *
 * OUTPUT IS FREE ON THIS MODEL, so the input term is the whole cost. Four sibling plugins hard-code this same
 * rate; it is one constant here for the reason the fifth gives -- two copies of a price drift.
 */
export const PRICE_USD_PER_MTOK_INPUT = 0.042
export const PRICE_TRANSCRIBED_AT = '2026-09-28'
export const PRICE_SOURCE = `$${PRICE_USD_PER_MTOK_INPUT}/MTok input, transcribed ${PRICE_TRANSCRIBED_AT} from the vendor page; output tokens are free on this model`

/**
 * The gap above which two calls stop counting as one stretch of activity.
 *
 * KEPT SEPARATE FROM THE PRICE ON PURPOSE. The single most instructive failure in the study this port comes from
 * is a retention constant reused as a report window, so that a tab labelled "30 days" summed 60 and its own
 * comparison was structurally about twice the previous value. Two constants, two names, no sharing.
 */
export const IDLE_GAP_MS = 60_000

/**
 * Total time covered by intervals, merging any two closer together than `gap`. Ported from `dsh-maze`, whose
 * stated reason applies here more than there: "a 27-hour idle session must not dilute dense tool activity into
 * 1%". This trace has hour-scale gaps between runs, so a raw duration is meaningless.
 */
export function mergeIntervalsTotal(intervals, gap) {
    if (!Array.isArray(intervals) || intervals.length === 0) return 0
    const sorted = [...intervals].sort((a, b) => a[0] - b[0])
    let total = 0
    let currentStart = sorted[0][0]
    let currentEnd = Math.max(sorted[0][1], sorted[0][0])
    for (const [start, end] of sorted) {
        const finish = Math.max(end, start)
        if (start <= currentEnd + gap) {
            currentEnd = Math.max(currentEnd, finish)
        }
        else {
            total += currentEnd - currentStart
            currentStart = start
            currentEnd = finish
        }
    }
    return total + (currentEnd - currentStart)
}

/** The judge's input tokens for one call, from whichever envelope carried them. */
export function inputTokensOf(event) {
    const value = event?.envelope?.usage?.inputTokens ?? event?.answer?.envelope?.usage?.inputTokens
    return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** The judge's output tokens. Free on this model, recorded anyway so the absence of a cost term is visible. */
export function outputTokensOf(event) {
    const value = event?.envelope?.usage?.outputTokens ?? event?.answer?.envelope?.usage?.outputTokens
    return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** Whether this call carried a usage object at all, so "unpriced" is distinguishable from "cost nothing". */
function isPriced(event) {
    const usage = event?.envelope?.usage ?? event?.answer?.envelope?.usage
    return usage !== null && typeof usage === 'object'
}

/** Money, to six decimal places: a per-call figure below a tenth of a cent is otherwise indistinguishable. */
export function usdOf(inputTokens, pricePerMTokInput) {
    return Math.round((inputTokens * pricePerMTokInput / 1e6) * 1e6) / 1e6
}

/** The price to use, from the row's config or from the cited constant. */
export function priceOf(config) {
    const configured = readConfigValue(config?.pricePerMTokInput)
    return typeof configured === 'number' && Number.isFinite(configured) && configured >= 0
        ? configured
        : PRICE_USD_PER_MTOK_INPUT
}

function atOf(event) {
    const value = Date.parse(typeof event?.at === 'string' ? event.at : '')
    return Number.isFinite(value) ? value : null
}

/** The interval one call occupied: it was written when it finished, and it says how long it took. */
function intervalOf(event) {
    const end = atOf(event)
    if (end === null) return null
    const ms = typeof event.ms === 'number' && Number.isFinite(event.ms) ? event.ms : 0
    return [end - ms, end]
}

/**
 * The median, by the definition the rest of this repository already uses: for an even count, the AVERAGE of the
 * two middle values.
 *
 * Kept separate from `percentile` because the two conventions genuinely differ, and silently swapping one for the
 * other changes a number a reader has already seen: nearest-rank over `[100, 300]` gives 100, the averaging
 * definition gives 200, and both are defensible -- so the one that was already in use stays.
 */
function medianOf(values) {
    if (values.length === 0) return null
    const sorted = [...values].sort((a, b) => a - b)
    const middle = Math.floor(sorted.length / 2)
    return sorted.length % 2 === 1 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2)
}
/** Nearest-rank, which is the convention for a tail figure like p95. */
function percentile(values, fraction) {
    if (values.length === 0) return null
    const sorted = [...values].sort((a, b) => a - b)
    const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)
    return sorted[Math.max(0, index)]
}

function tally(values, limit = 12) {
    const counts = new Map()
    for (const value of values) {
        if (value === null || value === undefined) continue
        counts.set(value, (counts.get(value) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([key, count]) => ({ key, count }))
}

/**
 * The cost and timing block for a set of events.
 *
 * Pass the RUN's events. Every array is bounded, because this crosses a wire into a browser card that has to
 * draw it, and because the reader windows the file anyway.
 */
export function costOf(events, options = {}) {
    const pricePerMTokInput = typeof options.pricePerMTokInput === 'number' && Number.isFinite(options.pricePerMTokInput)
        ? options.pricePerMTokInput
        : PRICE_USD_PER_MTOK_INPUT
    const list = Array.isArray(events) ? events : []
    const calls = list.filter(event => event?.event === 'call')
    let inputTokens = 0
    let outputTokens = 0
    let pricedCalls = 0
    const seams = new Map()
    const msValues = []
    let msSum = 0
    let durationMsSum = 0
    for (const call of calls) {
        const tokensIn = inputTokensOf(call)
        const tokensOut = outputTokensOf(call)
        inputTokens += tokensIn
        outputTokens += tokensOut
        if (isPriced(call)) pricedCalls += 1
        const seam = typeof call.hook === 'string' ? call.hook : '(unknown)'
        const bucket = seams.get(seam) ?? { key: seam, count: 0, inputTokens: 0, outputTokens: 0, msSum: 0, durationMsSum: 0 }
        bucket.count += 1
        bucket.inputTokens += tokensIn
        bucket.outputTokens += tokensOut
        // `ms` IS THE OBSERVER'S CLOCK and `durationMs` is the PROVIDER'S. Their difference is NOT network time:
        // the default transport is loopback, where the client-observed round trip IS the server's handling time.
        // It is reported as client/transport overhead and named that way -- see `overheadNote`.
        const ms = typeof call.ms === 'number' && Number.isFinite(call.ms) ? call.ms : 0
        const durationMs = typeof call.envelope?.durationMs === 'number' ? call.envelope.durationMs : null
        bucket.msSum += ms
        msSum += ms
        msValues.push(ms)
        if (durationMs !== null) {
            bucket.durationMsSum += durationMs
            durationMsSum += durationMs
        }
        seams.set(seam, bucket)
    }
    const bySeamCost = [...seams.values()]
        .map(bucket => ({
            ...bucket,
            usd: usdOf(bucket.inputTokens, pricePerMTokInput),
            overheadMs: bucket.msSum - bucket.durationMsSum,
        }))
        .sort((a, b) => b.usd - a.usd)
    const estimatedUsd = usdOf(inputTokens, pricePerMTokInput)
    const runs = []
    const grouped = new Map()
    for (const event of list) {
        const id = typeof event?.run === 'string' ? event.run : '(no run)'
        if (!grouped.has(id)) grouped.set(id, [])
        grouped.get(id).push(event)
    }
    for (const [id, eventsOfRun] of grouped) {
        const times = eventsOfRun.map(atOf).filter(value => value !== null)
        const firstAt = times.length === 0 ? null : Math.min(...times)
        const lastAt = times.length === 0 ? null : Math.max(...times)
        const wallSpanMs = firstAt === null ? 0 : lastAt - firstAt
        const activeMs = mergeIntervalsTotal(eventsOfRun.filter(event => event?.event === 'call').map(intervalOf).filter(Boolean), IDLE_GAP_MS)
        const runCalls = eventsOfRun.filter(event => event?.event === 'call')
        runs.push({
            id,
            firstAt: firstAt === null ? null : new Date(firstAt).toISOString(),
            lastAt: lastAt === null ? null : new Date(lastAt).toISOString(),
            calls: runCalls.length,
            errors: eventsOfRun.filter(event => event?.event === 'error').length,
            skips: eventsOfRun.filter(event => event?.event === 'skip').length,
            rotations: eventsOfRun.filter(event => event?.event === 'rotate').length,
            activeMs,
            idleMs: Math.max(0, wallSpanMs - activeMs),
            wallSpanMs,
            usd: usdOf(runCalls.reduce((total, call) => total + inputTokensOf(call), 0), pricePerMTokInput),
            seamMix: tally(runCalls.map(call => (typeof call.hook === 'string' ? call.hook : null))),
        })
    }
    runs.sort((a, b) => String(a.firstAt).localeCompare(String(b.firstAt)))
    // TURNS ARE THE UNIT A READER ACTUALLY ASKS ABOUT ("what did that turn cost?"), and the only honest partial
    // flag available is the window's own leading edge: if a turn includes the first event read, earlier lines of
    // that turn may have been cut away, and a total that silently hides that is the failure this avoids.
    const turns = []
    const turnsSeen = new Map()
    for (const [index, event] of list.entries()) {
        const turn = typeof event?.turn === 'number' ? event.turn : null
        if (turn === null) continue
        const key = `${event?.run ?? ''}#${turn}`
        const bucket = turnsSeen.get(key) ?? { index: turn, firstAt: atOf(event), calls: 0, usd: 0, intervals: [], edge: false }
        bucket.calls += event.event === 'call' ? 1 : 0
        if (event.event === 'call') bucket.usd += usdOf(inputTokensOf(event), pricePerMTokInput)
        const interval = intervalOf(event)
        if (interval !== null) bucket.intervals.push(interval)
        if (index === 0) bucket.edge = true
        turnsSeen.set(key, bucket)
    }
    for (const bucket of turnsSeen.values()) {
        turns.push({
            index: bucket.index,
            firstAt: bucket.firstAt === null ? null : new Date(bucket.firstAt).toISOString(),
            calls: bucket.calls,
            usd: Math.round(bucket.usd * 1e6) / 1e6,
            activeMs: mergeIntervalsTotal(bucket.intervals, IDLE_GAP_MS),
            partial: bucket.edge,
        })
    }
    turns.sort((a, b) => String(a.firstAt).localeCompare(String(b.firstAt)))
    return {
        cost: {
            pricePerMTokInput,
            priceSource: pricePerMTokInput === PRICE_USD_PER_MTOK_INPUT ? PRICE_SOURCE : `$${pricePerMTokInput}/MTok input, configured in this row`,
            priceTranscribedAt: PRICE_TRANSCRIBED_AT,
            inputTokens,
            outputTokens,
            estimatedUsd,
            // WHAT THIS FIGURE IS: the judge's own tokens. The subject model's are never captured, so this is not
            // a session cost and must never be rendered as one.
            covers: 'the decision model only',
            pricedCalls,
            unpricedCalls: calls.length - pricedCalls,
        },
        bySeamCost,
        latency: {
            min: msValues.length === 0 ? null : Math.min(...msValues),
            median: medianOf(msValues),
            p95: percentile(msValues, 0.95),
            max: msValues.length === 0 ? null : Math.max(...msValues),
            msSum,
            durationMsSum,
            overheadMsSum: msSum - durationMsSum,
            overheadMsPerCall: calls.length === 0 ? null : Math.round(((msSum - durationMsSum) / calls.length) * 1000) / 1000,
            overheadNote: 'client/transport overhead: `ms` is the observer AND `durationMs` is the provider. Not network time — the default transport is loopback, where the observed round trip IS the server handling time.',
        },
        runs: runs.slice(-12),
        turns: turns.slice(-40),
    }
}
