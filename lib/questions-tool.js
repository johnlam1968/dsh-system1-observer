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
import { questionGroup } from './instrument-input.js'
import { listSets, readSelectedSet, setSettings, SET_SUFFIX } from './question-sets.js'
import { lintScope, lintSelection, MACHINE_UNCOVERED } from './question-lint.js'

export const QUESTIONS_TOOL_NAME = 'system1_question_sets'

const DESCRIPTION = [
  'Compose, check and store the question sets this row asks at its seams, its turn aggregate and its sessions.',
  'Actions: `list` (every composition the row can see, with hashes and what each declares), `read` (one scope\'s specs',
  'and the rationale file\'s name), `validate` (check specs with the SAME loader the row uses, writing nothing),',
  '`lint` (check a scope\'s specs, or a whole composition on disk, against the RULES the authoring guide states: a',
  'question may only name state its scope actually emits, ids are lowercase and scoped, a choice carries exactly one',
  'abstain option, a noul reads as a predicate -- and it says which of those rules it CANNOT check), and',
  '`write` (validate, then store one scope file). A write refuses to overwrite an existing scope unless `replace` is',
  'true, refuses an empty list, and answers with the composition hash read back from disk -- so an agent can record',
  'exactly which instrument it just created.',
].join(' ')

const parameters = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', enum: ['list', 'read', 'validate', 'lint', 'write'], description: 'What to do.' },
    set: { type: 'string', description: 'The composition (a directory name under the sets directory). Required for `read`, `validate` and `write`, and for `lint` unless `specs` are given inline.' },
    scope: { type: 'string', description: 'Which scope the specs are for: a seam name (`assemble`, `admit`, `draft`, `pre_execute`, `execute`, `post_execute`, `result`), `turn`, or `session`. Required for `read`, `validate` and `write`, and for `lint` when `specs` are given; omit it on `lint` to check every scope of a composition on disk.' },
    specs: {
      type: 'array',
      description: 'The spec list for `validate` and `write`: each `{id, type, instructions}` with `levels` for a score or `options` for a choice (exactly one carrying `"abstain": true`).',
      // OPEN, NOT CLOSED-AND-EMPTY. This declared `items: {type: 'object', additionalProperties: false}` with no
      // `properties` at all, which forbids EVERY key of every spec: a live `write` was refused with a list of
      // "specs[0].id is not a declared property" errors, so the tool could not be used to author anything and the
      // whole point of it -- "put a question set into words, check it, and store it" -- was unreachable from a call.
      // A spec is AUTHORED: `buildOne` refuses an unknown `type` rather than an unknown key, and the same openness
      // is already declared on this tool's `read` output. Third defect in this family (the `oneOf` on
      // `system1_decide`, then `list`'s undeclared `path`), and the same cause: a declaration nobody ran a real
      // value against.
      items: { type: 'object', additionalProperties: true },
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
  const built = buildQuestions(questionGroup({ questions: { [scope]: specs } }), scope)
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
              type: 'object', additionalProperties: false,
              properties: {
                name: { type: 'string' },
                kind: { type: 'string' },
                hash: { type: 'string' },
                seams: { type: 'array', items: { type: 'string' } },
                // OPEN: the manifest's own flat map of strings (`model`, `useCase`, `user`), read from the set file.
                // Set files are authored, so the keys are the operator's and not this schema's to enumerate.
                appliesTo: { type: 'object', additionalProperties: true, description: 'The set manifest\'s `appliesTo`: a flat map of STRING axes, authored in the set file, so its keys are the operator\'s.' },
                problem: { type: 'string' },
              },
            },
          },
          set: { type: 'string', description: 'The composition this call was about.' },
          scope: { type: 'string', description: 'The scope this call was about.' },
          specs: {
            type: 'array', description: 'For `read`: the scope\'s specs, as they are on disk.',
            // OPEN, WITH THE KNOWN KEYS NAMED: a spec is AUTHORED, and `buildOne` refuses an unknown TYPE rather than an
            // unknown key, so a set file may carry a key this schema has not heard of without being wrong (F118).
            items: {
              type: 'object', additionalProperties: true,
              properties: {
                id: { type: 'string' }, type: { type: 'string' }, instructions: { type: 'string' },
                options: { type: 'array' }, levels: { type: 'array' }, criteria: { type: 'string' },
              },
            },
          },
          hash: { type: 'string', description: 'The composition\'s hash, read back from disk after a write.' },
          scopeHashes: { type: 'object', additionalProperties: true, description: 'A hash per scope of the composition -- keyed by scope NAME, so the map is open.' },
          written: { type: 'string', description: 'The path written, for `write`.' },
          replaced: { type: 'boolean', description: 'Whether an existing scope file was overwritten.' },
          created: { type: 'boolean', description: 'Whether the composition directory was created by this call.' },
          problems: { type: 'array', description: 'What the loader says about the specs. A non-empty list means NOTHING was written.', items: { type: 'string' } },
          findings: {
            type: 'array', description: 'For `lint`: what the authoring rules say. `error` means the question cannot work as written; `warn` means it works but a documented property is missing.',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                level: { type: 'string' }, rule: { type: 'string' }, id: { type: 'string' }, message: { type: 'string' },
              },
            },
          },
          checked: { type: 'integer', description: 'For `lint`: how many specs were examined.' },
          ok: { type: 'boolean', description: 'For `lint`: true when no finding is an `error`. This is NOT a statement that the questions are good -- see `machineUncovered`.' },
          machineUncovered: { type: 'array', description: 'For `lint`: the authoring rules NO machine can check, so a clean report is not a pass on them.', items: { type: 'string' } },
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
        // WHOLE-SET LINTS NAME NO SCOPE, so the scope is omitted rather than printed as the string "undefined" -- a lint of a
      // composition checks every scope it declares, and one that names none is not missing its argument.
      lines.push(`${value.action} ${value.set}${value.scope === undefined || value.scope === '' ? '' : '/' + value.scope} in ${value.dir}`)
        if (Array.isArray(value.problems) && value.problems.length > 0) {
          lines.push('REFUSED -- nothing was written:')
          for (const problem of value.problems) lines.push('  ' + problem)
          return [{ type: 'text', text: lines.join('\n') }]
        }
        if (value.action === 'read') lines.push(`  ${(value.specs ?? []).length} spec(s) on disk`)
        if (value.action === 'validate') lines.push('  the loader accepts these specs')
        if (value.action === 'lint') {
          const findings = value.findings ?? []
          lines.push(`  ${value.checked ?? 0} spec(s) checked, ${value.ok === true ? 'no error' : 'ERRORS'} (${findings.filter((f) => f.level === 'error').length} error, ${findings.filter((f) => f.level === 'warn').length} warn)`)
          for (const item of findings) lines.push(`  ${item.level === 'error' ? 'ERROR' : 'warn '} [${item.rule}]${item.id === null ? '' : ' ' + item.id}: ${item.message}`)
          for (const gap of value.machineUncovered ?? []) lines.push('  NOT CHECKED: ' + gap)
        }
        if (value.action === 'write') {
          lines.push(`  ${value.replaced === true ? 'REPLACED' : 'wrote'} ${value.written}${value.created === true ? ' (new composition)' : ''}`)
          lines.push(`  the composition is now ${value.hash} -- record that hash with any measurement made under it`)
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args, exec) {
      // THE CALLER'S CANCELLATION, HONOURED BEFORE ANY WORK. `reference/cookbook/adding-a-tool.md:49` requires it:
      // "honour `exec.signal`; cancel in-flight work when it fires". What this tool does cannot be interrupted mid-flight, so the entry check is the
      // honest maximum -- stated here rather than implied by silence.
      if (exec?.signal?.aborted === true) throw new Error('the call was cancelled before it started')

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
      if (name === '' && action !== 'lint') return fail('`set` is required for `' + action + '`: the composition to act on', { ...base, action, dir: directory })

      // LINT COMES BEFORE THE SCOPE GATE, because a whole-composition lint has no single scope. Two routes: inline
      // `specs` for one scope, or every scope of a composition read from disk. Both write nothing.
      if (action === 'lint') {
        if (scope !== '') {
          if (!WRITABLE_SCOPES.includes(scope)) {
            return fail('`' + scope + '` is not a scope a set can be written for (known: ' + WRITABLE_SCOPES.join(', ') + ')', { ...base, action, dir: directory, set: name, scope })
          }
          const inline = lintScope(checked.specs ?? [], scope)
          return {
            action, dir: directory, set: name, scope,
            findings: inline.findings, checked: inline.checked, ok: inline.ok, machineUncovered: [...MACHINE_UNCOVERED],
          }
        }
        if (name === '') return fail('`lint` needs a `scope` with `specs`, or a `set` to read every scope of', { ...base, action, dir: directory })
        const loaded = read(directory, name)
        if (loaded.problem !== null && loaded.problem !== undefined) return fail(loaded.problem, { ...base, action, dir: directory, set: name })
        const whole = lintSelection(loaded.questions)
        return {
          action, dir: directory, set: name, hash: loaded.hash,
          findings: whole.findings, checked: whole.checked, ok: whole.ok, machineUncovered: whole.machineUncovered,
        }
      }

      if (scope === '') return fail('`scope` is required for `' + action + '`: the seam, `turn`, or `session`', { ...base, action, dir: directory, set: name })
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
