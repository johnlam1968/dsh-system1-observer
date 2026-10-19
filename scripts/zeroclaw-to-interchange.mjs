#!/usr/bin/env node
// READ A ZEROCLAW SESSION DB AND WRITE dsh-chat-import INTERCHANGE v1 FILES, one per session.
//
//   node scripts/zeroclaw-to-interchange.mjs --out <dir> [--db ~/.zeroclaw-jane/data/sessions/sessions.db]
//                                            [--session <key>] [--dry-run] [--quiet]
//
// ── WHY A CONVERTER AND NOT A PLUGIN PARSER ──────────────────────────────────────────────────────────────────
// `dsh-chat-import` reads 25+ harnesses but not this one: its `openclaw` parser is JSONL rooted at
// `~/.openclaw/agents` (`core/discovery/jsonl.mjs:381`), and its sqlite family covers opencode/mimocode/kilocode/
// teleagent/zcode/goose/zed/crush/trae/hermes — no zeroclaw. `core/zeroclaw-interchange.js` says why and what is
// lost; this file is only the half that touches a filesystem and a database.
//
// ── THE DB IS OPENED READ-ONLY, AND THAT IS THE POINT ────────────────────────────────────────────────────────
// zeroclaw is a live service (a Telegram bot) with `sessions.db-wal` / `-shm` sidecars sitting next to the
// database. `readOnly: true` is not caution for its own sake: it is the only mode that guarantees this script
// cannot checkpoint the writer's WAL or leave a lock on a database a running agent owns.
//
// ── WHY THE OUTPUT IS A DIRECTORY OF FILES AND NOT ONE BUNDLE ───────────────────────────────────────────────
// The plugin's incremental rule is keyed on a source file's stat (mtime + size). One file per session means a
// later-continued session invalidates exactly ONE receipt, instead of one concatenated document whose every
// session re-imports whenever any one of them grows.
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { groupBySession, sessionToInterchange, toEpochMs } from '../core/zeroclaw-interchange.js'

const argv = process.argv.slice(2)
const flag = (name, fallback = null) => {
  const at = argv.indexOf(`--${name}`)
  return at === -1 ? fallback : argv[at + 1]
}
const has = (name) => argv.includes(`--${name}`)

const OUT = flag('out')
const DB = flag('db', join(homedir(), '.zeroclaw-jane', 'data', 'sessions', 'sessions.db'))
const ONLY = flag('session')
const DRY = has('dry-run')
const QUIET = has('quiet')

if (!OUT) {
  process.stderr.write('用法: node scripts/zeroclaw-to-interchange.mjs --out <dir> [--db <path>] [--session <key>] [--dry-run]\n')
  process.exit(2)
}

const require = createRequire(import.meta.url)
let DatabaseSync
try {
  ;({ DatabaseSync } = require('node:sqlite'))
} catch {
  process.stderr.write('node:sqlite 不可用（需要 Node >= 22.13）\n')
  process.exit(1)
}

// ── read ──────────────────────────────────────────────────────────────────────────────────────────────────────
const db = new DatabaseSync(DB, { readOnly: true })
const rows = db.prepare(
  'SELECT id, session_key AS sessionKey, role, content, created_at AS createdAt FROM sessions ORDER BY id',
).all()

// `session_metadata` may be absent in some zeroclaw builds; the metadata is a title bonus, never a requirement.
const metaByKey = new Map()
try {
  for (const m of db.prepare(
    'SELECT session_key AS sessionKey, created_at AS createdAt, name, message_count AS messageCount FROM session_metadata',
  ).all()) metaByKey.set(m.sessionKey, m)
} catch {
  // table missing — carry on with first-message timestamps
}
db.close()

// ── convert ───────────────────────────────────────────────────────────────────────────────────────────────────
const groups = groupBySession(rows)
if (!DRY) mkdirSync(OUT, { recursive: true })

const totals = { sessions: 0, turns: 0, steps: 0, prompts: 0, strippedPrefixes: 0, abortedTurns: 0, failedTurns: 0, written: 0 }
const written = []
for (const [key, messages] of groups) {
  if (ONLY && key !== ONLY) continue
  const { doc, stats } = sessionToInterchange(key, messages, metaByKey.get(key) ?? {})
  if (doc.turns.length === 0) {
    // The plugin rejects a document with no importable turns; say so rather than writing a file it will refuse.
    process.stdout.write(`skip ${key}: 0 turn(s) — nothing importable\n`)
    continue
  }
  totals.sessions++
  totals.turns += stats.turns
  totals.steps += stats.steps
  totals.prompts += stats.prompts
  totals.strippedPrefixes += stats.strippedPrefixes
  totals.abortedTurns += stats.abortedTurns
  totals.failedTurns += stats.failedTurns

  const path = join(OUT, `${key.replace(/[^\w.-]+/g, '_')}.interchange.json`)
  const json = JSON.stringify(doc, null, 2)
  if (!DRY) writeFileSync(path, json, 'utf8')
  totals.written++
  written.push({ path, key, bytes: Buffer.byteLength(json), ...stats, createdAt: doc.meta.createdAt })
}

// ── report ───────────────────────────────────────────────────────────────────────────────────────────────────
// Everything absent from the source is reported as absent. `toolCalls: 0` is printed, not hidden: for THIS store
// it is a measurement (roles are exactly user/assistant), not a missing field. The end markers are reported for
// the same reason: a turn that failed or was interrupted is a fact, and "assistant steps == prompts" would hide it.
if (!QUIET) {
  process.stdout.write(
    `\nzeroclaw -> dsh-chat-import interchange v1\n`
    + `  source db     ${DB}${DRY ? '  (dry run, nothing written)' : ''}\n`
    + `  sessions      ${totals.sessions} of ${groups.size} in store`
    + (ONLY ? ` (filtered to ${ONLY})` : '')
    + `; ${metaByKey.has(ONLY) ? 'named' : 'unnamed'} in session_metadata\n`
    + `  turns/prompts ${totals.turns} / ${totals.prompts}    assistant steps ${totals.steps}\n`
    + `  tool calls    0  (absent in this store, not zero-valued)\n`
    + `  reasoning     0  (absent in this store, not zero-valued)\n`
    + `  end markers   ${totals.abortedTurns} interrupted (turn.aborted: true)`
    + `, ${totals.failedTurns} failed (kept as message text — interchange v1 has no field for it)\n`
    + `  stamp prefix  ${totals.strippedPrefixes} message(s) had a redundant rendered timestamp stripped;\n`
    + `                the row's created_at is kept as the turn/step time in epoch ms\n`
    + `  output        ${DRY ? '(dry run)' : OUT}\n`,
  )
  for (const w of written) {
    process.stdout.write(`    ${w.key}  turns=${w.turns} steps=${w.steps} bytes=${w.bytes}\n`)
  }
}
