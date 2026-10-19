// THE NORMALIZED SESSION ROWS -- one shape, every harness, and the rules it exists to enforce.
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
// THE RULES, each enforced below rather than described:
//   1. `exchange` is the boundary, and it is an ASK-GROUP -- never a native turn. `validateRows` refuses a `turn`.
//   2. `shadowed` is required. 3,417 messages in one dsh session sit inside a compaction `replace` range: the log holds
//      what the surface no longer does, so an absent flag measures text the model cannot see while looking complete.
//   3. A malformed line is COUNTED with its line number, never dropped. A reader that skips what it cannot parse returns
//      a shorter session that answers every question correctly and about the wrong conversation.
//   4. Absence is `null`, never `''` and never `0`. There is no reasoning is not zero-length reasoning.
//   5. A message's text is TRIMMED. Measured, and it was not a theory: the observer's producer trimmed it and the
//      store's did not, so one message had two texts -- 58 characters in one channel, 59 in the other, the difference
//      being a trailing space -- and 53 of the 946 sessions in the live corpus differ that way. The consequence is
//      not cosmetic: the `stateHash` of a measurement is made of the text, so a reading taken from the index and a
//      reading taken from the file are DIFFERENT READINGS of one session, and neither can say so.
//   6. `interrupted` is PRESENT, and `null` means nobody said -- not "it was not interrupted".
//   7. A row carries NO NUL BYTE. Measured: a message's text held one, and `node:sqlite` binds a string with
//      NUL-terminated semantics, so the index stored the 11 characters before the NUL and dropped the 89 after it.
//      One session in 946 composed differently for that reason alone, and two tool-call names became empty strings
//      where the log held a name. The fix is stated, not hoped for: `withoutNuls` below, applied by every producer.
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
 * THE REPLACEMENT CHARACTER, and the one byte a row may not carry.
 *
 * WHY A NUL IS A PROBLEM, measured rather than supposed. `node:sqlite` binds a JavaScript string with
 * NUL-terminated semantics: the value stored is the bytes before the first NUL and nothing after it. So a message whose
 * text carried one NUL was 100 characters in the log and **11** characters in the index -- the 89 characters after the
 * NUL were not shortened, they were GONE, and the row read as though the model had said less. Measured on the live
 * corpus: 67 messages in 1 of 946 sessions, and 2 tool-call names that became empty strings where the log held one.
 * The consequence is the one this contract exists to prevent -- the two channels composed DIFFERENT sessions, and the
 * composed state is what a measurement's `stateHash` is made of.
 *
 * WHY U+FFFD AND NOT A DELETION. A NUL is not a character anybody reads, and every consumer downstream of here -- a
 * JSONL file, an HTTP body, a model's context window -- either truncates at one or mangles it. U+FFFD is the standard
 * marker for a byte that could not be represented, so the text KEEPS ITS LENGTH, the reader can see that something was
 * there, and both channels produce the same characters. A silent deletion would make the two channels agree too, and
 * would do it by throwing away evidence.
 *
 * This lives in `core/` and imports nothing, because the store needs the same rule and the contract is where a rule
 * that two producers must obey belongs. The store carries its own copy of it until the shared half is extracted.
 */
export const REPLACEMENT_CHARACTER = '\uFFFD'

/**
 * The same string, with every NUL replaced by U+FFFD. A non-string is returned unchanged.
 *
 * @param {string} value
 * @returns {string}
 */
export function withoutNuls(value) {
    if (typeof value !== 'string') return value
    if (!value.includes('\u0000')) return value
    return value.split('\u0000').join(REPLACEMENT_CHARACTER)
}

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
        // EVERY ROW BELONGS TO A GROUP, so a null exchange is a defect rather than an absence. It is also what a reader
        // produces when the source could not supply one -- an index built before `exchange` existed, say -- and the
        // difference between "this row has no group" and "nobody could tell me the group" is one a reader cannot see.
        // Reporting it here is what stops that from becoming a silent null in a measurement.
        if (row.exchange === null || row.exchange === undefined) problems.push(`${at}: no exchange -- every row belongs to an ask-group, and a null one means the producer could not supply it`)
        if ('turn' in row) problems.push(`${at}: carries a native \`turn\`; the boundary is the ask-group (\`exchange\`), because a harness with no turn would otherwise read as a dsh-only session`)
        // RULE 7. A row carries NO NUL BYTE, and this is the rule the index channel cannot survive without. The
        // producer applies `withoutNuls`; the contract refuses a row that still carries one, because a row that reaches
        // one channel whole and the other cut short is TWO rows -- and the composed state, which is what a
        // measurement's `stateHash` is made of, differs. Measured: 67 messages in 1 of 946 sessions.
        if (row.kind === 'tool_call') {
            for (const field of ['name', 'args']) {
                if (typeof row[field] === 'string' && row[field].includes('\u0000')) {
                    problems.push(`${at}: tool call ${field} carries a NUL byte; the index channel stores the bytes before the first NUL and drops the rest, so this row would be two rows`)
                }
            }
        }
        if (row.kind !== 'message') return
        if (!MESSAGE_ROLES.includes(row.role)) problems.push(`${at}: role ${JSON.stringify(row.role)} is not one of ${MESSAGE_ROLES.join(', ')}`)
        if (!MESSAGE_TYPES.includes(row.type)) problems.push(`${at}: type ${JSON.stringify(row.type)} is not one of ${MESSAGE_TYPES.join(', ')}`)
        // RULE 2. The absence of this flag is the failure it was added for, so it is refused rather than defaulted.
        if (typeof row.shadowed !== 'boolean') problems.push(`${at}: no \`shadowed\` -- its absence is a value, because the log holds what the surface no longer does`)
        // RULE 4. `null` is how a row says "there was none". An empty string would be indistinguishable from an answer
        // that was genuinely empty, which is the difference between "no reasoning" and "some, of length zero".
        if (!('reasoning' in row)) problems.push(`${at}: no \`reasoning\` field; absence is null, never an absent key`)
        // RULE 5. The text is trimmed, and the two channels that produce rows must produce the SAME text. A trailing
        // space is invisible in a rendering and load-bearing in a hash: the `stateHash` of a measurement is made of this
        // text, so a producer that keeps the whitespace and a producer that drops it do not measure the same session --
        // they measure two, and both of them look right.
        if (typeof row.text === 'string' && row.text !== row.text.trim()) {
            problems.push(`${at}: text carries leading or trailing whitespace; the contract's text is trimmed, so every channel reads the same message as the same text`)
        }
        // AND THE REASONING IS TRIMMED TOO, because both producers trim it and the same hash is made of it.
        if (typeof row.reasoning === 'string' && row.reasoning !== row.reasoning.trim()) {
            problems.push(`${at}: reasoning carries leading or trailing whitespace; the contract's reasoning is trimmed, like the text`)
        }
        // RULE 6. `interrupted` is a FACT, and a reader that cannot supply it says so. The index has no column for it,
        // so the reader that reads an index says `null`; the producer that read a log says `true` or `false`. `false`
        // would be a claim -- "this message was not interrupted" -- from a reader that never looked.
        if (!('interrupted' in row)) problems.push(`${at}: no \`interrupted\` field; absence is null, and null means nobody said`)
        // RULE 7, ON THE MESSAGE BODY. A NUL in the text or the reasoning is a row the index channel would cut in half,
        // and the cut is invisible: the row reads as a short answer rather than as a damaged one.
        for (const field of ['text', 'reasoning']) {
            if (typeof row[field] === 'string' && row[field].includes('\u0000')) {
                problems.push(`${at}: ${field} carries a NUL byte; replace it with U+FFFD, because the index channel stores the bytes before the first NUL and drops the rest`)
            }
        }
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
 * **EACH SEGMENT CARRIES ITS OWN ROWS**, under the key `events`, and that is not a naming whim: `dsh/measure.js`
 * composes every segment from `part.events`, and the dsh cut has always returned them. This cut did not, so the
 * standalone's measure route -- the one that reads a normalized session, whether it came from a log or an index --
 * threw `Cannot read properties of undefined (reading 'filter')` on its first segment, every time. The unit test
 * agreed with the implementation because it only ever drove the DSH cut, so the two were wrong in the same shape.
 *
 * The slice runs from the FIRST covered message to the LAST, so the tool calls between them travel with the messages
 * they answered -- the same reason `dsh/segment.js` widens its window to the events between the first and the last
 * covered message. And the window is found by IDENTITY, exactly as that module finds its own: the rows carry no
 * index to slice by, and a window built from a field that is sometimes missing is a window nothing can verify.
 *
 * @param {object[]} rows
 * @param {{ maxChars?: number }} [options]
 * @returns {{ index: number, from: number, to: number, messages: number, chars: number, events: object[] }[]}
 */
export function segmentsOfRows(rows, { maxChars = 57600 } = {}) {
    const all = Array.isArray(rows) ? rows : []
    const list = messagesOf(all)
    const budget = Number.isFinite(maxChars) && maxChars > 0 ? Math.floor(maxChars) : 57600
    const segments = []
    let start = 0
    let chars = 0
    const close = (end) => {
        if (end <= start) return
        const first = all.indexOf(list[start])
        const last = all.indexOf(list[end - 1])
        segments.push({
            index: segments.length, from: start, to: end, messages: end - start, chars,
            events: first === -1 || last === -1 ? list.slice(start, end) : all.slice(first, last + 1),
        })
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
