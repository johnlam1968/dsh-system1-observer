// WHAT THE OBSERVER ASKS, in one place.
//
// TWO MODES, and the mode is decided by the CONTENT of `questions`, never by a marker field:
//
//   LEGACY (no seam carries a spec): the runtime's OWN probe question, or the global `question` string
//   compiled to a `noul`. This is what a row that has never been edited does, so adding the per-seam map
//   changes nothing about an existing install.
//
//   PER-SEAM (at least one seam carries a spec): the question(s) authored for THAT seam. A seam with no
//   spec -- absent, or an empty list -- asks NOTHING and records a skip.
//
// WHY NOT A MARKER FIELD, and this cost a measurement to learn: schemastery MATERIALISES an optional
// object, so an unset `questions` does not resolve to `undefined` -- it resolves to
// `{assemble: [], admit: [], request: [], draft: []}`, every declared key present and empty. Presence of
// keys therefore cannot tell "never configured" from "configured, ask nothing", and a marker key would be
// a second field that a hand-edited YAML can set inconsistently with the specs beside it. Deriving the
// mode from the specs themselves cannot disagree with them.
//
// The cost of that choice, stated plainly: a config with EVERY seam empty is indistinguishable from no
// config at all, so "observe nothing anywhere" is spelled by disabling the row or by removing the seams
// from `hooks` -- not here. Deleting the last question reverts every seam to the probe question, which the
// settings card says in as many words.
//
// The default probe question is imported rather than restated: its wording is what makes the answers
// checkable (the seam is known), and a second copy of that text is a second text that drifts.
//
// NOTHING HERE THROWS. `observe` runs in the critical path of every turn, so a malformed spec becomes a
// `problem` string that the caller records on the line; a throw from this module would abort the listener
// and fail the turn, which is the one thing this plugin must never do.
import { PROBE_QUESTION, PROBE_SEAMS } from './seams.js'
import { choice, noul, score } from './model/questions.js'
import { isRecord } from './is-record.js'
import { readConfigValue } from './config-value.js'

/** The id used in legacy mode, so a trace line never needs a second lookup to know what was asked. */
export const QUESTION_ID = 'probe'

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The `questions` config as an object, or `undefined` when it is not one.
 *
 * This does NOT decide the mode: an all-empty object is returned like any other, and `hasSpecs` below is
 * what tells the two modes apart.
 */
export function readQuestionConfig(config) {
  const given = readConfigValue(config?.questions)
  return isRecord(given) ? given : undefined
}

/**
 * Whether ANY key carries at least one spec -- the whole of the legacy/per-seam decision.
 *
 * ANY KEY, not just a declared seam, and that is deliberate: a hand-edited YAML naming `admti` instead of
 * `admit` is a question the operator believes they configured. Counting only declared seams would read
 * that file as "no config at all" and ask the probe question everywhere -- the question the operator
 * thought they had replaced -- and nothing in the trace would say so. This way the row takes the config
 * seriously, asks nothing at the seams it cannot match, and says `no question configured for this seam`.
 */
export function hasSpecs(configured) {
  if (configured === undefined) return false
  return Object.values(configured).some(value => Array.isArray(value) && value.length > 0)
}

/** The specs authored for one seam; `[]` when the seam carries none. */
function specsFor(configured, seam) {
  const given = configured?.[seam]
  return Array.isArray(given) ? given : []
}

/**
 * One stored spec -> one `Question`, or the reason it cannot be one.
 *
 * The three builders are the runtime's own (`lib/model/questions.js`), so the rules that make a question
 * readable -- a non-empty instruction, at least two options, exactly one abstain option, at least two
 * levels -- are enforced in ONE place, and a spec that reaches the model has already passed them. Each
 * throws `QuestionShapeError`, which is caught here and turned into a problem line.
 */
function buildOne(spec, index, seam) {
  const where = `${seam}[${index}]`
  if (!isRecord(spec)) return { reason: `${where} is not an object` }
  const id = typeof spec.id === 'string' ? spec.id.trim() : ''
  if (id === '') return { reason: `${where} needs a non-empty id` }
  try {
    if (spec.type === 'noul') return { id, question: noul(spec.instructions, spec.criteria) }
    if (spec.type === 'choice') return { id, question: choice(spec.instructions, spec.options) }
    if (spec.type === 'score') return { id, question: score(spec.instructions, spec.levels) }
  } catch (error) {
    return { reason: `${where}: ${messageOf(error)}` }
  }
  return { reason: `${where}: unknown type "${String(spec.type)}"` }
}

/** The legacy question: the global `question` string as a `noul`, else the runtime probe question. */
function legacyQuestion(config) {
  const given = readConfigValue(config?.question)
  const text = typeof given === 'string' ? given.trim() : ''
  if (text === '') return { questions: { [QUESTION_ID]: PROBE_QUESTION }, problems: [] }
  try {
    return { questions: { [QUESTION_ID]: noul(text) }, problems: [] }
  } catch (error) {
    // `question` is a non-empty string by construction above, so this cannot fire today. It is here so a
    // future shape change degrades to the probe question instead of into the loop.
    return { questions: { [QUESTION_ID]: PROBE_QUESTION }, problems: [`question: ${messageOf(error)}`] }
  }
}

/**
 * The question map for ONE seam firing, and the specs that could not be turned into questions.
 *
 * @param config the row's config, as Cordis passed it (a plain object; nothing is required)
 * @param seam   the seam being observed, so the per-seam map can be read
 * @returns `{ questions, problems }`; an empty `questions` means this seam asks nothing
 */
export function buildQuestions(config, seam) {
  return capQuestions(legacyOrConfigured(config, seam), config)
}

/** The default cap on the question text, matching the one the sibling plugin refuses at. */
export const MAX_QUESTION_CHARS_DEFAULT = 4000

/** The configured cap, or the default. Never `0`: a cap of zero would refuse every question silently. */
export function questionCap(config) {
  const configured = readConfigValue(config?.maxQuestionChars)
  return typeof configured === 'number' && Number.isFinite(configured) && configured > 0
    ? configured
    : MAX_QUESTION_CHARS_DEFAULT
}

/**
 * REFUSE, DO NOT TRUNCATE, and that is not a style choice.
 *
 * The answer map is keyed by question id, and `narrowAnswers` matches an answer to the question that was asked.
 * A shortened question still produces answers -- keyed to a question the row no longer has -- so the answers come
 * back that cannot be matched to what was asked: a measurement of one thing filed under another. An empty map
 * with a `problems` string says exactly what happened and why, and the per-firing `reason` carries it to the line.
 *
 * The question text was UNBOUNDED until this existed: `maxFieldChars` bounds `state.text` alone, while the
 * instructions, every option label, every criterion and every level went verbatim -- an unbounded per-call spend
 * against the same model whose answers the trace exists to measure.
 */
export function capQuestions(built, config) {
  const cap = questionCap(config)
  const questions = built.questions ?? {}
  const problems = built.problems ?? []
  if (Object.keys(questions).length === 0) return { questions, problems }
  const size = JSON.stringify(questions).length
  if (size <= cap) return { questions, problems }
  return {
    questions: {},
    problems: [...problems, `the configured question text serializes to ${size} characters, over the ${cap}-character cap: refused rather than truncated, because the answer map is keyed by question and a shortened question returns answers that cannot be matched to what was asked`],
  }
}

/** The configured per-seam questions, or the legacy global one. Split out so the cap covers both paths. */
function legacyOrConfigured(config, seam) {
  const configured = readQuestionConfig(config)
  if (!hasSpecs(configured)) return legacyQuestion(config)
  const questions = {}
  const problems = []
  specsFor(configured, seam).forEach((spec, index) => {
    const built = buildOne(spec, index, seam)
    if (built.reason !== undefined) { problems.push(built.reason); return }
    if (Object.hasOwn(questions, built.id)) {
      problems.push(`${seam}[${index}]: duplicate question id "${built.id}"`)
      return
    }
    questions[built.id] = built.question
  })
  return { questions, problems }
}

/**
 * Every question id the config could ask, for the `mount` line's `questionIds`.
 *
 * A union over the seams rather than a per-seam map, because the mount line is one line about the row.
 * Legacy mode is always `[probe]`, which is what the mount line said before this existed.
 */
export function configuredQuestionIds(config) {
  const configured = readQuestionConfig(config)
  if (!hasSpecs(configured)) return [QUESTION_ID]
  const ids = []
  for (const seam of PROBE_SEAMS) {
    for (const spec of specsFor(configured, seam)) {
      const id = isRecord(spec) && typeof spec.id === 'string' ? spec.id.trim() : ''
      if (id !== '' && !ids.includes(id)) ids.push(id)
    }
  }
  return ids
}
