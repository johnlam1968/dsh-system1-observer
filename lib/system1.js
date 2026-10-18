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
import { resolveQuestions, renderAnswerLines } from './question-request.js'
import { lintScope, lintSelection, MACHINE_UNCOVERED } from './question-lint.js'
import { listSets, readSelectedSet } from './question-sets.js'
import { buildQuestions } from './questions.js'
import { createModel } from './model/client.js'

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
    lint,
  }
}

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

/** The lint rules this repository cannot check, exported so a caller renders them beside a clean report. */
export { MACHINE_UNCOVERED, renderAnswerLines }
