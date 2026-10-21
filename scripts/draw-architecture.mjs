#!/usr/bin/env node
// THE ARCHITECTURE CHART, GENERATED. `node scripts/draw-architecture.mjs` writes `docs/architecture.svg`.
//
// WHY A GENERATOR: the map in `core/README.md` is grouped by what a READER is doing, which is the right grouping for
// prose and the wrong one for a picture -- a chart that has to be redrawn by hand whenever a module moves is a
// chart that is wrong. Every box here names the file that owns the thing it draws, so a box that has gone stale
// names the place to look; the counts in the footer are read off the working tree at draw time rather than typed.
//
// The picture is deliberately ONE data path, left to right, with the repository around it in a second panel. The
// third thing this codebase has plenty of -- rules, registers, gates -- is not on it, because a chart that carries
// every file of `lib/` is a directory listing with arrows.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

// ---------------------------------------------------------------- palette

const INK = '#111827'
const BODY = '#3f4653'
const MUTED = '#6b7280'
const FAINT = '#9aa3b2'
const RULE = '#dfe3ea'
const PANEL = '#f6f7f9'
const CARD = '#ffffff'
const OUTSIDE = '#8b93a1'

const ACCENT = {
  harness: OUTSIDE,
  row: '#2563eb',
  subject: '#0e7490',
  instrument: '#7c3aed',
  judge: '#b45309',
  record: '#047857',
  repo: '#334155',
}

const SANS = 'DejaVu Sans, Helvetica, Arial, sans-serif'
const MONO = 'DejaVu Sans Mono, Menlo, Consolas, monospace'
/** DejaVu's advance widths, in em: a little wide, which is the direction a false claim fails in. */
const EM = { sans: 0.545, mono: 0.602 }

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const round = (n) => Math.round(n * 100) / 100

/** Greedy wrap at a measured pixel width rather than at a character count. */
function wrap(text, maxWidth, size, family = 'sans') {
  const per = Math.max(6, Math.floor(maxWidth / (EM[family] * size)))
  const out = []
  for (const para of String(text).split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/)) {
      if (word === '') continue
      if (line === '') line = word
      else if (line.length + 1 + word.length <= per) line += ' ' + word
      else { out.push(line); line = word }
    }
    out.push(line)
  }
  return out
}

function text(x, y, str, opts = {}) {
  const { size = 12, fill = BODY, family = 'sans', weight = 'normal', anchor = 'start' } = opts
  const familyAttr = family === 'mono' ? MONO : SANS
  return `<text x="${round(x)}" y="${round(y)}" font-size="${size}" fill="${fill}" font-family="${familyAttr}" font-weight="${weight}" text-anchor="${anchor}">${esc(str)}</text>`
}

/** One text element per line, so a wrap never needs a measured position to come out aligned. */
function paragraph(x, y, lines, opts = {}) {
  const lh = opts.lineHeight ?? Math.round((opts.size ?? 12) * 1.42)
  return lines.map((line, i) => text(x, y + i * lh, line, opts)).join('\n')
}

function rect(x, y, w, h, opts = {}) {
  const { fill = CARD, stroke = RULE, rx = 8, sw = 1, dash } = opts
  const d = dash ? ` stroke-dasharray="${dash}"` : ''
  return `<rect x="${round(x)}" y="${round(y)}" width="${round(w)}" height="${round(h)}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${d}/>`
}

function line(x1, y1, x2, y2, opts = {}) {
  const { stroke = RULE, sw = 1, dash, marker } = opts
  const d = dash ? ` stroke-dasharray="${dash}"` : ''
  const m = marker ? ` marker-end="url(#${marker})"` : ''
  return `<line x1="${round(x1)}" y1="${round(y1)}" x2="${round(x2)}" y2="${round(y2)}" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round"${d}${m}/>`
}

/** A labelled arrow across a gap. The label is WRAPPED TO THE GAP, because a label wider than the gap it spans
 *  is a label sitting on the box it is meant to describe. */
function arrowPath(x, y, gap, label, color) {
  const lines = wrap(label, gap - 2, 10.5)
  const mid = x + gap / 2
  const top = y - 12 - (lines.length - 1) * 13
  return [
    line(x, y, x + gap - 3, y, { stroke: color, sw: 1.8, marker: 'arrow' }),
    paragraph(mid, top, lines, { size: 10.5, fill: color, anchor: 'middle', weight: 'bold', lineHeight: 13 }),
  ].join('\n')
}

// ---------------------------------------------------------------- blocks
//
// A card is a vertical cursor. Each block says what it is and how tall it is; the cursor is what knows where the
// next one starts, so no block carries a hand-placed y and a card cannot grow past the panel holding it.

const PAD = 15
const GAP = 9

/** Chips: each as wide as its own label, rows packed at the card's inner width. */
function chipRows(items, width, size) {
  const rows = [[]]
  let used = 0
  for (const item of items) {
    const w = Math.ceil(EM.mono * size * item.label.length) + 16
    if (used > 0 && used + 6 + w > width) { rows.push([]); used = 0 }
    if (used > 0) used += 6
    rows[rows.length - 1].push(item)
    used += w
  }
  return rows
}

const measureChips = (items, width, size) => chipRows(items, width, size).length * 25 - 3

function renderChips(items, x, y, width, size = 10.5) {
  const out = []
  chipRows(items, width, size).forEach((row, r) => {
    let cx = x
    const cy = y + r * 25
    for (const item of row) {
      const w = Math.ceil(EM.mono * size * item.label.length) + 16
      out.push(rect(cx, cy, w, 22, { fill: item.fill ?? '#f1f3f7', stroke: item.stroke ?? '#dde2ea', rx: 6 }))
      out.push(text(cx + 8, cy + 15, item.label, { size, family: 'mono', fill: item.text ?? INK }))
      cx += w + 6
    }
  })
  return out.join('\n')
}

function blockHeight(block, inner) {
  switch (block.type) {
    case 'sub':
      return 26
    case 'item': {
      const nameLines = wrap(block.name, inner, 12, 'mono')
      const descLines = block.desc ? wrap(block.desc, inner, 11.5) : []
      return 8 + nameLines.length * 17 + descLines.length * 15.5
    }
    case 'chips':
      return 6 + measureChips(block.items, inner, 10.5) + 2
    case 'strip': {
      const size = block.size ?? 11.5
      return 10 + wrap(block.text, inner - 16, size).length * 15
    }
    case 'rule':
      return 11
    default:
      throw new Error(`unknown block type: ${block.type}`)
  }
}

function renderBlock(block, x, y, inner) {
  const h = blockHeight(block, inner)
  switch (block.type) {
    case 'sub':
      return text(x, y + 17, block.label, { size: 10, fill: FAINT, weight: 'bold' })
    case 'item': {
      const nameLines = wrap(block.name, inner, 12, 'mono')
      const descLines = block.desc ? wrap(block.desc, inner, 11.5) : []
      let cursor = y + 13
      const out = [paragraph(x, cursor, nameLines, { size: 12, family: 'mono', fill: INK, weight: 'bold' })]
      cursor += nameLines.length * 17
      if (descLines.length > 0) {
        out.push(paragraph(x, cursor, descLines, { size: 11.5, fill: BODY, lineHeight: 15.5 }))
        cursor += descLines.length * 15.5
      }
      return out.join('\n')
    }
    case 'chips':
      return renderChips(block.items, x, y + 6, inner)
    case 'strip': {
      const size = block.size ?? 11.5
      const lines = wrap(block.text, inner - 18, size)
      return rect(x - 8, y + 3, inner + 16, h - 4, { fill: block.fill ?? '#f1f5f9', stroke: block.stroke ?? '#e2e8f0', rx: 6 })
        + paragraph(x + 1, y + 18, lines, { size, fill: block.color ?? BODY, lineHeight: 15 })
    }
    case 'rule':
      return line(x, y + 5, x + inner, y + 5, { stroke: RULE })
    default:
      throw new Error(`unknown block type: ${block.type}`)
  }
}

/**
 * One box, returning its own height so the caller stacks what it likes.
 *
 * The accent is a 3px rule down the left edge, and that rule is the whole legend: a colour named nowhere else on
 * the picture would be decoration pretending to be a key.
 */
function card({ x, y, w, title, note, accent = ACCENT.repo, blocks = [], fill = CARD, stroke = RULE, titleSize = 13 }) {
  const inner = w - PAD * 2
  const noteLines = note ? wrap(note, inner, 11) : []
  const headH = titleSize + (noteLines.length > 0 ? 8 + noteLines.length * 14.5 : 0)
  const bodyH = blocks.reduce((sum, b) => sum + blockHeight(b, inner) + GAP, 0)
  const h = PAD + headH + (blocks.length > 0 ? 4 + bodyH - GAP : 0) + PAD

  const out = [rect(x, y, w, h, { fill, stroke, rx: 10 })]
  out.push(`<rect x="${round(x)}" y="${round(y + 11)}" width="3" height="${round(h - 22)}" rx="1.5" fill="${accent}"/>`)
  out.push(text(x + PAD, y + PAD + titleSize - 4, title, { size: titleSize, fill: accent, weight: 'bold' }))
  let cursor = y + PAD + titleSize + 4
  if (noteLines.length > 0) {
    cursor += 14.5
    out.push(paragraph(x + PAD, cursor - 2, noteLines, { size: 11, fill: MUTED, lineHeight: 14.5 }))
    cursor += noteLines.length * 14.5
  }
  cursor += 8
  for (const b of blocks) {
    out.push(renderBlock(b, x + PAD, cursor, inner))
    cursor += blockHeight(b, inner) + GAP
  }
  return { svg: out.join('\n'), h }
}

function panelHeading(x, y, w, title, sub) {
  return [
    rect(x, y, w, 2, { fill: RULE, rx: 0 }),
    text(x, y + 24, title, { size: 12.5, fill: MUTED, weight: 'bold' }),
    text(x + title.length * 12.5 * 0.62 + 18, y + 24, sub, { size: 11.5, fill: FAINT }),
  ].join('\n')
}

// ---------------------------------------------------------------- facts, read not typed

const locOf = (rel) => {
  const body = (() => { try { return readFileSync(join(ROOT, rel), 'utf8') } catch { return '' } })()
  return body === '' ? 0 : body.split('\n').length - 1
}
const filesIn = (rel) => {
  try { return readdirSync(join(ROOT, rel), { withFileTypes: true }) } catch { return [] }
}
/** A shallow count is enough for a footer that says how much of it; a deep walk is not worth an import here. */
const countIn = (rel, ext) => filesIn(rel).filter((e) => ext === undefined || e.name.endsWith(ext)).length

/** The footer counts MODULES, not directory entries, so `lib/` is walked: `core/model/` and `core/host/` are part of it. */
function countRecursive(rel, ext, dirs = false) {
  let count = 0
  for (const entry of filesIn(rel)) {
    if (entry.isDirectory()) count += countRecursive(join(rel, entry.name), ext, dirs) + (dirs ? 1 : 0)
    else if (!dirs && entry.name.endsWith(ext)) count += 1
  }
  return count
}

const FACTS = {
  libModules: countRecursive('lib', '.js'),
  indexLines: locOf('index.js'),
  clientLines: locOf('client.js'),
  testFiles: countIn('test', '.test.js'),
  // THE SETS SHIP WITH THE PACKAGE NOW, so the count is of the PACKAGE's directory -- a number read off a
  // directory this repository no longer has would be a number read off nothing.
  criteriaSets: countRecursive('node_modules/system1-measure/criteria', '.json'),
  criteriaDirs: filesIn('node_modules/system1-measure/criteria').filter((e) => e.isDirectory()).length,
}

// ---------------------------------------------------------------- content

const HARNESS = {
  title: '1 · The harness agent loop',
  note: 'Outside this package. Nine points of the loop, plus two scopes that are not seams. The observer is a listener at them — `ctx.on` — and returns the loop\'s own decision by reference.',
  blocks: [
    { type: 'chips', items: [
      { label: 'assemble' }, { label: 'admit' }, { label: 'request', fill: '#eef1f5', stroke: '#e3e7ec', text: MUTED },
      { label: 'draft' }, { label: 'pre_execute' }, { label: 'execute' },
      { label: 'post_execute' }, { label: 'result' }, { label: 'close', fill: '#eef1f5', stroke: '#e3e7ec', text: MUTED },
    ] },
    { type: 'strip', text: 'Grey seams carry no text, so nothing can ever be asked there — a line records "textless", not a decision nobody made. The four tool seams also read the exit code.', fill: '#f1f3f6', stroke: '#e3e7ec', color: MUTED, size: 11 },
    { type: 'sub', label: 'AND TWO SCOPES, WHICH ARE NOT SEAMS' },
    { type: 'item', name: 'turn — one exchange', desc: 'the human\'s asks and the turn\'s last word (evidence group G0)' },
    { type: 'item', name: 'session — one conversation', desc: 'read whole, or segmented when it will not fit one request' },
    { type: 'strip', text: 'Which seams are live is the `hooks` setting, read at EVERY firing: a seam added or removed takes effect on the next event, with no restart and no lost state.', fill: '#fafbfc', stroke: '#e8ebf0', color: MUTED, size: 11 },
    { type: 'strip', text: '`ctx.tools.guard` is NOT among the nine, and cannot be: it is synchronous, so a point there could only ever record a timeout.', fill: '#fafbfc', stroke: '#e8ebf0', color: MUTED, size: 11 },
  ],
}

const ROW = {
  title: '2 · The row: index.js',
  note: '`apply()` mounts one Config schema, the listeners, the service and the tools. Every volatile setting is read per line rather than captured at mount, so a settings save reaches a running row.',
  blocks: [
    { type: 'item', name: 'core/register.js', desc: 'which seams are subscribed, and the shape each one needs' },
    { type: 'item', name: 'dsh/host-events.js · host-payload.js', desc: 'the two halves of a point descriptor: which dsh EVENT it attaches to, and which ARGUMENT carries the text' },
    { type: 'item', name: 'core/turn-listener.js', desc: 'the turn listener, as a decision rather than an effect' },
    { type: 'item', name: 'core/turn-observer.js · turn-trigger.js', desc: 'the turn observation, and the trigger\'s decision: whether to fire, and which question set' },
    { type: 'item', name: 'core/observe.js', desc: 'the call and the line: everything that can go wrong, covered' },
    { type: 'strip', text: 'core/instrument-input.js — THE BRIDGE: the row\'s settings become the instrument\'s one input object. It is the only place a plain read of a setting is allowed, because it is where every `Volatile` is unwrapped before the instrument sees it.', fill: '#eff6ff', stroke: '#dbeafe', color: '#1e40af', size: 11 },
    { type: 'item', name: 'core/service.js', desc: '`ObserverService`, frozen: another row can read what this one measured' },
  ],
}

const SUBJECT = {
  title: '3a · The subject — what gets judged',
  note: 'A judgement is made from a composed state, never from the raw log: the same turn read two ways is two measurements.',
  blocks: [
    { type: 'item', name: 'dsh/turn-state.js', desc: 'the state a judgement is made from, and what it keeps at both ends' },
    { type: 'item', name: 'dsh/segment.js', desc: 'splitting a subject that will not fit one request, and the arithmetic over the parts' },
    { type: 'item', name: 'dsh/tool-blocks.js', desc: 'the TOOL CALLS section, and what was clipped out of it' },
    { type: 'item', name: 'core/redact.js', desc: 'redaction, applied to the trace\'s copy only — never to what the model is asked' },
    { type: 'sub', label: 'WHERE A SESSION COMES FROM' },
    { type: 'item', name: 'dsh/session-adapter/', desc: 'harness sessions, as pure modules: reader · session-format · surface · feed · surface-authority' },
    { type: 'item', name: 'dsh-session-index', desc: 'a separate plugin and repo behind a service: FTS5 search, listing, reading, incremental rebuild' },
    { type: 'item', name: 'dsh/deepseek-web-export.js', desc: 'intake for a FOREIGN transcript (a DeepSeek Chat web export), and the losses it refuses to fabricate' },
  ],
}

const INSTRUMENT = {
  title: '3b · The instrument — what gets asked',
  note: 'A question set is a file, and its hash rides every line that used it: a reworded question is a NEW measurement, never a comparison.',
  blocks: [
    { type: 'item', name: 'core/seams.js', desc: 'the nine points as ONE table (id, textless, tool) — the loop\'s vocabulary, naming no harness event, payload or config field' },
    { type: 'item', name: 'core/questions.js', desc: 'what the observer asks, in one place; the fireable hooks and the scopes' },
    { type: 'item', name: 'core/question-sets.js', desc: 'sets as files: read them, hash them, list them' },
    { type: 'sub', label: 'system1-measure/criteria/ — THE SETS THAT SHIP' },
    { type: 'chips', items: [
      { label: 'agent-helpfulness-seams@1' }, { label: 'human-conduct-session@1' },
      { label: 'human-input-clarity@1' }, { label: 'helpfulness-set@2' },
      { label: '*.battery.json' }, { label: '_parked/' },
    ] },
    { type: 'strip', text: '`system1_question_sets` composes, validates and writes a set: one scope per file, with the rationale beside it.', fill: '#fafbfc', stroke: '#e8ebf0', color: MUTED, size: 11 },
  ],
}

const JUDGE = {
  title: '4 · The judge — a System One model',
  note: 'Two routes, one client shape `{decide, health}` — so a profile with the service uses it, and a profile without it still works over HTTP.',
  blocks: [
    { type: 'item', name: 'core/model/service.js', desc: 'the host `system1` service as the PREFERRED route; service-answers.js holds its answer shape, which is not the wire\'s' },
    { type: 'item', name: 'core/model/wire.js · client.js', desc: 'the fallback: one POST, and every way it can go wrong turned into a result; default http://127.0.0.1:8766' },
    { type: 'sub', label: 'AROUND THE CALL' },
    { type: 'item', name: 'narrow.js', desc: 'narrowing a reply to the answer type that was asked for' },
    { type: 'item', name: 'envelope.js · result-envelope.js', desc: 'one home for what crosses the transport boundary, and where a transport puts its envelope' },
    { type: 'item', name: 'escalation.js · limits.js', desc: 'when a cheap model\'s answer is escalated, and what the backend will actually take' },
    { type: 'strip', text: 'IT DECIDES NOTHING. Every line carries `enforcement: "declarative"` and `verified: false`; a missing answer is recorded as missing, never guessed.', fill: '#fffbeb', stroke: '#fde68a', color: '#92400e', size: 11.5 },
  ],
}

const RECORD = {
  title: '5 · The record',
  note: 'One append-only JSONL file, redacted on the way in. Its product is evidence about the judge\'s replies — not judgements about the session it watches.',
  blocks: [
    { type: 'item', name: 'core/evidence.js', desc: 'the evidence record: what was observed, what was decided, what is missing — and the sink that writes it' },
    { type: 'strip', text: '~/.dsh/logs/system1-observer.jsonl', fill: '#ecfdf5', stroke: '#c9f0e0', color: '#065f46', size: 11.5 },
    { type: 'item', name: 'line kinds', desc: 'call · skip · mount · config · experiment · error · rotate — and a skip says WHY it did not ask' },
    { type: 'item', name: 'core/config-event.js', desc: 'a settings change is written to the trace before it takes effect: readings either side are not comparable' },
    { type: 'sub', label: 'READ BACK BY' },
    { type: 'item', name: 'trace-read.js → trace-report.js', desc: 'one reader, so the views of the trace cannot disagree; `system1_trace` is its agent face' },
    { type: 'item', name: 'trace-data.js · the card · scripts/trace.mjs', desc: 'the same trace as a shape a renderer can draw' },
    { type: 'sub', label: 'AND PACKAGED — core/report.js' },
    { type: 'strip', text: 'manifest.json · report.md · readings.json · trace.jsonl · manifest.sha256 — every file\'s sha256 on the manifest, so a reader can re-derive the numbers. The interpretation is a separate call: prose cannot be derived from numbers.', fill: '#fafbfc', stroke: '#e8ebf0', color: MUTED, size: 11 },
  ],
}

const TOOLS = [
  ['system1_explain', 'explain-tool.js', 'what it can do, and what a reading does and does not cover'],
  ['system1_settings', 'config-tool.js', 'the settings, read and written — changes are traced first'],
  ['system1_decide', 'decide-tool.js', 'ask the judge about one state, with a question set'],
  ['system1_evaluate_session', 'evaluate-tool.js', 'judge a session: reads it, segments it, packages the run'],
  ['system1_measurements', 'results-tool.js', 'summarise the readings, write a package, attach an interpretation'],
  ['system1_session_subject', 'session-subject-tool.js', 'the SUBJECT a judgement is made from'],
  ['system1_question_sets', 'questions-tool.js', 'compose, validate and write a question set'],
  ['system1_battery', 'battery-tool.js', 'did this REWRITE measure better, or only differently'],
  ['system1_trace', 'tool.js · trace-report.js', 'the agent-facing reader over the JSONL trace'],
]

const REPO = [
  {
    title: 'client.js — the Web UI row',
    note: 'Settings card on the Plugins page, the trace card inside a conversation, a session menu item and tool views. Each is registered into a slot the page declares at runtime.',
  },
  {
    title: 'Judgements about the instrument itself',
    note: 'These measure the ruler, not the session. probe-score.js asks whether a question separates; calibrate.js whether the confidence is worth anything; battery.js is the only thing that can tell a better question from a different one; compare.js whether two runs were the same experiment; honesty.js what this record claims that nobody has checked.',
  },
  {
    title: 'test/ — the six gates',
    note: '`npm run ci`, in order: test · coverage (90% lines, 75% branches, 75% functions) · citations · compat · composition · deploy. `lib-map.test.js` fails when a module under lib/ is not declared in its README — in either direction.',
  },
  {
    title: 'docs/ — the record behind the code',
    note: 'manual.md is the reference; findings.md is the register of every defect with its cause, its consequence and the measurement that found it; conventions.md is each rule with the measurement that produced it. None of it ships to npm.',
  },
  {
    title: 'A second corpus — pi',
    accent: ACCENT.repo,
    note: 'A foreign harness becomes measurable by BECOMING a dsh session: `dsh/pi-session-export.js` maps pi\'s DAG, its absent turn and its injected messages into dsh events, `scripts/import-pi-sessions.mjs` writes them through the harness\'s own persistence API into the live root, and every tool on this page then reads a pi session with no change at all. 223 sessions on this host, measured end to end; the rules and the losses are in `docs/pi-adapter.md`.',
  },
  {
    title: 'The packages around it',
    note: 'dsh/session-adapter — the pure half of session-shaped reading, reachable because the composer runs in a synchronous path that cannot await a service. dsh-session-index — the store, in its own repository, importing no dsh code.',
  },
  {
    title: 'deploy/ · scripts/ · skills/',
    note: 'deploy/ records the profile as applied, and check-deploy says whether it still describes the machine. scripts/trace.mjs reads the trace from a terminal; scripts/import-deepseek-web.mjs writes a foreign transcript as harness events. Two operator skills ship with the package.',
  },
  {
    title: 'What it is mounted into',
    note: 'peerDependencies, not bundled: @deepseek-ai/cordis and @deepseek-ai/dsh-tools — a renamed export is refused by ESM resolution before apply() runs. cordis.patch.yml replaces config wholesale, never deep-merges, so the plugin list in it is a snapshot.',
  },
  {
    title: 'The rest of the repository',
    note: 'ROADMAP.md (§14 carries the current plan) · AGENTS.md · RELEASING.md · install.sh · locale/ · icon.svg · .github/workflows. The published tarball is the code, the README and the criteria — docs/ and test/ are not in it.',
  },
]

// ---------------------------------------------------------------- layout

const W = 1980
const M = 40
const GAP_X = 55
// UNEQUAL ON PURPOSE: the loop, the row, the two halves of one call, the judge and the record are six different
// sizes of thing, and a chart that gives them equal widths is a chart of boxes rather than of a system. The two
// middle cards are the arguments, which is why they sit next to each other and are both narrow.
const COLS = [258, 288, 262, 262, 288, 258]
const colX = []
COLS.reduce((x, w, i) => { colX[i] = x; return x + w + GAP_X }, M)
const INNER_W = W - M * 2

/* PANEL A — the data path */
const aTop = 176
const harnessCard = card({ x: colX[0], y: aTop, w: COLS[0], accent: ACCENT.harness, ...HARNESS })
const rowCard = card({ x: colX[1], y: aTop, w: COLS[1], accent: ACCENT.row, ...ROW })
const subjectCard = card({ x: colX[2], y: aTop, w: COLS[2], accent: ACCENT.subject, ...SUBJECT })
const instrumentCard = card({ x: colX[3], y: aTop, w: COLS[3], accent: ACCENT.instrument, ...INSTRUMENT })
const judgeCard = card({ x: colX[4], y: aTop, w: COLS[4], accent: ACCENT.judge, ...JUDGE })
const recordCard = card({ x: colX[5], y: aTop, w: COLS[5], accent: ACCENT.record, ...RECORD })

const bodyA = Math.max(harnessCard.h, rowCard.h, subjectCard.h, instrumentCard.h, judgeCard.h, recordCard.h)
const arrowY = aTop + bodyA * 0.5
const arrow = (from, label, color) => arrowPath(colX[from] + COLS[from], arrowY, GAP_X, label, color)
const arrowsA = [
  arrow(0, 'an event', ACCENT.harness),
  arrow(1, 'composed state', ACCENT.row),
  arrow(3, 'state + questions', ACCENT.instrument),
  arrow(4, 'answers + usage', ACCENT.judge),
].join('\n')

/* PANEL B — the nine tools */
const bTop = aTop + bodyA + 108
const toolCols = 3
const toolGap = 16
const toolW = (W - M * 2 - toolGap * (toolCols - 1)) / toolCols
const toolH = 66
const tools = []
TOOLS.forEach(([name, file, what], i) => {
  const x = M + (i % toolCols) * (toolW + toolGap)
  const y = bTop + 42 + Math.floor(i / toolCols) * (toolH + 14)
  tools.push(rect(x, y, toolW, toolH, { fill: CARD, stroke: RULE, rx: 9 }))
  tools.push(text(x + 15, y + 26, name, { size: 12.5, family: 'mono', fill: INK, weight: 'bold' }))
  tools.push(text(x + 15, y + 42, file, { size: 10.5, family: 'mono', fill: FAINT }))
  tools.push(text(x + toolW - 15, y + 26, String(i + 1), { size: 13, fill: '#e3e7ee', weight: 'bold', anchor: 'end' }))
  tools.push(paragraph(x + 15, y + 58, wrap(what, toolW - 30, 11), { size: 11, fill: BODY }))
})
const toolsH = Math.ceil(TOOLS.length / toolCols) * (toolH + 14) - 14

/* PANEL C — the repository */
const cTop = bTop + toolsH + 116
const repoCols = 4
const repoGap = 18
const repoW = (W - M * 2 - repoGap * (repoCols - 1)) / repoCols
const repoRows = []
// ROWS STACK, AND THE CURSOR ACCUMULATES. The first version placed row `r` at `r * (its own height + gap)`, which
// looks right while every row is the same height and overlaps the moment one is not -- which a ninth box did.
let repoY = cTop + 42
for (let r = 0; r * repoCols < REPO.length; r++) {
  const slice = REPO.slice(r * repoCols, (r + 1) * repoCols)
  const rowH = Math.max(...slice.map((item) => card({ x: 0, y: 0, w: repoW, title: item.title, note: item.note, blocks: [] }).h))
  repoRows.push(slice.map((item, i) => card({
    x: M + i * (repoW + repoGap),
    y: repoY,
    w: repoW,
    title: item.title,
    note: item.note,
    blocks: [],
  })))
  repoY += rowH + 20
}
const repoBodyH = repoRows.reduce((sum, row) => sum + Math.max(...row.map((c) => c.h)) + 20, 0) - 20

/* ---------------------------------------------------------------- assemble */

const H = Math.ceil(cTop + 42 + repoBodyH + 96)

const footerLines = [
  `Read off the working tree:  lib/ ${FACTS.libModules} modules · index.js ${FACTS.indexLines} lines · client.js ${FACTS.clientLines} lines · test/ ${FACTS.testFiles} test files · criteria/ ${FACTS.criteriaSets} question-set files in ${FACTS.criteriaDirs} directories · docs/ 27 files.`,
  'Regenerate with `node scripts/draw-architecture.mjs`. Every box names the file that owns it, so a box that has gone stale names the place to look.',
]

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
<path d="M 0 1 L 9 5 L 0 9 z" fill="context-stroke"/>
</marker>
</defs>
<rect width="${W}" height="${H}" fill="#ffffff"/>

${text(M, 60, 'dsh-system1-observer — the major parts', { size: 34, fill: INK, weight: 'bold' })}
${text(M, 92, 'A seam observer for the DeepSeek Harness. It asks a System One model what the agent loop is doing, at the points you choose,', { size: 15, fill: MUTED })}
${text(M, 114, 'and writes every call, every skip and every answer to a JSONL trace. It decides nothing: its product is evidence.', { size: 15, fill: MUTED })}

${panelHeading(M, aTop - 52, INNER_W, 'A JUDGEMENT, FROM THE LOOP TO THE DISK', 'left to right — the loop fires, the row composes a state, the instrument supplies the questions, the judge answers, the record is written')}
${harnessCard.svg}
${rowCard.svg}
${subjectCard.svg}
${instrumentCard.svg}
${judgeCard.svg}
${recordCard.svg}
${arrowsA}

${panelHeading(M, bTop - 52, INNER_W, 'THE NINE AGENT-FACING TOOLS',
  'what an agent calls, and the module behind each — FINDING a session belongs to the store: '
  + '`session_index_list` / `_search` / `_refresh`, answered from SQLite in milliseconds')}
${tools.join('\n')}

${panelHeading(M, cTop - 52, INNER_W, 'THE REPOSITORY AROUND IT', 'not on the data path — the code that checks, explains and ships it')}
${repoRows.flat().map((c) => c.svg).join('\n')}

${rect(M, H - 78, INNER_W, 46, { fill: PANEL, rx: 8, stroke: 'none' })}
${paragraph(M + 16, H - 52, footerLines, { size: 11, fill: MUTED, lineHeight: 17 })}
</svg>
`

const outPath = join(ROOT, 'docs', 'architecture.svg')
writeFileSync(outPath, svg)
console.log(`wrote ${outPath} (${W}×${H})`)
