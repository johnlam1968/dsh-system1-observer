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
import { join } from 'node:path'
import { readConfigValue } from './config-value.js'

/** A set file's suffix. JSON, because a set is data and the harness already reads JSON nowhere else here. */
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
  for (const name of names.filter((entry) => entry.endsWith(SET_SUFFIX)).sort()) {
    const path = join(where, name)
    const read = readSetFile(path)
    sets.push({
      // THE NAME IS THE FILE'S STEM: that is what a row selects, so it is what a person types.
      name: name.slice(0, name.length - SET_SUFFIX.length),
      path,
      hash: read.hash,
      seams: read.questions === null ? [] : Object.keys(read.questions),
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
  if (wanted === '') return { questions: null, hash: '', path: '', problem: null, selected: false }
  const where = typeof dir === 'string' ? dir.trim() : ''
  if (where === '') {
    return { questions: null, hash: '', path: '', selected: true, problem: 'a set is selected (' + wanted + ') but no `questionSetsDir` is configured' }
  }
  const path = join(where, wanted + SET_SUFFIX)
  const read = readSetFile(path)
  return { questions: read.questions, hash: read.hash, path, selected: true, problem: read.problem }
}

/** The two settings, read live like every other setting in this plugin. */
export function setSettings(config) {
  const dir = readConfigValue(config?.questionSetsDir)
  const name = readConfigValue(config?.questionSet)
  return {
    dir: typeof dir === 'string' ? dir.trim() : '',
    name: typeof name === 'string' ? name.trim() : '',
  }
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}
