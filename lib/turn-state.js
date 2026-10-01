import { surfaceEvents } from './host/surface.js'
// `X`, THE TARGET THE TURN TRIGGER ASKS ABOUT.
//
// ROADMAP §9.6: X is an artifact, not "the operator's message", and §10.2 requires it to carry the tool calls with
// their results. This module is what turns a session's events into that artifact.
//
// THE FOUR SECTIONS FALL OUT OF THE ADMIT SEMANTICS, which is what makes this derivable rather than heuristic. The
// listener fires on an `admit` -- the operator's message opening a step -- so within the window:
//
//   the NEWEST user message .......... OPERATOR NEXT MESSAGE   (it is the admit that woke us)
//   the assistant message before it .. AGENT RESPONSE
//   the user message before that ..... OPERATOR REQUEST
//   whatever happened between them ... TOOL CALLS
//
// So the exchange the helpfulness questions are about is reconstructed from the event order, and the section that
// makes it answerable -- the agent's response AND the operator's reaction to it -- is present by construction. A
// target holding only the request cannot support a question about whether the reply helped.
//
// WHAT IT REFUSES. With no assistant message in the window there is no response to judge, and it says so instead of
// returning three empty sections that would be asked as though they were evidence. An empty section is
// indistinguishable from an absent one once it reaches the model, which is the failure this repository catalogues as
// presence-versus-absence.
import { assembleToolCalls } from './tool-blocks.js'

const textOfBlocks = (content) => {
    if (!Array.isArray(content)) return ''
    return content
        .filter((block) => block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('')
        .trim()
}

const isMessage = (event) => event !== null && typeof event === 'object'
    && (event.type === 'user/message' || event.type === 'assistant/message')
    // EITHER SHAPE. `SessionEventMap` declares `'user/message': UserMessage` -- `data` IS the message -- while
    // `assistant/message` and `tool/result` declare `data.message`. The plugin worked live against the latter, so the
    // two sources may differ; reading either is one line and defends against a shape this suite had never tried.
    && (event.data?.message !== undefined || event.data?.content !== undefined)

/**
 * The labelled target, or the reason it cannot be built.
 *
 * @returns `{ refused, reason, state, sections, unclassified, truncated }` -- `state` is the text handed to the
 * model, and `sections` is the same content kept apart so a caller can assert what it asked about.
 */
const textOfMessage = (value) => {
    if (typeof value === 'string') return value.trim()
    if (value !== null && typeof value === 'object') {
        if (typeof value.text === 'string') return value.text.trim()
        return textOfBlocks(value.content).trim()
    }
    return ''
}

/**
 * @param events      the session's events for the window
 * @param nextMessage THE OPERATOR'S OWN MESSAGE, when the caller has it directly. `agent/pre-step`'s payload
 *                    declares `messages: UserMessage[]`, so the turn boundary carries the operator's message
 *                    whether or not the session's event stream types it as `user/message` -- and a session store
 *                    that names it something else would make every turn refuse, silently, forever. Supplied text
 *                    wins over what the events say, because the payload is the boundary itself.
 */
export function composeTurnState({ events = [], nextMessage, maxChars = 8000, surfaceSeqs = null, claimedRequest = null } = {}) {
    // SEARCH THE SURFACE, NOT THE LOG. The newest message of a role is not always IN the surface: a `replace`
    // carried by another role drops a message with nothing of that role taking its place, and the role search
    // then reaches into what only the log still holds. Measured -- see the adapter module.
    // THE HOST'S ANSWER FIRST, WHEN IT IS GIVEN: `Session.surface.nodes` is the surviving seqs, which is what the
    // fold computes. WHEN THE HOST ANSWERS, THE FOLD DOES NOT RUN AT ALL -- not "runs and is then filtered": the
    // first version of this filtered the fold's output, so the host's answer could only ever SUBTRACT, and a message
    // the fold had dropped could never be kept. That is precisely the case this parameter exists for, and the test's
    // second assertion caught it. Absent or empty, the fold decides -- an empty list is not an empty surface.
    const source = Array.isArray(events) ? events : []
    const kept = Array.isArray(surfaceSeqs) && surfaceSeqs.length > 0 ? new Set(surfaceSeqs) : null
    // `surface` IS EVERY SURVIVING EVENT; `list` IS THE MESSAGES AMONG THEM. The tool window needs the FORMER:
    // `tool/call` and `tool/result` are not messages, so filtering first discarded the whole tool record.
    const surface = kept === null ? surfaceEvents(source) : source.filter((event) => kept.has(event?.seq))
    const list = surface.filter(isMessage)
    // A TOOL RESULT ARRIVES ON THE USER CHANNEL AND IS NOT THE OPERATOR. The harness delivers a tool's result as a
    // `user/message`, so "the newest user message" is the tool result half the time -- measured here when the
    // request resolved to an empty tool-result message and the tool window then started AFTER the call it was
    // meant to contain. An operator message is one that carries text; a delivery that carries a result is not a
    // turn boundary and must never be read as one.
    const messages = list.map((event) => {
        const role = event.type === 'user/message' ? 'user' : 'assistant'
        const text = textOfBlocks((event.data?.message?.content ?? event.data?.content) ?? [])
        return { seq: event.seq, role, text, operator: role === 'user' && text !== '' }
    })

    let next = -1
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index].operator) { next = index; break }
    }
    // THE ANNOUNCED BOUNDARY, WHEN THE HARNESS GAVE ONE. `agent/inbox/claimed` says which message OPENS this turn,
    // located by seq when both sides carry one and by TEXT otherwise: seq and role are bookkeeping, and agreeing on
    // them while disagreeing on content is the failure that comparison exists to catch.
    let claimed = -1
    if (claimedRequest !== null && claimedRequest !== undefined) {
        const wanted = claimedRequest.message ?? null
        const wantedSeq = typeof claimedRequest.seq === 'number' ? claimedRequest.seq : (typeof wanted?.seq === 'number' ? wanted.seq : null)
        const wantedText = textOfMessage(wanted)
        for (let index = messages.length - 1; index >= 0; index -= 1) {
            if (!messages[index].operator) continue
            const seqMatches = wantedSeq !== null && messages[index].seq === wantedSeq
            const textMatches = wantedText !== '' && messages[index].text === wantedText
            if (seqMatches || textMatches) { claimed = index; break }
        }
    }
    const supplied = textOfMessage(nextMessage)
    if (next === -1 && supplied === '') {
        return { refused: true, reason: 'no operator message in the window, so there is no exchange to judge' }
    }
    // WHERE THE RESPONSE SEARCH STARTS, and the supplied message changes the answer. When the caller hands over the
    // REACTION -- which is what `nextMessage` is -- then the newest operator message IN THE EVENTS is not the
    // reaction at all: it is the REQUEST. Taking it for the reaction put the boundary at the request's own index, so
    // the search looked before the request and found no response, and EVERY turn refused with "no agent response in
    // the window". Measured with an exchange of request, tool call, result and reply, which refused for exactly that
    // reason. So a supplied reaction searches the whole window; only without one is the newest operator message
    // taken as the boundary.
    // WITH AN ANNOUNCED REQUEST THE WINDOW IS EXACT: it ENDS where the next exchange begins, or at the end of the
    // list. `boundary` is EXCLUSIVE -- the response search below runs backwards from `boundary - 1` -- which is the
    // arithmetic that failed first time round by containing only the request.
    let boundary
    if (claimed !== -1) {
        boundary = messages.length
        for (let index = claimed + 1; index < messages.length; index += 1) {
            if (messages[index].operator) { boundary = index; break }
        }
    } else {
        boundary = supplied !== '' || next === -1 ? messages.length : next
    }

    let response = -1
    for (let index = boundary - 1; index >= 0; index -= 1) {
        if (messages[index].role === 'assistant') { response = index; break }
    }
    if (response === -1) {
        return { refused: true, reason: 'no agent response in the window, so there is nothing to judge: a refusal is clearer than an empty section' }
    }

    let request = claimed
    if (request === -1) {
        for (let index = response - 1; index >= 0; index -= 1) {
            if (messages[index].operator) { request = index; break }
        }
    }

    // The tool calls of THIS exchange: from the request through the response, exclusive of the operator's reply.
    const windowStart = (request === -1 ? 0 : messages[request].seq) ?? 0
    const responseSeq = messages[response].seq
    // includeText: false -- the agent's words are the AGENT RESPONSE section, and a target that repeats them
    // spends its budget twice on the same evidence.
    const tools = assembleToolCalls(surface.filter((event) => (event.seq ?? 0) >= windowStart && (event.seq ?? 0) <= responseSeq), { includeText: false })

    const sections = {
        'OPERATOR REQUEST': request === -1 ? '(not in the window)' : messages[request].text,
        'AGENT RESPONSE': messages[response].text,
        'TOOL CALLS': tools.text,
        // NO SUPPLIED REACTION, BUT AN ANNOUNCED REQUEST, MEANS THE OPERATOR HAS NOT REPLIED YET. Without this the
        // section repeats the turn's OWN REQUEST under a heading that says NEXT -- and `operator_next_message_kind`,
        // whose abstain option is "OPERATOR NEXT MESSAGE is 'none yet' or absent", then answers about a message that is
        // not a reaction at all. That is exactly the state the trigger move to `agent/turn-stopping` creates: the
        // harness announces which message OPENED the turn, and the turn is closing, so no reply exists.
        'OPERATOR NEXT MESSAGE': supplied !== '' ? supplied : (claimed !== -1 ? 'none yet' : messages[next].text),
    }

    let state = Object.entries(sections)
        .map(([label, body]) => `${label}:\n${body === '' || body === undefined ? '(none)' : body}`)
        .join('\n\n')
    let truncated = false
    if (state.length > maxChars) {
        state = state.slice(0, maxChars)
        truncated = true
    }
    return { refused: false, reason: null, state, sections, unclassified: tools.unclassified, truncated }
}
