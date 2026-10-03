// SYSTEM1_QUESTIONS: list, read, validate and WRITE question sets -- the composing half of the agent-driven loop.
//
// The suite already has a tool that SELECTS a set (`system1_settings` sets `questionSet`) and one that READS a
// trace. What was missing is the one an agent needs in the middle: put a question set into words, check it, and store
// it -- without a text editor and without a restart.
//
// FIVE RULES, each of which exists because the alternative damages the instrument rather than merely annoying it:
//
// 1. **The loader validates BEFORE anything is written.** `buildQuestions` is the same code the row uses at call
//    time, so a set that would be refused while running is refused while composing, and the file on disk is never the
//    first thing to discover the problem. A write that failed validation leaves the previous bytes untouched.
// 2. **An existing scope file is not overwritten without `replace: true`.** A set's identity is the hash of its
//    bytes, and that hash is on the mount line: silently rewriting a published scope makes every earlier run
//    incomparable with every later one while looking like nothing happened. `replace` is the agent saying it knows.
// 3. **A revision is a new file, not an edit.** The tool says so in its own refusal, because `@2` beside `@1` is how
//    this corpus versions a set, and an edit in place is the mistake rule 1 exists to make expensive.
// 4. **An empty scope list is refused.** A scope file holding `[]` is a valid file and a silent instrument: the point
//    asks nothing and reports nothing, which this repository refuses to let pass for a measurement.
// 5. **A write reports what landed, read back from disk.** The hash in the answer is the composition's hash AFTER the
//    write, computed by re-reading it, because a hash computed from the bytes the tool MEANT to write is a claim
//    rather than an observation.
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkAgainst } from './tool-args.js'
import { buildQuestions } from './questions.js'
import { listSets, readSelectedSet, setSettings, SET_SUFFIX } from './question-sets.js'

export const QUESTIONS_TOOL_NAME = 'system1_question_sets'

const DESCRIPTION = [
  'Compose, check and store the question sets this row asks at its seams, its turn aggregate and its sessions.',
  'Actions: `list` (every composition the row can see, with hashes and what each declares), `read` (one scope\'s specs',
  'and the rationale file\'s name), `validate` (check specs with the SAME loader the row uses, writing nothing), and',
  '`write` (validate, then store one scope file). A write refuses to overwrite an existing scope unless `replace` is',
  'true, refuses an empty list, and answers with the composition hash read back from disk -- so an agent can record',
  'exactly which instrument it just created.',
].join(' ')

const parameters = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', enum: ['list', 'read', 'validate', 'write'], description: 'What to do.' },
    set: { type: 'string', description: 'The composition (a directory name under the sets directory). Required for `read`, `validate` and `write`.' },
    scope: { type: 'string', description: 'Which scope the specs are for: a seam name (`assemble`, `admit`, `draft`, `pre_execute`, `execute`, `post_execute`, `result`), `turn`, or `session`. Required for `read`, `validate` and `write`.' },
    specs: {
      type: 'array',
      description: 'The spec list for `validate` and `write`: each `{id, type, instructions}` with `levels` for a score or `options` for a choice (exactly one carrying `"abstain": true`).',
      items: { type: 'object' },
    },
    replace: { type: 'boolean', description: 'Set true to overwrite an existing scope file. Defaults to false, which refuses and suggests a new `@` revision instead.' },
    dir: { type: 'string', description: 'Override the row\'s `questionSetsDir` for this call. Defaults to the row\'s own directory.' },
  },
}

/** The scopes a spec list may be written for, so a typo is a refusal rather than an unreachable file. */
export const WRITABLE_SCOPES = Object.freeze([
  'assemble', 'admit', 'request', 'draft', 'pre_execute', 'execute', 'post_execute', 'result', 'close', 'turn', 'session',
])

/**
 * What the LOADER says about these specs, in the loader's own words.
 *
 * `buildQuestions` is the call-time check, so this is not a second opinion -- it is the same opinion, taken earlier.
 */
export function validateSpecs(scope, specs) {
  const problems = []
  if (!Array.isArray(specs)) return ['`specs` must be an array of question specs']
  if (specs.length === 0) {
    return ['an empty list asks nothing at this scope, and silence that looks like a measurement is worse than no measurement']
  }
  const built = buildQuestions({ questions: { [scope]: specs } }, scope)
  for (const problem of (built.problems ?? [])) problems.push(problem)
  if (Object.keys(built.questions).length === 0 && problems.length === 0) {
    problems.push('the loader accepted these specs and produced no question, which is a defect worth reporting rather than a set to write')
  }
  const ids = specs.filter((s) => s !== null && typeof s === 'object').map((s) => s.id)
  const duplicates = ids.filter((id, index) => id !== undefined && ids.indexOf(id) !== index)
  for (const id of [...new Set(duplicates)]) {
    problems.push('two specs share the id `' + id + '`: the answer map is keyed by id, so one would overwrite the other')
  }
  return problems
}

export function createQuestionsTool({ dir, list = listSets, read = readSelectedSet, validate = validateSpecs, readText = (file) => readFileSync(file, 'utf8'), writeText = (file, text) => writeFileSync(file, text), exists = (path) => { try { statSync(path); return true } catch { return false } }, listDir = (path) => readdirSync(path) } = {}) {
  const where = (args) => {
    if (typeof args.dir === 'string' && args.dir.trim() !== '') return args.dir.trim()
    const configured = typeof dir === 'function' ? dir() : dir
    return typeof configured === 'string' ? configured.trim() : ''
  }
  const fail = (problem, extra = {}) => ({ action: extra.action ?? 'list', problem, ...extra })
  const base = { action: 'list', dir: '' }

  return {
    name: QUESTIONS_TOOL_NAME,
    description: DESCRIPTION,
    parameters,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', description: 'What was done.' },
          dir: { type: 'string', description: 'The sets directory used.' },
          sets: {
            type: 'array',
            description: 'For `list`: every composition, with its scopes, hashes and declarations.',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                kind: { type: 'string' },
                hash: { type: 'string' },
                seams: { type: 'array', items: { type: 'string' } },
                appliesTo: { type: 'object' },
                problem: { type: 'string' },
              },
            },
          },
          set: { type: 'string', description: 'The composition this call was about.' },
          scope: { type: 'string', description: 'The scope this call was about.' },
          specs: { type: 'array', description: 'For `read`: the scope\'s specs, as they are on disk.', items: { type: 'object' } },
          hash: { type: 'string', description: 'The composition\'s hash, read back from disk after a write.' },
          scopeHashes: { type: 'object', description: 'A hash per scope of the composition.' },
          written: { type: 'string', description: 'The path written, for `write`.' },
          replaced: { type: 'boolean', description: 'Whether an existing scope file was overwritten.' },
          created: { type: 'boolean', description: 'Whether the composition directory was created by this call.' },
          problems: { type: 'array', description: 'What the loader says about the specs. A non-empty list means NOTHING was written.', items: { type: 'string' } },
          problem: { type: 'string', description: 'Set when the call could not be made at all.' },
        },
      },
      render(_args, value) {
        if (typeof value.problem === 'string' && value.problem !== '') return [{ type: 'text', text: 'UNAVAILABLE: ' + value.problem }]
        const lines = []
        if (value.action === 'list') {
          lines.push('sets in ' + value.dir + ': ' + (value.sets ?? []).length)
          for (const set of value.sets ?? []) {
            lines.push(`  ${set.name} [${set.kind}] ${set.hash} scopes=${(set.seams ?? []).join(',') || '(none)'}${set.appliesTo ? ' for=' + JSON.stringify(set.appliesTo) : ''}${set.problem ? ' PROBLEM: ' + set.problem : ''}`)
          }
          return [{ type: 'text', text: lines.join('\n') }]
        }
        lines.push(`${value.action} ${value.set}/${value.scope} in ${value.dir}`)
        if (Array.isArray(value.problems) && value.problems.length > 0) {
          lines.push('REFUSED -- nothing was written:')
          for (const problem of value.problems) lines.push('  ' + problem)
          return [{ type: 'text', text: lines.join('\n') }]
        }
        if (value.action === 'read') lines.push(`  ${(value.specs ?? []).length} spec(s) on disk`)
        if (value.action === 'validate') lines.push('  the loader accepts these specs')
        if (value.action === 'write') {
          lines.push(`  ${value.replaced === true ? 'REPLACED' : 'wrote'} ${value.written}${value.created === true ? ' (new composition)' : ''}`)
          lines.push(`  the composition is now ${value.hash} -- record that hash with any measurement made under it`)
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args) {
      let checked
      try {
        checkAgainst(parameters, args ?? {}, QUESTIONS_TOOL_NAME)
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error), { ...base })
      }
      checked = args ?? {}
      const action = String(checked.action ?? '')
      const directory = where(checked)
      if (directory === '') return fail('no `questionSetsDir` is configured for this row and no `dir` was given', { ...base, action })

      if (action === 'list') {
        const listed = list(directory)
        if (listed.problem !== null) return fail(listed.problem, { ...base, action, dir: directory })
        return {
          action, dir: directory,
          sets: listed.sets.map((set) => ({
            name: set.name, kind: set.kind, hash: set.hash, seams: set.seams,
            ...(set.appliesTo === null || set.appliesTo === undefined ? {} : { appliesTo: set.appliesTo }),
            ...(set.problem === null || set.problem === undefined ? {} : { problem: set.problem }),
          })),
        }
      }

      const name = String(checked.set ?? '')
      const scope = String(checked.scope ?? '')
      if (name === '') return fail('`set` is required for `' + action + '`: the composition to act on', { ...base, action, dir: directory })
      if (scope === '') return fail('`scope` is required for `' + action + '`: the seam, `turn`, or `session`', { ...base, action, dir: directory })
      if (!WRITABLE_SCOPES.includes(scope)) {
        return fail('`' + scope + '` is not a scope a set can be written for (known: ' + WRITABLE_SCOPES.join(', ') + ')', { ...base, action, dir: directory, set: name, scope })
      }

      if (action === 'read') {
        const file = join(directory, name, scope + SET_SUFFIX)
        if (!exists(file)) return fail('no ' + file + ' yet', { ...base, action, dir: directory, set: name, scope })
        let parsed
        try {
          parsed = JSON.parse(readText(file))
        } catch (error) {
          return fail(file + ' is not valid JSON: ' + (error instanceof Error ? error.message : String(error)), { ...base, action, dir: directory, set: name, scope })
        }
        const specs = Array.isArray(parsed) ? parsed : parsed[scope]
        if (!Array.isArray(specs)) return fail(file + ' does not hold a spec list', { ...base, action, dir: directory, set: name, scope })
        return { action, dir: directory, set: name, scope, specs }
      }

      if (action === 'validate') {
        const problems = validate(scope, checked.specs)
        return { action, dir: directory, set: name, scope, problems }
      }

      // WRITE. Every refusal below happens BEFORE the filesystem is touched, which is the property the tests assert.
      const problems = validate(scope, checked.specs)
      if (problems.length > 0) return { action, dir: directory, set: name, scope, problems }
      const targetDir = join(directory, name)
      // A NEW COMPOSITION IS CREATED, not refused. Its own refusal used to advise "create it by writing its first scope
      // file under that exact name" while refusing exactly that, and creating a directory cannot damage an existing set
      // -- so this is also the honest default for a revision: `@next` is one write away.
      let created = false
      if (!exists(targetDir)) {
        try {
          mkdirSync(targetDir)
          created = true
        } catch (error) {
          return { action, dir: directory, set: name, scope, problems: ['cannot create ' + targetDir + ': ' + (error instanceof Error ? error.message : String(error))] }
        }
      }
      let kind = 'unknown'
      try {
        kind = statSync(targetDir).isDirectory() ? 'directory' : 'file'
      } catch (error) {
        return { action, dir: directory, set: name, scope, problems: [String(error)] }
      }
      if (kind !== 'directory') {
        return { action, dir: directory, set: name, scope, problems: [join(directory, name) + ' is a flat set file, not a composition directory: write a flat file with your own editor, or make a composition directory'] }
      }
      const file = join(targetDir, scope + SET_SUFFIX)
      const replaced = exists(file)
      if (replaced && checked.replace !== true) {
        return {
          action, dir: directory, set: name, scope,
          problems: [file + ' already exists. A set is identified by the hash of its bytes and that hash is on the mount line, so rewriting it makes every earlier run incomparable with every later one. Either pass `replace: true` knowing that, or write a NEW composition (a new directory, e.g. `' + name.replace(/@[0-9]+$/, '') + '@next`) so the previous instrument keeps its name'],
        }
      }
      try {
        writeText(file, JSON.stringify(checked.specs, null, 2) + '\n')
      } catch (error) {
        return { action, dir: directory, set: name, scope, problems: ['cannot write ' + file + ': ' + (error instanceof Error ? error.message : String(error))] }
      }
      // READ BACK, so the hash in the answer is an observation rather than an intention.
      const after = read(directory, name)
      return {
        action, dir: directory, set: name, scope, written: file, replaced, created,
        hash: after.hash,
        ...(after.scopes === undefined ? {} : { scopeHashes: after.scopes }),
        ...(after.problem === null || after.problem === undefined ? {} : { problems: [after.problem] }),
      }
    },
  }
}
