// THE DSH SESSION VOCABULARY -- the one place in `lib/` that names the harness's event types and reads its two
// message shapes.
//
// WHY THIS EXISTS. Everything here was spread across the callers, and spread knowledge drifts:
//
//   * THE TWO-SHAPE READER WAS WRITTEN TWICE, WITH TWO DIFFERENT RULES. `lib/session-subject.js` took `.text` from
//     ANY content block and joined them with a SPACE; `lib/turn-state.js` took only `block.type === 'text'` and
//     joined with NOTHING. So the character counts included reasoning text that the judge never received, and every
//     boundary between two text blocks invented a character the model never emitted. `F78` is the same duplication
//     one layer down: the shape fix had to be made twice, because the reader lived twice.
//
//   * THE EVENT-NAME LITERALS WERE SCATTERED, which is what the second test in `test/session-format.test.js` now
//     prevents: a bare `'user/message'` outside this file fails, so a second harness is a file to replace rather
//     than a search to run.
//
// THE SHAPES ARE THE HARNESS'S, AND THEY ARE DECLARED, NOT GUESSED. `packages/core/session/src/types.ts` in the
// harness checkout:
//
//   'user/message': UserMessage            -- `data` IS the message, so the text is at `data.content`
//   'assistant/message': { turn, step, message: AssistantMessage, stream, usage?, interrupted? }
//                                          -- so the text is at `data.message.content`
//   'turn/start' / 'turn/end'              -- a turn may close with NO step (rejection, empty input, cancellation)
//   'tool/call' / 'tool/result'            -- the working record, which are NOT message events
//
// and `types.ts:309` documents the `source` that separates the three kinds of `user/message`: a direct human
// prompt, a synthetic `agent.inject()` context, or an entered goal continuation round.
//
// WHAT IS *NOT* HERE, ON PURPOSE. Which of those events a measurement SELECTS -- the human's asks rather than the
// harness's injections, G0 rather than G1 -- is this plugin's business logic, not the harness's vocabulary. That
// distinction is the whole reason a session-handling plugin can be replaced without touching the measurement:
// **the format is theirs, the selections are ours.**

/** The harness event types this plugin names. Values are the harness's, from `core/session/src/types.ts`. */
export const EVENT = Object.freeze({
    USER_MESSAGE: 'user/message',
    ASSISTANT_MESSAGE: 'assistant/message',
    TOOL_CALL: 'tool/call',
    TOOL_RESULT: 'tool/result',
    SYSTEM_MESSAGE: 'system/message',
    DEVELOPER_MESSAGE: 'developer/message',
    TURN_START: 'turn/start',
    TURN_END: 'turn/end',
    STEP_START: 'step/start',
    STEP_END: 'step/end',
    AGENT_TURN_STOPPING: 'agent/turn-stopping',
    SESSION_EVENT: 'session/event',
})

/** The `source.kind` a DIRECT HUMAN prompt carries. The other kinds are the harness speaking on the same channel. */
export const HUMAN_SOURCE_KIND = 'user'

/** The `source.kind` of one event, or `''` when the event declares none. */
export function sourceKindOf(event) {
    return String(event?.data?.source?.kind ?? '')
}

/** Whether an event is a `user/message`, whatever its source. Says nothing about who sent it. */
export function isUserMessage(event) {
    return event?.type === EVENT.USER_MESSAGE
}

/** Whether an event is an `assistant/message`. */
export function isAssistantMessage(event) {
    return event?.type === EVENT.ASSISTANT_MESSAGE
}

/** Whether an event is one of the two MESSAGE types -- the pair that carries conversation rather than traffic. */
export function isMessageEvent(event) {
    return isUserMessage(event) || isAssistantMessage(event)
}

/** Whether an event is tool traffic, which travels BESIDE the messages rather than inside them. */
export function isToolTraffic(event) {
    return event?.type === EVENT.TOOL_CALL || event?.type === EVENT.TOOL_RESULT
}

/**
 * The text of a content-block array, as the JUDGE receives it.
 *
 * `text` blocks only, joined with nothing. Reasoning is NOT included: the judge has never been given it, and folding
 * it in now would change what every reading means. That omission is recorded as `F79` -- the format supports a
 * `reasoning` block (`trajectory-event-projection.ts:94`), and a session that contains one has it dropped here
 * silently. Whoever gives reasoning to the judge decides it HERE, once.
 *
 * THE `type` TAG IS REQUIRED, and this is not pedantry. `ContentBlockMap` in the harness declares
 * `'text': TextBlock` as `{ type: 'text'; text: string }`, and `ReasoningBlock` carries a `text` field too -- so a
 * reader that took `.text` from any block returned the model's REASONING as though the operator had said it. One
 * reader here, and `displayTextOfEvent` below for the one caller that needs a different separator.
 */
export function textOfContent(content, separator = '') {
    if (typeof content === 'string') return content.trim()
    if (!Array.isArray(content)) return ''
    return content
        .filter((block) => block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join(separator)
        .trim()
}

/** The text of a message VALUE -- a string, `{ text }`, or `{ content: [...] }` -- rather than of an event. */
export function textOfMessage(value) {
    if (typeof value === 'string') return value.trim()
    if (value !== null && typeof value === 'object') {
        if (typeof value.text === 'string') return value.text.trim()
        return textOfContent(value.content)
    }
    return ''
}

/** The text of one message EVENT. BOTH SHAPES: a `user/message` carries `data.content`, an `assistant/message` `data.message.content`. */
export function textOfEvent(event, separator = '') {
    const content = event?.data?.message?.content ?? event?.data?.content
    return textOfContent(content, separator)
}

/**
 * The same text for a line SHOWN TO A PERSON, which is the one place a separator is wanted.
 *
 * The judge is handed the model's own characters, so adjacent text blocks are joined with nothing. A reader that
 * printed two blocks as `onetwo` would be showing a word the model never wrote, so this variant joins with a space.
 * The difference is whitespace between blocks and nothing else -- which is why it is one function with one argument
 * rather than a second reader.
 */
export function displayTextOfEvent(event) {
    return textOfEvent(event, ' ')
}

/** The role an event names, for a renderer that labels lines rather than judging them. */
export function roleOf(event) {
    return isUserMessage(event) ? 'user' : 'assistant'
}

/** The turn an event belongs to, or `null` when it declares none. */
export function turnOf(event) {
    const turn = event?.data?.turn
    return typeof turn === 'number' ? turn : null
}
