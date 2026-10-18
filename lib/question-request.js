/**
 * THE ONE PATH FROM A QUESTION SET TO ANSWERS, shared by the agent tool and the standalone script.
 *
 * WHY THIS IS A MODULE AND NOT A CONVENTION. `system1_decide` and `scripts/ask.mjs` were written separately and
 * agreed by eye, which is the arrangement this repository keeps recording as a defect: two copies of the same rule
 * are each correct and disagree later. They disagreed here twice already -- the tool took `questions` and a set by
 * `set`, the script took a set by name and inline specs by JSON -- and the DSL arrived with only one of them.
 *
 * So both now ask this module the same three questions, in the same words, and get the same refusal:
 *
 *   WHERE DO THE QUESTIONS COME FROM?   a stored set by NAME, a list of DSL STRINGS, or inline specs
 *   ARE THEY WELL FORMED?               the loader decides, and this passes its answer on
 *   HOW DO THEY READ?                   one renderer, so a question reads the same wherever it was asked
 *
 * AND THE CALL ITSELF WAS ALREADY SHARED, which is worth saying because it is the part that costs money:
 * `lib/model/client.js` builds the request and narrows the reply, and both callers reach it. `system1_decide` takes a
 * `decide` injected by the row (so a profile's own transport and trace apply); `scripts/ask.mjs` builds one from a
 * `baseUrl`, a `model` and an `apiKey`. Same module, same wire, same refusals -- one difference, and it is deliberate:
 * the tool's transport can be a seam's subject, so it wraps its inline specs in the observer's question group, while
 * the script has no seam and passes the group through.
 *
 * @module lib/question-request
 */
import { isRecord } from './is-record.js'
import { readSelectedSet } from './question-sets.js'
import { buildQuestions } from './questions.js'
import { parseQuestions } from './question-dsl.js'

/**
 * Resolve questions from whichever of the three routes the caller used.
 *
 * REFUSES RATHER THAN CHOOSES between routes that disagree, and names the route. A stored set beside an inline list
 * can say two different things about the same question, and nothing in the record would show which one was asked.
 *
 * @param input.set a stored composition's name
 * @param input.scope which scope of it; defaults to the only one it declares
 * @param input.specs inline specs, as JSON (`questions`, under the tool's name, is the same route)
 * @param input.question inline specs, as DSL strings (one per element)
 * @param input.setsDir where `set` is read from
 * @param input.wrap `(specs, scope) => group` for a caller whose loader wants a group rather than a map
 * @returns `{ok: true, questions, ids, source, setLabel, setHash}` or `{ok: false, reason}`
 */
export function resolveQuestions({ set, scope, specs, questions, question, setsDir = () => '', wrap = (list) => ({ questions: { [TOOL_SCOPE]: list } }) } = {}) {
  const named = typeof set === 'string' ? set.trim() : ''
  const strings = Array.isArray(question) ? question.filter((entry) => typeof entry === 'string' && entry.trim() !== '') : []
  // `specs` AND `questions` ARE THE SAME ROUTE under two names: `system1_question_sets` has always called the inline
  // list `specs`, and `system1_decide` has always called it `questions`. A shared module that made every caller
  // translate into its own vocabulary would be a shared module with two names to keep straight -- so it accepts both
  // and the PUBLIC parameter of each tool keeps the name that tool already announced.
  const raw = specs ?? questions
  const label = specs === undefined ? '`questions`' : '`specs`'
  // A route is COUNTED BEFORE IT IS READ, so an unusable value -- a string, a number, null -- is a route given and
  // then refused by name, rather than the absence of a route and a different message entirely.
  let listed = false
  if (raw !== undefined && raw !== null) {
    if (Array.isArray(raw) && raw.length === 0) listed = false
    else if (isRecord(raw) && Object.keys(raw).length === 0) listed = false
    else listed = true
  }
  const routes = [named !== '' ? '`set`' : null, strings.length > 0 ? '`question`' : null, listed ? label : null].filter(Boolean)
  if (routes.length === 0) {
    return {
      ok: false,
      reason: 'give `set` (a stored question set), `question` (one question per string), or `specs` (inline JSON). Composing and storing first is what survives the tool-call boundary',
    }
  }
  if (routes.length > 1) {
    return { ok: false, reason: `give one of \`set\`, \`question\` or \`specs\`, not several (${routes.join(' and ')}): two forms of the same question can disagree, and nothing in the record would show it` }
  }

  if (named !== '') {
    const where = String(setsDir() ?? '')
    if (where === '') return { ok: false, reason: 'no question-set directory is configured, so `set` cannot be read' }
    const selected = readSelectedSet(where, named)
    if (selected.problem !== null) return { ok: false, reason: selected.problem }
    const scopes = Object.keys(selected.questions ?? {})
    const asked = typeof scope === 'string' ? scope.trim() : ''
    const chosen = asked !== '' ? asked : (scopes.length === 1 ? scopes[0] : '')
    if (chosen === '') return { ok: false, reason: `\`scope\` is required: \`${named}\` declares ${scopes.length === 0 ? 'no scopes' : scopes.join(', ')}` }
    if (!scopes.includes(chosen)) return { ok: false, reason: `\`${chosen}\` is not a scope \`${named}\` declares (${scopes.join(', ')})` }
    // A STORED SET IS NOT REBUILT. It was built and validated when it was composed, and building a built question
    // again would run a choice's `criteria` map back through a builder that expects `options`.
    const built = buildQuestions({ questions: { [chosen]: selected.questions[chosen] } }, chosen)
    if (built.problems.length > 0) return { ok: false, reason: built.problems[0] }
    const ids = Object.keys(built.questions)
    if (ids.length === 0) return { ok: false, reason: `\`${named}/${chosen}\` asks nothing, so there is nothing to ask` }
    // THE SPECS AS STORED, beside the questions built from them. A linter must read the SOURCE: a built choice
    // carries `criteria`, a map, where the spec carries `options`, a list -- so linting the built form reports
    // faults that are not in the file, and would call a composition nobody touched a broken one.
    return { ok: true, questions: built.questions, ids, specs: selected.questions[chosen], source: 'set', setLabel: `${named}/${chosen}`, setHash: selected.hash }
  }

  // ONE ROUTE IS READ, and the other two are not looked at. `readSpecs(undefined)` is a refusal about a parameter the
  // caller never sent, which is how taking the DSL route came to fail until this was read through.
  let list
  let source = 'specs'
  try {
    if (strings.length > 0) {
      list = parseQuestions(strings)
      source = 'question'
    } else {
      list = readSpecs(raw, label)
    }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
  const built = buildQuestions(wrap(list, TOOL_SCOPE), TOOL_SCOPE)
  if (built.problems.length > 0) return { ok: false, reason: built.problems[0] }
  const ids = Object.keys(built.questions)
  if (ids.length === 0) return { ok: false, reason: 'the question set is empty, so there is nothing to ask' }
  return { ok: true, questions: built.questions, ids, specs: list, source, setLabel: null, setHash: null }
}

/**
 * The specs a caller handed us: an array, or a map from id to spec.
 *
 * A map is accepted because a hand-written call is easier as one, and an array because that is what a set file holds.
 * Nothing else is accepted, and a value that is neither is refused BY NAME rather than silently empty -- an empty set
 * is the state that asks nothing and looks like an answer.
 *
 * THIS LIVED IN `decide-tool.js` and was reached through the shared module, which meant the shared path did not
 * include it and the MAP FORM stopped working the moment the resolution moved. A route that only some callers get is
 * not a shared route.
 *
 * @param value the `questions` argument, as an array or a map
 * @param label the caller's name for the parameter, so the refusal names the caller's own word
 * @returns {object[]} specs
 */
export function readSpecs(value, label = '`questions`') {
  if (Array.isArray(value)) return value
  if (isRecord(value)) {
    return Object.entries(value).map(([id, spec]) =>
      isRecord(spec) && typeof spec.id === 'string' && spec.id.trim() !== '' ? spec : { ...(isRecord(spec) ? spec : {}), id },
    )
  }
  throw new Error(`${label} must be an array of specs or a map from id to spec.`)
}

/** The seam name used when a caller has no scope of its own. The loader needs one, and only the SHAPE matters here. */
const TOOL_SCOPE = 'call'

/**
 * Render answers the same way for every caller, so a question reads the same whoever asked it.
 *
 * ONE LINE PER ANSWER, and the field that distinguishes the primitives is the one that varies: a choice is a label and
 * ITS probability rather than the label alone, a score is a level, a noul is its probability. A renderer that printed
 * one of those three the way it prints the other two would be the sort of quiet disagreement this module exists to end.
 *
 * @param answers the narrowed answers, keyed by question id
 * @returns {string[]} one line per question, without a trailing newline
 */
export function renderAnswerLines(answers, scales = {}) {
  const rows = []
  const widest = Math.max(0, ...Object.keys(answers ?? {}).map((id) => id.length))
  for (const [id, value] of Object.entries(answers ?? {})) {
    rows.push(`${id.padEnd(widest)}  ${renderOne(value, scales[id])}`)
  }
  return rows
}

/** One answer, as a short human string. An unreadable answer says WHY rather than printing its shape. */
function renderOne(value, topLevel) {
  if (!isRecord(value)) return JSON.stringify(value)
  if (value.type === 'unreadable') return `unreadable — ${String(value.reason ?? 'no reason given')}`
  if (value.type === 'choice') {
    const shown = isRecord(value.probabilities) ? value.probabilities[value.label] : undefined
    return shown === undefined
      ? String(value.label)
      : `${value.label}  (p=${Number(shown).toFixed(3)})`
  }
  if (value.type === 'score') {
    // `of N` IS NOT DECORATION. A score is an EXPECTED VALUE, not a level: measured live, a three-level ladder
    // returned `level: 0.82` with `probabilities {0: 0, 1: 0.23, 2: 0.77}` -- the mean, while the mode is 2. Printed
    // bare, `0.82` reads as "nearly level 1". `scoreScales` (in `lib/system1.js`, so both surfaces use it) supplies
    // the top level.
    const of = typeof topLevel === 'number' && topLevel > 0 ? ` of ${topLevel}` : ''
    return `${value.level}${of}  (confidence ${value.confidence ?? 'n/a'})`
  }
  if (value.type === 'noul') return `${value.probability}  (p=true${value.confidence === undefined ? '' : `, confidence ${value.confidence}`})`
  return JSON.stringify(value)
}
