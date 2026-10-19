/**
 * THE ONE SURFACE EVERY CALLER GOES THROUGH: compose a question, list a set, load a set and ask.
 *
 * WHY THIS MODULE EXISTS, and it is the same reason `lib/question-request.js` exists, one level up.
 *
 * A question set has five ways into this repository, and each of them used to answer three questions for itself:
 *
 *   1. `scripts/ask.mjs`                    the standalone
 *   2. `system1_decide`                     the agent tool
 *   3. `system1_battery`                    which SET is this battery measuring
 *   4. `system1_evaluate_session`           which SET judged this session, via the row
 *   5. the seam path in `lib/observe.js`    which questions watched this hook
 *
 * Five copies of "where do the questions come from, are they well formed, and how do they read". They were each
 * correct, and they disagreed: the battery hand-rolled the named-set branch that `question-request.js` already owned,
 * the standalone listed sets in a shape the `question_sets` tool did not produce, and the DSL reached only two of the
 * five. That is the arrangement this repository has recorded as a defect more than once -- two copies of a rule are
 * each correct and diverge later -- and the divergence is silent, because each copy answers its own caller well.
 *
 * So there are THREE operations, and they are these three:
 *
 *   {@link composeQuestions}  compose and lint questions, from DSL strings, inline JSON, or a stored set
 *   {@link listQuestionSets}  what sets exist, in one shape every caller renders the same way
 *   {@link askQuestions}      load a set (or an inline list) and call the model with it
 *
 * AND THE FOUR SURFACES ARE NOW THIN. What differs between them is not the rules -- it is the trace (some surfaces
 * record, some do not), the subject (a session, a seam's state, a pasted article, a URL) and the transport (the row
 * supplies one, the standalone builds one). Those are the three legitimate differences, and a caller wanting a fourth
 * difference should add it here and nowhere else.
 *
 * @module lib/system1
 */
import { isRecord } from './is-record.js'
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveQuestions, renderAnswerLines } from './question-request.js'
import { lintScope, lintSelection, MACHINE_UNCOVERED, SEAM_SCOPES } from './question-lint.js'
import { listSets, readSelectedSet, SET_SUFFIX } from './question-sets.js'
import { buildQuestions } from './questions.js'
import { createModel } from './model/client.js'

/**
 * THE SCOPE OF A CALLER THAT IS NOT A SEAM. A pasted article, a URL, a file, stdin: none of them is a point in an
 * agent loop. It was already this value inside the resolver before it was a NAME in the lint table, which is exactly
 * why the loader never objected to it and the vocabulary never noticed.
 */
const NON_SEAM_SCOPE = 'call'

/**
 * COMPOSE AND LINT. One question, or a set of them, from whichever route the caller has -- DSL strings, inline JSON,
 * or a stored set by name -- checked against the authoring rules and handed back ready to ask.
 *
 * LINT IS PART OF COMPOSING, not a separate tool, because a question that is well formed and a question that is any
 * good are different questions and only the first one can be checked mechanically. The rules no machine can check are
 * returned alongside, so a clean report cannot read as a pass on the judgement.
 *
 * @param input.question DSL strings, one per question
 * @param input.specs inline specs as JSON (`questions`, under the tools' name, is the same route)
 * @param input.set a stored composition's name
 * @param input.scope the scope to build at; defaults to the only scope a set declares
 * @param input.setsDir where `set` is read from
 * @param input.wrap `(specs, scope) => group`, for a caller whose loader wants a group rather than a map
 * @param input.isSeam true only for a caller that is a seam, which may then name a seam scope
 * @returns {{ok: true, questions, ids, specs, source, setLabel, setHash, lint} | {ok: false, reason}}
 */
export function composeQuestions(input = {}) {
  // A PRE-BUILT GROUP. The seam is handed one already assembled by `lib/instrument-input.js`, carrying the set
  // location with the questions -- so it hands THAT over rather than specs to rebuild, and asking a seam is the same
  // call as asking anything else. Rebuilding it here from re-derived specs is how a question silently changed shape
  // on the way to a seam.
  if (isRecord(input.group)) {
    const scope = input.scope === null || input.scope === undefined ? '' : String(input.scope).trim()
    const built = buildQuestions(input.group, scope)
    // A PARTLY BROKEN GROUP IS NOT A FAILED ONE. A config where one spec is unusable must still ask the others --
    // refusing outright would leave a seam silent because of a typo in a question nobody was measuring -- so the
    // questions that built are returned WITH the problems, and the caller records them. This is the same rule
    // `lib/observe.js` already kept, and moving it here is how the seam kept it.
    if (built.problems.length > 0 && Object.keys(built.questions).length === 0) return { ok: false, reason: built.problems[0] }
    return {
      ok: true,
      questions: built.questions,
      problems: built.problems ?? [],
      ids: Object.keys(built.questions),
      specs: [],
      source: 'group',
      setLabel: null,
      setHash: null,
      scope,
      lint: { ok: true, checked: 0, scopes: scope === '' ? [] : [scope], findings: [], machineUncovered: MACHINE_UNCOVERED },
    }
  }
  const resolved = resolveQuestions(input)
  if (!resolved.ok) return { ok: false, reason: resolved.reason }
  // LINT WHAT WAS ASKED FOR, and what was ASKED FOR rather than what was handed over: a set read from disk was
  // linted when it was written, and re-linting a stored scope at a scope it was not written for would report a
  // fault in a composition that is fine.
  // A CALLER THAT DID NOT CHOOSE A SCOPE PASSES `null`, and `String(null)` is the four characters "null" -- which
  // the loader then helpfully reports as a scope nobody wrote. The default has to be chosen BEFORE the cast.
  const asked = input.scope === null || input.scope === undefined ? '' : String(input.scope).trim()
  const scope = asked !== '' ? asked : scopeOf(resolved)
  // AND A CALLER THAT IS NOT A SEAM MAY NOT NAME ONE **FOR QUESTIONS IT COMPOSES**. This is the rule the vocabulary
  // leaked through, stated rather than assumed: `ask.mjs` has no operator, no loop and no step, so `--scope draft`
  // would be a claim about where in somebody else's agent loop this question sits -- a lie that reads as metadata.
  //
  // IT IS ABOUT COMPOSING, NOT ABOUT READING, and the distinction is the whole thing. `resolved.source === 'set'`
  // means the scope was chosen by whoever WROTE that set, and the reader did not choose it and cannot rename it:
  // `system1_decide { set: 'news-claim-check@2', scope: 'admit' }` asks a set written for a seam, from a tool that is
  // not one, and that is correct -- the set is about a seam's job and the agent is running that job. Refusing it would
  // ban the one reading the repository exists to do. What is banned is a non-seam caller NAMING a seam for new
  // questions it is inventing.
  const composing = resolved.source !== 'set'
  if (composing && asked !== '' && asked !== NON_SEAM_SCOPE && input.isSeam !== true) {
    return { ok: false, reason: `\`${asked}\` is a SEAM scope -- a point in the agent loop -- and this caller composes questions rather than asking at a seam. Use \`call\`, or \`${SEAM_SCOPES.join('`, `')}\` if the caller is a seam (pass \`isSeam: true\`)` }
  }
  // THE SPECS THE LINTER READS ARE THE ONES THE CALLER HANDED OVER, for both routes. Linting the built questions
  // instead would read a choice's `criteria` map where the rule expects an `options` list, and report faults that
  // are not in the file.
  const lint = resolved.source === 'set'
    ? lintSelection({ [scope]: resolved.specs })
    : lintScope(resolved.specs, scope)
  return {
    ok: true,
    questions: resolved.questions,
    ids: resolved.ids,
    specs: resolved.specs,
    source: resolved.source,
    setLabel: resolved.setLabel,
    setHash: resolved.setHash,
    scope,
    scales: scoreScales(resolved.questions),
    lint,
  }
}

/**
 * COMPOSE A SET ONTO DISK. Operation two's other half: `composeQuestions` says whether the questions are any good,
 * and this says where they become a composition anybody can name.
 *
 * THE REFUSALS ARE THE POINT, and all of them happen BEFORE the filesystem is touched:
 *
 *   a scope no set can be written for        -- it would be a file no reader looks for
 *   specs the loader refuses                 -- a broken instrument stored under a good name is worse than none
 *   a composition that is a flat FILE        -- writing beside it would produce a set of two shapes
 *   an existing scope file, without `replace` -- a set is identified by the hash of its bytes, and that hash is on
 *                                               the mount line, so rewriting one makes every earlier run
 *                                               incomparable with every later one. Write `@next` instead.
 *
 * AND IT READS BACK, so the hash in the answer is an observation of what is on disk rather than an intention.
 *
 * @returns `{ok: true, written, hash, created, replaced}` or `{ok: false, reason}`
 */
export function writeQuestionSet({ dir, name, scope, specs, replace = false, validate, isSeam = false, exists = defaultExists, writeText = defaultWriteText, mkdir = defaultMkdir, isDirectory = defaultIsDirectory } = {}) {
  const where = String(dir ?? '')
  if (where === '') return { ok: false, reason: 'no question-set directory was given' }
  if (typeof name !== 'string' || name.trim() === '') return { ok: false, reason: '`name` is required: the composition to create' }
  if (typeof validate !== 'function') return { ok: false, reason: '`validate` is required: a composition is never written unvalidated' }
  const setName = name.trim()
  const scopeName = String(scope ?? '').trim()
  if (!WRITABLE_SCOPES.includes(scopeName)) {
    return { ok: false, reason: `\`${scopeName}\` is not a scope a set can be written for (known: ${WRITABLE_SCOPES.join(', ')})` }
  }
  // STORING AT A SEAM SCOPE IS COMPOSING FOR THAT SEAM. The same rule as the resolver, at the only place a name
  // becomes permanent: a stored set carries its scope forever, so a mistake here is not corrected by the next read.
  if (scopeName !== NON_SEAM_SCOPE && scopeName !== 'session' && scopeName !== 'turn' && isSeam !== true) {
    return { ok: false, reason: `\`${scopeName}\` is a SEAM scope. Write this set at \`call\`, or pass \`isSeam: true\` from a caller that is asking at that point of the agent loop` }
  }
  const problems = validate(scopeName, specs)
  if (problems.length > 0) return { ok: false, reason: problems.join('; ') }

  const targetDir = join(where, setName)
  let created = false
  // A NEW COMPOSITION IS CREATED, not refused. Its own refusal used to advise "create it by writing its first scope
  // file under that exact name" while refusing exactly that -- and creating a directory cannot damage an existing set,
  // so this is also the honest default for a revision: `@next` is one write away.
  if (!exists(targetDir)) {
    try {
      mkdir(targetDir, { recursive: true })
      created = true
    } catch (error) {
      return { ok: false, reason: `cannot create ${targetDir}: ${message(error)}` }
    }
  } else if (!isDirectory(targetDir)) {
    return { ok: false, reason: `${targetDir} is a flat set file, not a composition directory: write a flat file with your own editor, or make a composition directory` }
  }
  const file = join(targetDir, scopeName + SET_SUFFIX)
  const replaced = existsSync(file)
  if (replaced && replace !== true) {
    return {
      ok: false,
      reason: `${file} already exists. A set is identified by the hash of its bytes and that hash is on the mount line, so rewriting it makes every earlier run incomparable with every later one. Either replace it knowing that, or write a NEW composition (a new directory, e.g. \`${setName.replace(/@[0-9]+$/, '')}@next\`) so the previous instrument keeps its name`,
    }
  }
  try {
    writeText(file, JSON.stringify(specs, null, 2) + '\n')
  } catch (error) {
    return { ok: false, reason: `cannot write ${file}: ${message(error)}` }
  }
  const after = readSelectedSet(where, setName)
  if (after.problem !== null) return { ok: false, reason: `wrote ${file} and then could not read it back: ${after.problem}` }
  return { ok: true, written: file, hash: after.hash, created, replaced, setName, scope: scopeName }
}

/**
 * The scopes a set may be written for. Re-exported here so the writer carries its own rule rather than being told it.
 *
 * `call` IS IN IT, and FIRST, because it is the scope a standalone run uses and it is the only one that needs no
 * harness to mean anything. The rest are the agent loop's own points plus the two aggregate scopes; a caller that owns
 * one of those passes it, and nobody else does.
 */
export const WRITABLE_SCOPES = Object.freeze(['call', 'assemble', 'admit', 'request', 'draft', 'pre_execute', 'execute', 'post_execute', 'result', 'close', 'turn', 'session'])

const message = (error) => (error instanceof Error ? error.message : String(error))

// THE FILESYSTEM, BEHIND FOUR DOORS. `system1_question_sets` injects its own `exists` and `writeText` so a test can
// drive the refusals without touching a disk, and the first version of this writer used `node:fs` directly -- which
// meant every one of those injected refusals was quietly bypassed and two tests found it. A shared writer that is not
// still writable by its caller is not shared; it is a second implementation that happens to sit in a better place.
const defaultExists = (path) => existsSync(path)
const defaultWriteText = (file, text) => writeFileSync(file, text)
const defaultMkdir = (path) => mkdirSync(path, { recursive: true })
const defaultIsDirectory = (path) => statSync(path).isDirectory()

/** LIST, in one shape every caller renders the same way. */
export function listQuestionSets(dir, wanted = null) {
  const where = String(dir ?? '')
  if (where === '') return { ok: false, reason: 'no `questionSetsDir` is configured' }
  const listed = wanted === null ? listSets(where) : readSelectedSet(where, wanted)
  if (listed.problem !== null) return { ok: false, reason: listed.problem }
  if (wanted !== null) {
    return {
      ok: true,
      sets: [{ name: wanted, hash: listed.hash, seams: Object.keys(listed.questions ?? {}) }],
    }
  }
  return {
    ok: true,
    // THE ROWS, NOT THE RAW READER'S. `listSets` returns a reader record carrying paths and problems, and a caller
    // that renders it has to decide which of those to show -- which is how the standalone and the tool ended up
    // printing different things about the same set. What a LIST is for is name, hash and scope.
    sets: listed.sets.map((row) => ({
      name: row.name,
      // `kind` IS CARRIED, because `system1_question_sets list` publishes it and a reader is entitled to the same
      // fields the tool printed before the two were routed through one place.
      ...(row.kind === null || row.kind === undefined ? {} : { kind: row.kind }),
      hash: row.hash,
      seams: row.seams ?? Object.keys(row.scopes ?? {}),
      ...(row.appliesTo === null || row.appliesTo === undefined ? {} : { appliesTo: row.appliesTo }),
      ...(row.problem === null || row.problem === undefined ? {} : { problem: row.problem }),
    })),
  }
}

/**
 * LOAD A SET AND ASK. The whole of operation three: resolve, call, and hand back the answers with their provenance.
 *
 * `transport` is `{decide(request) => result}` rather than a model, because the row's transport can be a seam's
 * subject and records its own trace lines, while the standalone builds one from a URL and a key. Same call, one
 * place that makes it.
 *
 * @param input the same fields {@link composeQuestions} takes, plus `state`
 * @param transport `{decide}` -- required, so no surface can accidentally reach a model by a route of its own
 * @returns `{ok: true, result, envelope, questions, ids, setLabel, setHash, source} | {ok: false, reason}`
 */
export async function askQuestions(input = {}, transport) {
  if (!isRecord(transport) || typeof transport.decide !== 'function') {
    throw new Error('askQuestions needs a transport with a `decide` method: no surface may reach a model by a route of its own')
  }
  const composed = composeQuestions(input)
  if (!composed.ok) return composed
  const value = await transport.decide({ state: input.state, questions: composed.questions })
  return {
    ok: true,
    result: value,
    envelope: isRecord(value) && isRecord(value.envelope) ? value.envelope : {},
    questions: composed.questions,
    ids: composed.ids,
    setLabel: composed.setLabel,
    setHash: composed.setHash,
    source: composed.source,
    // THE SCALE TRAVELS WITH THE RESULT, so a caller cannot forget it. A caller that has to remember to look it up is
    // a caller that eventually does not, and the symptom is a score printed bare -- which reads as a level and is not.
    scales: composed.scales,
  }
}

/**
 * BUILD A TRANSPORT FROM AN ENDPOINT AND A KEY, for a caller that has no row to inherit one from.
 *
 * The key is read from the environment by its NAME and never taken as an argument: a key on a command line is a key
 * in the shell history, in the process table, and in every `ps` on the host. This is the only place a credential
 * enters the instrument, which is what makes "the instrument holds no secret" checkable rather than aspirational.
 */
export function wireTransport({ baseUrl, model = 'jev-latest', keyEnv = 'OPENROUTER_API_KEY', env = process.env, timeoutMs = 20000, fetch } = {}) {
  const apiKey = env[keyEnv]
  if (typeof apiKey !== 'string' || apiKey.trim() === '') {
    throw new Error(`\`${keyEnv}\` is not set. Export it, or pass a different variable name. A key is never an argument here: it would land in the shell history and in every ps on this host.`)
  }
  const client = createModel({ baseUrl, model, apiKey, timeoutMs, ...(fetch ? { fetch } : {}) })
  return { decide: (request) => client.decide(request), baseUrl, model }
}

/** The scope a resolved set was read at, when the caller did not say. */
function scopeOf(resolved) {
  return resolved.setLabel === null ? 'call' : String(resolved.setLabel).split('/').slice(1).join('/')
}

/**
 * `{id: topLevel}` for every `score` question, so a render can print `1.85 of 2` rather than a bare number.
 *
 * IT LIVES HERE rather than in `evaluate-tool.js`, because the standalone rendered `0.39` bare while the row rendered
 * `1.85 of 2` -- the same answer read two ways, and a reader comparing them would have to know which tool they came
 * from. That is the arrangement this module exists to end.
 *
 * @param questions the BUILT questions, keyed by id
 * @returns {Record<string, number>} id to the highest level index
 */
export function scoreScales(questions) {
  const out = {}
  for (const [id, question] of Object.entries(questions ?? {})) {
    if (question?.type !== 'score') continue
    // BOTH SHAPES, because this function is called with either -- and for a YEAR it was called with only one and
    // therefore matched only one. The loader TURNS `levels` into `criteria` (a built score carries
    // `{type, instructions, criteria: [...]}`), so reading `levels` here found nothing on the real path and every
    // score rendered as a bare number: `0.45`, meaning somewhere between levels 0 and 1, read as "nearly level 1".
    //
    // The unit test did not catch it because it INJECTED a questions object in the SPEC shape, so it agreed with the
    // stub and not with the loader. What proves this is a spec that has been through `buildQuestions` and no further.
    const levels = Array.isArray(question.levels) ? question.levels : question.criteria
    if (Array.isArray(levels) && levels.length > 1) out[id] = levels.length - 1
  }
  return out
}

/** The lint rules this repository cannot check, exported so a caller renders them beside a clean report. */
export { MACHINE_UNCOVERED, renderAnswerLines }
