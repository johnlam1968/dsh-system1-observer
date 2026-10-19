// THE NORMALIZED SESSION ROWS -- one shape, every harness, and the four rules it exists to enforce.
//
// WHY THIS EXISTS RATHER THAN A dsh EVENT LOG. A session is a conversation; dsh is one way of writing one down. The
// measured reason this is not a dsh shape: pi has NO TURN AT ALL -- all 44 pi messages in the surveyed corpus carried a
// null turn -- so anything keying on `turn` silently became a dsh-ONLY query while appearing cross-harness
// (`docs/adapters-and-standards.md`, "The normalized schema, tested rather than proposed"). The failure is silent, and
// a silent failure that returns a complete-looking answer is the one this repository keeps recording.
//
// WHAT A ROW IS. One JSON object per line. A session is a RECEIPT, then MESSAGES, TOOL CALLS and FACTS. The receipt
// comes first because a measurement that cannot name the bytes it read cannot be reproduced or argued with.
//
// THE FOUR RULES, each enforced below rather than described:
//   1. `exchange` is the boundary, and it is an ASK-GROUP -- never a native turn. `validateRows` refuses a `turn`.
//   2. `shadowed` is required. 3,417 messages in one dsh session sit inside a compaction `replace` range: the log holds
//      what the surface no longer does, so an absent flag measures text the model cannot see while looking complete.
//   3. A malformed line is COUNTED with its line number, never dropped. A reader that skips what it cannot parse returns
//      a shorter session that answers every question correctly and about the wrong conversation.
//   4. Absence is `null`, never `''` and never `0`. There is no reasoning is not zero-length reasoning.
//
// NO HARNESS APPEARS HERE. Nothing in this file imports a vocabulary, a `ctx`, or a session reader -- that is what lets
// the same function serve a dsh log, a pi transcript and a web export, and it is checked rather than asserted by
// `test/instrument-boundary.test.js`, which walks the closure from `scripts/ask.mjs`.

/** Every row kind, so a producer cannot invent one. */
export const ROW_KINDS = Object.freeze(['receipt', 'message', 'tool_call', 'fact'])

/** The roles a message may carry. Anything else is a producer that has drifted from this contract. */
export const MESSAGE_ROLES = Object.freeze(['user', 'assistant', 'system', 'developer', 'tool'])

/** The message body kinds. `text` and `reasoning` are separate, so a count of one is not a count of the other. */
export const MESSAGE_TYPES = Object.freeze(['text', 'reasoning'])

/**
 * Read rows from JSONL text.
 *
 * @param {string} text
 * @returns {{ rows: object[], malformed: { line: number, reason: string, raw: string }[] }}
 */
export function readRowsJsonl(text) {
    const rows = []
    const malformed = []
    const lines = String(text ?? '').split('\n')
    for (let index = 0; index < lines.length; index += 1) {
        const raw = lines[index]
        // A BLANK LINE IS NOT A MALFORMED LINE. A trailing newline is how files end; reporting it as corruption would
        // make every well-formed session look damaged, and a reader that cries wolf is a reader that gets ignored.
        if (raw.trim() === '') continue
        try {
            const row = JSON.parse(raw)
            if (row === null || typeof row !== 'object' || Array.isArray(row)) {
                malformed.push({ line: index + 1, reason: 'not an object', raw: raw.slice(0, 120) })
                continue
            }
            rows.push(row)
        } catch (error) {
            malformed.push({ line: index + 1, reason: error.message, raw: raw.slice(0, 120) })
        }
    }
    return { rows, malformed }
}

/**
 * Everything wrong with a set of rows, in words a producer can act on.
 *
 * An empty array means the rows are usable. This is a LIST rather than a throw because a caller holding a real session
 * needs to say what is wrong with it, and a caller holding a synthetic one wants the same answer: a bare `Error` names
 * the field in a stack frame, and this names it in a sentence attached to the row.
 *
 * @param {object[]} rows
 * @returns {string[]}
 */
export function validateRows(rows) {
    const problems = []
    const list = Array.isArray(rows) ? rows : []
    if (list.length === 0) return ['no rows: an empty session has nothing to measure, and is not the same as a session that failed to parse']

    let receipt = 0
    list.forEach((row, index) => {
        const at = `row ${index + 1}`
        if (!ROW_KINDS.includes(row.kind)) {
            problems.push(`${at}: kind ${JSON.stringify(row.kind)} is not one of ${ROW_KINDS.join(', ')}`)
            return
        }
        if (row.kind === 'receipt') {
            receipt += 1
            if (typeof row.sourceSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(row.sourceSha256)) {
                problems.push(`${at}: receipt needs a sourceSha256 of 64 hex characters, or the measurement names nothing it read`)
            }
            if (!Number.isFinite(row.highWater)) problems.push(`${at}: receipt needs highWater, so a reader knows how far this window reaches`)
            return
        }
        // RULE 1. The exchange is what makes a per-exchange query mean anything, and a native `turn` is refused rather
        // than ignored: a producer that reaches for one is the dsh-shaped producer this contract exists to catch.
        if (!('exchange' in row)) problems.push(`${at}: no exchange -- a boundary is derived from the asks, and this harness may have no turn`)
        if ('turn' in row) problems.push(`${at}: carries a native \`turn\`; the boundary is the ask-group (\`exchange\`), because a harness with no turn would otherwise read as a dsh-only session`)
        if (row.kind !== 'message') return
        if (!MESSAGE_ROLES.includes(row.role)) problems.push(`${at}: role ${JSON.stringify(row.role)} is not one of ${MESSAGE_ROLES.join(', ')}`)
        if (!MESSAGE_TYPES.includes(row.type)) problems.push(`${at}: type ${JSON.stringify(row.type)} is not one of ${MESSAGE_TYPES.join(', ')}`)
        // RULE 2. The absence of this flag is the failure it was added for, so it is refused rather than defaulted.
        if (typeof row.shadowed !== 'boolean') problems.push(`${at}: no \`shadowed\` -- its absence is a value, because the log holds what the surface no longer does`)
        // RULE 4. `null` is how a row says "there was none". An empty string would be indistinguishable from an answer
        // that was genuinely empty, which is the difference between "no reasoning" and "some, of length zero".
        if (!('reasoning' in row)) problems.push(`${at}: no \`reasoning\` field; absence is null, never an absent key`)
    })

    if (receipt !== 1) problems.push(`a session needs exactly one receipt, and this has ${receipt}`)
    return problems
}

/**
 * The receipt: what these rows are, and which bytes they came from.
 *
 * @param {object[]} rows
 * @returns {{ harness: string, id: string, source: string, sourceBytes?: number, sourceSha256: string, highWater: number, schemaVersion?: number } | null}
 */
export function receiptOf(rows) {
    const found = (Array.isArray(rows) ? rows : []).find((row) => row?.kind === 'receipt')
    if (!found) return null
    return {
        harness: found.harness ?? null,
        id: found.id ?? null,
        source: found.source ?? null,
        sourceBytes: Number.isFinite(found.sourceBytes) ? found.sourceBytes : null,
        sourceSha256: found.sourceSha256 ?? null,
        highWater: Number.isFinite(found.highWater) ? found.highWater : null,
        schemaVersion: Number.isFinite(found.schemaVersion) ? found.schemaVersion : null,
    }
}

/** The messages, in order. A receipt or a tool call is not a message and is never counted as one. */
function messagesOf(rows) {
    return (Array.isArray(rows) ? rows : []).filter((row) => row?.kind === 'message')
}

/**
 * The exchanges -- one per ASK-GROUP, which is the unit every harness shares.
 *
 * A dsh `turn` is a harness fact; an ask-group is derived from where the human spoke. pi has no turn and mcode's
 * boundary is its own, so grouping by `exchange` is what lets one query answer for all three. An exchange with no
 * answer still appears: "asked and never answered" is a finding, and a grouping that dropped it would report a
 * conversation as merely shorter.
 *
 * @param {object[]} rows
 * @returns {{ exchange: string|number, asks: object[], answers: object[], toolCalls: object[], shadowed: number }[]}
 */
export function exchangesOfRows(rows) {
    const byExchange = new Map()
    for (const row of Array.isArray(rows) ? rows : []) {
        if (row?.kind !== 'message' && row?.kind !== 'tool_call') continue
        const key = row.exchange
        if (!byExchange.has(key)) byExchange.set(key, [])
        byExchange.get(key).push(row)
    }
    return [...byExchange.entries()].map(([exchange, list]) => {
        const messages = list.filter((row) => row.kind === 'message')
        return {
            exchange,
            asks: messages.filter((row) => row.role === 'user'),
            answers: messages.filter((row) => row.role === 'assistant'),
            toolCalls: list.filter((row) => row.kind === 'tool_call'),
            // Counted from the flags rather than inferred from the absence of one, per RULE 2.
            shadowed: messages.filter((row) => row.shadowed === true).length,
        }
    })
}

/**
 * The measurement window, cut into contiguous runs of messages by TEXT SIZE.
 *
 * A SINGLE MESSAGE OVER THE BUDGET IS ITS OWN SEGMENT. A question's criteria refer to messages, so cutting one in half
 * would ask about a piece of an answer as though it were one; the caller sees `chars` and can see it is over budget
 * rather than being handed a comfortable lie.
 *
 * `from` and `to` INDEX THE MESSAGES, not the rows. A receipt and a tool call are rows and are not messages, so an
 * index that meant "row" would land on the receipt. This matches `dsh/segment.js`, which indexes its `messages`
 * argument the same way, and it is stated because the two are otherwise easy to read as interchangeable.
 *
 * @param {object[]} rows
 * @param {{ maxChars?: number }} [options]
 * @returns {{ index: number, from: number, to: number, messages: number, chars: number }[]}
 */
export function segmentsOfRows(rows, { maxChars = 57600 } = {}) {
    const list = messagesOf(rows)
    const budget = Number.isFinite(maxChars) && maxChars > 0 ? Math.floor(maxChars) : 57600
    const segments = []
    let start = 0
    let chars = 0
    const close = (end) => {
        if (end <= start) return
        segments.push({ index: segments.length, from: start, to: end, messages: end - start, chars })
    }
    for (let index = 0; index < list.length; index += 1) {
        const size = typeof list[index].text === 'string' ? list[index].text.length : 0
        if (chars > 0 && chars + size > budget) {
            close(index)
            start = index
            chars = 0
        }
        chars += size
    }
    close(list.length)
    return segments
}

/**
 * What a session contains, counted from the rows themselves.
 *
 * Every number here is a COUNT OF SOMETHING PRESENT. Nothing is inferred from a row that failed to parse, and no
 * missing field contributes a zero -- a caller that wants to know whether a session had reasoning asks
 * `reasoningChars > 0` about rows that declare it, and `rowsSummary` has already refused the ones that do not.
 *
 * @param {object[]} rows
 * @returns {{ messages: number, toolCalls: number, exchanges: number, shadowed: number, reasoningChars: number, visibleChars: number, shadowedChars: number }}
 */
export function rowsSummary(rows) {
    const list = Array.isArray(rows) ? rows : []
    const messages = messagesOf(list)
    const exchanges = new Set(messages.map((row) => row.exchange))
    let reasoningChars = 0
    let visibleChars = 0
    let shadowedChars = 0
    for (const row of messages) {
        // RULE 4. Only a row that HAS reasoning contributes, and only a row whose text is a string contributes chars.
        if (typeof row.reasoning === 'string') reasoningChars += row.reasoning.length
        const size = typeof row.text === 'string' ? row.text.length : 0
        if (row.shadowed === true) shadowedChars += size
        else visibleChars += size
    }
    return {
        messages: messages.length,
        toolCalls: list.filter((row) => row?.kind === 'tool_call').length,
        exchanges: exchanges.size,
        shadowed: messages.filter((row) => row.shadowed === true).length,
        reasoningChars,
        visibleChars,
        shadowedChars,
    }
}
