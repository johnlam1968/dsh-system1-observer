// QUESTION SETS AS FILES: read them, hash them, list them.
//
// Today a question set is a nested object in the profile's `questions` key -- it cannot be named, reused across rows,
// shared, or identified in a trace, so two runs under different sets are compared as though one instrument produced
// both. §12 of `docs/settings.md` designs the answer: a DIRECTORY of set files, one set per file, selected by name.
//
// WHAT THIS MODULE DOES, AND WHAT IT DELIBERATELY DOES NOT. It reads files, hashes their bytes and lists them. It does
// NOT decide whether a question spec is well formed: that rule lives in `lib/questions.js` (which reads specs for the
// live path already), and a second copy of it here would be a second answer to what a spec is. So the validation is
// the reader's, and this module's only structural judgement is "an object whose values are arrays" -- enough to know
// that it is looking at a questions map rather than at, say, a package manifest.
//
// THE HASH IS THE POINT. A set file's bytes are hashed so the run can record WHICH set produced it: `instrument` in
// `lib/compare.js` then refuses to compare runs under different sets, by the same mechanism `probeHash` already uses
// for the probe question. Editing one character of a set makes its runs honestly incomparable, which is the whole
// reason to put sets in files rather than in a profile.
//
// NOTHING HERE THROWS. A missing directory, an unreadable file and malformed JSON are all named problems: the caller
// is a settings read or a tool, and both have to explain what went wrong rather than fail.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { readConfigValue } from './config-value.js'

/** A set file's suffix. JSON, because a set is data and the harness already reads JSON nowhere else here. */
import { BATTERY_SUFFIX } from './battery.js'

export const SET_SUFFIX = '.json'

/** The identity of a set: the hash of its BYTES, so whitespace matters -- a reformat is a different experiment. */
export function setHash(text) {
  return createHash('sha256').update(String(text)).digest('hex').slice(0, 12)
}

/**
 * One set file, parsed.
 *
 * @returns `{ questions, hash, path, problem }` -- `questions` is the questions map, `problem` a sentence or null.
 */
export function readSetFile(path) {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    return { questions: null, hash: '', path, problem: 'cannot read ' + path + ': ' + messageOf(error) }
  }
  const hash = setHash(text)
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    // THE HASH IS STILL REPORTED: a file that does not parse has an identity, and naming it is how a person finds the
    // file that broke their run.
    return { questions: null, hash, path, problem: path + ' is not valid JSON: ' + messageOf(error) }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { questions: null, hash, path, problem: path + ' is not an object of seams' }
  }
  // A QUESTIONS MAP, NOT A SET OBJECT: `{ admit: [...], draft: [...] }`. A wrapper object would be a second shape for
  // the same thing, and the profile's own `questions` key is already this shape.
  for (const [seam, specs] of Object.entries(parsed)) {
    if (!Array.isArray(specs)) {
      return { questions: null, hash, path, problem: path + ': "' + seam + '" is not a list of questions' }
    }
  }
  return { questions: parsed, hash, path, problem: null }
}

/** The set files in a directory, newest name order, each with its hash. */
/**
 * THE SCOPE FILES INSIDE A COMPOSITION DIRECTORY.
 *
 * One file per scope, named for the scope: `draft.json` holds the spec LIST for `draft`. The scope name is the file
 * stem -- and that is not a structure hidden in a filename: it is the key, spelled once, in the one place a reader
 * looks. Anything prefixed `_` is METADATA and is not a scope (`_templates`, and later a manifest naming which model
 * or use case a composition is for).
 *
 * A file may also carry the one-key map form (`{ "draft": [ ... ] }`); a map naming a DIFFERENT scope is refused,
 * because a file called draft.json answering for `result` is a set that means two things.
 */
function scopeFilesIn(dir) {
  let names
  try {
    names = readdirSync(dir)
  } catch (error) {
    return { entries: [], problem: 'cannot list ' + dir + ': ' + messageOf(error) }
  }
  const entries = []
  for (const name of names.filter((entry) => entry.endsWith(SET_SUFFIX) && !entry.startsWith('_')).sort()) {
    const path = join(dir, name)
    const stem = name.slice(0, name.length - SET_SUFFIX.length)
    let text
    try {
      text = readFileSync(path, 'utf8')
    } catch (error) {
      return { entries: [], problem: 'cannot read ' + path + ': ' + messageOf(error) }
    }
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      return { entries: [], problem: path + ' is not valid JSON: ' + messageOf(error) }
    }
    let specs = parsed
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const keys = Object.keys(parsed)
      if (keys.length !== 1 || keys[0] !== stem) {
        return { entries: [], problem: path + ' must hold a list of specs, or a single key "' + stem + '"' }
      }
      specs = parsed[stem]
    }
    if (!Array.isArray(specs)) return { entries: [], problem: path + ' does not hold a list of specs' }
    entries.push({ scope: stem, specs, hash: setHash(text), path })
  }
  // A COMPOSITION WITH NO SCOPE FILES ASKS NOTHING AT EVERY SEAM, silently -- the same failure as the flat one-seam file
  // that disables the other eight, and refused for the same reason: a row that selected this would measure nothing and
  // say nothing about it.
  if (entries.length === 0) return { entries: [], problem: dir + ' has no scope files, so it asks nothing at any seam' }
  return { entries, problem: null }
}

/**
 * WHAT A COMPOSITION IS FOR, when it wants to say: a model, a use case, a person.
 *
 * `_manifest.json` inside the directory, and it is METADATA, not a scope: it is never read as questions and it does
 * NOT enter the composition's hash, because declaring who a set is for does not change what it asks. Two rows with the
 * same scopes and different manifests are the same instrument -- which is the point: the manifest is how a row can
 * SELECT on that, rather than a person remembering which file is which.
 *
 * Free-form beyond `appliesTo`, which is a flat map of strings (`model`, `useCase`, `user`), because the axes worth
 * naming are not known in advance and adding one must not need a code change.
 */
function readManifest(dir) {
  const path = join(dir, '_manifest.json')
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return { manifest: null, problem: null } // no manifest is the ordinary case
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return { manifest: null, problem: path + ' is not valid JSON: ' + messageOf(error) }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { manifest: null, problem: path + ' must be an object' }
  }
  if (parsed.appliesTo !== undefined) {
    if (parsed.appliesTo === null || typeof parsed.appliesTo !== 'object' || Array.isArray(parsed.appliesTo)) {
      return { manifest: null, problem: path + ': `appliesTo` must be an object of strings' }
    }
    for (const [axis, value] of Object.entries(parsed.appliesTo)) {
      if (typeof value !== 'string' || value.trim() === '') {
        return { manifest: null, problem: path + ': `appliesTo.' + axis + '` must be a non-empty string' }
      }
    }
  }
  return { manifest: parsed, problem: null }
}

/**
 * THE COMPOSITION'S IDENTITY, from its parts: the same per-scope hashes in any order give the same value, so moving a
 * file around is not a change of instrument, while editing one character of one scope is.
 */
export function compositionHash(entries) {
  return setHash(entries.map((entry) => entry.scope + ' ' + entry.hash).sort().join('\n'))
}

/** Whether a name selects a directory (a composition) rather than a flat file. */
function isComposition(dir, name) {
  try {
    return statSync(join(dir, name)).isDirectory()
  } catch {
    return false
  }
}

export function listSets(dir) {
  const where = typeof dir === 'string' ? dir.trim() : ''
  if (where === '') return { sets: [], problem: 'no `questionSetsDir` is configured' }
  let names
  try {
    if (!statSync(where).isDirectory()) return { sets: [], problem: where + ' is not a directory' }
    names = readdirSync(where)
  } catch (error) {
    return { sets: [], problem: 'cannot list ' + where + ': ' + messageOf(error) }
  }
  const sets = []
  // A BATTERY IS NOT A SET, and it lives in this directory because it is written against one. Without this exclusion
  // `trial.battery.json` was offered as a set called `trial.battery`, whose only question would be the battery's own
  // top-level keys -- a set nobody wrote, in the picker everyone reads.
  for (const name of names.filter((entry) => !entry.startsWith('_') && !entry.endsWith(BATTERY_SUFFIX)).sort()) {
    const path = join(where, name)
    let directory = false
    try {
      directory = statSync(path).isDirectory()
    } catch {
      continue
    }
    if (directory) {
      // A COMPOSITION: one file per scope, named for the scope.
      const read = scopeFilesIn(path)
      const manifest = readManifest(path)
      sets.push({
        name,
        path,
        kind: 'composition',
        hash: read.problem === null ? compositionHash(read.entries) : '',
        seams: read.entries.map((entry) => entry.scope),
        scopeHashes: Object.fromEntries(read.entries.map((entry) => [entry.scope, entry.hash])),
        manifest: manifest.manifest,
        appliesTo: manifest.manifest?.appliesTo ?? null,
        problem: read.problem ?? manifest.problem,
      })
      continue
    }
    if (!name.endsWith(SET_SUFFIX)) continue
    // A FLAT FILE, from before compositions existed: kept working, because a single-scope trial does not need a directory.
    const read = readSetFile(path)
    sets.push({
      name: name.slice(0, name.length - SET_SUFFIX.length),
      path,
      kind: 'file',
      hash: read.hash,
      seams: read.questions === null ? [] : Object.keys(read.questions),
      scopeHashes: read.questions === null ? {} : Object.fromEntries(Object.keys(read.questions).map((scope) => [scope, read.hash])),
      problem: read.problem,
    })
  }
  return { sets, problem: null }
}

/**
 * The set a row selected, ready for `lib/questions.js` to build questions from.
 *
 * An unset name means "the inline `questions` object", which is what every row does today -- so this returns
 * `{ questions: null }` rather than an error, and the caller keeps its existing path.
 */
export function readSelectedSet(dir, name) {
  const wanted = typeof name === 'string' ? name.trim() : ''
  if (wanted === '') return { questions: null, hash: '', path: '', scopes: {}, problem: null, selected: false }
  const where = typeof dir === 'string' ? dir.trim() : ''
  if (where === '') {
    return { questions: null, hash: '', path: '', scopes: {}, selected: true, problem: 'a set is selected (' + wanted + ') but no `questionSetsDir` is configured' }
  }
  if (isComposition(where, wanted)) {
    const path = join(where, wanted)
    const read = scopeFilesIn(path)
    if (read.problem !== null) return { questions: null, hash: '', path, scopes: {}, appliesTo: null, selected: true, problem: read.problem }
    const manifest = readManifest(path)
    if (manifest.problem !== null) return { questions: null, hash: '', path, scopes: {}, appliesTo: null, selected: true, problem: manifest.problem }
    const questions = {}
    for (const entry of read.entries) {
      // TWO FILES ANSWERING FOR ONE SCOPE IS REFUSED: whichever won would make the composition's meaning depend on a
      // sort order, and a set that means two things cannot be calibrated.
      if (questions[entry.scope] !== undefined) {
        return { questions: null, hash: '', path, scopes: {}, selected: true, problem: path + ' has two files for "' + entry.scope + '"' }
      }
      questions[entry.scope] = entry.specs
    }
    return {
      questions,
      hash: compositionHash(read.entries),
      path,
      scopes: Object.fromEntries(read.entries.map((entry) => [entry.scope, entry.hash])),
      appliesTo: manifest.manifest?.appliesTo ?? null,
      selected: true,
      problem: null,
    }
  }
  const file = join(where, wanted + SET_SUFFIX)
  const read = readSetFile(file)
  return { questions: read.questions, hash: read.hash, path: file, scopes: {}, selected: true, problem: read.problem }
}

/** The two settings, read live like every other setting in this plugin. */
/**
 * THE DEFAULT SESSION SET, AND WHERE THE SETS LIVE WHEN THE ROW SAYS NOTHING.
 *
 * MEASURING A SESSION MUST NOT DEPEND ON THE ROW. An agent asked to measure had to discover the settings, change the
 * live `questionSet`, run, and change it back -- and a row whose `questionSetsDir` is empty could not measure at all,
 * because the only directory it knew was the one the row named. Both are built in now: the plugin ships its own
 * `criteria/`, and the default set asks BOTH dimensions, the agent's and the operator's.
 *
 * The row remains an OVERRIDE -- for where sets live, and for the SEAM hooks. It is not required for a session
 * measurement to run.
 */
export const DEFAULT_SESSION_SET = 'session@1'

/** The `criteria/` directory that ships beside this library, so a default can name a set without a row. */
export function bundledSetsDir() {
  return fileURLToPath(new URL('../criteria', import.meta.url))
}

export function setSettings(config) {
  const dir = readConfigValue(config?.questionSetsDir)
  const name = readConfigValue(config?.questionSet)
  return {
    // THE ROW'S DIRECTORY WINS WHEN IT NAMES ONE; the bundled directory answers when it does not, so a row with an
    // empty `questionSetsDir` still finds every set this plugin ships.
    dir: typeof dir === 'string' && dir.trim() !== '' ? dir.trim() : bundledSetsDir(),
    name: typeof name === 'string' ? name.trim() : '',
  }
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}
