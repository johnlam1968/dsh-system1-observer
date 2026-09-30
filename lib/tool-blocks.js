// THE `TOOL CALLS` SECTION OF X: the part the trigger's target cannot do without.
//
// WHY IT IS NEEDED. ROADMAP §10.2 requires X to carry "the tool calls with their results", because the questions
// worth asking are about a trajectory: `gave_up_after_null_result` asks what happened AFTER a search returned
// nothing, and a target holding only the current tool call cannot answer it. Measured: the peer bridge's transcript
// reader collects `type: 'text'` blocks and reports `[+N non-text block(s)]` for everything else, so a tool call is
// present as a COUNT and never as content.
//
// WHAT IS VERIFIED AND WHAT IS NOT, because the difference decides how this reads:
//   VERIFIED, from the bridge working against live sessions: the envelope is
//     { seq, type: 'user/message' | 'assistant/message', data: { message: { content: [block, ...] } } }
//     and a text block is `{ type: 'text', text: '...' }`.
//   NOT VERIFIED: the block TYPES that carry a tool call and its result. The bridge never inspected one, so no
//   sample of them exists in this repository.
//
// THEREFORE THIS DOES NOT GUESS SILENTLY. A block it cannot classify is returned in `unclassified` WITH ITS TYPE
// NAME, so a reader that meets an unfamiliar shape says so instead of dropping it. A target built by silently
// discarding half its evidence is worse than one built by refusing: the first produces confident answers about a
// trajectory it never saw. When a real sample is available, the classification is EXTENDED -- the reporting stays.
const textOf = (value) => (typeof value === 'string' ? value : '')

/** One block to one line, or a reason it cannot be read. */
function classify(block) {
    if (block === null || typeof block !== 'object') return { reason: 'a block that is not an object' }
    const type = textOf(block.type) || '(no type)'
    if (type === 'text' && typeof block.text === 'string') return { kind: 'text', text: block.text }
    if (type === 'tool_use' || (type === '(no type)' && typeof block.name === 'string' && block.input !== undefined)) {
        const name = textOf(block.name) || '(unnamed)'
        return { kind: 'call', name, text: `${name}(${JSON.stringify(block.input ?? {})})` }
    }
    if (type === 'tool_result' || block.tool_use_id !== undefined) {
        const inner = Array.isArray(block.content)
            ? block.content.map((part) => textOf(part?.text)).join('')
            : textOf(block.content)
        return { kind: 'result', text: inner === '' ? '(empty result)' : inner }
    }
    return { reason: type }
}

/**
 * The `TOOL CALLS` section, and what could not be read.
 *
 * @returns `{ text, calls, results, unclassified, truncated }` -- `unclassified` counts block types, so an unknown
 * shape is visible to whoever reads the target rather than absent from it.
 */
export function assembleToolCalls(events = [], { maxChars = 4000, includeText = true } = {}) {
    const calls = []
    const results = []
    const unclassified = {}
    let text = ''
    const list = Array.isArray(events) ? events : []

    for (const event of list) {
        if (event === null || typeof event !== 'object') continue
        if (event.type !== 'assistant/message' && event.type !== 'user/message') continue
        const blocks = event.data?.message?.content
        if (!Array.isArray(blocks)) continue
        for (const block of blocks) {
            const outcome = classify(block)
            if (outcome.reason !== undefined) {
                unclassified[outcome.reason] = (unclassified[outcome.reason] ?? 0) + 1
                continue
            }
            if (outcome.kind === 'text') { text += outcome.text; continue }
            if (outcome.kind === 'call') { calls.push(outcome.text); continue }
            results.push(outcome.text)
        }
    }

    const lines = []
    // `includeText` is off when the caller keeps the agent's words in a section of its own: emitting them
    // here as well put the response in the target TWICE, once as AGENT RESPONSE and once inside TOOL CALLS.
    if (includeText && text.trim() !== '') lines.push('agent text: ' + text.trim().replace(/\s+/g, ' '))
    calls.forEach((call, index) => {
        lines.push(`call ${index + 1}: ${call}`)
        if (results[index] !== undefined) lines.push(`  -> ${results[index].replace(/\s+/g, ' ')}`)
    })
    // A result with no call before it is worth saying, not silently pairing with the wrong call.
    if (results.length > calls.length) lines.push(`(${results.length - calls.length} result(s) with no preceding call)`)

    let body = lines.join('\n')
    let truncated = false
    if (body.length > maxChars) {
        body = body.slice(0, maxChars)
        truncated = true
    }
    return { text: body, calls, results, unclassified, truncated }
}
