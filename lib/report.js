// THE MEASUREMENT REPORT PACKAGE: a measurement made portable.
//
// WHY A PACKAGE AND NOT A REPORT. A rendered report is a claim about numbers nobody can re-derive: the trace it was
// computed from lives in one file that grows forever, is rotated, and is not shipped with the prose. So a package
// carries BOTH -- the exact lines the numbers came from and the numbers themselves -- with the sha256 of every file on
// the manifest, and a reader can re-run the aggregation over `trace.jsonl` and get `readings.json` back. Anything less
// is a screenshot of a measurement.
//
// FOUR FILES, and the third and fourth are what make it a package rather than a summary:
//
//   manifest.json   what this is: the window, the counts, the refusals, and every file's size and hash
//   report.md       the same numbers as PROSE, rendered by the tool's own renderer -- one home for the accounting's
//                   words, so a package cannot say something the tool does not
//   readings.json   the aggregate, machine-readable
//   trace.jsonl     the window's lines, verbatim, WITHOUT which none of the above can be checked
//
// WHERE IT GOES, and it is not a new decision: this repository already keeps local data in `data/`, which `.gitignore`
// excludes. A package belongs there, one directory per package, and NOT in git -- `trace.jsonl` carries call lines, and
// a seam call line carries the state it judged (`lib/observe.js:165`, redacted but real conversation). The manifest says
// so in as many words, because a reader who copies the directory somewhere should know what is in it.
//
// IT NEVER OVERWRITES. A package id is derived from the run and the timestamp, so two packages of the same run are two
// packages; writing over one would silently replace a measurement with another that has the same name. `writePackage`
// refuses, and says which directory already exists.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

/** The files a package holds, in the order they are written. One list, so the manifest cannot disagree with the disk. */
export const PACKAGE_FILES = Object.freeze(['manifest.json', 'report.md', 'readings.json', 'trace.jsonl', 'manifest.sha256'])

/**
 * THE ONE FILE THAT IS NOT REPRODUCIBLE, and the package says so.
 *
 * Every other file can be re-derived: `trace.jsonl` through the readers gives `readings.json`, and `report.md` is that
 * summary's own render. An INTERPRETATION cannot be -- it is somebody's reading of the numbers, and the only honest
 * things to do with it are to ATTRIBUTE it and to ANCHOR it to the exact revision it was written against. So it lives
 * in its own file, never inside `report.md`, and the manifest names `reproducible` separately from `written`.
 *
 * WHY IT IS IN THE PACKAGE AT ALL, which was the operator's question and a fair one: because a reading kept in a chat
 * is not attached to its evidence. `docs/findings.md` is full of the failure that follows -- a number recorded in one
 * place and the sentence about it in another, so nobody can check the sentence and nobody can find the number. The
 * anchor below is what makes the pair checkable: `readingsSha256` is the hash of the readings this prose was written
 * against, so a package whose readings are ever regenerated differently leaves the interpretation visibly orphaned
 * rather than quietly wrong.
 */
export const INTERPRETATION_FILE = 'interpretation.md'

/** What a reader may check, and what they may only attribute. Named, so the manifest is not a list of equal files. */
export const REPRODUCIBLE_FILES = Object.freeze(['report.md', 'readings.json', 'trace.jsonl'])

/** The files the manifest can name, which is every file but ITSELF -- a file cannot contain its own hash. */
export const HASHED_FILES = Object.freeze(['report.md', 'readings.json', 'trace.jsonl'])

/** A hash of a string, as the manifest records it. Length-prefixed is unnecessary: these are whole files, not records. */
export function hashOf(text) {
  return createHash('sha256').update(String(text)).digest('hex')
}

/**
 * THE PACKAGE ID, from what the package is ABOUT and when it was made.
 *
 * The run is in the name because that is the unit a reading is attributable to, and the timestamp is in it because the
 * same window summarised twice is two observations of a changing file -- the trace keeps growing, and the second may
 * be over more lines than the first. A content hash of the window is NOT used: it would make the id change with line
 * order and formatting while hiding the thing a reader wants first, which is when this was taken.
 */
export function packageId({ at, run }) {
  const stamp = String(at ?? '').replace(/[:.]/g, '-')
  const which = typeof run === 'string' && run !== '' ? run : 'all-runs'
  return stamp + '_' + which.replace(/[^A-Za-z0-9._-]/g, '-')
}

/**
 * THE FOUR FILES AND THE MANIFEST, as strings. Pure: the writing is `writePackage`'s job, so every rule here is
 * testable without a disk.
 *
 * @param report   the rendered prose, produced by the tool's OWN renderer so the two cannot say different things
 * @param summary  the aggregate object, written to `readings.json` verbatim
 * @param lines    the window's parsed lines, written to `trace.jsonl` verbatim so the aggregate can be re-derived
 */
export function buildPackage({ id, at, report, summary, lines, meta = {} }) {
  const window = summary?.window ?? {}
  const bodies = {
    'report.md': String(report),
    'readings.json': JSON.stringify(summary, null, 2) + '\n',
    // VERBATIM AND UNORDERED. This is the input, not a rendering of it: one line per line as it was read, so a
    // re-derivation runs the same reader over the same bytes.
    'trace.jsonl': (Array.isArray(lines) ? lines : []).map((line) => JSON.stringify(line)).join('\n') + (lines.length === 0 ? '' : '\n'),
  }
  const manifest = {
    package: 'system1-observer measurement report',
    id,
    at: at ?? null,
    plugin: meta.plugin ?? 'dsh-system1-observer',
    version: meta.version ?? null,
    dsh: meta.dsh ?? null,
    node: meta.node ?? process.version,
    // WHAT THIS IS ABOUT, as the windows the reader was given -- so a bounded read is visible rather than implied.
    window: {
      ...(window.run === undefined ? {} : { run: window.run }),
      ...(window.hook === undefined ? {} : { hook: window.hook }),
      ...(window.question === undefined ? {} : { question: window.question }),
      ...(window.agent === undefined ? {} : { agent: window.agent }),
      ...(window.groupBy === undefined ? {} : { groupBy: window.groupBy }),
      ...(window.tail === undefined ? {} : { tail: window.tail }),
    },
    // WHAT CAN BE RE-DERIVED, AND WHAT CAN ONLY BE ATTRIBUTED. A reader who cannot tell the two apart will treat an
    // opinion and a measurement as the same kind of thing, which is the failure this whole repository catalogues.
    reproducible: [...REPRODUCIBLE_FILES],
    counts: summary?.counts ?? null,
    // THE REFUSALS RIDE THE MANIFEST, not only the prose: a reader who opens `readings.json` and skips `report.md`
    // must still meet the list of numbers that may not be read from this window.
    refusals: Array.isArray(summary?.refusals) ? summary.refusals : [],
    // AND WHAT IS IN THE TRACE SLICE. A package copied out of `data/` carries conversation text with it.
    contains: 'trace.jsonl holds the call and skip lines of this window verbatim, and a seam call line carries the state it judged -- redacted conversation text. Treat a package as local data, and check before copying it anywhere.',
    // THE FILES IT CAN NAME, which is every file but itself. A FILE CANNOT CONTAIN ITS OWN HASH: writing the hash in
    // changes the bytes, which changes the hash. My first version tried anyway and shipped the hash of an EMPTY STRING,
    // which the test caught -- so the manifest is covered by `manifest.sha256` instead, the conventional way, and that
    // file is the root of trust because nothing hashes it.
    files: HASHED_FILES.map((name) => ({ name, bytes: Buffer.byteLength(bodies[name], 'utf8'), sha256: hashOf(bodies[name]) })),
  }
  const manifestBody = JSON.stringify(manifest, null, 2) + '\n'
  bodies['manifest.json'] = manifestBody
  bodies['manifest.sha256'] = hashOf(manifestBody) + '  manifest.json\n'
  return { id, files: PACKAGE_FILES.map((name) => ({ name, body: bodies[name] })), manifest }
}

/**
 * WHERE A PACKAGE GOES, and it is NOT a relative path.
 *
 * THE BUG THIS FIXES WAS FOUND BY LETTING ANOTHER AGENT RUN THE WORKFLOW. The default was the literal string
 * `data/measurements`, so it resolved against whatever working directory the CALLER happened to have -- the repository
 * for me, and `~/.dsh/profiles` for a subagent -- and the same measurement landed in two different trees depending on
 * who asked. An agent's cwd is not the session's cwd, and neither is the profile's.
 *
 * SO IT IS ABSOLUTE, PROFILE-SCOPED, AND DECLARED IN THAT ORDER:
 *   1. `SYSTEM1_OBSERVER_DATA`, when a deployment wants to say;
 *   2. `<DSH_PROFILE_DIR>/data/measurements`, because a measurement belongs to the profile that produced it and the
 *      harness already tells every plugin which profile that is;
 *   3. `data/measurements` LAST, which is the cwd-relative guess that caused this, kept only so a bare environment
 *      still writes somewhere rather than failing.
 */
export function defaultPackageDir({ env = process.env, argv = process.argv, cwd = process.cwd() } = {}) {
  const declared = typeof env?.SYSTEM1_OBSERVER_DATA === 'string' ? env.SYSTEM1_OBSERVER_DATA.trim() : ''
  if (declared !== '') return declared
  const profile = typeof env?.DSH_PROFILE_DIR === 'string' ? env.DSH_PROFILE_DIR.trim() : ''
  if (profile !== '') return join(profile, 'data', 'measurements')
  // THE HARNESS DOES NOT SET `DSH_PROFILE_DIR` FOR THE PLUGIN PROCESS ITSELF -- only for the shells it spawns, which is
  // why this read worked in `bash` and failed in the tool. Measured on the live process that runs the tools: its env
  // is Telegram variables and `PWD=/home/john/.dsh/profiles`, with NO `DSH_HOME` and NO `DSH_PROFILE_DIR`, and its
  // command line is `node .../dsh docdrift`. So the profile is read from where it actually IS: named on the command
  // line, rooted in the directory the process was started in. A package written this way landed in
  // `~/.dsh/profiles/data/measurements` -- neither the profile's directory nor the repository's -- and the operator
  // could not find it, which is the whole failure.
  const slug = argv.slice(2).find((arg) => typeof arg === 'string' && arg !== '' && !arg.startsWith('-'))
  if (slug !== undefined && basename(cwd) === 'profiles') return join(cwd, slug, 'data', 'measurements')
  // AND THE LAST RUNG IS ABSOLUTE. A relative default is what made the same measurement land in two trees depending on
  // who asked; `~/.dsh/measurements` is findable without knowing which directory a caller happened to have.
  const home = typeof env?.DSH_HOME === 'string' && env.DSH_HOME.trim() !== '' ? env.DSH_HOME.trim() : join(homedir(), '.dsh')
  return join(home, 'measurements')
}

/**
 * WRITE IT, OR REFUSE. `mkdir` is recursive because `data/` may not exist yet, and a package already at this path is
 * NOT overwritten: two measurements with one name is how a reading gets replaced by a different one.
 *
 * @returns `{ dir, files: [names], problem }` -- a problem string rather than a throw, because the caller is a tool.
 */
export function writePackage(dir, pkg) {
  try {
    if (existsSync(dir)) return { dir, files: [], problem: dir + ' already exists, so this package was NOT written: a package is never overwritten, and a second measurement of the same window is a second package' }
    mkdirSync(dir, { recursive: true })
    for (const file of pkg.files) writeFileSync(join(dir, file.name), file.body)
    return { dir, files: pkg.files.map((file) => file.name), problem: null }
  } catch (error) {
    return { dir, files: [], problem: 'writing ' + dir + ' failed: ' + (error instanceof Error ? error.message : String(error)) }
  }
}

/**
 * ATTACH AN INTERPRETATION TO AN EXISTING PACKAGE, and refuse the ways that could go wrong.
 *
 * The package is AMENDED, not rewritten: `interpretation.md` is added, the manifest gains one entry and one anchor,
 * and `manifest.sha256` is recomputed -- because a manifest that changed is a manifest whose hash changed, and a
 * reader must be able to check the amended package exactly as they checked the original.
 *
 * @param dir  the package directory, which must already be one
 * @returns `{ problem, anchor, file }` -- a problem string, never a throw.
 */
export function attachInterpretation(dir, { text, by = 'unknown', at = null } = {}) {
  if (typeof text !== 'string' || text.trim() === '') return { problem: 'an interpretation with no text is not an interpretation', anchor: null, file: null }
  const manifestPath = join(dir, 'manifest.json')
  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    return { problem: dir + ' is not a package: ' + (error instanceof Error ? error.message : String(error)), anchor: null, file: null }
  }
  if (!Array.isArray(manifest.files) || !manifest.files.some((file) => file.name === 'readings.json')) {
    return { problem: dir + ' has no readings.json entry, so it is not a package this can anchor to', anchor: null, file: null }
  }
  // ONE INTERPRETATION PER PACKAGE. Two prose readings of one measurement is not more evidence, it is ambiguity about
  // which one is current -- and a package is never overwritten anywhere else, so it is not overwritten here either.
  if (manifest.interpretation !== undefined) {
    return { problem: dir + ' already carries an interpretation by ' + String(manifest.interpretation.by) + '; a package holds ONE reading of its numbers, so write a second package rather than a second opinion', anchor: null, file: null }
  }
  // THE ANCHOR: the readings as they are ON DISK, so the prose is tied to a revision and not to a moment.
  let readings
  try {
    readings = readFileSync(join(dir, 'readings.json'), 'utf8')
  } catch (error) {
    return { problem: 'cannot read ' + join(dir, 'readings.json') + ': ' + (error instanceof Error ? error.message : String(error)), anchor: null, file: null }
  }
  const anchor = hashOf(readings)
  const stamp = at ?? new Date().toISOString()
  const body = [
    '<!-- AN INTERPRETATION, NOT A MEASUREMENT. Nothing here is re-derivable from trace.jsonl. -->',
    '# Interpretation',
    '',
    '| | |',
    '|---|---|',
    '| package | `' + String(manifest.id ?? dir) + '` |',
    '| written by | ' + String(by) + ' |',
    '| written at | ' + stamp + ' |',
    '| anchored to `readings.json` | `sha256:' + anchor + '` |',
    '',
    '> The numbers discussed below are in `readings.json` and rendered in `report.md`. The hash above is the exact',
    '> revision of them this was written against, so if the readings are ever regenerated differently this file is',
    '> ORPHANED rather than quietly wrong. Check it with: `sha256sum readings.json`.',
    '',
    '---',
    '',
    text.trim(),
    '',
  ].join('\n')
  try {
    writeFileSync(join(dir, INTERPRETATION_FILE), body)
    // `name` FIRST, because every other entry in `files` is `{name, bytes, sha256}` and a reader that walks the list
    // must not meet a differently-shaped one. The interpretation's extra fields ride alongside rather than replacing.
    manifest.interpretation = { name: INTERPRETATION_FILE, bytes: Buffer.byteLength(body, 'utf8'), sha256: hashOf(body), by: String(by), at: stamp, readingsSha256: anchor }
    manifest.files = [...manifest.files.filter((file) => file.name !== INTERPRETATION_FILE), manifest.interpretation]
    // `written` IS NOT `reproducible`, and the manifest says which is which after the amendment as well as before it.
    manifest.written = [...REPRODUCIBLE_FILES, INTERPRETATION_FILE]
    // AND A PACKAGE BUILT BEFORE THIS FIELD EXISTED IS COMPLETED BY THE AMENDMENT rather than left half-described: the
    // same three files were always reproducible, and a manifest that names `written` without `reproducible` leaves a
    // reader unable to tell a number from an opinion.
    if (manifest.reproducible === undefined) manifest.reproducible = [...REPRODUCIBLE_FILES]
    const manifestBody = JSON.stringify(manifest, null, 2) + '\n'
    writeFileSync(manifestPath, manifestBody)
    writeFileSync(join(dir, 'manifest.sha256'), hashOf(manifestBody) + '  manifest.json\n')
    return { problem: null, anchor, file: INTERPRETATION_FILE, bytes: manifest.interpretation.bytes }
  } catch (error) {
    return { problem: 'attaching the interpretation to ' + dir + ' failed: ' + (error instanceof Error ? error.message : String(error)), anchor: null, file: null }
  }
}

/**
 * THE REPORT SKELETON: the format, emitted by the tool instead of requested in prose.
 *
 * WHY THIS IS CODE AND NOT A CONVENTION IN A SKILL. I wrote this table by hand four times, and the numbers in it were
 * retyped each time -- from a tool result, into prose, by a model. That is the shape this repository refuses everywhere
 * else: a number living in two places, able to drift, with nothing checking them against each other. A convention in a
 * skill would be a fifth copy of the format and a sixth opportunity to mistype a median.
 *
 * THE SHAPE IS THE OPERATOR'S, taken from the interpretation they said they liked, and it is four things: a BASIS
 * paragraph saying what was measured and how; one section per INSTRUMENT, headed with the set's name, holding a table
 * of short labels against THIS measurement and a COMPARISON, with the prose in a `READING:` line below rather than in a
 * column; then what the reading does not establish; then what the package itself caught.
 *
 * The tool fills every NUMBER. It cannot fill the reading -- prose is not derivable from numbers, which is why
 * `interpret` is its own call -- but it can guarantee that no figure in the finished report came from a transcript of
 * one.
 *
 * @param tables  `[{ title, set, questions: [id, ...] }]`, in the order they should appear. The CALLER names them,
 *                because which questions belong to "the model" and which to "the operator" is a fact about the
 *                question sets, not about the numbers (register row F59).
 * @param against `{ title, questions: { id: entry } }` -- a second measurement to compare against, or null. The
 *                comparison is a COLUMN, and when there is none the table says so rather than printing a blank one.
 * @param basis   the sentence saying what was measured; derived from the window when not given.
 */
export function buildSkeleton({ summary, basis = null, against = null, tables = [], at = null } = {}) {
  const counts = summary?.counts ?? {}
  const run = summary?.window?.run
  const byId = new Map()
  for (const group of summary?.groups ?? []) for (const q of group.questions ?? []) if (!byId.has(q.id)) byId.set(q.id, q)
  const compared = against === null || against === undefined ? null : against

  const head = [
    '# Measurement report',
    '',
    '| | |',
    '|---|---|',
    '| window | ' + (run === undefined ? 'every run in the file' : 'run `' + run + '`') + ', ' + (counts.call ?? 0) + ' call(s) |',
    '| model | ' + (summary?.mount?.model ?? '(not recorded)') + ' via ' + (summary?.mount?.provider ?? '(not recorded)') + ' |',
    '| probe | `sha256:' + (summary?.mount?.probeHash ?? '(not recorded)') + '` |',
    '| taken | ' + (at ?? '(unspecified)') + ' |',
    '',
    '> The numbers below are read from `readings.json` in this package; every `READING:` line and the two closing',
    '> sections are written, not derived, and are the only parts of this file that are not reproducible. Check the',
    '> anchor with `sha256sum readings.json`.',
    '',
    basis ?? basisOf(summary, tables, at),
    '',
  ]

  const body = []
  for (const table of tables) {
    const ids = table.questions ?? []
    body.push('## ' + String(table.title ?? '(untitled)') + ', in this session' + setClause(table, summary, tables))
    body.push('')
    // NO COMPARISON MEANS TWO COLUMNS. The first version kept the third column and left it blank under the header
    // `reading`, which is a column that says nothing and looks like a mistake -- and a blank cell is the one thing this
    // format exists to prevent.
    const column = compared === null ? null : String(compared.title ?? 'the comparison')
    body.push('| question | ' + segmentsClause(ids, byId) + (column === null ? '' : ' | ' + column) + ' |')
    body.push(column === null ? '|---|---|' : '|---|---|---|')
    for (const id of ids) {
      const q = byId.get(id)
      // A QUESTION NOBODY ASKED IS NAMED, because a blank cell reads as a formatting mistake rather than as an absence.
      const mine = q === undefined ? '**NOT IN THIS WINDOW**' : cellOf(q)
      const theirs = compared === null ? null : (compared.questions?.[id] === undefined ? '--' : cellOf(compared.questions[id], true))
      body.push('| ' + labelOf(id) + ' (' + kindOf(q) + ') | ' + mine + (theirs === null ? '' : ' | ' + theirs) + ' |')
    }
    body.push('')
    if (compared === null) body.push('_No comparison was given. Pass `against` with another package directory to put a second measurement beside these numbers._')
    body.push('')
    body.push('READING: _')
    body.push('')
  }

  const tail = [
    '## What this reading does NOT establish',
    '',
    '* **A segment aggregate is not a session-level judgement.** __',
    '* **One run is one run.** __',
    '* **`confidence` is not accuracy.** __',
    '* **__ has no battery.** __',
    '',
    '## What the package itself caught',
    '',
    '__',
    '',
  ]
  const refusals = (summary?.refusals ?? []).length === 0 ? [] : [
    '## What may NOT be read from this window',
    '',
    ...(summary.refusals ?? []).map((line) => '* ' + line),
    '',
  ]
  return [...head, ...body, ...tail, ...refusals].join('\n')
}

/** The heading's `(set \`name\`, hash h)`, from what the caller named and what the window recorded. */
function setClause(table, summary, tables) {
  const name = typeof table.set === 'string' && table.set !== '' ? table.set : null
  // THE WINDOW RECORDS ONE SET HASH, ON THE MOUNT LINE (register row F59), so borrowing it is only honest when this
  // report has ONE instrument. With two, the second table was claiming the first table's set -- so it is omitted
  // unless the caller says, and `tables` is passed in for exactly that count.
  const hash = table.setHash ?? (tables.length === 1 ? (summary?.runs?.[0]?.questionSetHash ?? null) : null)
  if (name === null && hash === null) return ''
  if (name === null) return ' (hash ' + hash + ')'
  return ' (set `' + name + '`' + (hash === null ? '' : ', hash ' + hash) + ')'
}

/** `reading over 16 segments`, which is what the column IS -- the reader must know it is parts, not a whole. */
function segmentsClause(ids, byId) {
  const read = ids.map((id) => byId.get(id)).filter((q) => q !== undefined).map((q) => q.read ?? 0)
  const most = read.length === 0 ? 0 : Math.max(...read)
  return most === 0 ? 'reading' : 'reading over ' + most + ' segment(s)'
}

/** The basis sentence, from the window, when the caller did not write one. */
function basisOf(summary, tables, at) {
  const counts = summary?.counts ?? {}
  const questions = tables.reduce((total, table) => total + (table.questions ?? []).length, 0)
  return 'MEASUREMENT taken ' + (at ?? '(undated)') + ' from run `' + (summary?.window?.run ?? '(every run)') + '`: '
    + (counts.call ?? 0) + ' call(s) over ' + tables.length + ' instrument(s) and ' + questions + ' question(s). __'
}

/** `request served (score)` -- the id read back as words, with the PRIMITIVE marked. */
function labelOf(id) {
  return String(id).replace(/^(session|operator|turn|probe)_/, '').replace(/_/g, ' ')
}

/**
 * WHICH PRIMITIVE IT IS, DERIVED FROM WHAT IS PRESENT and never from `q.type`, which these call lines do not record
 * (register row F53). A probability block with value counts is a SCORE -- its mean is filed as a level, so the counts
 * are the levels it landed on; a probability block alone is a NOUL; value counts alone are a CHOICE.
 */
function kindOf(q) {
  if (q === undefined) return '?'
  const hasP = q.probabilities !== undefined
  const hasV = Array.isArray(q.values) && q.values.length > 0
  if (hasP && hasV) return 'score'
  if (hasP) return 'noul'
  if (hasV) return Array.isArray(q.values) && q.values.every((v) => Number.isFinite(Number(v.value))) ? 'score' : 'choice'
  return '?'
}

/**
 * One question's numbers as a table cell -- bold on the fact that decides it, because a reader scanning the column is
 * looking for the one thing that matters, and `median 0.415, range 0.22..0.86` alone does not say it.
 */
function cellOf(q, compact = false) {
  const tail = (q.unreadable > 0 ? ', unreadable=' + q.unreadable : '') + (q.failed > 0 ? ', FAILED=' + q.failed : '')
  const flat = q.separates === false ? ' -- NOT SEPARATING' : ''
  const values = Array.isArray(q.values) ? q.values : []
  const p = q.probabilities
  if (p !== undefined) {
    const score = kindOf(q) === 'score'
    const share = p.n === 0 ? '' : Math.round((p.atOrAboveHalf / p.n) * 100) + '%'
    // A SCORE'S `at or above half` IS MEANINGLESS -- its level is not a probability -- so it is not printed for one.
    const side = score || p.n === 0 ? '' : ', **true in ' + p.atOrAboveHalf + '/' + p.n + ' (' + share + ')**'
    return 'median ' + round(p.median) + ', range ' + round(p.min) + '-' + round(p.max) + side + tail + flat
  }
  if (values.length > 0) {
    if (kindOf(q) === 'score') {
      const expanded = values.flatMap((v) => Array.from({ length: v.n }, () => Number(v.value))).sort((a, b) => a - b)
      const middle = Math.floor(expanded.length / 2)
      const median = expanded.length % 2 === 1 ? expanded[middle] : (expanded[middle - 1] + expanded[middle]) / 2
      return 'median ' + round(median) + ', range ' + round(expanded[0]) + '-' + round(expanded[expanded.length - 1]) + tail + flat
    }
    // THE MODE, NOT THE FIRST VALUE ENCOUNTERED. These counts come from a Map in insertion order, so `values[0]` is
    // whichever label happened to appear first -- and bolding it made the report's most prominent fact a coin toss.
    // Measured: `failed_tool_recovery` rendered **no_empty_result 7/15** while the mode was `retried_differently=8`.
    const ranked = [...values].sort((a, b) => b.n - a.n)
    const top = ranked[0]
    const total = values.reduce((sum, v) => sum + v.n, 0)
    const share = total === 0 ? '' : Math.round((top.n / total) * 100) + '%'
    const rest = ranked.slice(1).map((v) => v.value + '=' + v.n).join(' ')
    return '**' + top.value + ' ' + top.n + '/' + total + ' (' + share + ')**' + (rest === '' ? '' : ' ' + rest) + tail + flat
  }
  return (q.read === 0 ? '**NO READABLE ANSWER**' : '**read=' + q.read + ', nothing summarisable**') + tail + flat
}

/** Three decimals, because `0.11499999999999999` is a float artefact and reads as precision that is not there. */
function round(value) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 1000) / 1000 : value
}

/** Every question in a `readings.json`, by id -- what a comparison package contributes to the skeleton's third column. */
export function questionsById(readings) {
  const out = {}
  for (const group of readings?.groups ?? []) for (const q of group.questions ?? []) if (!Object.hasOwn(out, q.id)) out[q.id] = q
  return out
}
