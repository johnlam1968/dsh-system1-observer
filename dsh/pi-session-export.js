// PI SESSIONS -> DSH SESSION EVENTS. The pure half: parse, choose the live branch, map, count. No harness, no files.
//
// WHY THIS IS IN THIS REPOSITORY, AND WHY IT LOOKS LIKE `lib/deepseek-web-export.js`. `dsh/session-adapter`
// reads HARNESS sessions and has no reader for any foreign format (`docs/adapters-and-standards.md`, "The
// prerequisite"), so a foreign transcript has to BECOME a DSH session before anything here can measure it. That
// file is that conversion for `chat.deepseek.com`; this is the same conversion for **pi** (`pi-coding-agent` 0.85.1),
// and `docs/adapters-and-standards.md` already names pi as "the cheapest second adapter".
//
// EVERY RULE BELOW WAS MEASURED ON THIS HOST, NOT READ OFF A SPEC, and the measurement is what each comment cites.
// The pi corpus as measured on 2026-10-14: **223 session files** under `~/.pi/<agent>/sessions/`, 41,960 entries,
// 1,971 operator asks, 19,874 assistant messages, 19,077 tool results, 183 extension `custom_message`s, 8
// compactions, 6 `context_edit`s, 0 unparseable lines, and exactly **one** session with a branch.
//
// THE FOUR RULES, AND WHAT EACH ONE COSTS:
//
//   1. **THE LIVE BRANCH IS THE LEAF PATH, NOT THE FILE ORDER.** pi's entries form a DAG (`id`/`parentId`), and
//      pi itself resolves it with `buildContextEntries()`, which walks from the current LEAF to the root. Measured:
//      the leaf is the last entry in file order in **223 of 223** sessions, and only **3 entries in the whole
//      corpus** sit off that path. So the importer follows the leaf path and records what it left behind, rather
//      than flattening the file and silently merging two branches into one conversation. This is a BETTER rule
//      than the DeepSeek importer's "follow the deepest subtree", which had to GUESS because that export names no
//      winner; pi states which branch is live, so the guess is not needed.
//
//   2. **THE TURN IS DERIVED, AND THE ASK IS THE BOUNDARY.** **pi has no turn at all** -- `docs/adapters-and-
//      standards.md` measured this already ("all 44 pi messages loaded with a null turn"), and it is why a naive
//      cross-harness "per turn" query silently became a dsh-only query. dsh's log REFUSES an `assistant/message`
//      that does not match an open turn and step, so a turn has to be constructed. The rule is the ask-group one
//      the same document recommends: **each operator `user` message opens a turn, and each assistant message is
//      one step inside it**. Measured: every one of the 19,077 tool results appears BEFORE the next assistant
//      message (100%; 0 after), so "one assistant message plus its own results" is a step, not a guess about
//      grouping.
//
//   3. **AN ASK IS A `user` MESSAGE, AND NOTHING ELSE IS.** The corpus contains **183 `custom_message` entries
//      across 10 extension types** -- `subagent-notify` (74), `goal-event` (34), `telegram-connection-state` (27),
//      `intercom_message` (16) and six others -- and every one of them participates in the LLM context without a
//      human typing it. Treating them as asks would invent 183 operator turns out of extension chatter; that is the
//      "not every user message is a human" problem `docs/adapters-and-standards.md` records for mcode, in pi's own
//      vocabulary. They are emitted as `user/message` with `source.kind: 'plugin'`, which is exactly the
//      discrimination `lib/exchange.js` already makes (it counts a non-human `user/message` rather than skipping
//      it silently), so they stay in the log and stay OUT of the asks. Measured: **0** of the 1,971 `user`
//      messages carry a `<system-reminder>`-style system block, so the ask rule needs no exception.
//
//   4. **AN UNRESOLVED CALL IS DROPPED FROM THE BLOCK, NOT FAKED.** dsh validates tool lifecycles: a
//      `tool-call` block inside an `assistant/message` ADVERTISES a call, a `tool/call` must match it by name AND
//      arguments, and `step/end` / `turn/end` REFUSE an unresolved call. Measured: **23 of 19,100** advertised
//      calls have no result — the tail of aborted sessions (76 `aborted` and 187 `error` stops). Fabricating a
//      result for them, or emitting the block and leaving the lifecycle open, would make the log unreadable; so
//      those blocks are left out and COUNTED, which is the rule the DeepSeek importer follows for its own
//      unusable fragments.
//
// THE LOSSES ARE DELIBERATE AND COUNTED, never absorbed: image payloads, pi's `system` prompt sections, the
// stream (pi keeps none), compaction summaries, `context_edit`s, `bashExecution` messages, `thinking`/
// `model_change` facts, and the per-message cost. Each is returned in `facts` and written to the import's
// sidecar, because a loss nothing reports reads as a measurement that saw everything.

import { EVENT, HUMAN_SOURCE_KIND } from 'dsh-session-adapter/session-format'

/** pi's entry types, as this importer reads them. Anything else is counted, not dropped. */
export const PI_ENTRY = Object.freeze({
  SESSION: 'session',
  MESSAGE: 'message',
  MODEL_CHANGE: 'model_change',
  THINKING_LEVEL_CHANGE: 'thinking_level_change',
  USAGE: 'usage',
  COMPACTION: 'compaction',
  CONTEXT_EDIT: 'context_edit',
  BRANCH_SUMMARY: 'branch_summary',
  CUSTOM: 'custom',
  CUSTOM_MESSAGE: 'custom_message',
  LABEL: 'label',
  SESSION_INFO: 'session_info',
})

/** The message roles this importer distinguishes. `user` is the only one that opens a turn. */
export const PI_ROLE = Object.freeze({
  USER: 'user',
  ASSISTANT: 'assistant',
  TOOL_RESULT: 'toolResult',
  SYSTEM: 'system',
  BASH_EXECUTION: 'bashExecution',
})

/** pi's assistant content-block types, and what this importer puts in their place. */
export const PI_BLOCK = Object.freeze({ TEXT: 'text', THINKING: 'thinking', TOOL_CALL: 'toolCall', IMAGE: 'image' })

/**
 * ONE FILE, PARSED. A line that is not JSON is COUNTED and skipped, never dropped silently -- the rule
 * `docs/adapters-and-standards.md` credits to `agent-eval` ("a line that is not JSON is counted"). Measured: 0
 * unparseable lines in 41,960 on this host, which is a receipt that the counter works rather than a reason to drop
 * it.
 */
export function parseSession(text) {
  const lines = String(text ?? '').split('\n')
  const entries = []
  let header = null
  let unparseable = 0
  for (const line of lines) {
    if (line.trim() === '') continue
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      unparseable += 1
      continue
    }
    if (entry !== null && typeof entry === 'object' && entry.type === PI_ENTRY.SESSION) {
      header = entry
      continue
    }
    if (entry !== null && typeof entry === 'object') entries.push(entry)
  }
  return { header, entries, unparseable }
}

/**
 * THE LIVE BRANCH: the path from the current leaf back to the root, oldest first.
 *
 * pi's own resolution (`buildContextEntries`) walks leaf -> root and honours compaction; this returns that path
 * WITHOUT the compaction rule, because an imported dsh log carries the whole history and the compaction fact is
 * reported rather than applied (see the header, loss 1).
 *
 * A `parentId` that names no entry ends the walk rather than throwing: a truncated file is a real state for a log
 * that is being written right now, and refusing the whole session for its last line would be the wrong answer.
 */
export function livePath(entries) {
  const list = Array.isArray(entries) ? entries : []
  const byId = new Map()
  for (const entry of list) if (typeof entry?.id === 'string') byId.set(entry.id, entry)
  const chain = []
  const seen = new Set()
  let node = list.length === 0 ? undefined : list[list.length - 1]
  while (node !== undefined && node !== null && !seen.has(node.id)) {
    seen.add(node.id)
    chain.push(node)
    node = typeof node.parentId === 'string' ? byId.get(node.parentId) : undefined
  }
  const onPath = new Set(chain.map((entry) => entry.id))
  return {
    entries: chain.reverse(),
    offPath: list.filter((entry) => !onPath.has(entry?.id)),
    /** A cycle in the DAG would make the walk unbounded; this says whether one was seen. */
    cyclic: seen.size !== list.filter((entry) => typeof entry?.id === 'string').length,
  }
}

/** The text of one pi content block, or `''` when it carries none. `thinking` is NOT text the judge has ever seen. */
function textOfBlock(block) {
  if (block === null || typeof block !== 'object') return ''
  if (block.type === PI_BLOCK.TEXT && typeof block.text === 'string') return block.text
  if (block.type === PI_BLOCK.THINKING && typeof block.thinking === 'string') return block.thinking
  return ''
}

/** pi's `content` is a string for a user message and an array of blocks otherwise. Text out of either. */
function textOfContent(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map(textOfBlock).filter((text) => text !== '').join('\n')
}

/** The image blocks in a content array, counted and NOT carried: their bytes are base64 and a log does not need
 *  them to be readable, while a fabricated text placeholder would be evidence the model never produced. */
function countImages(content) {
  if (!Array.isArray(content)) return 0
  return content.filter((block) => block?.type === PI_BLOCK.IMAGE).length
}

/** One exchange: an operator ask and everything the agent did in answer to it. The unit a measurement reads. */
function emptyExchange(turn, at) {
  return { turn, at, ask: '', askContent: null, customMessages: [], assistants: [], toolResults: [], asks: 0 }
}

/**
 * THE EXCHANGES, as ask-groups over the live branch.
 *
 * One turn per operator `user` message; each assistant message and each tool result joins the turn it follows.
 * A `custom_message` joins the open turn without opening one, which is what makes an injected message a MESSAGE
 * inside a turn rather than a turn of its own (the section-vs-message distinction in the vocabulary).
 */
export function exchangesOf(entries) {
  const { entries: path, offPath } = livePath(entries)
  const exchanges = []
  let current = null
  const open = () => {
    if (current === null) {
      current = emptyExchange(exchanges.length + 1, null)
      exchanges.push(current)
    }
    return current
  }
  for (const entry of path) {
    if (entry.type === PI_ENTRY.CUSTOM_MESSAGE) {
      const exchange = open()
      exchange.customMessages.push({ customType: entry.customType ?? null, display: entry.display !== false, content: entry.content })
      continue
    }
    if (entry.type !== PI_ENTRY.MESSAGE) continue
    const message = entry.message ?? {}
    if (message.role === PI_ROLE.USER) {
      // A NEW ASK OPENS A NEW TURN, and it also CLOSES the previous one: dsh's turns cannot nest, and pi's
      // mid-turn user message is a follow-up that pi itself treats as the next run.
      current = emptyExchange(exchanges.length + 1, entry.timestamp ?? null)
      exchanges.push(current)
      current.ask = textOfContent(message.content)
      current.askContent = message.content
      current.asks += 1
      continue
    }
    if (message.role === PI_ROLE.ASSISTANT) {
      open().assistants.push(entry)
      continue
    }
    if (message.role === PI_ROLE.TOOL_RESULT) {
      open().toolResults.push(entry)
    }
  }
  return { exchanges, offPath }
}

/**
 * One pi session as DSH v4 session events, plus the facts the log deliberately does not carry.
 *
 * PURE ON PURPOSE: the structural rules are the part that is easy to get wrong -- an `assistant/message` outside
 * an open turn and step, or a `tool-call` block with no matching `tool/call`, is REFUSED at read time by the
 * harness (`SessionFormatError`), so they are testable here without a harness, a filesystem or a model. The writer
 * lives in `scripts/import-pi-sessions.mjs`.
 */
export function eventsOf(parsed, { sessionId, cwd } = {}) {
  const header = parsed?.header ?? {}
  const entries = Array.isArray(parsed?.entries) ? parsed.entries : []
  const { exchanges, offPath } = exchangesOf(entries)
  const piId = typeof header.id === 'string' && header.id !== '' ? header.id : null
  const id = sessionId ?? (piId === null ? null : `session-${piId}`)
  const createdAt = Date.parse(header.timestamp) || Date.now()

  const events = []
  const facts = {
    piSessionId: piId,
    piVersion: typeof header.version === 'number' ? header.version : null,
    piCwd: typeof header.cwd === 'string' ? header.cwd : null,
    parentSession: typeof header.parentSession === 'string' ? header.parentSession : null,
    unparseableLines: Number.isInteger(parsed?.unparseable) ? parsed.unparseable : 0,
    offBranchEntries: offPath.length,
    title: sessionNameOf(entries),
    promptSections: 0,
    systemMessages: 0,
    bashExecutions: 0,
    compactionEntries: 0,
    contextEdits: 0,
    branchSummaries: 0,
    customEntries: 0,
    labels: 0,
    usageEntries: 0,
    modelChanges: 0,
    thinkingLevelChanges: 0,
    customMessages: 0,
    customMessagesHidden: 0,
    imagesNotInLog: 0,
    unresolvedCalls: 0,
    orphanResults: 0,
    assistantMessages: 0,
    operatorAsks: 0,
    toolCalls: 0,
    toolResults: 0,
    reasoningBlocks: 0,
    textBlocks: 0,
    /** pi's per-message cost and reasoning-token counts, which dsh's `usage` has no field for. */
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    reasoningTokens: 0,
    stopReasons: {},
    thinkingLevels: [],
    models: [],
  }

  let seq = 0
  const ev = (type, data, time, surfaceOp, sourceEventSeqs) => {
    const event = { type, seq: seq++, time: Number.isFinite(time) ? time : createdAt, data }
    if (surfaceOp !== undefined) event.surfaceOp = surfaceOp
    if (sourceEventSeqs !== undefined) event.sourceEventSeqs = sourceEventSeqs
    events.push(event)
    // The seq OF THIS EVENT. It was `event.seq - 1` here, which is one less than the event it had just pushed --
    // so every `tool/result` cited the assistant message before it rather than the `tool/call` it answers.
    return event.seq
  }

  // THE TITLE, ONLY WHEN PI NAMES THE SESSION. `session/title` with `source.kind: 'user'` must carry an EMPTY
  // `messageSeqs` (the harness asserts exactly that), which is the honest shape for a title supplied from outside
  // and pinned. With no pi name the harness's own fallback generator is left to run, rather than this importer
  // inventing one.
  if (facts.title !== null) {
    ev('session/title', { title: facts.title, messageSeqs: [], source: { kind: 'user' } }, createdAt)
  }

  // Every tool result in the session, by the call id pi pairs it with. MEASURED: the pairing field is
  // `toolCallId`, every result matches an advertised call, and every one appears before the next assistant
  // message -- so a lookup table, not a positional guess.
  const resultsByCall = new Map()
  for (const exchange of exchanges) {
    for (const entry of exchange.toolResults) {
      const id = entry.message?.toolCallId
      if (typeof id === 'string' && !resultsByCall.has(id)) resultsByCall.set(id, entry)
    }
  }

  let turn = 0
  let step = 0
  let stepOpen = false
  let openTurn = null
  let lastTime = createdAt
  const timeOf = (exchange) => Date.parse(exchange.at ?? '') || createdAt

  // THE STEP COUNTER IS NOT THE OPEN-STEP MARKER. dsh numbers steps 1, 2, 3... inside a turn and requires the
  // next one to be exactly `nextStep`, so closing a step must not reset the number -- an earlier version did, and
  // every step in a converted log came out numbered 1.
  const closeStep = () => {
    if (!stepOpen) return
    ev(EVENT.STEP_END, { turn, step }, lastTime)
    stepOpen = false
  }
  const closeTurn = () => {
    closeStep()
    if (openTurn === null) return
    ev(EVENT.TURN_END, { turn, reason: 'completed' }, lastTime)
    openTurn = null
  }
  const openOneTurn = () => {
    if (openTurn !== null) return
    turn += 1
    openTurn = turn
    step = 0
    ev(EVENT.TURN_START, { turn }, lastTime)
  }
  const openStep = () => {
    openOneTurn()
    step += 1
    stepOpen = true
    ev(EVENT.STEP_START, { turn, step }, lastTime)
  }

  for (const exchange of exchanges) {
    const at = timeOf(exchange)
    lastTime = Number.isFinite(at) ? at : lastTime

    // THE ASK, at the head of the turn's first step -- the shape the harness itself writes (measured on a live
    // log: `turn/start`, `step/start`, `user/message`, `assistant/message`, `step/end`, `turn/end`).
    if (exchange.ask !== '') {
      closeTurn()
      openOneTurn()
      openStep()
      // AN IMAGE ATTACHED TO AN ASK IS A LOSS LIKE ANY OTHER, and it was being dropped without being counted: the
      // corpus holds 131 image blocks and the first import reported 126, because only assistant and tool-result
      // images were counted.
      facts.imagesNotInLog += countImages(exchange.askContent)
      ev(EVENT.USER_MESSAGE, {
        content: [{ type: 'text', text: exchange.ask }],
        source: { kind: HUMAN_SOURCE_KIND },
        role: 'user',
        id: `pi-${id}-u${exchange.turn}`,
      }, lastTime, 'append')
      facts.operatorAsks += 1
    }

    // INJECTED MESSAGES: in the log, out of the asks. The `source.kind` is PRODUCER-OWNED, which is a rule the
    // harness enforces by refusing the log: v4 "requires a producer-owned source kind" and explicitly rejects the
    // retired `"plugin"` wrapper (measured -- the first write of this importer was refused for using it). The kinds a
    // real deployment writes are named after whoever produced the message -- `model`, `tool`, `goal`,
    // `subagent-settled`, `skill-invocation` -- so a pi extension's message is named after the extension: `pi` plus
    // its `customType`. That carries MORE attribution than a generic wrapper rather than less, which is the
    // direction the rule states ("preserves unknown attribution").
    //
    // `lib/exchange.js` reads anything that is not `user` as a non-human message rather than as an ask, so these
    // stay in the log and stay out of the asks.
    for (const injected of exchange.customMessages) {
      openOneTurn()
      if (!stepOpen) openStep()
      const content = textOfContent(injected.content)
      facts.imagesNotInLog += countImages(injected.content)
      facts.customMessages += 1
      if (injected.display !== true) facts.customMessagesHidden += 1
      if (content === '') continue
      ev(EVENT.USER_MESSAGE, {
        content: [{ type: 'text', text: content }],
        source: { kind: producerKindOf(injected.customType) },
        role: 'user',
        id: `pi-${id}-m${exchange.turn}-${facts.customMessages}`,
      }, lastTime, 'append')
    }

    // THE AGENT'S SIDE: one assistant message is one step.
    for (const entry of exchange.assistants) {
      openOneTurn()
      if (!stepOpen) openStep()
      const message = entry.message ?? {}
      const blocks = Array.isArray(message.content) ? message.content : []
      facts.assistantMessages += 1
      facts.imagesNotInLog += countImages(blocks)

      const stop = typeof message.stopReason === 'string' ? message.stopReason : null
      if (stop !== null) facts.stopReasons[stop] = (facts.stopReasons[stop] ?? 0) + 1
      if (typeof message.model === 'string' && !facts.models.includes(message.model)) facts.models.push(message.model)
      const usage = message.usage ?? null
      if (usage !== null && usage.cost !== undefined && usage.cost !== null) {
        for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'total']) {
          facts.cost[key] += Number(usage.cost[key]) || 0
        }
      }
      if (usage !== null) facts.reasoningTokens += Number(usage.reasoning) || 0

      // THE CONTENT, BLOCK BY BLOCK, in pi's own order. `thinking` becomes a `reasoning` block -- the SAME field
      // under a different name and field key (`thinking` -> `text`), which `docs/adapters-and-standards.md`
      // measured as pi's own difference from dsh. The text reader ignores reasoning by design (`F79`), so this
      // preserves the record without changing what a judgement means.
      const content = []
      const advertised = []
      for (const block of blocks) {
        if (block?.type === PI_BLOCK.TEXT && typeof block.text === 'string') {
          content.push({ type: 'text', text: block.text })
          facts.textBlocks += 1
          continue
        }
        if (block?.type === PI_BLOCK.THINKING && typeof block.thinking === 'string') {
          content.push({ type: 'reasoning', text: block.thinking })
          facts.reasoningBlocks += 1
          continue
        }
        if (block?.type === PI_BLOCK.TOOL_CALL && typeof block.id === 'string') {
          advertised.push({ id: block.id, name: typeof block.name === 'string' ? block.name : '(unnamed)', args: block.arguments })
        }
      }

      // AN UNRESOLVED CALL IS LEFT OUT OF THE BLOCK. dsh validates that every advertised call is started and
      // finished before the step closes, so keeping the block would make the log unreadable; the count is the
      // receipt.
      const resolved = []
      for (const call of advertised) {
        if (resultsByCall.has(call.id)) resolved.push(call)
        else facts.unresolvedCalls += 1
      }
      for (const call of resolved) {
        // `arguments` is a JSON STRING on both sides, because that is what the harness writes (measured on a live
        // log) and what its validator compares: `tool/call` must match the advertised block by name AND by
        // arguments VALUE.
        content.push({ type: 'tool-call', id: call.id, name: call.name, arguments: JSON.stringify(call.args ?? {}) })
        facts.toolCalls += 1
      }

      const assistantSeq = ev(EVENT.ASSISTANT_MESSAGE, {
        turn,
        step,
        message: {
          role: 'assistant',
          content,
          source: {
            kind: 'model',
            provider: typeof message.provider === 'string' ? message.provider : 'pi',
            model: typeof message.model === 'string' ? message.model : 'unknown',
          },
          id: `pi-${id}-a${turn}-${step}`,
        },
        // pi keeps NO stream record -- the session file holds the finalised message only -- so this is empty
        // rather than invented. An empty stream is not a missing measurement; it is the harness's own shape for a
        // message that was not streamed into this log.
        stream: [],
        ...(usage === null ? {} : { usage: usageOf(usage) }),
        // pi's `aborted` is dsh's `interrupted`: the model's turn was cut short rather than finished.
        ...(message.stopReason === 'aborted' ? { interrupted: true } : {}),
      }, lastTime, 'append')

      // THE TOOL TRAFFIC, in pi's order: the call, then the result that answers it, paired by the id pi gives.
      for (const call of resolved) {
        const result = resultsByCall.get(call.id)
        const args = JSON.stringify(call.args ?? {})
        const callSeq = ev(EVENT.TOOL_CALL, { turn, step, callId: call.id, name: call.name, arguments: args }, lastTime)
        const resultMessage = result?.message ?? {}
        const blocksOut = Array.isArray(resultMessage.content) ? resultMessage.content : []
        facts.imagesNotInLog += countImages(blocksOut)
        const body = typeof resultMessage.content === 'string'
          ? [{ type: 'text', text: resultMessage.content }]
          : blocksOut.filter((block) => block?.type === PI_BLOCK.TEXT && typeof block.text === 'string')
            .map((block) => ({ type: 'text', text: block.text }))
        facts.toolResults += 1
        ev(EVENT.TOOL_RESULT, {
          turn,
          step,
          message: {
            role: 'tool',
            source: { kind: 'tool', callId: call.id },
            toolCallId: call.id,
            content: body,
            ...(resultMessage.isError === true ? { isError: true } : {}),
            id: `pi-${id}-r${turn}-${call.id}`,
          },
        }, lastTime, 'append', [callSeq])
      }
      closeStep()
    }
    closeTurn()
  }
  closeStep()
  closeTurn()

  countNonMessageEntries(entries, facts)

  // A RESULT WITH NO CALL is the one thing this importer cannot pair, and it must be visible rather than
  // positionally matched to whatever came before it (`lib/tool-blocks.js` records what positional pairing cost:
  // every result after the first under the wrong call).
  const advertisedIds = new Set()
  for (const exchange of exchanges) {
    for (const assistant of exchange.assistants) {
      for (const block of assistant.message?.content ?? []) {
        if (block?.type === PI_BLOCK.TOOL_CALL && typeof block.id === 'string') advertisedIds.add(block.id)
      }
    }
  }
  for (const exchange of exchanges) {
    for (const result of exchange.toolResults) {
      const callId = result.message?.toolCallId
      if (typeof callId !== 'string' || !advertisedIds.has(callId)) facts.orphanResults += 1
    }
  }
  facts.turns = turn

  return { id, createdAt, cwd: cwd ?? facts.piCwd ?? undefined, events, facts, exchanges }
}

/** THE `source.kind` FOR AN INJECTED MESSAGE: the producer, in the kebab-case the harness's own kinds use
 *  (`subagent-settled`, `skill-invocation`, `tool-registry`). pi names its extension with `customType`, so the
 *  kind is `pi-<that>`, and an extension with no name falls back to `pi-extension`. */
function producerKindOf(customType) {
  const name = String(customType ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return name === '' ? 'pi-extension' : `pi-${name}`
}

/** dsh's `usage` field names, from a live log. pi's `reasoning` tokens and `cost` have no field here; they are
 *  counted in `facts` rather than dropped. */
function usageOf(usage) {
  return {
    inputTokens: Number(usage.input) || 0,
    outputTokens: Number(usage.output) || 0,
    cacheReadTokens: Number(usage.cacheRead) || 0,
    cacheWriteTokens: Number(usage.cacheWrite) || 0,
    totalTokens: Number(usage.totalTokens) || 0,
  }
}

/** The display name pi holds, if the session has one: the LAST `session_info` entry on the live path, which is
 *  how pi itself reads it (`getSessionName()`). */
export function sessionNameOf(entries) {
  const { entries: path } = livePath(entries)
  let name = null
  for (const entry of path) {
    if (entry.type !== PI_ENTRY.SESSION_INFO) continue
    if (typeof entry.name === 'string' && entry.name.trim() !== '') name = entry.name.trim()
  }
  return name
}

/**
 * THE NON-MESSAGE ENTRIES, counted rather than dropped.
 *
 * These are pi's session FACTS -- which model, at what thinking level, what compaction, which label. dsh's log has
 * no place for most of them, so they are counted here and written to the import's sidecar. A reader who is not
 * told that a session was compacted reads a measurement over a conversation the model can no longer see.
 */
function countNonMessageEntries(entries, facts) {
  for (const entry of entries) {
    switch (entry.type) {
      case PI_ENTRY.MESSAGE: {
        const role = entry.message?.role
        if (role === PI_ROLE.SYSTEM) {
          facts.systemMessages += 1
          const sections = entry.message?.sections
          if (sections !== null && typeof sections === 'object') {
            facts.promptSections += Object.keys(sections).length
          }
        } else if (role === PI_ROLE.BASH_EXECUTION) {
          facts.bashExecutions += 1
        }
        break
      }
      case PI_ENTRY.COMPACTION: facts.compactionEntries += 1; break
      case PI_ENTRY.CONTEXT_EDIT: facts.contextEdits += 1; break
      case PI_ENTRY.BRANCH_SUMMARY: facts.branchSummaries += 1; break
      case PI_ENTRY.CUSTOM: facts.customEntries += 1; break
      case PI_ENTRY.LABEL: facts.labels += 1; break
      case PI_ENTRY.USAGE: facts.usageEntries += 1; break
      case PI_ENTRY.MODEL_CHANGE: facts.modelChanges += 1; break
      case PI_ENTRY.THINKING_LEVEL_CHANGE: {
        facts.thinkingLevelChanges += 1
        if (typeof entry.thinkingLevel === 'string') facts.thinkingLevels.push(entry.thinkingLevel)
        break
      }
      default: break
    }
  }
}

/** A filesystem-safe slug for a session, for the import's report. */
export function slugify(value, fallback = 'pi-session') {
  const slug = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return slug === '' ? fallback : slug
}
