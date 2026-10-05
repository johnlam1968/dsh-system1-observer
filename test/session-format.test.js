// THE HARNESS'S SESSION VOCABULARY, TESTED WHERE IT LIVES -- and prevented from spreading back out.
//
// The two halves belong together. The first says the vocabulary reads the shapes the harness actually writes; the
// second says it is the ONLY place in `lib/` that names them. A vocabulary that is correct in one file and also
// restated in six others is not a vocabulary, it is a coincidence -- and each restatement is somewhere a format
// change has to be found.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
    EVENT,
    HUMAN_SOURCE_KIND,
    displayTextOfEvent,
    isAssistantMessage,
    isMessageEvent,
    isToolTraffic,
    isUserMessage,
    roleOf,
    sourceKindOf,
    textOfContent,
    textOfEvent,
    textOfMessage,
    turnOf,
} from 'dsh-session-adapter/session-format'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

test('the two message shapes are read, and a block without a type is not a text block', () => {
    // `'user/message': UserMessage` -- `data` IS the message.
    assert.equal(textOfEvent({ type: EVENT.USER_MESSAGE, data: { content: [{ type: 'text', text: 'the ask' }] } }), 'the ask')
    assert.equal(textOfEvent({ type: EVENT.USER_MESSAGE, data: { content: 'the ask' } }), 'the ask')
    // `'assistant/message'` declares `data.message`.
    assert.equal(textOfEvent({ type: EVENT.ASSISTANT_MESSAGE, data: { message: { content: [{ type: 'text', text: 'the answer' }] } } }), 'the answer')
    // A block the harness does not write is not text, and neither is a gap for one.
    assert.equal(textOfContent([{ text: 'no type' }]), '')
    assert.equal(textOfContent(undefined), '')
    assert.equal(textOfContent([{ type: 'text', text: 'only' }, { type: 'text', text: 'text counts' }]), 'onlytext counts')
    // The one caller that shows a line to a person joins them, so a reader never sees two blocks glued.
    assert.equal(displayTextOfEvent({ data: { message: { content: [{ type: 'text', text: 'only' }, { type: 'text', text: 'text counts' }] } } }), 'only text counts')
})

test('reasoning is NOT the message, though it carries the same field name', () => {
    const content = [{ type: 'reasoning', text: 'private thought' }, { type: 'text', text: 'said out loud' }]
    assert.equal(textOfContent(content), 'said out loud')
    assert.equal(textOfMessage({ content }), 'said out loud')
})

test('the human is told apart from the harness by the source the harness declares', () => {
    const human = { type: EVENT.USER_MESSAGE, data: { source: { kind: HUMAN_SOURCE_KIND }, content: 'typed' } }
    const injected = { type: EVENT.USER_MESSAGE, data: { source: { kind: 'skill-catalog' }, content: 'injected' } }
    const bare = { type: EVENT.USER_MESSAGE, data: { content: 'no source' } }
    assert.equal(sourceKindOf(human), 'user')
    assert.equal(sourceKindOf(injected), 'skill-catalog')
    // A MISSING SOURCE IS NOT THE HUMAN -- reading absence as consent is the error this guards.
    assert.equal(sourceKindOf(bare), '')
    assert.equal(isUserMessage(injected), true, 'an injected message is still a user/message')
    assert.equal(textOfEvent(bare), 'no source', 'and its text is still readable')
})

test('the predicates separate messages from traffic, and a tool result is NOT a message', () => {
    assert.equal(isMessageEvent({ type: EVENT.USER_MESSAGE }), true)
    assert.equal(isMessageEvent({ type: EVENT.ASSISTANT_MESSAGE }), true)
    assert.equal(isToolTraffic({ type: EVENT.TOOL_CALL }), true)
    assert.equal(isToolTraffic({ type: EVENT.TOOL_RESULT }), true)
    // Measured: a tool result arrives as a `user/message` too, which is why role is read from the type and not guessed.
    assert.equal(isMessageEvent({ type: EVENT.TOOL_RESULT }), false)
    assert.equal(isAssistantMessage({ type: EVENT.ASSISTANT_MESSAGE }), true)
    assert.equal(roleOf({ type: EVENT.USER_MESSAGE }), 'user')
    assert.equal(roleOf({ type: EVENT.ASSISTANT_MESSAGE }), 'assistant')
    assert.equal(turnOf({ data: { turn: 12 } }), 12)
    assert.equal(turnOf({ data: {} }), null)
})

test('the vocabulary is the ONLY place in lib/ that names a harness event, and it still names them all', () => {
    const NAMES = Object.values(EVENT)
    const pattern = new RegExp(`(['"])(${NAMES.map((n) => n.replace(/[/-]/g, '\\$&')).join('|')})\\1`)
    const offenders = []
    const walk = (dir) => readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
        const rel = `${dir}/${entry.name}`
        if (entry.isDirectory()) return entry.name === 'host' ? [] : walk(rel)
        if (!entry.isFile() || !entry.name.endsWith('.js')) return []
        // COMMENTS ARE NOT CODE: a header may name an event to explain it, which is documentation rather than a
        // second home. Same rule, and the same reason, as the host-inventory scan.
        const code = readFileSync(join(ROOT, rel), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .split('\n').map((line) => line.replace(/\/\/.*$/, '')).join('\n')
        for (const line of code.split('\n')) if (pattern.test(line)) offenders.push(`${rel}: ${line.trim().slice(0, 70)}`)
        return []
    })
    walk('lib')
    assert.deepEqual(offenders, [], `these name a harness event outside lib/host/: ${offenders.join(' | ')}`)
    // And the names themselves are the harness's, not a paraphrase -- read from `core/session/src/types.ts`.
    for (const name of ['user/message', 'assistant/message', 'tool/call', 'tool/result', 'turn/start', 'turn/end']) {
        assert.ok(NAMES.includes(name), `${name} is missing from EVENT`)
    }
})
