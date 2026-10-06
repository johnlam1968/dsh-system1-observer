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
//
// WHAT ARRIVES HERE IS THE INSTRUMENT'S QUESTION GROUP, NOT THE ROW'S CONFIG. Every function below takes
// `{ questions, question, probeQuestion, maxQuestionChars, sets: { dir, name } }` -- PLAIN values, already unwrapped
// -- and the application builds that object from the row (`lib/instrument-input.js`). This module therefore imports
// no config reader: the field names are the knobs an operator can find in the settings card, so a `problem` string
// can still quote the setting to change, but nothing here reaches for a row.
import { PROBE_QUESTION, PROBE_SEAMS } from './seams.js'
import { choice, noul, score } from './model/questions.js'
import { isRecord } from './is-record.js'
import { readSelectedSet, setSettings } from './question-sets.js'

/** The id used in legacy mode, so a trace line never needs a second lookup to know what was asked. */
export const QUESTION_ID = 'probe'

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The `questions` map of the instrument's question group, or `undefined` when it is not one.
 *
 * This does NOT decide the mode: an all-empty object is returned like any other, and `hasSpecs` below is
 * what tells the two modes apart.
 */
export function readQuestionConfig(config) {
  const given = config?.questions
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

/**
 * THE PROBE QUESTION IN FORCE, which is the built-in one unless the row rewords it.
 *
 * WHY THE QUESTION TEXT IS THE PART THAT IS CONFIGURABLE, and the answer is in the code rather than in a preference:
 * `isProbeQuestion` treats the CRITERIA as fixed (a reworded criterion is the same instrument -- only the labels
 * decide what an answer means) while `probeFingerprint` hashes the INSTRUCTIONS. So the question text IS the
 * instrument's identity, and the answer set is not. A deployment whose domain needs the question put differently can
 * say so; it cannot change what an answer means without changing what every calibration in the report measures.
 *
 * ABSENT IS THE BUILT-IN, by reference: the constant itself when nothing is configured, so an unconfigured row is
 * identical to the row before this function existed.
 */
export function probeOf(config) {
    const given = config?.probeQuestion
    if (typeof given !== 'string' || given.trim() === '') {
        // PRESENT BUT UNUSABLE IS A PROBLEM, not silence: an empty string is somebody having cleared the field, and a
        // row that quietly reverted to a question nobody chose is the failure this repository keeps refusing.
        const problem = typeof given === 'string' ? 'probeQuestion: an empty string; the built-in question is in force' : null
        return { question: PROBE_QUESTION, configured: false, instructions: PROBE_QUESTION.instructions, problem }
    }
    const instructions = given.trim()
    return {
        question: Object.assign({}, PROBE_QUESTION, { instructions }),
        configured: true,
        instructions,
        problem: null,
    }
}

/** The legacy question: the global `question` string as a `noul`, else the runtime probe question. */
function legacyQuestion(config) {
  const given = config?.question
  const text = typeof given === 'string' ? given.trim() : ''
  if (text === '') return { questions: { [QUESTION_ID]: probeOf(config).question }, problems: [] }
  try {
    return { questions: { [QUESTION_ID]: noul(text) }, problems: [] }
  } catch (error) {
    // `question` is a non-empty string by construction above, so this cannot fire today. It is here so a
    // future shape change degrades to the probe question instead of into the loop.
    return { questions: { [QUESTION_ID]: probeOf(config).question }, problems: [`question: ${messageOf(error)}`] }
  }
}

/**
 * The question map for ONE seam firing, and the specs that could not be turned into questions.
 *
 * @param config the instrument's QUESTION GROUP, built by `lib/instrument-input.js`; plain values, nothing required
 * @param seam   the seam being observed, so the per-seam map can be read
 * @returns `{ questions, problems }`; an empty `questions` means this seam asks nothing
 */
export function buildQuestions(config, seam) {
  // A SELECTED SET *IS* THE ROW'S QUESTIONS, resolved here so that every caller -- the observation path, the turn
  // trigger, both tools -- inherits it without knowing sets exist. The set replaces `config.questions` wholesale
  // rather than merging: a set that names one seam and inherits another from a profile would describe an experiment
  // nobody wrote down.
  //
  // AND A SEAM THE SET DOES NOT NAME ASKS NOTHING -- it does NOT fall back to the probe question, which is what this
  // comment claimed until a live run measured otherwise (F123). `hasSpecs` is true as soon as ANY scope carries a
  // list, so a set declaring only `session` puts the whole row in PER-SEAM mode: every seam scope asks nothing and
  // records `no question configured for this seam`. Measured with `session@1` selected: 45 such skips and not one
  // probe call. That is the design (the set IS the instrument, so it may not inherit one), but it means selecting a
  // session-only set turns the seam probe OFF, and an operator who wants both needs a set with seam scopes.
  const settings = setSettings(config?.sets)
  const selected = readSelectedSet(settings.dir, settings.name)
  // REFUSE, DO NOT FALL BACK. A row that selected a set and did not get it would be measuring something else under
  // the name of the set -- the failure this register keeps recording. The problem is named and no question is asked.
  if (selected.problem !== null) return { questions: {}, problems: [selected.problem] }
  const effective = selected.questions === null ? config : Object.assign({}, config, { questions: selected.questions })
  return capQuestions(legacyOrConfigured(effective, seam), effective)
}

/**
 * The default cap on the question text, matching the one the sibling plugin refuses at.
 *
 * RAISED FROM 4000 TO 8000 when the agent and operator dimensions were merged into ONE default set: sixteen questions
 * serialize to 5,835 characters and the cap refused them. THE ALTERNATIVE WAS REWRITING THE QUESTIONS, and that is the
 * wrong lever -- a set's hash is what its battery was scored against, so shortening sixteen validated questions to fit
 * under a character cap would have invalidated every score recorded for them and silently changed the instrument.
 *
 * THE CAP STILL DOES ITS JOB: it refuses rather than truncates, because the answer map is keyed by question and a
 * shortened question returns answers that cannot be matched to what was asked. What changed is only the number, and
 * 8,000 characters is about 2,000 tokens against the judge's 32,000-token state budget -- six per cent of the request,
 * which is a fair price for asking both dimensions at once.
 */
export const MAX_QUESTION_CHARS_DEFAULT = 8000

/** The configured cap, or the default. Never `0`: a cap of zero would refuse every question silently. */
export function questionCap(config) {
  const configured = config?.maxQuestionChars
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
 * A union over FIREABLE_HOOKS rather than a per-seam map, because the mount line is one line about the row.
 * Legacy mode is always `[probe]`, which is what the mount line said before this existed.
 */
export function configuredQuestionIds(config) {
  const configured = readQuestionConfig(config)
  if (!hasSpecs(configured)) return [QUESTION_ID]
  const ids = []
  for (const hook of FIREABLE_HOOKS) {
    for (const spec of specsFor(configured, hook)) {
      const id = isRecord(spec) && typeof spec.id === 'string' ? spec.id.trim() : ''
      if (id !== '' && !ids.includes(id)) ids.push(id)
    }
  }
  return ids
}

/**
 * A hook the plugin can ask a question under -- NOT the same list as `PROBE_SEAMS`.
 *
 * `PROBE_SEAMS` is the seams of the agent loop: the places a listener fires. `turn` is a place this plugin asks
 * on a schedule instead, so it is absent from `PROBE_SEAMS` by construction and must be listed here, or the
 * mount line denies the questions the row is configured to ask. Measured before this: a row with twelve
 * questions under `turn` reported `questionIds: []` while every one of them loaded and built.
 *
 * THE DISTINCTION IS THE POINT, and it is why this is not simply "every key". A key outside this list -- a
 * misspelled seam, say -- is a question that will NEVER be asked, and the mount line must not claim it; that is
 * what `configuredQuestionIds` returning `[]` for a typo protects, and the test above still holds it. Listing
 * `turn` here is a claim that code exists to ask it, and the turn trigger is that code.
 */
export const TURN_HOOK = 'turn'
export const FIREABLE_HOOKS = Object.freeze([...PROBE_SEAMS, TURN_HOOK])

/**
 * THE THIRD STATE SCOPE: a whole SESSION, judged on demand rather than at a firing.
 *
 * It is NOT a fireable hook and must not join `FIREABLE_HOOKS` -- nothing fires at `session`; `system1_evaluate_session` asks
 * it when a person or an agent asks for a conversation to be judged (`docs/settings.md` §11). It is a scope for
 * QUESTIONS, which is why it belongs here: the three scopes a set can be written for are one SEAM's text, the
 * MULTI-TURN aggregate, and a SESSION.
 */
export const SESSION_HOOK = 'session'

/**
 * EVERY KEY A ROW'S `questions` MAP MAY CARRY: the nine seams, the aggregate, and the session scope.
 *
 * One list, because the schema declares exactly this set of keys and an undeclared key is DROPPED by `projectForm` --
 * "a stored turn set vanishes the next time any other field is saved" is the failure the schema's own comment records.
 */
export const QUESTION_SCOPES = Object.freeze([...FIREABLE_HOOKS, SESSION_HOOK])
