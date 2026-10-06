// DEEPSEEK CHAT WEB EXPORT -> DSH SESSION EVENTS. The pure half: parse, linearize, map. No harness, no files.
//
// WHY THIS IS IN THIS REPOSITORY. `packages/session-adapter` reads HARNESS sessions and has no reader for any
// foreign format (`docs/adapters-and-standards.md`, "The prerequisite"). So a foreign transcript has to BECOME a
// DSH session before anything here can measure it, and this module is that conversion for one format: the archive
// `chat.deepseek.com` hands a user, `conversations.json`.
//
// The conversion rules are not obvious and each was measured rather than guessed; they were worked out by the
// *Paper screening* session in the operator's `test-system1-observer` workspace (2026-10-06) and are carried here
// with its reasoning:
//
//   * one conversation is a `mapping` TREE, so an edited prompt leaves two branches. The export names no winner,
//     so this follows the DEEPEST subtree -- the branch the conversation continued on -- and reports the branch
//     point so the choice is visible rather than silent;
//   * `THINK` and `RESPONSE` are separate fragments and stay separate (`reasoning` vs `text` blocks). Text never
//     shown to the user is never counted as the answer -- `F79`'s rule inside the adapter, applied at the source;
//   * `FILE` carries metadata only (the archive ships no bytes), so an attachment-only turn becomes an EMPTY user
//     message rather than a fabricated block;
//   * `SEARCH` citations are NOT session events. Emitting `tool/call` + `tool/result` for them would fabricate
//     tool history that a measurement would then read as real. They go to the sidecar (`IMPORT-MAP.json`);
//   * the conversation's title is pinned as `source.kind: 'user'`. Of the three kinds the harness declares, that is
//     the only honest one -- `fallback` claims the first prompt was truncated into a title, `provider` claims a DSH
//     title provider did it, and neither is true of a title DeepSeek Chat assigned. `user` means "supplied from
//     outside, and pinned", which is the wanted effect: automatic generation will not overwrite it.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// THE HARNESS'S EVENT VOCABULARY HAS ONE HOME (`dsh-session-adapter/session-format`), and a test in this repository
// enforces it: no other file in `lib/` may name a harness event as a string literal. This module writes events, so
// it imports the names rather than spelling them -- which is also why adding an event to the vocabulary cannot
// silently leave this converter behind.
import { EVENT, HUMAN_SOURCE_KIND } from 'dsh-session-adapter/session-format'

/** Fragment types, as the export spells them. */
export const FRAGMENT = Object.freeze({
  REQUEST: 'REQUEST',
  RESPONSE: 'RESPONSE',
  THINK: 'THINK',
  SEARCH: 'SEARCH',
  FILE: 'FILE',
})

/** Which side of the exchange a fragment belongs to. */
export const SIDE = Object.freeze({ USER: 'user', ASSISTANT: 'assistant' })

/** The title event's own type. NOT in `EVENT`: the adapter's vocabulary lists the twelve events it reads, and this is
 *  written by an importer rather than read by the composer. Declared once here so the string has one home. */
const SESSION_TITLE = 'session/title'

/** The side a fragment is on: the human's turn or the model's. */
export function sideOf(fragment) {
  return fragment?.type === FRAGMENT.REQUEST || fragment?.type === FRAGMENT.FILE ? SIDE.USER : SIDE.ASSISTANT
}

/** Load `conversations.json` and `user.json` from an extracted export directory. */
export function loadExport(dir) {
  const conversations = JSON.parse(readFileSync(join(dir, 'conversations.json'), 'utf8'))
  let user = null
  try {
    user = JSON.parse(readFileSync(join(dir, 'user.json'), 'utf8'))
  } catch {
    user = null
  }
  return { conversations, user }
}

/**
 * The live thread of one conversation, as an array of mapping nodes in order.
 *
 * At a branch, follow the child whose subtree reaches deepest; ties go to the first child listed, so the choice is
 * deterministic and reproducible. This is a CHOICE, not a fact the export states.
 */
export function linearize(conversation) {
  const mapping = conversation.mapping ?? {}
  const rootIds = Object.keys(mapping).filter((id) => mapping[id].parent === null || mapping[id].parent === undefined)
  if (rootIds.length === 0) return []
  const depthFrom = memoDepth(mapping)
  const path = []
  let current = rootIds[0]
  while (current !== undefined && mapping[current] !== undefined) {
    path.push(current)
    const children = mapping[current].children ?? []
    if (children.length === 0) break
    current = children.reduce((best, child) =>
      (depthFrom.get(child) ?? 0) > (depthFrom.get(best) ?? 0) ? child : best, children[0])
  }
  return path.map((id) => ({ id, ...mapping[id] }))
}

/** Depth of each node's subtree, memoized -- what `linearize` uses to pick the live branch. */
function memoDepth(mapping) {
  const depths = new Map()
  const visit = (id, guard) => {
    if (depths.has(id)) return depths.get(id)
    if (guard.has(id)) return 0
    guard.add(id)
    const children = mapping[id]?.children ?? []
    const depth = children.length === 0 ? 1 : 1 + Math.max(...children.map((child) => visit(child, guard)))
    depths.set(id, depth)
    guard.delete(id)
    return depth
  }
  for (const id of Object.keys(mapping)) visit(id, new Set())
  return depths
}

/** Every branch point in a conversation: nodes with more than one child, and what each branch leads with. */
export function branchPoints(conversation) {
  const mapping = conversation.mapping ?? {}
  return Object.entries(mapping)
    .filter(([, node]) => (node.children ?? []).length > 1)
    .map(([id, node]) => ({
      id,
      children: node.children,
      branches: node.children.map((child) => {
        const message = mapping[child]?.message
        return { id: child, fragments: (message?.fragments ?? []).map((f) => f.type) }
      }),
    }))
}

/** Fold one node's fragments into the pieces a reader or an importer consumes. */
export function readNode(node) {
  const message = node?.message
  const fragments = message?.fragments ?? []
  return {
    id: node.id,
    model: message?.model ?? null,
    insertedAt: message?.inserted_at ?? null,
    asks: fragments.filter((f) => f.type === FRAGMENT.REQUEST).map((f) => f.content ?? ''),
    answers: fragments.filter((f) => f.type === FRAGMENT.RESPONSE).map((f) => f.content ?? ''),
    thoughts: fragments.filter((f) => f.type === FRAGMENT.THINK).map((f) => f.content ?? ''),
    searches: fragments.flatMap((f) => f.type === FRAGMENT.SEARCH ? (f.results ?? []) : []),
    files: fragments.flatMap((f) => f.type === FRAGMENT.FILE ? (f.files ?? []) : []),
    fragmentTypes: fragments.map((f) => f.type),
  }
}

/**
 * One conversation as an ordered list of EXCHANGES: a human side followed by the model's side.
 *
 * The grouping is structural, not positional guesswork: a node whose fragments include a REQUEST or a FILE is the
 * human's, everything else is the model's, and an exchange closes when the model's side is non-empty or the run of
 * nodes ends.
 */
export function exchangesOf(conversation) {
  const nodes = linearize(conversation).map(readNode)
  const exchanges = []
  let pending = null
  for (const node of nodes) {
    const isUserSide = node.fragmentTypes.includes(FRAGMENT.REQUEST) || node.fragmentTypes.includes(FRAGMENT.FILE)
    if (isUserSide) {
      if (pending) exchanges.push(pending)
      pending = { asks: [...node.asks], files: [...node.files], nodeIds: [node.id], answers: [], thoughts: [], searches: [], model: node.model, at: node.insertedAt }
      continue
    }
    if (!pending) pending = { asks: [], files: [], nodeIds: [], answers: [], thoughts: [], searches: [], model: node.model, at: node.insertedAt }
    pending.answers.push(...node.answers)
    pending.thoughts.push(...node.thoughts)
    pending.searches.push(...node.searches)
    pending.nodeIds.push(node.id)
    if (node.model) pending.model = node.model
  }
  if (pending) exchanges.push(pending)
  return exchanges.filter((x) => x.asks.length > 0 || x.answers.length > 0 || x.thoughts.length > 0 || x.files.length > 0 || x.searches.length > 0)
}

/**
 * One conversation as DSH v4 session events, plus the citations and attachments the log deliberately does not carry.
 *
 * PURE ON PURPOSE: the structural rules are the part that is easy to get wrong (a hand-written log that pairs
 * `assistant/message` with `turn/start` but omits `step/start` is REFUSED at read time by the harness --
 * `SessionFormatError: assistant/message does not match an open turn and step`), so they are testable without a
 * harness, a filesystem or a model. The writer lives in `scripts/import-deepseek-web.mjs`.
 */
export function eventsOf(conversation, { sessionId, cwd } = {}) {
  const createdAt = Date.parse(conversation?.inserted_at) || Date.now()
  const id = sessionId ?? `session-${conversation?.id}`
  const events = []
  const citations = []
  const attachments = []
  const counts = { turns: 0, reasoningBlocks: 0, emptyAttachmentTurns: 0 }
  let seq = 0
  let turn = 0

  const ev = (type, data, time, surfaceOp) => events.push({ type, seq: seq++, time, data, ...(surfaceOp ? { surfaceOp } : {}) })

  for (const exchange of exchangesOf(conversation)) {
    const hasAsk = exchange.asks.length > 0
    const hasAnswer = exchange.answers.length > 0
    const hasThought = exchange.thoughts.length > 0
    const hasFiles = exchange.files.length > 0
    if (!hasAsk && !hasAnswer && !hasThought && !hasFiles) continue

    turn += 1
    const at = Date.parse(exchange.at) || createdAt
    ev(EVENT.TURN_START, { turn }, at)
    ev(EVENT.STEP_START, { turn, step: 1 }, at)

    if (hasAsk || hasFiles) {
      ev(EVENT.USER_MESSAGE, {
        content: exchange.asks.map((text) => ({ type: 'text', text })),
        source: { kind: HUMAN_SOURCE_KIND },
        role: 'user',
        id: `web-${id}-u${turn}`,
      }, at, 'append')
      if (turn === 1 && typeof conversation?.title === 'string' && conversation.title.trim() !== '') {
        ev(SESSION_TITLE, { title: conversation.title.trim(), messageSeqs: [], source: { kind: 'user' } }, at)
      }
      if (hasFiles && !hasAsk) counts.emptyAttachmentTurns += 1
      for (const file of exchange.files) attachments.push({ turn, ...file })
    }

    if (hasAnswer || hasThought) {
      // REASONING AND TEXT STAY SEPARATE BLOCKS, in this order: the model thought, then it answered.
      const content = [
        ...exchange.thoughts.map((text) => ({ type: 'reasoning', text })),
        ...exchange.answers.map((text) => ({ type: 'text', text })),
      ]
      ev(EVENT.ASSISTANT_MESSAGE, {
        turn,
        step: 1,
        message: {
          role: 'assistant',
          content,
          source: { kind: 'model', provider: 'deepseek', model: exchange.model ?? 'deepseek-chat' },
          id: `web-${id}-a${turn}`,
        },
        stream: [],
      }, at, 'append')
      counts.reasoningBlocks += exchange.thoughts.length
    }

    ev(EVENT.STEP_END, { turn, step: 1 }, at)
    ev(EVENT.TURN_END, { turn, reason: 'completed' }, at)
    for (const r of exchange.searches) citations.push({ turn, url: r.url, title: r.title ?? null })
  }

  counts.turns = turn
  return { id, createdAt, cwd, events, citations, attachments, counts }
}

/** A filesystem-safe slug for a conversation title. */
export function slugify(title, fallback = 'conversation') {
  const slug = String(title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return slug === '' ? fallback : slug
}
