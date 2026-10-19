// A dsh SESSION LOG, NORMALIZED -- the producer that feeds `core/session-rows.js`.
//
// This is the seam the whole normalized shape turns on. Everything downstream of it -- the segmentation, the asking,
// the aggregation, the package -- is harness-free and reads ROWS. Everything upstream is a substrate, and this is the
// one place that knows a dsh log is a dsh log. A pi transcript and a DeepSeek web export each need their own producer
// writing the same rows, and none of them needs to know what a dsh log is.
//
// THREE FACTS ARE DERIVED HERE, and each is the reason this file exists rather than a one-line projection:
//
//   1. THE EXCHANGE IS AN ASK-GROUP. `exchangesOf` groups by where the human spoke, so the unit is comparable with a
//      harness that has no turn at all. Carrying the log's own turn number would reproduce the dsh-only query that
//      `docs/adapters-and-standards.md` measured, and the rows contract REFUSES a `turn` for that reason.
//   2. SHADOWED IS WHAT THE SURFACE WITHHELD. The log holds everything the session ever wrote; the model saw only what
//      survived compaction. `surfaceEvents` folds the `surfaceOp: replace` spans, and a message outside the result is
//      one the model cannot see -- measured at 3,417 such messages in a single dsh session. A producer that defaulted
//      this to `false` would produce a session that looks complete and measures text nobody could read.
//   3. THE RECEIPT NAMES THE BYTES. `sha256` and `highWater` travel with the rows, so a measurement can say which file
//      and how much of it it read. A measurement that cannot name its evidence cannot be reproduced or argued with.
//
// NO `ctx`, NO CONFIG, NO I/O: the caller passes the events it already has. That is what lets a live window and a
// stored log go through the same producer.

import { exchangesOf } from './exchange.js'
import { EVENT, isMessageEvent, isUserMessage, textOfEvent } from './session-adapter/lib/session-format.js'
import { surfaceEvents } from './session-adapter/lib/surface.js'

/** The dsh role -> the normalized role. A harness fact that has to be said once, in one place. */
const ROLE_OF_EVENT = new Map([
    [EVENT.USER_MESSAGE, 'user'],
    [EVENT.ASSISTANT_MESSAGE, 'assistant'],
    [EVENT.SYSTEM_MESSAGE, 'system'],
    [EVENT.DEVELOPER_MESSAGE, 'developer'],
    [EVENT.TOOL_CALL, 'tool'],
])

/**
 * The ask-group index of every event, by IDENTITY.
 *
 * DERIVED HERE, NOT TAKEN FROM `exchangesOf`, and the difference is the whole point. `exchangesOf` groups by the log's
 * own `turn`: a new turn starts a new group, and when the log carries no turn -- pi, mcode, and a dsh log written by a
 * converter that did not number them -- every event collapses into ONE group. Measured there: all 44 pi messages
 * loaded with a null turn, and a "per turn" query silently became a dsh-only query while looking cross-harness.
 *
 * An ASK-GROUP needs only one thing every harness has: a human message. Each one opens a group, and everything after it
 * belongs to that group until the next ask. Nothing here reads `turn`, so a session that has none is grouped the same
 * way as a session that has thousands.
 *
 * The map is keyed by object identity, not by `seq`: a window handed back by the host may carry events whose `seq` is
 * absent, and a map keyed on a field that is sometimes missing silently drops half the conversation.
 */
function exchangeIndexOf(events) {
    const index = new Map()
    let ordinal = -1
    for (const event of events) {
        if (isUserMessage(event)) ordinal += 1
        // THE LEADING RUN before the first ask belongs to the first group rather than to a group of its own: a
        // session that opens with narration has not asked anything yet, and `exchange: -1` would be a key no query
        // knows how to select.
        index.set(event, Math.max(ordinal, 0))
    }
    return index
}

/**
 * The REASONING blocks of a message, joined.
 *
 * `textOfMessage` DELIBERATELY drops them -- `session-format.js` records that whoever gives reasoning to the judge
 * decides it once, and that is not this file. So the row carries reasoning for COUNTING (`rowsSummary` reports
 * `reasoningChars`, and a session whose reasoning is unmeasured cannot be compared with one whose is), while the
 * composer that builds the judge's state reads `text` alone.
 */
function reasoningOf(event) {
    const content = event?.data?.message?.content ?? event?.data?.content
    if (!Array.isArray(content)) return null
    const blocks = content
        .filter((block) => block !== null && typeof block === 'object' && block.type === 'reasoning' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('\n')
        .trim()
    return blocks === '' ? null : blocks
}

/**
 * Turn dsh events into normalized rows.
 *
 * @param {object[]} events the whole window, in order
 * @param {object} receipt `{ harness, id, source, sourceBytes, sourceSha256, highWater, schemaVersion }`
 * @returns {object[]} a receipt, then one row per message and one per tool call
 */
export function normalizeEvents(events, receipt = {}) {
    const list = Array.isArray(events) ? events : []
    const onSurface = new Set(surfaceEvents(list))
    const exchangeOf = exchangeIndexOf(list)

    const rows = [{
        kind: 'receipt',
        harness: receipt.harness ?? 'dsh',
        id: receipt.id ?? null,
        source: receipt.source ?? null,
        sourceBytes: Number.isFinite(receipt.sourceBytes) ? receipt.sourceBytes : null,
        sourceSha256: receipt.sourceSha256 ?? null,
        highWater: Number.isFinite(receipt.highWater) ? receipt.highWater : (list.at(-1)?.seq ?? null),
        schemaVersion: Number.isFinite(receipt.schemaVersion) ? receipt.schemaVersion : 1,
    }]

    let ordinal = 0
    for (const event of list) {
        if (!isMessageEvent(event)) {
            // A TOOL CALL is not a message and is never counted as one. It is kept as its own row because it is
            // evidence: a question about what the agent DID needs it, and folding it into a message would make the
            // tool traffic indistinguishable from something the model said.
            if (event?.type === EVENT.TOOL_CALL) {
                rows.push({
                    kind: 'tool_call',
                    seq: event.seq ?? null,
                    exchange: exchangeOf.get(event) ?? null,
                    callId: event.data?.callId ?? event.data?.id ?? null,
                    name: event.data?.name ?? null,
                    args: event.data?.arguments ?? event.data?.args ?? null,
                    result: null,
                    outcome: null,
                })
            }
            continue
        }
        const role = ROLE_OF_EVENT.get(event.type) ?? 'assistant'
        // REASONING IS ITS OWN ROW-TYPE, not a field of the text. The rule is that absence is `null`: a message with
        // no reasoning says so, and one cannot be confused with an answer that was genuinely empty.
        const reasoning = role === 'assistant' ? reasoningOf(event) : null
        const text = textOfEvent(event)
        rows.push({
            kind: 'message',
            seq: event.seq ?? null,
            exchange: exchangeOf.get(event) ?? 0,
            ordinal: (ordinal += 1),
            role,
            type: 'text',
            text,
            reasoning: reasoning === '' ? null : reasoning,
            // THE ONE FIELD A PROJECTION WOULD GET WRONG, because it looks like a default and is not one.
            shadowed: !onSurface.has(event),
            interrupted: event.data?.interrupted === true,
        })
    }
    return rows
}

/** The rows as JSONL text, which is the shape `scripts/ask.mjs session --file` reads. */
export function rowsToJsonl(rows) {
    return (Array.isArray(rows) ? rows : []).map((row) => JSON.stringify(row)).join('\n') + '\n'
}
