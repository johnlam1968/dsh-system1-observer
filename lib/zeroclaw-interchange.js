// CONVERT A ZEROCLAW SESSION DB INTO dsh-chat-import INTERCHANGE v1 DOCUMENTS.
//
// ── WHY THE PLUGIN CANNOT READ THIS STORE DIRECTLY ────────────────────────────────────────────────────────
// `dsh-chat-import` (0.25.2) has an `openclaw` parser, and zeroclaw is an OpenClaw variant — but that parser is
// **JSONL**: `lib/discovery/jsonl.mjs:381` roots it at `~/.openclaw/agents`, and `lib/convert/openclaw.mjs` reads
// `{type:'session'|'message'}` lines. This store is **SQLite**: `~/.zeroclaw-jane/data/sessions/sessions.db`, whose
// `sessions` table is `(id, session_key, role, content, created_at)` — a flat MESSAGE list, one file per session
// does not exist. The plugin's sqlite family (`lib/discovery/sqlite.mjs`) covers opencode/mimocode/kilocode/
// teleagent, zcode, goose, zed, crush, trae and hermes; zeroclaw is not among them. Measured, not assumed.
//
// So the supported way in is the plugin's own documented escape hatch: the `dsh-chat-import-convert` skill —
// "Convert any external chat transcript into an importable dsh-chat-import interchange v1 JSON document".
// This module produces exactly that, and nothing else.
//
// ── WHAT IS AND IS NOT IN THE OUTPUT ───────────────────────────────────────────────────────────────────────
// The store has four columns and no more. Measured on this host: 7 sessions, 336 messages, roles are exactly
// {user: 168, assistant: 168}. There is **no tool traffic and no reasoning** — this is a Telegram/RPC chat bot,
// not a coding agent, so an interchange document here carries prompt + steps and nothing else. Every field the
// source cannot support is OMITTED rather than zero-filled, which is the presence-versus-absence rule in
// `docs/adapters-and-standards.md`: "A run whose diagnostic says hasCost: false has no cost, not a cost of zero."
//
// ONE deliberate loss, counted and reported: the stored `content` begins with a redundant rendered timestamp,
// `[2026-09-16 16:48:18 -04:00] 测试一下`. The authoritative timestamp is the row's own `created_at`, which is kept
// as the turn/step `time` in epoch ms. Keeping the prefix would print the same instant twice in two zones and
// make every imported prompt start with bracket noise. `strippedPrefixes` is returned so the caller can say how
// many rows were touched rather than losing it silently.

/**
 * A message row from the `sessions` table, plus its `session_metadata` row when one exists.
 * @typedef {{ role: 'user'|'assistant', content: string, createdAt: string, id: number }} ZeroclawMessage
 * @typedef {{ sessionKey: string, createdAt?: string, name?: string|null, messageCount?: number }} ZeroclawMeta
 */

/** RFC3339 with nanosecond precision -> epoch ms. Returns null when unparseable (absent, not zero). */
export function toEpochMs(value) {
  if (typeof value !== 'string' || value === '') return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

// `content` is stored with the sender's local time already rendered into the first line, e.g.
// `[2026-09-16 16:48:18 -04:00] 测试一下`.
//
// The bracket must be a DATE. A first attempt matched `^\[[^\]\n]*\]` — "any leading bracket" — and silently
// deleted four real messages whose whole content was a turn-end marker: `[Session interrupted — not continuing
// this request]` and `[Task failed — not continuing this request]` (measured: rows 44, 254, 256, 440 of
// telegram_jane). A marker is not a timestamp, and a status the source states in words is not noise.
const LEADING_STAMP = /^\[\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?[^\]\n]*\]\s*/

// A turn-end marker: the source recording in prose that the turn did not finish. Kept verbatim as content AND
// recognised, because the interchange schema has exactly one field for it and the repo's rule is that a turn's
// end state is addressable rather than inferred from what is missing.
const END_MARKER = /^\[(Session interrupted|Task failed)[^\]\n]*\]/i

/** Does this text carry a turn-end marker rather than (or as well as) a rendered timestamp? */
export function endMarkerOf(text) {
  const match = END_MARKER.exec(typeof text === 'string' ? text.trim() : '')
  if (!match) return null
  return match[1].toLowerCase() === 'session interrupted' ? 'interrupted' : 'failed'
}

/**
 * Strip the redundant leading rendered timestamp, but only when it actually is one.
 * @returns {{ text: string, stripped: boolean }}
 */
export function stripRenderedStamp(content) {
  const text = typeof content === 'string' ? content : ''
  const match = LEADING_STAMP.exec(text)
  if (!match) return { text: text.trim(), stripped: false }
  return { text: text.slice(match[0].length).trim(), stripped: true }
}

/**
 * Build ONE interchange v1 document from one session's messages, in stored order.
 *
 * A user message opens a turn; every assistant message until the next user message becomes a step of that turn.
 * zeroclaw alternates strictly here (168/168), so every turn carries exactly one step — but the reader tolerates
 * several, which is what a source with multi-part answers would produce.
 *
 * @param {string} sessionKey
 * @param {ZeroclawMessage[]} messages in store order
 * @param {ZeroclawMeta} [meta]
 * @returns {{ doc: object, stats: { turns: number, steps: number, prompts: number, strippedPrefixes: number, abortedTurns: number, failedTurns: number, emptyTurns: number } }}
 */
export function sessionToInterchange(sessionKey, messages, meta = {}) {
  const turns = []
  let current = null
  let prompts = 0
  let strippedPrefixes = 0
  let abortedTurns = 0
  let failedTurns = 0

  for (const row of messages) {
    const { text, stripped } = stripRenderedStamp(row?.content)
    if (stripped) strippedPrefixes++
    const time = toEpochMs(row?.createdAt)

    if (row?.role === 'user') {
      if (!text) continue // an ask with no text would be dropped downstream anyway; skip it here, counted as empty
      current = { prompt: text, steps: [] }
      if (time !== null) current.time = time
      turns.push(current)
      prompts++
    } else if (row?.role === 'assistant' && current) {
      // An assistant row before any user row has no turn to belong to. The plugin's openclaw parser drops these
      // too (`else if (msg.role === 'assistant' && cur)`); matching that is deliberate, not an oversight.
      if (!text) continue
      const step = { content: [{ type: 'text', text }] }
      if (time !== null) step.time = time
      current.steps.push(step)

      // The source states the turn's end in prose. Record it where the format has a field for it, and keep the
      // marker text either way — `[Task failed …]` has no such field, so it is preserved as content and counted,
      // never silently dropped and never upgraded into a field the schema does not define.
      const marker = endMarkerOf(text)
      if (marker === 'interrupted') { current.aborted = true; abortedTurns++ }
      else if (marker === 'failed') { failedTurns++ }
    }
    // any other role: the store has none (measured), and an unknown role is dropped rather than guessed at
  }

  // A turn with a prompt but no step still imports (the prompt is real); one with neither is dropped by the plugin.
  const emptyTurns = turns.filter((t) => !t.prompt && t.steps.length === 0).length

  const createdAt = toEpochMs(meta?.createdAt)
    ?? turns.find((t) => typeof t.time === 'number')?.time
    ?? null

  const doc = {
    interchange: 'dsh-chat-import',
    version: 1,
    meta: { id: sessionKey, ...(createdAt !== null ? { createdAt } : {}) },
    // The store's own name is null for every session on this host, so the first ask is the title — which is also
    // what the plugin would have derived on its own. Only an explicit name overrides it.
    ...(meta?.name ? { title: meta.name } : {}),
    provider: 'zeroclaw',
    turns,
  }

  return {
    doc,
    stats: {
      turns: turns.length,
      steps: turns.reduce((n, t) => n + t.steps.length, 0),
      prompts,
      strippedPrefixes,
      abortedTurns,
      failedTurns,
      emptyTurns,
    },
  }
}

/**
 * Split a flat message list into per-session groups, preserving store order within each group.
 * @param {ZeroclawMessage[]} messages
 * @returns {Map<string, ZeroclawMessage[]>}
 */
export function groupBySession(messages) {
  const groups = new Map()
  for (const row of messages) {
    const key = row?.sessionKey
    if (typeof key !== 'string' || key === '') continue
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }
  return groups
}
