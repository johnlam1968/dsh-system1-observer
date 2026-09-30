// WHAT LEAVES THE PROCESS, AND WHERE IT GOES.
//
// This plugin sends operator text and raw tool output to a third party at up to seven seams per turn. The `mount`
// line recorded the transport, the provider, the model, the seams, the sessions and the trace path -- and **never
// said what leaves or where it goes**. An operator could not answer "what does turning this on send?" without
// reading the source.
//
// THE DECLARATION IS DATA, NOT A LOG LINE, so it rides the mount record where it can also be asserted. `jevcore`
// needed a log line because it has no trace; this plugin has one, and a `logger.info` would reach a console
// nobody keeps while the trace reaches the tool, the card and `scripts/trace.mjs` for free.
//
// THE ONE FIELD THAT MATTERS MOST IS THE UNBOUNDED ONE. `maxFieldChars` bounds `state.text` alone; the configured
// question text -- instructions, every option label, every criterion, every level -- is sent verbatim, and the
// contract says so rather than listing only the fields that are under control. A contract that hides its
// unbounded term is a contract designed to look good.
import { PROBE_SEAMS, TEXTLESS_SEAMS } from './seams.js'
import { REDACTED } from './redact.js'

/** The seams that can send anything: the nine, minus the two whose payload carries no text. */
export const EGRESS_SEAMS = Object.freeze(PROBE_SEAMS.filter(seam => !TEXTLESS_SEAMS.includes(seam)))

/** The longest `state.hook` can be, which is the seam name itself. Stated so the contract is complete. */
const HOOK_CHARS = 12

/**
 * What this row would send, as data.
 *
 * `transport` says which road, `endpoint` says where it leads, and `seams` says what is on each lorry. Note that
 * `egress: false` is not a promise that nothing is sent per seam -- it is the master switch's own state, and the
 * per-seam lines below say what the switch is suppressing.
 */
export function egressFacts(input = {}) {
    const callsEnabled = input.callsEnabled !== false
    const maxFieldChars = typeof input.maxFieldChars === 'number' && input.maxFieldChars > 0 ? input.maxFieldChars : 20000
    const maxQuestionChars = typeof input.maxQuestionChars === 'number' && input.maxQuestionChars > 0 ? input.maxQuestionChars : null
    const seamsOff = Array.isArray(input.seamsOff) ? input.seamsOff : []
    const hooks = Array.isArray(input.hooks) ? input.hooks : []
    return {
        transport: typeof input.transport === 'string' ? input.transport : '(unknown)',
        endpoint: typeof input.endpoint === 'string' ? input.endpoint : '(unknown)',
        model: typeof input.model === 'string' ? input.model : null,
        egress: callsEnabled,
        // SAID IN THE OPERATOR'S OWN WORDS, because this is the line they will quote back.
        reason: callsEnabled ? null : 'calls disabled: no request is made; every seam records a skip',
        // The bound on the question text, or `null` for unbounded -- never omitted.
        questionCapChars: maxQuestionChars,
        stateTextCapChars: maxFieldChars,
        redactEnabled: input.redactEnabled !== false,
        // HOW MUCH OF A PATH THE RECORD KEEPS. Not an egress field -- it governs the local trace -- but it belongs
        // on this line because the contract's last sentence is about exactly that: what the record exposes.
        pathMode: typeof input.pathMode === 'string' ? input.pathMode : 'full',
        sessions: Array.isArray(input.sessions) ? input.sessions : null,
        subagents: input.observeSubagents === true,
        nonOperatorStreams: input.includeNonOperatorFacing === true,
        seams: EGRESS_SEAMS.map(seam => {
            if (!callsEnabled) return { seam, sends: false, because: 'callsEnabled=false' }
            if (!hooks.includes(seam)) return { seam, sends: false, because: 'not in `hooks` for this run' }
            if (seamsOff.includes(seam)) return { seam, sends: false, because: 'switched off at this seam' }
            return {
                seam,
                sends: true,
                fields: `state.hook<=${HOOK_CHARS}c state.text<=${maxFieldChars}c questions<=${maxQuestionChars === null ? 'UNBOUNDED' : `${maxQuestionChars}c`}`,
                // THE CAVEAT THE STRING MUST NOT OVERSTATE: whether a seam actually asks anything is decided per
                // FIRING (`lib/questions.js`), not here -- a seam with no configured question records a skip. The
                // per-firing `reason` remains the authority; this is what the row is configured to send.
                conditional: 'if a question is configured for this seam at that firing',
            }
        }),
    }
}

/**
 * The contract as lines a person reads.
 *
 * Pure: same facts, same strings, so a test can assert all four shapes without a live row.
 */
export function egressLines(facts) {
    if (facts === null || typeof facts !== 'object') return []
    const head = `[system1-observer] transport=${facts.transport} endpoint=${facts.endpoint}`
        + (facts.model === null || facts.model === undefined ? '' : ` model=${facts.model}`)
        + (facts.egress === false ? ` egress=OFF (${facts.reason})` : ' egress=ON')
    const lines = [head]
    for (const seam of Array.isArray(facts.seams) ? facts.seams : []) {
        if (seam.sends === true) lines.push(`[system1-observer]   SENDS  seam:${seam.seam.padEnd(13)} { ${seam.fields} }`)
        else lines.push(`[system1-observer]   off    seam:${seam.seam.padEnd(13)} (${seam.because})`)
    }
    const sessions = facts.sessions === null || facts.sessions === undefined
        ? 'sessions=(not recorded)'
        : `sessions=${facts.sessions.length === 0 ? 'NONE' : facts.sessions.join(',')}`
    lines.push(`[system1-observer]   ${sessions}  subagents=${facts.subagents ? 'yes' : 'no'}  non-operator streams=${facts.nonOperatorStreams ? 'yes' : 'no'}`)
    // THE HONEST LIMIT, IN THE CONTRACT AND NOT ONLY IN THE README. Pattern matching cannot close this: an
    // unlabelled secret in free text is invisible to it, and prose like "the password is hunter2" has no `:`,
    // no `=` and no prefix. Treat the trace file as sensitive.
    const paths = facts.pathMode === 'full'
        ? 'absolute paths are kept (set `pathMode` to `basename` or `omit` if you share the file)'
        : `absolute paths are reduced to ${facts.pathMode === 'omit' ? '[PATH]' : 'their basename'}`
    lines.push(facts.redactEnabled === false
        ? `[system1-observer]   NO REDACTION: the trace copy is written verbatim, bounded only by state.text's cap; ${paths}`
        : '[system1-observer]   the trace copy is redacted (fields whose key names a secret, and known credential shapes);'
            + ` the model still receives the raw text; ${paths}.`
            + ' Redaction is best-effort and cannot recognise an unlabelled secret in free text.')
    return lines
}

/** The one-line summary, for a reader with no room for the block. */
export function egressSummary(facts) {
    if (facts === null || typeof facts !== 'object') return 'egress: (not recorded)'
    if (facts.egress === false) return `egress OFF (${facts.reason})`
    const sending = (facts.seams ?? []).filter(seam => seam.sends === true).map(seam => seam.seam)
    const questions = facts.questionCapChars === null ? 'questions UNBOUNDED' : `questions<=${facts.questionCapChars}c`
    return `egress ON to ${facts.endpoint} · ${sending.length} seam(s) configured to send: ${sending.join(', ') || 'none'} · state.text<=${facts.stateTextCapChars}c · ${questions}`
}

/** The placeholder the redaction module uses, restated here so the contract can point at it. */
export const REDACTION_MARKER = REDACTED
