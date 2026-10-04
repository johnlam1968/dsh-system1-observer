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
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** The files a package holds, in the order they are written. One list, so the manifest cannot disagree with the disk. */
export const PACKAGE_FILES = Object.freeze(['manifest.json', 'report.md', 'readings.json', 'trace.jsonl', 'manifest.sha256'])

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
