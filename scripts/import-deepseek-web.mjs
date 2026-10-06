// CONVERT A DEEPSEEK CHAT WEB EXPORT INTO DSH SESSION LOGS, so this plugin can measure it.
//
//   node scripts/import-deepseek-web.mjs --export <extracted-export-dir> --out <session-root> [--compression zstd]
//
// The conversion rules live in `lib/deepseek-web-export.js` (pure, tested). This file is the part that needs a
// harness: it writes the events through the harness's OWN persistence API rather than emitting JSONL by hand,
// because the writer enforces the structural rules that a hand-written log gets wrong --
// `SessionFormatError: assistant/message does not match an open turn and step` was measured from exactly that.
//
// THE COMPRESSION MUST MATCH THE DEPLOYMENT THAT WILL READ IT, and this is the one setting that decides whether the
// import is measurable at all. `dsh-session-persistence-jsonl` defaults to `zstd`; a root holding even ONE artifact
// of the other encoding is refused at listing time, and that aborts the listing for EVERY session in the root
// (`F147`, measured: dropping uncompressed logs into a live `zstd` root broke a deployment's whole session list).
// `none` stays the default here because it keeps the logs readable as plain JSONL with no harness at all -- but if
// the sessions are meant to be measured in a running deployment, pass `--compression zstd`.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { eventsOf, loadExport } from '../lib/deepseek-web-export.js'

const argv = process.argv.slice(2)
const flag = (name, fallback = null) => {
  const at = argv.indexOf(`--${name}`)
  return at === -1 ? fallback : argv[at + 1]
}
const EXPORT_DIR = flag('export')
const OUT = flag('out')
const COMPRESSION = flag('compression', 'none')
const CWD = flag('cwd', undefined)
const FORCE = argv.includes('--force')

if (EXPORT_DIR === null || OUT === null) {
  console.error('usage: node scripts/import-deepseek-web.mjs --export <dir> --out <session-root> [--compression none|zstd] [--cwd <dir>] [--force]')
  process.exit(2)
}
if (COMPRESSION !== 'none' && COMPRESSION !== 'zstd') {
  console.error(`--compression must be 'none' or 'zstd', got ${JSON.stringify(COMPRESSION)}`)
  process.exit(2)
}

// ── REFUSE TO DESTROY A ROOT THIS TOOL DID NOT WRITE ────────────────────────────────────────────────
// The import WIPES and recreates the output root, so a wrong path is a destructive mistake rather than a failed
// run. Both refusals are reachable as written, and the first was nearly made in this repository while measuring
// the imported corpus (`F146` is the sibling mistake, in the store).
const expectedSuffix = COMPRESSION === 'zstd' ? '.jsonl.zstd' : '.jsonl'
if (!FORCE) {
  if (/(^|\/)\.dsh\/sessions(\/|$)/.test(OUT)) {
    console.error(`refusing to write into a harness's own session root:\n  ${OUT}\n`
      + '  This import DELETES and recreates that directory. Point it at a directory of your own, or pass --force.')
    process.exit(1)
  }
  const foreign = existsSync(OUT) ? foreignArtifacts(OUT, expectedSuffix) : []
  if (foreign.length > 0) {
    console.error(`refusing to overwrite ${OUT}: it holds session artifacts of a different compression, e.g.\n  ${foreign[0]}\n`
      + '  Mixing compressions breaks listing for the WHOLE root, and this import would delete them. Use a fresh root, or pass --force.')
    process.exit(1)
  }
}

/** Session artifacts under `dir` whose filename does not match the compression about to be written. Filenames only. */
function foreignArtifacts(dir, suffix, found = []) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    if (found.length >= 5) return found
    const full = join(dir, entry.name)
    if (entry.isDirectory()) foreignArtifacts(full, suffix, found)
    else if (/^session\.v\d+\.jsonl(\.zstd)?$/.test(entry.name) && !entry.name.endsWith(suffix)) found.push(full)
  }
  return found
}

/**
 * A harness package, resolved the way the suite resolves the harness: locally if it is a dependency, otherwise from
 * the installed harness (`$DSH_HARNESS_ROOT`, or `npm root -g`). Named failure rather than a bare MODULE_NOT_FOUND.
 */
async function harnessPackage(name) {
  const tried = []
  try {
    return await import(name)
  } catch {
    tried.push('this repository\'s node_modules')
  }
  const roots = []
  if (process.env.DSH_HARNESS_ROOT) roots.push(process.env.DSH_HARNESS_ROOT)
  try {
    roots.push(join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), '@deepseek-ai/dsh/node_modules'))
  } catch {
    tried.push('npm root -g (npm not on PATH)')
  }
  for (const root of roots) {
    const manifest = join(root, name, 'package.json')
    if (!existsSync(manifest)) continue
    try {
      return await import(pathToFileURL(createRequire(manifest).resolve(name)).href)
    } catch (error) {
      tried.push(`${manifest} (${error.message})`)
    }
  }
  throw new Error(`cannot resolve ${name}. Looked in: ${tried.join('; ')}.\n`
    + '  The importer needs the harness that will read the result: install it, or set DSH_HARNESS_ROOT to its node_modules.')
}

const { Context } = await harnessPackage('@deepseek-ai/cordis')
const JsonlPersistence = (await harnessPackage('@deepseek-ai/dsh-session-persistence-jsonl')).default
const SessionStore = (await harnessPackage('@deepseek-ai/dsh-session')).default

const { conversations, user } = loadExport(EXPORT_DIR)
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const ctx = new Context()
ctx.plugin(SessionStore)
ctx.plugin(JsonlPersistence, { root: OUT, compression: COMPRESSION })
await new Promise((resolve) => setTimeout(resolve, 300))
const persistence = ctx.get('sessionPersistence')
if (!persistence) throw new Error('session persistence did not mount: the harness packages resolved but refused to load')

const report = {
  generatedAt: new Date().toISOString(),
  root: OUT,
  compression: COMPRESSION,
  exportedBy: user?.email ?? null,
  sessions: [],
  totals: { sessions: 0, turns: 0, userMessages: 0, assistantMessages: 0, reasoningBlocks: 0, emptyAttachmentTurns: 0, citationsNotInLog: 0, attachmentsNotInLog: 0 },
}

for (const conversation of conversations) {
  const built = eventsOf(conversation, { sessionId: `session-${conversation.id}`, cwd: CWD })
  const handle = await persistence.create({ version: 4, id: built.id, createdAt: built.createdAt, isSeeded: false, ...(CWD ? { cwd: CWD } : {}) })
  if (built.events.length > 0) await handle.append(built.events)
  await handle.flush()
  await handle.close()

  report.totals.sessions += 1
  report.totals.turns += built.counts.turns
  report.totals.reasoningBlocks += built.counts.reasoningBlocks
  report.totals.emptyAttachmentTurns += built.counts.emptyAttachmentTurns
  report.totals.userMessages += built.events.filter((e) => e.type === 'user/message').length
  report.totals.assistantMessages += built.events.filter((e) => e.type === 'assistant/message').length
  report.sessions.push({
    id: built.id,
    title: conversation.title ?? null,
    sourceConversationId: conversation.id,
    createdAt: new Date(built.createdAt).toISOString(),
    turns: built.counts.turns,
    events: built.events.length,
    citations: built.citations,
    attachments: built.attachments,
  })
}

// THE LOSSLESS SIDECAR: what the session log deliberately does not carry (citations that are not session events,
// attachment references whose bytes are not in the archive). Written BEFORE the totals that count them, and again
// after, so the file on disk and the numbers printed agree.
writeFileSync(join(OUT, 'IMPORT-MAP.json'), JSON.stringify(report, null, 2) + '\n')
report.totals.citationsNotInLog = report.sessions.reduce((n, s) => n + s.citations.length, 0)
report.totals.attachmentsNotInLog = report.sessions.reduce((n, s) => n + s.attachments.length, 0)
writeFileSync(join(OUT, 'IMPORT-MAP.json'), JSON.stringify(report, null, 2) + '\n')

console.log('=== IMPORT TOTALS ===')
console.log(JSON.stringify(report.totals, null, 2))
console.log(`\nsession root: ${OUT}`)
console.log(`compression : ${COMPRESSION}${COMPRESSION === 'none'
  ? '  <- plain JSONL: a default (zstd) deployment will REFUSE this root wholesale'
  : '  <- matches a default dsh deployment, so it can be measured in place'}`)
console.log(COMPRESSION === 'none'
  ? 'to measure these in a running deployment: re-run with --compression zstd into a fresh root'
  : 'to measure: point a deployment at this root, or copy the session directories into its own root')
