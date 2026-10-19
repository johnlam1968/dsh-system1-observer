// THE PI CONVERTER, TESTED AGAINST THE RULES THE HARNESS ENFORCES AT READ TIME.
//
// WHY A STRUCTURAL VALIDATOR INSTEAD OF A ROUND TRIP. `scripts/import-pi-sessions.mjs` writes through the
// harness's own persistence API, which is the only place a refusal can be observed end to end -- and it refuses
// AT WRITE TIME, in a second process, over a directory of real sessions. The DeepSeek importer's lesson is that a
// structurally wrong log is discovered when someone tries to read it, which is the most expensive place to find
// out. So the rules the harness's validator enforces are stated HERE and applied to converted output on every run:
// `turn/start` opens the expected next turn, `step/start` the expected next step inside it, `assistant/message`,
// `tool/call` and an appended `tool/result` require an open turn and step, and no step or turn closes with an
// unresolved tool call. The rules are transcribed from `dsh-session-persistence-jsonl`'s validator
// (`assertReleasedArtifactRelationships`), not from a description of it.
//
// THE REAL-CORPUS TEST IS CONDITIONAL, AND SAYS SO. A test that needs `~/.pi` fails on a machine without pi, so
// the corpus case skips with a stated reason rather than pretending to have run. When it does run it is the check
// that matters: exact parity between what pi holds and what the log says, per the DeepSeek import's 75/75.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { EVENT, textOfEvent } from '../dsh/session-adapter/lib/session-format.js'
import { eventsOf, exchangesOf, livePath, parseSession, PI_BLOCK, PI_ROLE } from '../dsh/pi-session-export.js'

/**
 * A pi session file as text: a header plus whatever entries the case needs.
 *
 * THE ENTRIES ARE CHAINED BY `parentId`, because that is what pi writes and what the importer follows: the live
 * branch is the leaf path, so a fixture whose entries all claim `parentId: null` has ONE entry on its path and
 * tests nothing about grouping. An entry that names its own `parentId` keeps it, which is how a branching case
 * is written.
 */
function piFile(header, entries) {
  let previous = null
  const chained = entries.map((entry) => {
    const parentId = entry.parentId === undefined ? previous : entry.parentId
    previous = entry.id
    return { ...entry, parentId }
  })
  return [JSON.stringify({ type: 'session', version: 3, id: 'pi-1', timestamp: '2026-01-01T00:00:00.000Z', cwd: '/work', ...header })]
    .concat(chained.map((entry) => JSON.stringify(entry)))
    .join('\n') + '\n'
}

const ask = (id, text) => ({ type: 'message', id, timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'user', content: [{ type: 'text', text }], timestamp: 1 } })
const answer = (id, text, calls = []) => ({
  type: 'message', id, timestamp: '2026-01-01T00:00:02.000Z',
  message: { role: 'assistant', content: [...(text === null ? [] : [{ type: 'text', text }]), ...calls], provider: 'p', model: 'm', stopReason: calls.length > 0 ? 'toolUse' : 'stop', timestamp: 2 },
})
const call = (id, toolId, name = 'bash', args = { command: 'ls' }) => ({ type: PI_BLOCK.TOOL_CALL, id: toolId, name, arguments: args })
const result = (id, toolId, text) => ({
  type: 'message', id, timestamp: '2026-01-01T00:00:03.000Z',
  message: { role: PI_ROLE.TOOL_RESULT, toolCallId: toolId, toolName: 'bash', content: [{ type: 'text', text }], isError: false, timestamp: 3 },
})
const injected = (id, customType, text) => ({ type: 'custom_message', id, timestamp: '2026-01-01T00:00:04.000Z', customType, content: text, display: false })

/**
 * THE HARNESS'S STRUCTURAL RULES, APPLIED TO A CONVERTED LOG.
 *
 * @returns an array of problems; empty means the log would survive the harness's own validator. The tool lifecycle
 *          is checked here too -- an advertised `tool-call` block with no matching `tool/call`/`tool/result` pair
 *          is what `step/end` refuses.
 */
function structuralProblems(events) {
  const problems = []
  let openTurn = null
  let nextTurn = 1
  let openStep = null
  let nextStep = 1
  const lifecycles = new Map()

  const requireOpenStep = (type, data) => {
    if (openTurn === null || openStep === null || data.turn !== openTurn || data.step !== openStep) {
      problems.push(`${type} does not match an open turn and step`)
    }
  }

  for (const event of events) {
    const data = event.data ?? {}
    switch (event.type) {
      case EVENT.TURN_START:
        if (openTurn !== null) problems.push(`turn/start ${data.turn} opens while turn ${openTurn} is open`)
        if (data.turn !== nextTurn) problems.push(`turn/start ${data.turn} does not open expected turn ${nextTurn}`)
        openTurn = data.turn
        openStep = null
        nextStep = 1
        lifecycles.clear()
        break
      case EVENT.TURN_END:
        if (openTurn !== data.turn) problems.push(`turn/end ${data.turn} has no matching open turn`)
        if (lifecycles.size > 0) problems.push(`turn/end leaves unresolved tool call ${[...lifecycles.keys()][0]}`)
        if (openStep !== null) problems.push(`turn/end ${data.turn} crosses an open step`)
        openTurn = null
        openStep = null
        nextTurn += 1
        break
      case EVENT.STEP_START:
        if (openTurn !== data.turn || openStep !== null || data.step !== nextStep) {
          problems.push(`step/start ${JSON.stringify(data)} does not match the open turn and next step`)
        }
        openStep = data.step
        break
      case EVENT.STEP_END:
        requireOpenStep('step/end', data)
        if (lifecycles.size > 0) problems.push(`step/end leaves unresolved tool call ${[...lifecycles.keys()][0]}`)
        openStep = null
        nextStep += 1
        break
      case EVENT.ASSISTANT_MESSAGE: {
        requireOpenStep('assistant/message', data)
        for (const block of data.message?.content ?? []) {
          if (block?.type !== 'tool-call') continue
          if (lifecycles.has(block.id)) problems.push(`assistant/message repeats advertised tool call ${block.id}`)
          lifecycles.set(block.id, { name: block.name, arguments: block.arguments })
        }
        break
      }
      case EVENT.TOOL_CALL: {
        requireOpenStep('tool/call', data)
        const lifecycle = lifecycles.get(data.callId)
        if (lifecycle === undefined) problems.push(`tool/call ${data.callId} does not match one advertised tool call`)
        else if (lifecycle.name !== data.name || lifecycle.arguments !== data.arguments) {
          problems.push(`tool/call ${data.callId} does not match the advertised name and arguments`)
        }
        break
      }
      case EVENT.TOOL_RESULT: {
        requireOpenStep('tool/result', data)
        const callId = data.message?.source?.callId
        if (!lifecycles.has(callId)) problems.push(`tool/result ${callId} has no advertised tool lifecycle`)
        else lifecycles.delete(callId)
        break
      }
      case EVENT.USER_MESSAGE:
      case 'session/title':
        break
      default:
        break
    }
  }
  if (openTurn !== null) problems.push(`the log ends with turn ${openTurn} open`)
  return problems
}

test('a pi session parses into a header, entries and an unparseable-line count', () => {
  const parsed = parseSession(piFile({}, [ask('a', 'hello')]) + '{not json}\n')
  assert.equal(parsed.header.id, 'pi-1')
  assert.equal(parsed.header.version, 3)
  assert.equal(parsed.entries.length, 1)
  assert.equal(parsed.unparseable, 1, 'a line that is not JSON is COUNTED, never dropped silently')
})

test('the live branch is the leaf path, and what is off it is reported rather than merged', () => {
  // Two children of the same parent: the later one is the leaf, so the earlier branch is NOT in the conversation.
  const entries = [
    { type: 'message', id: 'u1', parentId: null, timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'user', content: [{ type: 'text', text: 'go' }] } },
    { type: 'message', id: 'a1', parentId: 'u1', timestamp: '2026-01-01T00:00:02.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'first try' }] } },
    { type: 'message', id: 'a2', parentId: 'u1', timestamp: '2026-01-01T00:00:03.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'second try' }] } },
  ]
  const { entries: path, offPath } = livePath(entries)
  assert.deepEqual(path.map((e) => e.id), ['u1', 'a2'], 'the leaf path, oldest first')
  assert.deepEqual(offPath.map((e) => e.id), ['a1'], 'the abandoned branch is reported, not merged in')
})

test('a turn opens per OPERATOR ask, and one assistant message is one step', () => {
  const parsed = parseSession(piFile({}, [
    ask('u1', 'first'),
    answer('a1', 'one'),
    ask('u2', 'second'),
    answer('a2', 'two'),
    answer('a3', 'three'),
  ]))
  const built = eventsOf(parsed)
  assert.equal(built.facts.turns, 2, 'two asks, two turns')
  assert.equal(built.facts.operatorAsks, 2)
  assert.deepEqual(structuralProblems(built.events), [], 'the converted log satisfies the harness rules')
  const starts = built.events.filter((e) => e.type === EVENT.STEP_START)
  assert.equal(starts.length, 3, 'three assistant messages, three steps')
  assert.deepEqual(starts.map((e) => e.data.turn), [1, 2, 2], 'the second turn holds two steps')
})

test('an INJECTED message is in the log and OUT of the asks', () => {
  const parsed = parseSession(piFile({}, [
    ask('u1', 'do the thing'),
    injected('m1', 'subagent-notify', 'a child agent finished'),
    answer('a1', 'done'),
  ]))
  const built = eventsOf(parsed)
  assert.equal(built.facts.operatorAsks, 1, 'an extension message never becomes an operator ask')
  assert.equal(built.facts.turns, 1, 'and it never opens a turn of its own')
  assert.equal(built.facts.customMessages, 1)
  assert.equal(built.facts.customMessagesHidden, 1)
  const messages = built.events.filter((e) => e.type === EVENT.USER_MESSAGE)
  assert.equal(messages.length, 2)
  assert.equal(messages[0].data.source.kind, 'user')
  assert.equal(messages[1].data.source.kind, 'pi-subagent-notify', 'the producer owns the kind, and v4 REFUSES the retired `plugin` wrapper')
  assert.deepEqual(structuralProblems(built.events), [])
})

test('tool traffic is paired BY ID, and a call with no result is left out of the block and counted', () => {
  const parsed = parseSession(piFile({}, [
    ask('u1', 'run it'),
    answer('a1', null, [call('a1', 't1'), call('a1', 't2', 'read', { path: '/x' })]),
    result('r1', 't1', 'the output'),
  ]))
  const built = eventsOf(parsed)
  assert.deepEqual(structuralProblems(built.events), [], 'an unresolved advertised call would be refused at step/end')
  assert.equal(built.facts.toolCalls, 1, 'only the resolved call is written')
  assert.equal(built.facts.unresolvedCalls, 1, 'and the one that had no result is counted')
  assert.equal(built.facts.toolResults, 1)
  const callEvent = built.events.find((e) => e.type === EVENT.TOOL_CALL)
  const resultEvent = built.events.find((e) => e.type === EVENT.TOOL_RESULT)
  assert.equal(callEvent.data.callId, resultEvent.data.message.source.callId)
  assert.deepEqual(resultEvent.sourceEventSeqs, [callEvent.seq], 'the result cites the call it answers')
  assert.equal(resultEvent.surfaceOp, 'append')
  assert.equal(typeof callEvent.data.arguments, 'string', 'arguments is a JSON string, the shape the harness writes')
})

test('an aborted answer is marked interrupted, and thinking becomes a reasoning block', () => {
  const parsed = parseSession(piFile({}, [
    ask('u1', 'go'),
    { type: 'message', id: 'a1', parentId: 'u1', timestamp: '2026-01-01T00:00:02.000Z', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: 'partial' }], provider: 'p', model: 'm', stopReason: 'aborted', usage: { input: 3, output: 4, cacheRead: 0, cacheWrite: 0, totalTokens: 7, cost: { input: 0.1, total: 0.1 } } } },
  ]))
  const built = eventsOf(parsed)
  const message = built.events.find((e) => e.type === EVENT.ASSISTANT_MESSAGE)
  assert.equal(message.data.interrupted, true)
  assert.equal(message.data.message.content[0].type, 'reasoning')
  assert.equal(message.data.message.content[0].text, 'hmm')
  assert.deepEqual(message.data.usage, { inputTokens: 3, outputTokens: 4, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 7 })
  assert.equal(built.facts.reasoningBlocks, 1)
  assert.equal(built.facts.stopReasons.aborted, 1)
  assert.equal(built.facts.cost.total, 0.1, 'pi cost has no dsh field, so it is counted rather than dropped')
  assert.equal(textOfEvent(message), 'partial', 'the reader sees the text, never the reasoning (F79)')
})

test('a pi session name becomes a pinned title, and no name means no title', () => {
  const named = parseSession(piFile({}, [ask('u1', 'go'), { type: 'session_info', id: 'n1', parentId: 'u1', timestamp: '2026-01-01T00:00:05.000Z', name: 'Refactor auth module' }]))
  const title = eventsOf(named).events.find((e) => e.type === 'session/title')
  assert.equal(title.data.title, 'Refactor auth module')
  assert.deepEqual(title.data.messageSeqs, [], 'a user-pinned title must cite no messages')
  assert.equal(title.data.source.kind, 'user')

  const unnamed = eventsOf(parseSession(piFile({}, [ask('u1', 'go')])))
  assert.equal(unnamed.events.some((e) => e.type === 'session/title'), false, 'no name, no invented title')
})

test('the non-message entries are counted, not dropped', () => {
  const parsed = parseSession(piFile({}, [
    ask('u1', 'go'),
    { type: 'model_change', id: 'm', parentId: 'u1', timestamp: '2026-01-01T00:00:02.000Z', provider: 'p', modelId: 'm' },
    { type: 'thinking_level_change', id: 't', parentId: 'm', timestamp: '2026-01-01T00:00:02.000Z', thinkingLevel: 'high' },
    { type: 'compaction', id: 'c', parentId: 't', timestamp: '2026-01-01T00:00:03.000Z', summary: 's', firstKeptEntryId: 'u1', tokensBefore: 10 },
    { type: 'context_edit', id: 'e', parentId: 'c', timestamp: '2026-01-01T00:00:04.000Z', targetId: 'u1', replacement: null },
  ]))
  const { facts } = eventsOf(parsed)
  assert.equal(facts.modelChanges, 1)
  assert.equal(facts.thinkingLevelChanges, 1)
  assert.deepEqual(facts.thinkingLevels, ['high'])
  assert.equal(facts.compactionEntries, 1)
  assert.equal(facts.contextEdits, 1)
})

test('a system prompt section is counted and NOT written into the conversation', () => {
  const parsed = parseSession(piFile({}, [
    ask('u1', 'go'),
    { type: 'message', id: 's1', parentId: 'u1', timestamp: '2026-01-01T00:00:02.000Z', message: { role: 'system', content: '', sections: { preamble: 'You are…', tools: '<tools>…</tools>' } } },
    answer('a1', 'ok'),
  ]))
  const built = eventsOf(parsed)
  assert.equal(built.facts.systemMessages, 1)
  assert.equal(built.facts.promptSections, 2)
  assert.equal(built.events.some((e) => textOfEvent(e).includes('You are')), false, 'a prompt section is not a turn')
})

test('an ask-group exchange carries the asks, the injected messages and the answers', () => {
  const parsed = parseSession(piFile({}, [
    ask('u1', 'first'),
    injected('m1', 'goal-event', 'a goal was set'),
    answer('a1', 'one', [call('a1', 't1')]),
    result('r1', 't1', 'out'),
    ask('u2', 'second'),
    answer('a2', 'two'),
  ]))
  const { exchanges } = exchangesOf(parsed.entries)
  assert.equal(exchanges.length, 2)
  assert.equal(exchanges[0].ask, 'first')
  assert.equal(exchanges[0].assistants.length, 1)
  assert.equal(exchanges[0].toolResults.length, 1)
  assert.equal(exchanges[0].customMessages.length, 1)
  assert.equal(exchanges[1].ask, 'second')
})

/* ── THE REAL CORPUS ────────────────────────────────────────────────────────────────────────────────── */

const REAL = join(homedir(), '.pi', 'agent', 'sessions')
function largestRealSession() {
  if (!existsSync(REAL)) return null
  const files = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.jsonl')) files.push({ full, bytes: statSync(full).size })
    }
  }
  walk(REAL)
  if (files.length === 0) return null
  return files.sort((a, b) => b.bytes - a.bytes)[0].full
}

test('a REAL pi session converts with exact parity and no structural problem', (t) => {
  const file = largestRealSession()
  if (file === null) {
    t.skip('no pi sessions under ~/.pi/agent/sessions on this machine')
    return
  }
  const parsed = parseSession(readFileSync(file, 'utf8'))
  const built = eventsOf(parsed)

  const messages = parsed.entries.filter((e) => e.type === 'message')
  const piUser = messages.filter((e) => e.message.role === PI_ROLE.USER)
  const piAssistant = messages.filter((e) => e.message.role === PI_ROLE.ASSISTANT)
  const piText = piAssistant.flatMap((e) => e.message.content)
    .filter((b) => b.type === PI_BLOCK.TEXT)
    .reduce((n, b) => n + b.text.length, 0)
  const piCalls = piAssistant.flatMap((e) => e.message.content).filter((b) => b.type === PI_BLOCK.TOOL_CALL).length
  const piResults = messages.filter((e) => e.message.role === PI_ROLE.TOOL_RESULT).length

  const dshUser = built.events.filter((e) => e.type === EVENT.USER_MESSAGE && e.data.source?.kind === 'user')
  const dshAssistant = built.events.filter((e) => e.type === EVENT.ASSISTANT_MESSAGE)
  const dshText = dshAssistant.reduce((n, e) => n + textOfEvent(e).length, 0)
  const dshCalls = built.events.filter((e) => e.type === EVENT.TOOL_CALL).length
  const dshResults = built.events.filter((e) => e.type === EVENT.TOOL_RESULT).length

  assert.equal(dshUser.length, piUser.length, 'operator asks')
  assert.equal(dshAssistant.length, piAssistant.length, 'assistant messages')
  assert.equal(dshText, piText, 'visible characters')
  assert.equal(dshCalls, piCalls - built.facts.unresolvedCalls, 'tool calls, less the unresolved ones')
  assert.equal(dshResults, piResults - built.facts.unresolvedCalls, 'tool results pair one-for-one with calls')
  assert.deepEqual(structuralProblems(built.events), [], 'the converted log would survive the harness validator')
  assert.ok(built.events.length > 0)
})
