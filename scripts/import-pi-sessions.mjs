#!/usr/bin/env node
// CONVERT PI SESSIONS INTO DSH SESSION LOGS, so this plugin can measure them.
//
//   node scripts/import-pi-sessions.mjs --out <staging-root> [--root ~/.pi] [--compression zstd]
//                                       [--agent <name>] [--cwd <slug-filter>] [--limit N] [--dry-run]
//   node scripts/import-pi-sessions.mjs --install <staging-root> --to <session-root>
//
// The conversion rules live in `core/pi-session-import.js` (pure, tested). This file is the half that needs the
// harness: it writes the events through the harness's OWN persistence API rather than emitting JSONL by hand,
// because the writer enforces the structural rules a hand-written log gets wrong -- `SessionFormatError:
// assistant/message does not match an open turn and step` was measured from exactly that, and `dsh/pi-session-export.js`
// carries the same rules as a test because that refusal only shows up in a second process, over real files.
//
// ── WHY THIS WRITER IS ADDITIVE AND `import-deepseek-web.mjs` IS NOT ─────────────────────────────────────────
// The DeepSeek importer **wipes and recreates** its output root, which is safe for an export directory nobody else
// uses and **destructive** for a root a deployment reads. This one targets `~/.dsh/sessions` -- the LIVE root, where
// every dsh conversation already is -- so it does three things differently, each from a measured lesson:
//
//   * it never deletes anything. Sessions are written into a staging root and then MOVED into the target;
//   * it REFUSES to overwrite an existing session id, because an imported session id is derived from pi's and a
//     collision means two different conversations wearing one name. `--force` says you meant it;
//   * `--compression` defaults to **zstd**, which is what a real deployment writes. F147 measured what the other
//     default does: a single uncompressed artifact in a zstd root is refused at listing time and breaks the WHOLE
//     root's session list.
//
// ── WHY TWO STEPS ────────────────────────────────────────────────────────────────────────────────────────
// Converting 223 sessions means writing ~170 MB through the persistence API, and a half-finished import into the
// live root would leave session directories no deployment can read. So `--out` builds a STAGING root and
// `--install` moves finished sessions in. The move is the commit point; until it runs, nothing a deployment can
// see has changed.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { eventsOf, parseSession } from '../dsh/pi-session-export.js'

const argv = process.argv.slice(2)
const flag = (name, fallback = null) => {
  const at = argv.indexOf(`--${name}`)
  return at === -1 ? fallback : argv[at + 1]
}
const ROOT = flag('root', join(homedir(), '.pi'))
const OUT = flag('out')
const INSTALL = flag('install')
const TO = flag('to')
const COMPRESSION = flag('compression', 'zstd')
const AGENT = flag('agent')
const CWD_FILTER = flag('cwd')
const LIMIT = Number(flag('limit', '0')) || 0
const FORCE = argv.includes('--force')
const DRY_RUN = argv.includes('--dry-run')

if (OUT === null && INSTALL === null) {
  console.error('usage:\n'
    + '  node scripts/import-pi-sessions.mjs --out <staging-root> [--root ~/.pi] [--compression none|zstd]\n'
    + '                                      [--agent <name>] [--cwd <slug>] [--limit N] [--dry-run] [--force]\n'
    + '  node scripts/import-pi-sessions.mjs --install <staging-root> --to <session-root> [--force]\n')
  process.exit(2)
}
if (COMPRESSION !== 'none' && COMPRESSION !== 'zstd') {
  console.error(`--compression must be 'none' or 'zstd', got ${JSON.stringify(COMPRESSION)}`)
  process.exit(2)
}
if (INSTALL !== null && TO === null) {
  console.error('--install needs --to <session-root>')
  process.exit(2)
}

/* ── THE INSTALL STEP ───────────────────────────────────────────────────────────────────────────────────── */

if (INSTALL !== null) {
  const moved = []
  const skipped = []
  const refused = []
  for (const slug of readdirSync(INSTALL, { withFileTypes: true })) {
    if (!slug.isDirectory() || slug.name === 'IMPORT-MAP.json') continue
    for (const session of readdirSync(join(INSTALL, slug.name), { withFileTypes: true })) {
      if (!session.isDirectory()) continue
      const from = join(INSTALL, slug.name, session.name)
      const to = join(TO, slug.name, session.name)
      // A COLLISION IS TWO CONVERSATIONS WITH ONE NAME. Refusing is the whole point; `--force` is the way past it.
      if (existsSync(to) && !FORCE) {
        refused.push(to)
        continue
      }
      if (DRY_RUN) { moved.push(to); continue }
      mkdirSync(dirname(to), { recursive: true })
      try {
        renameSync(from, to)
      } catch (error) {
        // A cross-device move is the one case `rename` cannot do, and it is a copy rather than a failure.
        cpSync(from, to, { recursive: true })
        rmSync(from, { recursive: true, force: true })
        console.error(`  note: ${from} was copied rather than moved (${error.code})`)
      }
      moved.push(to)
    }
  }
  console.log(JSON.stringify({ installed: moved.length, refused: refused.length, dryRun: DRY_RUN }, null, 2))
  for (const path of refused.slice(0, 5)) console.log(`  REFUSED (already there): ${path}  -- pass --force to overwrite`)
  if (moved.length > 0) {
    console.log(`\n${TO} now holds the imported sessions. A deployment picks them up on its next listing;`)
    console.log('if it was running, restart it or open a session so the listing is rebuilt.')
  }
  process.exit(refused.length > 0 && !FORCE ? 1 : 0)
}

/* ── THE CONVERT STEP ───────────────────────────────────────────────────────────────────────────────────── */

/** A pi session's UUID out of a file or directory name: `<timestamp>_<uuid>.jsonl`. */
function uuidOf(name) {
  const base = String(name ?? '').replace(/\.jsonl$/, '')
  const at = base.indexOf('_')
  const tail = at === -1 ? base : base.slice(at + 1)
  return /^[0-9a-f-]{8,}$/i.test(tail) ? tail : null
}

/**
 * EVERY pi session under `root`, RECURSIVELY, and what kind it is.
 *
 * The recursive part is not a nicety. Measured on this host: `<slug>/*.jsonl` finds **188** of the **223** sessions,
 * because pi keeps two more kinds INSIDE a session's own directory:
 *
 *   `<session>/forks/<ts>_<uuid>.jsonl`     a `/fork` or `/clone` -- a real sibling conversation whose header
 *                                             names `parentSession`;
 *   `<session>/<uuid>/run-N/session.jsonl`  a **SUBAGENT RUN** -- a child agent's own conversation, with its own
 *                                             id and no `parentSession`.
 *
 * A subagent run is not an exchange of its parent's conversation, and importing it as one is the mistake
 * `docs/adapters-and-standards.md` records against a dsh library in which "318 of 498 stored sessions" are subagent
 * runs: an index of "sessions" that cannot tell them apart answers a question about conversations with the wrong
 * population. So they are imported with dsh's own `origin: 'subagent'` -- the flag this plugin's `observeSubagents`
 * already knows how to skip.
 */
function discover(root) {
  const found = []
  const agents = AGENT === null ? readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()) : [{ name: AGENT }]
  for (const agent of agents) {
    const dir = join(root, agent.name, 'sessions')
    if (!existsSync(dir)) continue
    for (const slug of readdirSync(dir, { withFileTypes: true })) {
      if (!slug.isDirectory()) continue
      if (CWD_FILTER !== null && !slug.name.includes(CWD_FILTER)) continue
      const walk = (current, relative, parentUuid) => {
        for (const entry of readdirSync(current, { withFileTypes: true })) {
          const full = join(current, entry.name)
          if (entry.isDirectory()) {
            walk(full, `${relative}/${entry.name}`, uuidOf(relative.split('/').pop() ?? '') ?? parentUuid)
            continue
          }
          if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
          // THE FILE'S OWN PATH, name included. The classification below reads the tail of it
          // (`…/forks/<file>.jsonl`, `…/run-N/session.jsonl`), so a relative path that stopped at the containing
          // DIRECTORY could never match either shape -- which is how 23 subagent runs came out classified as root
          // sessions in the first run of this importer.
          const fileRelative = `${relative}/${entry.name}`
          let kind = 'root'
          let parent = parentUuid
          if (fileRelative.includes('/forks/')) kind = 'fork'
          else if (/\/run-\d+\/session\.jsonl$/.test(fileRelative)) {
            kind = 'subagent'
            parent = uuidOf(fileRelative.split('/')[1] ?? '')
          }
          found.push({ file: full, agent: agent.name, slug: slug.name, bytes: statSync(full).size, kind, parentPiId: parent })
        }
      }
      walk(join(dir, slug.name), '', null)
    }
  }
  found.sort((a, b) => b.bytes - a.bytes)
  return LIMIT > 0 ? found.slice(0, LIMIT) : found
}

/** A harness package, resolved the way the suite resolves the harness: locally, else from the installed one. */
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

const sessions = discover(ROOT)
if (sessions.length === 0) {
  console.error(`no pi sessions found under ${ROOT}${AGENT === null ? '' : ` (agent ${AGENT})`}`)
  process.exit(2)
}

const report = {
  generatedAt: new Date().toISOString(),
  source: 'pi (pi-coding-agent session format)',
  piRoot: ROOT,
  stagedAt: OUT ?? null,
  compression: COMPRESSION,
  sessions: [],
  totals: {},
  // WHAT THE LOG DELIBERATELY DOES NOT CARRY. Written beside the sessions rather than inside them, because a
  // measurement that read a compacted conversation without being told would look complete while the model could
  // no longer see half of it. The keys are the CONVERTER'S OWN FACT NAMES, summed as they are: an earlier version
  // listed them under different names (`compactions`, `images`) and read the matching keys as `undefined`, so the
  // two most important lines in this report printed `0` on a corpus that holds 8 compactions and 131 images.
  notInLog: {
    offBranchEntries: 0, unresolvedCalls: 0, orphanResults: 0, imagesNotInLog: 0, promptSections: 0,
    systemMessages: 0, compactionEntries: 0, contextEdits: 0, bashExecutions: 0, customEntries: 0,
    thinkingLevelChanges: 0, modelChanges: 0, reasoningTokens: 0, customMessages: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
}

if (DRY_RUN) {
  for (const entry of sessions) {
    const parsed = parseSession(readFileSync(entry.file, 'utf8'))
    const built = eventsOf(parsed)
    report.sessions.push({ piFile: entry.file, id: built.id, events: built.events.length, turns: built.facts.turns, asks: built.facts.operatorAsks, title: built.facts.title })
  }
  console.log(`dry run: ${sessions.length} session(s) would be converted`)
  console.log(JSON.stringify(report.sessions.slice(0, 10), null, 2))
  process.exit(0)
}

const { Context } = await harnessPackage('@deepseek-ai/cordis')
const JsonlPersistence = (await harnessPackage('@deepseek-ai/dsh-session-persistence-jsonl')).default
const SessionStore = (await harnessPackage('@deepseek-ai/dsh-session')).default

mkdirSync(OUT, { recursive: true })
const ctx = new Context()
ctx.plugin(SessionStore)
ctx.plugin(JsonlPersistence, { root: OUT, compression: COMPRESSION })
await new Promise((resolve) => setTimeout(resolve, 300))
const persistence = ctx.get('sessionPersistence')
if (!persistence) throw new Error('session persistence did not mount: the harness packages resolved but refused to load')

for (const entry of sessions) {
  let parsed
  try {
    parsed = parseSession(readFileSync(entry.file, 'utf8'))
  } catch (error) {
    report.sessions.push({ piFile: entry.file, problem: `unreadable: ${error.message}` })
    continue
  }
  const built = eventsOf(parsed)
  if (built.events.length === 0 || built.id === null) {
    report.sessions.push({ piFile: entry.file, id: built.id, problem: 'nothing to convert' })
    continue
  }
  try {
    // THE HEADER FIELDS THAT CARRY WHAT pi KNOWS AND dsh ALSO HAS. `origin: 'subagent'` is the one that matters:
    // this plugin's `observeSubagents` knob (off by default) reads it to record a subagent's traffic as SKIP lines
    // rather than measure it as a conversation, and an import that flattened the two would quietly measure a
    // child agent's run as though the operator had said it.
    const header = {
      version: 4, id: built.id, createdAt: built.createdAt, isSeeded: false, delegationDepth: 0,
      ...(built.cwd === undefined ? {} : { cwd: built.cwd }),
      ...(entry.kind === 'subagent' ? { origin: 'subagent', delegationDepth: 1 } : {}),
      ...(entry.parentPiId === null || entry.parentPiId === undefined ? {} : { parentSession: `session-${entry.parentPiId}` }),
    }
    const handle = await persistence.create(header)
    await handle.append(built.events)
    await handle.flush()
    await handle.close()
  } catch (error) {
    // ONE REFUSAL MUST NOT END THE IMPORT. The harness validates as it writes, so this is where a structural rule
    // this converter got wrong would announce itself -- for one session, with the reason.
    report.sessions.push({ piFile: entry.file, id: built.id, problem: `the harness refused this log: ${error.message}` })
    continue
  }
  const facts = built.facts
  for (const key of Object.keys(report.notInLog)) {
    if (key === 'cost') continue
    report.notInLog[key] += Number(facts[key]) || 0
  }
  for (const key of Object.keys(report.notInLog.cost)) report.notInLog.cost[key] += Number(facts.cost[key]) || 0
  report.sessions.push({
    id: built.id,
    piFile: entry.file,
    piAgent: entry.agent,
    piKind: entry.kind,
    piParentSession: entry.parentPiId === null ? null : `session-${entry.parentPiId}`,
    piCwd: facts.piCwd,
    title: facts.title,
    createdAt: new Date(built.createdAt).toISOString(),
    events: built.events.length,
    turns: facts.turns,
    operatorAsks: facts.operatorAsks,
    assistantMessages: facts.assistantMessages,
    toolCalls: facts.toolCalls,
    toolResults: facts.toolResults,
    reasoningBlocks: facts.reasoningBlocks,
    unparseableLines: facts.unparseableLines,
    notInLog: {
      offBranchEntries: facts.offBranchEntries, unresolvedCalls: facts.unresolvedCalls, orphanResults: facts.orphanResults,
      images: facts.imagesNotInLog, promptSections: facts.promptSections, systemMessages: facts.systemMessages,
      compactions: facts.compactionEntries, contextEdits: facts.contextEdits, bashExecutions: facts.bashExecutions,
      customMessages: facts.customMessages, customMessagesHidden: facts.customMessagesHidden,
      thinkingLevelChanges: facts.thinkingLevelChanges, modelChanges: facts.modelChanges,
      reasoningTokens: facts.reasoningTokens, cost: facts.cost, models: facts.models,
    },
  })
  process.stdout.write(`  ${report.sessions.length}/${sessions.length} ${basename(entry.file)}\n`)
}

report.totals = {
  converted: report.sessions.filter((s) => s.problem === undefined).length,
  refused: report.sessions.filter((s) => s.problem !== undefined).length,
  turns: report.sessions.reduce((n, s) => n + (s.turns ?? 0), 0),
  operatorAsks: report.sessions.reduce((n, s) => n + (s.operatorAsks ?? 0), 0),
  assistantMessages: report.sessions.reduce((n, s) => n + (s.assistantMessages ?? 0), 0),
  events: report.sessions.reduce((n, s) => n + (s.events ?? 0), 0),
  // THE POPULATION SPLIT, because "how many sessions" is the wrong question on its own: a subagent run is a child
  // agent's conversation, not an exchange of the operator's.
  roots: report.sessions.filter((s) => s.piKind === 'root').length,
  forks: report.sessions.filter((s) => s.piKind === 'fork').length,
  subagentRuns: report.sessions.filter((s) => s.piKind === 'subagent').length,
}

writeFileSync(join(OUT, 'IMPORT-MAP.json'), JSON.stringify(report, null, 2) + '\n')

console.log('\n=== IMPORT TOTALS ===')
console.log(JSON.stringify(report.totals, null, 2))
console.log('\n=== NOT IN THE LOG (recorded in IMPORT-MAP.json) ===')
console.log(JSON.stringify(report.notInLog, null, 2))
for (const session of report.sessions.filter((s) => s.problem !== undefined).slice(0, 10)) {
  console.log(`  REFUSED: ${session.piFile}\n    ${session.problem}`)
}
console.log(`\nstaging root: ${OUT}`)
console.log('to make these visible to a deployment:')
console.log(`  node scripts/import-pi-sessions.mjs --install ${OUT} --to ${join(homedir(), '.dsh', 'sessions')}`)
