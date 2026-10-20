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
import { EVENT, contentOf, isHumanMessage, isMessageEvent, textOfEvent } from './session-adapter/lib/session-format.js'
import { surfaceEvents } from './session-adapter/lib/surface.js'
// THE RULES THE PACKAGE OWNS, USED AS THE PACKAGE'S. The ask-group, the reasoning and the NUL rule are said once,
// in `dsh-session-rows`, and this producer imports them instead of carrying its own copy: two producers that each
// restate a rule are two producers that can disagree about it, and every one of those disagreements was silent.
import { exchangeIndexOf, reasoningOf, withoutNuls } from 'dsh-session-rows'

/** The dsh role -> the normalized role. A harness fact that has to be said once, in one place. */
const ROLE_OF_EVENT = new Map([
    [EVENT.USER_MESSAGE, 'user'],
    [EVENT.ASSISTANT_MESSAGE, 'assistant'],
    [EVENT.SYSTEM_MESSAGE, 'system'],
    [EVENT.DEVELOPER_MESSAGE, 'developer'],
    [EVENT.TOOL_CALL, 'tool'],
])

/**
 * THE ROLE OF ONE EVENT, and the one place the producer asks who spoke.
 *
 * A `user/message` is the HUMAN only when its `data.source.kind` says so. The harness speaks on the same channel --
 * a skill catalogue, a goal, a runtime context -- and the event type cannot tell them apart. So an injection is
 * `system` here: it is context the agent was given, it is not an ask, and `exchangesOfRows` counts a group's asks as
 * the rows whose role is `user`. The contract has no `harness` role and does not need one: the harness speaking IS
 * the system, and naming it that way keeps the row in the group instead of dropping the evidence.
 *
 * Measured on one real session: 753 `user/message` events, 403 of them the human. Counting the type instead of the
 * speaker inflated the ask count by 86.8% and opened an ask-group for every injection.
 */
function roleOfEvent(event) {
    if (event?.type === EVENT.USER_MESSAGE) return isHumanMessage(event) ? 'user' : 'system'
    return ROLE_OF_EVENT.get(event?.type) ?? 'assistant'
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
    // THE ASK-GROUP, BY POSITION. The rule is the package's -- each human message opens a group, everything after it
    // belongs to that group until the next ask, and the leading run belongs to the first group -- and it is returned
    // as one index per record rather than a map, because a record's position in the stream IS its identity here: a
    // window handed back by the host may carry records whose `seq` is absent, and a map keyed on a field that is
    // sometimes missing silently drops half the conversation.
    const exchangeOf = exchangeIndexOf(list)

    // THE HARNESS NAMES ITS FORMAT TOO, and the two channels must agree on that. The reader that reads an index says
    // `dsh:v4` -- the index's own `format` column -- while this used to say `dsh`, so the SAME session measured from
    // the log and measured from the index carried two DIFFERENT RECEIPTS, and the receipt is the anchor a measurement
    // is argued from. The version is the log's own header, read the way the store reads it.
    const header = list.find((event) => event?.type === 'session' && Number.isInteger(event?.version))
    const named = String(receipt.harness ?? 'dsh')
    const harness = header !== undefined && !named.includes(':') ? `${named}:v${header.version}` : named

    const rows = [{
        kind: 'receipt',
        harness,
        id: receipt.id ?? null,
        source: receipt.source ?? null,
        sourceBytes: Number.isFinite(receipt.sourceBytes) ? receipt.sourceBytes : null,
        sourceSha256: receipt.sourceSha256 ?? null,
        highWater: Number.isFinite(receipt.highWater) ? receipt.highWater : (list.at(-1)?.seq ?? null),
        schemaVersion: Number.isFinite(receipt.schemaVersion) ? receipt.schemaVersion : 1,
    }]

    let ordinal = 0
    for (const [position, event] of list.entries()) {
        if (!isMessageEvent(event)) {
            // A TOOL CALL is not a message and is never counted as one. It is kept as its own row because it is
            // evidence: a question about what the agent DID needs it, and folding it into a message would make the
            // tool traffic indistinguishable from something the model said.
            if (event?.type === EVENT.TOOL_CALL) {
                rows.push({
                    kind: 'tool_call',
                    seq: event.seq ?? null,
                    exchange: exchangeOf[position] ?? null,
                    callId: event.data?.callId ?? event.data?.id ?? null,
                    // AND THE NAME AND THE ARGUMENTS CARRY NO NUL, because the index channel would store the bytes
                    // before the first one and drop the rest -- a name became an EMPTY STRING in the index where the
                    // log held one, and an empty name is not a name. Measured: 2 of 201 tool calls in one session.
                    name: withoutNuls(event.data?.name ?? null),
                    args: withoutNuls(event.data?.arguments ?? event.data?.args ?? null),
                    result: null,
                    outcome: null,
                })
            }
            continue
        }
        const role = roleOfEvent(event)
        // REASONING IS ITS OWN ROW-TYPE, not a field of the text. The rule is that absence is `null`: a message with
        // no reasoning says so, and one cannot be confused with an answer that was genuinely empty.
        // THE REASONING, BY THE RECORD TYPE. The content is resolved by the record's own type and then handed to the
        // package's rule, so this producer and the store -- which resolves by type too -- cannot end up with two
        // different reasonings for one record. A reader that looks for the content elsewhere finds text a record does
        // not have, and two producers produce two rows for one record.
        const reasoning = role === 'assistant' ? reasoningOf(contentOf(event)) : null
        const text = textOfEvent(event)
        rows.push({
            kind: 'message',
            seq: event.seq ?? null,
            exchange: exchangeOf[position] ?? 0,
            ordinal: (ordinal += 1),
            role,
            type: 'text',
            // THE TEXT AND THE REASONING CARRY NO NUL BYTE, and the reason is the index channel: `node:sqlite` binds a
            // string with NUL-terminated semantics, so a message whose text held one was 100 characters in this file and
            // ELEVEN in the index -- the 89 characters after the NUL were not shortened, they were gone, and the row read
            // as though the model had said less. Measured on the live corpus: 67 messages in 1 of 946 sessions, and the
            // two channels composed different sessions because of it. The rule is the contract's (RULE 7) and the fix is
            // U+FFFD, so the text keeps its length and both channels produce the same characters.
            text: withoutNuls(text),
            reasoning: reasoning === '' ? null : withoutNuls(reasoning),
            // THE ONE FIELD A PROJECTION WOULD GET WRONG, because it looks like a default and is not one.
            shadowed: !onSurface.has(event),
            // AND `interrupted` IS A FACT, OR IT IS ABSENCE. A dsh v4 `assistant/message` carries `interrupted` only
            // when it was interrupted, so reading it as `=== true` answered `false` for every message that never said
            // anything about it -- and `false` is a CLAIM ("this message was not interrupted") from a reader that never
            // looked. Measured: 278 of 282 message rows in 120 live sessions carried no such field, and the index
            // channel, which has no column for it, said `null` for all of them -- so the two channels disagreed on
            // 100% of messages, on a field this contract had just made mandatory. Absence is `null`.
            interrupted: typeof event.data?.interrupted === 'boolean' ? event.data.interrupted : null,
        })
    }
    return rows
}

/** The rows as JSONL text, which is the shape `scripts/ask.mjs session --file` reads. */
export function rowsToJsonl(rows) {
    return (Array.isArray(rows) ? rows : []).map((row) => JSON.stringify(row)).join('\n') + '\n'
}
