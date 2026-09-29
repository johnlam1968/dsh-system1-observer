#!/usr/bin/env node
//
// Read an observer trace as a human, not as a JSON dump.
//
//   node scripts/trace.mjs                     # the newest run, collapsed and aligned
//   node scripts/trace.mjs --list              # which runs are in the file
//   node scripts/trace.mjs --run 19-13         # one run by id or prefix
//   node scripts/trace.mjs --hook draft        # one seam
//   node scripts/trace.mjs --agent session-    # one agent
//   node scripts/trace.mjs --calls             # hide the skips
//   node scripts/trace.mjs --tail 40           # the last 40 events
//   node scripts/trace.mjs --full              # state, question and answer under each call
//   node scripts/trace.mjs --raw               # the parsed line, unrendered
//
// A trace is append-only across restarts, so it holds several RUNS and the newest is the live one.
// Consecutive identical skips are collapsed: a subagent generated ~500 of them in a row, and a line
// per skip buries everything that matters.
import { readFileSync, statSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = argv.indexOf(name)
  return i === -1 ? fallback : argv[i + 1]
}
const has = (name) => argv.includes(name)

// Small render helpers, as HOISTED declarations: --list uses them before their old position.
function pad(s, n) { return String(s).padEnd(n) }
function short(at) { return String(at).slice(11, 23) }
function shortTime(at) { return String(at).slice(11, 19) }
function agent(id) { return id === undefined || id === null ? '(none)' : String(id).slice(0, 14) }
/** A model id as a person reads it: the executed id already carries its provider. */
function who(party) {
  if (party === undefined || party === null || party.model === undefined) return '?'
  const model = String(party.model)
  return model.includes('/') ? model : `${party.provider ?? '?'}/${model}`
}
function oneLine(s, n) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

const NO_COLOR = has('--no-color') || process.env.NO_COLOR !== undefined || process.stdout.isTTY !== true
const paint = (code) => (s) => (NO_COLOR ? String(s) : `\u001b[${code}m${s}\u001b[0m`)
const bold = paint('1'), dim = paint('2'), red = paint('31'), green = paint('32'), yellow = paint('33'), cyan = paint('36')

/** The trace this plugin writes, searched in the order the plugin itself resolves it. */
function findTrace() {
  const given = flag('--file', undefined)
  if (given !== undefined) {
    // A wrong path deserves the path, not an ENOENT stack trace.
    const asked = resolve(given)
    if (!existsSync(asked)) { console.error(`no trace at ${asked}`); process.exit(1) }
    return asked
  }
  const tried = []
  const candidates = [
    process.env.SYSTEM1_OBSERVER_TRACE,
    join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'logs', 'system1-observer.jsonl'),
    join(HERE, '..', 'data', 'system1-observer.jsonl'),
    join(process.cwd(), 'data', 'system1-observer.jsonl'),
  ].filter((c) => typeof c === 'string' && c !== '')
  // THE MOST RECENTLY WRITTEN FILE WINS, not the first path that exists. A stale one-line trace
  // under $DSH_HOME shadowed the live 2 MB one in the package's data directory, and "the newest
  // run" then reported a single mount line.
  const found = []
  const seen = new Set()
  for (const c of candidates) {
    tried.push(c)
    const real = resolve(c)
    if (seen.has(real)) continue            // two candidates can resolve to one file
    try { const mtime = statSync(real).mtimeMs; seen.add(real); found.push({ path: real, mtime }) } catch { /* not there */ }
  }
  if (found.length > 0) {
    found.sort((a, b) => b.mtime - a.mtime)
    if (found.length > 1) {
      console.error(`reading ${found[0].path}`)
      console.error(`  (also present: ${found.slice(1).map((f) => f.path).join(', ')})`)
    }
    return found[0].path
  }
  console.error('no trace found. Tried:\n' + tried.map((t) => `  ${t}`).join('\n'))
  console.error('Pass one with --file <path>, or set SYSTEM1_OBSERVER_TRACE.')
  process.exit(1)
}

const path = findTrace()
const malformed = []
const events = readFileSync(path, 'utf8')
  .split('\n')
  .filter((line) => line.trim() !== '')
  .map((line, index) => {
    try { return JSON.parse(line) } catch { malformed.push(index + 1); return null }
  })
  .filter(Boolean)

if (events.length === 0) {
  console.error(`${path} holds no events`)
  process.exit(1)
}

/** Every run in the file, oldest first, with its span and counts. */
function runs() {
  const byRun = new Map()
  for (const e of events) {
    const id = e.run ?? '(no run id)'
    if (!byRun.has(id)) byRun.set(id, { id, first: e.at, last: e.at, counts: {} })
    const r = byRun.get(id)
    r.last = e.at
    r.counts[e.event] = (r.counts[e.event] ?? 0) + 1
  }
  return [...byRun.values()]
}
const allRuns = runs()

if (has('--list')) {
  console.log(`${path}`)
  console.log(`${allRuns.length} run(s), oldest first:\n`)
  for (const r of allRuns) {
    const c = r.counts
    console.log(`  ${r.id}`)
    console.log(`    ${short(r.first)} → ${short(r.last)}   calls ${c.call ?? 0} · skips ${c.skip ?? 0} · errors ${c.error ?? 0}${c.mount ? ' · mounted' : ''}`)
  }
  process.exit(0)
}

// The NEWEST run by default. A trace written before run ids existed has lines without one, and
// taking the first line's run picked the oldest run in the file.
const wantRun = flag('--run', undefined)
let run = null
for (let i = allRuns.length - 1; i >= 0; i -= 1) {
  if (wantRun === undefined || allRuns[i].id.startsWith(wantRun)) { run = allRuns[i].id; break }
}
if (wantRun !== undefined && run === null) {
  console.error(`no run matches "${wantRun}". Try --list.`)
  process.exit(1)
}

const wantAgent = flag('--agent', undefined)
const wantHook = flag('--hook', undefined)
const callsOnly = has('--calls')
const full = has('--full')

let rows = events.filter((e) => e.run === run)
const total = rows.length
if (wantAgent !== undefined) rows = rows.filter((e) => String(e.agentId ?? '').startsWith(wantAgent))
if (wantHook !== undefined) rows = rows.filter((e) => e.hook === wantHook)
if (callsOnly) rows = rows.filter((e) => e.event !== 'skip')

// COLLAPSE CONSECUTIVE IDENTICAL SKIPS. One subagent produced 488 in a row; printed one per line
// they hide every call in the run.
const collapsed = []
for (const e of rows) {
  const previous = collapsed[collapsed.length - 1]
  const sameSkip = e.event === 'skip' && previous !== undefined && previous.event === 'skip'
    && previous.hook === e.hook && previous.agentId === e.agentId && previous.reason === e.reason
  if (sameSkip) previous.times += 1
  else collapsed.push({ ...e, times: 1 })
}

const tail = Number(flag('--tail', 0))
const shown = tail > 0 ? collapsed.slice(-tail) : collapsed


/** The verdict inside one answer, per question type. */
function verdict(entry) {
  if (entry === undefined) return 'no answer'
  if (entry.type === 'choice') return `${entry.label} p=${entry.answerConfidence ?? entry.confidence}`
  if (entry.type === 'noul') return `p=${entry.probability}`
  if (entry.type === 'score') return `level=${entry.level} conf=${entry.confidence}`
  if (entry.type === 'unreadable') return `UNREADABLE ${oneLine(entry.reason, 48)}`
  return JSON.stringify(entry)
}
function answersOf(e) {
  const given = e.answer?.answers
  if (given === undefined || given === null) return e.answer?.kind === 'error' ? `ERROR ${oneLine(e.answer.reason, 48)}` : '(none)'
  return Object.entries(given).map(([id, a]) => (id === 'probe' ? verdict(a) : `${id}: ${verdict(a)}`)).join(' · ')
}

// ---- the header: what this run was, before any of its detail -------------------------------
const counts = {}
const byAgent = {}
const byHook = {}
const latencies = []
const models = new Map()
for (const e of rows) {
  counts[e.event] = (counts[e.event] ?? 0) + 1
  if (e.event === 'call') {
    if (e.agentId !== undefined) byAgent[e.agentId] = (byAgent[e.agentId] ?? 0) + 1
    byHook[e.hook] = (byHook[e.hook] ?? 0) + 1
    if (typeof e.ms === 'number') latencies.push(e.ms)
    const requested = e.envelope?.requested
    const executed = e.envelope?.executed
    // A call with no envelope is a line the transport never reached; it is not a model route, so it
    // is counted apart rather than shown as "?/?". And the executed id usually already carries its
    // provider -- "typesafe/jev-1.13-20260917" -- so prefixing again doubled it.
    if (requested !== undefined && executed !== undefined) {
      const key = `${who(requested)} → ${who(executed)}`
      models.set(key, (models.get(key) ?? 0) + 1)
    } else {
      models.set('(no envelope)', (models.get('(no envelope)') ?? 0) + 1)
    }
  }
}
const mount = events.find((e) => e.run === run && e.event === 'mount')
const sorted = [...latencies].sort((a, b) => a - b)
const median = sorted.length === 0 ? undefined : sorted[Math.floor(sorted.length / 2)]

console.log()
console.log(`${bold('run')} ${run}   ${dim(`${total} events · ${short(rows[0]?.at ?? '')} → ${short(rows[rows.length - 1]?.at ?? '')}`)}`)
if (mount !== undefined) {
  console.log(`  ${dim('mounted')}   hooks ${mount.hooks?.join(',')} · transport ${mount.transport} · ${mount.provider}/${mount.model} · questions ${(mount.questionIds ?? []).join(',')}`)
}
console.log(`  ${dim('events')}    ${green(`${counts.call ?? 0} calls`)} · ${dim(`${counts.skip ?? 0} skips`)} · ${(counts.error ?? 0) > 0 ? red(`${counts.error} errors`) : '0 errors'}`)
if (latencies.length > 0) {
  console.log(`  ${dim('latency')}   min ${sorted[0]}ms · median ${median}ms · max ${sorted[sorted.length - 1]}ms`)
}
if (byHook !== undefined && Object.keys(byHook).length > 0) {
  console.log(`  ${dim('hooks')}     ${Object.entries(byHook).sort((a, b) => b[1] - a[1]).map(([h, n]) => `${h} ${n}`).join(' · ')}`)
}
if (Object.keys(byAgent).length > 0) {
  console.log(`  ${dim('agents')}    ${Object.entries(byAgent).sort((a, b) => b[1] - a[1]).map(([a, n]) => `${agent(a)} ${n}`).join(' · ')}`)
}
for (const [key, n] of models) console.log(`  ${dim('model')}     ${key} ${dim(`×${n}`)}`)
if (malformed.length > 0) console.log(`  ${yellow(`${malformed.length} unparsable line(s): ${malformed.slice(0, 5).join(', ')}`)}`)
if (shown.length < collapsed.length) console.log(`  ${dim(`showing the last ${shown.length} of ${collapsed.length} rendered events`)}`)
console.log()

// ---- the body -------------------------------------------------------------------------------
const KIND = { call: 'CALL ', skip: 'SKIP ', error: 'ERROR', mount: 'MOUNT', transport: 'TRNS ' }
for (const e of shown) {
  const kind = KIND[e.event] ?? String(e.event).toUpperCase().slice(0, 5).padEnd(5)
  const colour = e.event === 'call' ? cyan : e.event === 'error' ? red : e.event === 'skip' ? dim : green
  const head = `${dim(shortTime(e.at))}  ${colour(kind)} ${pad(e.hook ?? '', 13)} ${pad(agent(e.agentId), 15)}`

  if (e.event === 'mount') {
    console.log(`${head} ${mount?.hooks?.join(',')} · ${mount?.transport} · ${mount?.tracePath}`)
    continue
  }
  if (e.event === 'transport') {
    console.log(`${head} → ${e.transport} ${e.provider ?? ''}/${e.model ?? ''}`)
    continue
  }
  if (e.event === 'skip') {
    console.log(`${head} ${pad(`${e.ms ?? ''}`, 6)} ${dim(oneLine(e.reason, 60))}${e.times > 1 ? dim(`  ×${e.times}`) : ''}`)
    continue
  }
  if (e.event === 'error') {
    console.log(`${head} ${pad(`${e.ms ?? ''}`, 6)} ${red(oneLine(e.error, 90))}`)
    continue
  }

  // A CALL, one line: how long, what was asked about, and what came back.
  console.log(`${head} ${pad(`${e.ms ?? '?'}ms`, 7)} ${oneLine(e.excerpt, 78)}`)
  console.log(`${' '.repeat(45)}${dim('→')} ${bold(answersOf(e))}${e.truncated === true ? dim('  (excerpt truncated)') : ''}`)

  if (full) {
    const indent = `${' '.repeat(45)}${dim('|')} `
    // `state.text` is the excerpt; printing both says the same thing twice.
    if (e.state?.text !== e.excerpt) console.log(`${indent}${dim('state')}     ${oneLine(e.state?.text, 200)}`)
    for (const [id, q] of Object.entries(e.questions ?? {})) {
      const n = q.type === 'choice' ? `${Object.keys(q.criteria ?? {}).length} options` : q.type === 'score' ? `${(q.criteria ?? []).length} levels` : 'probability'
      console.log(`${indent}${dim('question')}  ${id} [${q.type}, ${n}] ${oneLine(q.instructions, 120)}`)
      if (q.type === 'choice') console.log(`${indent}           ${Object.keys(q.criteria ?? {}).join(' · ')}`)
    }
    const envelope = e.answer?.envelope ?? e.envelope
    if (envelope !== undefined) {
      const usage = envelope.usage ?? {}
      const ms = envelope.durationMs === undefined ? '' : ` · ${Math.round(envelope.durationMs)}ms in the envelope`
      console.log(`${indent}${dim('envelope')}  requested ${who(envelope.requested)} · executed ${who(envelope.executed)} · tokens ${usage.inputTokens ?? '?'}/${usage.outputTokens ?? '?'}${ms}`)
    }
    if (e.answer?.worstCase !== undefined) console.log(`${indent}${dim('worst')}     ${e.answer.worstCase}`)
  }
}

if (shown.length === 0) console.log(dim('  (nothing matched those filters)'))
console.log()
