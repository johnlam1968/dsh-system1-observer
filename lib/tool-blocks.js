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
//   VERIFIED SINCE, against a real 2,996-event session ("Assisted freeciv play"): the harness writes a tool call
//   TWICE -- as a `tool/call` event (`data: { callId, name, arguments }`) and as a `tool-call` block inside the
//   assistant message (`{ type: 'tool-call', id, name, arguments }`) -- and the result once, as a `tool/result` event
//   whose `data.message.toolCallId` (and `data.message.source.callId`) is the SAME id. Measured: 529 calls, 529
//   blocks, 529 results, and the three id fields agreed on every one.
//
// THE TWO DEFECTS THAT MEASUREMENT FOUND, because both were invisible while the section was empty:
//   1. READING BOTH SHAPES DOUBLE-COUNTED EVERY CALL. The section held 1,058 calls for 529 real ones -- each call
//      once from its event and once from its block -- so the numbering a question refers to ("call 3") named a
//      duplicate of call 2.
//   2. RESULTS WERE PAIRED BY POSITION. With 1,058 calls against 529 results, `results[index]` attached every
//      result after the first to the WRONG call: `call 2: bash(pwd && ls -la)` was shown the README's contents,
//      because call 2 was a duplicate of call 1 and result 1 had already been used. A mis-attributed result is
//      worse than a missing one -- it is a fabricated pairing that reads as evidence.
//   Both are fixed by pairing on the id the harness already provides, and collapsing a repeated id to one call.
//   The positional fallback SURVIVES for shapes with no id at all (the `tool_use`/`tool_result` blocks the bridge
//   never sampled), and it now runs only for a call that carries no id, so it cannot overwrite an id match.
//
// THEREFORE THIS DOES NOT GUESS SILENTLY. A block it cannot classify is returned in `unclassified` WITH ITS TYPE
// NAME, so a reader that meets an unfamiliar shape says so instead of dropping it. A target built by silently
// discarding half its evidence is worse than one built by refusing: the first produces confident answers about a
// trajectory it never saw.
const textOf = (value) => (typeof value === 'string' ? value : '')

/** The id that ties a CALL to its result, wherever a shape puts it. `null` when the shape carries none. */
function callIdOf(value) {
    const found = value?.callId ?? value?.id ?? value?.toolCallId ?? value?.tool_use_id
    return typeof found === 'string' && found !== '' ? found : null
}

/**
 * The CALL id on a RESULT, which is NOT the result's own `id`.
 *
 * MEASURED, and this cost a round: a real `tool/result` message carries BOTH --
 * `{"id":"7cf1d783-3dfc-4e42-bdb4-a05bb2e999e6", "toolCallId":"call_01a0c50f7571710392f53485", "source":{"callId":"call_01a0…"}}`
 * -- and reading `id` first (as the call-shaped reader does) matched all 529 results against nothing, so the fixed
 * section came out with 529 calls, 529 results and ZERO pairing. The order here is the fix, not a preference.
 */
function resultCallIdOf(value) {
    const found = value?.toolCallId ?? value?.tool_use_id ?? value?.callId ?? value?.source?.callId
    return typeof found === 'string' && found !== '' ? found : null
}

/** One block to one line, or a reason it cannot be read. */
function classify(block) {
    if (block === null || typeof block !== 'object') return { reason: 'a block that is not an object' }
    const type = textOf(block.type) || '(no type)'
    if (type === 'text' && typeof block.text === 'string') return { kind: 'text', text: block.text }
    // THE DECLARED BLOCK TYPE IS `tool-call`, WITH `arguments` AS A JSON STRING. `ContentBlockMap` says
    // `'tool-call': { type, id, name, arguments }`; this file looked for the Anthropic-style `tool_use` with `input`,
    // which no harness fixture has ever produced -- so on a real session the TOOL CALLS section was EMPTY, and that
    // is the state the one live measurement was judged on. Both shapes are read; the declared one first.
    if (type === 'tool-call' || type === 'tool_use' || (type === '(no type)' && typeof block.name === 'string' && (block.input !== undefined || block.arguments !== undefined))) {
        const name = textOf(block.name) || '(unnamed)'
        return { kind: 'call', id: callIdOf(block), text: `${name}(${block.arguments !== undefined ? textOf(block.arguments) : JSON.stringify(block.input ?? {})})` }
    }
    if (type === 'tool_result' || block.tool_use_id !== undefined) {
        const inner = Array.isArray(block.content)
            ? block.content.map((part) => textOf(part?.text)).join('')
            : textOf(block.content)
        return { kind: 'result', id: resultCallIdOf(block), text: inner === '' ? '(empty result)' : inner }
    }
    return { reason: type }
}

/**
 * The `TOOL CALLS` section, and what could not be read.
 *
 * @returns `{ text, calls, results, unclassified, truncated }` -- `calls` and `results` are the TEXTS in the order
 *          they were first seen (a call repeated under one id appears once), `unclassified` counts block types, so an
 *          unknown shape is visible to whoever reads the target rather than absent from it.
 */
export function assembleToolCalls(events = [], { maxChars = 4000, includeText = true } = {}) {
    const calls = []
    const results = []
    const callIds = new Set()
    const unclassified = {}
    let text = ''
    const list = Array.isArray(events) ? events : []

    // A CALL IS ONE CALL HOWEVER MANY TIMES IT IS WRITTEN. Measured: the harness records each one twice, as an event
    // and as a block, and counting both made the numbering a question refers to name a duplicate.
    const addCall = (id, body) => {
        if (id !== null && callIds.has(id)) return
        if (id !== null) callIds.add(id)
        calls.push({ id, text: body })
    }

    for (const event of list) {
        if (event === null || typeof event !== 'object') continue
        // THE HARNESS'S OWN RECORD, AS EVENTS RATHER THAN BLOCKS. `tool/call` carries { callId, name, arguments }
        // and `tool/result` carries the result message -- and the composer's message list contains NEITHER, so a
        // window built only from blocks inside messages sees nothing. Measured with declared shapes: the section came
        // out empty, with the call name absent and the result dropped.
        if (event.type === 'tool/call') {
            const name = textOf(event.data?.name) || '(unnamed)'
            addCall(callIdOf(event.data), `${name}(${textOf(event.data?.arguments)})`)
            continue
        }
        if (event.type === 'tool/result') {
            const message = event.data?.message
            const inner = Array.isArray(message?.content)
                ? message.content.map((part) => textOf(part?.text)).join('')
                : textOf(message?.content)
            // THE ID LIVES IN TWO PLACES ON A REAL RESULT and both were checked: `message.toolCallId` and
            // `message.source.callId`. Reading neither is what left results to be paired by position.
            results.push({ id: resultCallIdOf(message), text: inner === '' ? '(empty result)' : inner })
            continue
        }
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
            if (outcome.kind === 'call') { addCall(outcome.id, outcome.text); continue }
            results.push({ id: outcome.id, text: outcome.text })
        }
    }

    // PAIRED BY ID FIRST, POSITIONALLY ONLY WHERE THERE IS NO ID TO PAIR ON -- see the header for what the other
    // order produced: 1,058 calls against 529 results, with every result after the first under the wrong call.
    const paired = new Map()
    const used = new Set()
    calls.forEach((call, index) => {
        if (call.id === null) return
        const at = results.findIndex((result, position) => !used.has(position) && result.id === call.id)
        if (at === -1) return
        used.add(at)
        paired.set(index, results[at].text)
    })
    let next = 0
    calls.forEach((call, index) => {
        if (call.id !== null || paired.has(index)) return
        while (next < results.length && used.has(next)) next += 1
        if (next >= results.length) return
        used.add(next)
        paired.set(index, results[next].text)
        next += 1
    })

    const lines = []
    // `includeText` is off when the caller keeps the agent's words in a section of its own: emitting them
    // here as well put the response in the target TWICE, once as AGENT RESPONSE and once inside TOOL CALLS.
    if (includeText && text.trim() !== '') lines.push('agent text: ' + text.trim().replace(/\s+/g, ' '))
    calls.forEach((call, index) => {
        lines.push(`call ${index + 1}: ${call.text}`)
        const result = paired.get(index)
        if (result !== undefined) lines.push(`  -> ${result.replace(/\s+/g, ' ')}`)
    })
    // A result with no call before it is worth saying, not silently pairing with the wrong one.
    const orphaned = results.length - used.size
    if (orphaned > 0) lines.push(`(${orphaned} result(s) with no preceding call)`)

    let body = lines.join('\n')
    let truncated = false
    if (body.length > maxChars) {
        body = body.slice(0, maxChars)
        truncated = true
    }
    return { text: body, calls: calls.map((call) => call.text), results: results.map((result) => result.text), unclassified, truncated }
}
