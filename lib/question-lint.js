/**
 * LINT: the rules in `criteria/_templates/SET-AUTHORING.md` that a machine can check.
 *
 * WHY A LINTER AND NOT MORE PROSE. The authoring guide states the rules; nothing executed them. An agent
 * drafting a question had to read the guide, hold the scope/state table in its head, and then discover the
 * consequences by spending a call -- or, worse, never discover them, because `buildQuestions` refuses a
 * malformed shape but a question naming a section its scope does not emit is perfectly well-formed and
 * perfectly unanswerable. The model answers it confidently either way.
 *
 * WHAT IT DELIBERATELY DOES NOT CLAIM. The guide's central rule -- "Every judgement is ONE narrow question" --
 * is not machine-checkable, and neither is "the criteria are good". `machineUncovered` is returned on every
 * call so a caller can say what a clean report does NOT mean. A linter that implies coverage it lacks is
 * worse than none, because it is believed.
 *
 * @module lib/question-lint
 */
import { TEXTLESS_SEAMS } from './seams.js'
import { buildQuestions } from './questions.js'

/**
 * The section labels the composer actually emits, from `lib/turn-state.js`: the `session` scope carries the
 * first two, the `turn` scope carries the last three. A seam carries NONE of them -- the seam's own text IS
 * the subject, which is why naming a section there is the error this file exists to catch.
 */
export const STATE_SECTIONS = Object.freeze({
  session: Object.freeze(['SESSION TRANSCRIPT', 'TOOL CALLS']),
  turn: Object.freeze(['OPERATOR REQUEST', 'AGENT RESPONSE', 'TOOL CALLS', 'OPERATOR NEXT MESSAGE']),
  seam: Object.freeze([]),
})

const SCOPES = Object.freeze(['assemble', 'admit', 'request', 'draft', 'pre_execute', 'execute', 'post_execute', 'result', 'close', 'turn', 'session'])

/** The scopes a question set may declare, in the order `system1_explain` lists them. */
export const LINT_SCOPES = Object.freeze(SCOPES)

/**
 * The authoring rules NO machine can check. Returned on every lint so a clean report cannot be read as a pass on
 * them: `ok: true` means "nothing mechanically wrong", and the central rule of the guide is not mechanical.
 */
export const MACHINE_UNCOVERED = Object.freeze([
  'whether ONE spec is ONE narrow judgement -- several judgements sharing an id cannot be calibrated, and no string check can see that',
  'whether the criteria or the ladder are the RIGHT ones for the decision',
  'whether the question separates anything -- only a battery with known answers answers that, and lint reads no cases',
])

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Every string a question can put in front of the model: the instruction and every label it carries. */
function questionText(spec) {
  const parts = [spec.instructions]
  if (isRecord(spec.criteria)) parts.push(...Object.values(spec.criteria))
  if (Array.isArray(spec.levels)) parts.push(...spec.levels)
  if (Array.isArray(spec.options)) {
    for (const option of spec.options) {
      if (!isRecord(option)) continue
      parts.push(option.label, option.criterion)
    }
  }
  return parts.filter((part) => typeof part === 'string').join('\n')
}

/** Which STATE_SECTIONS bucket a scope belongs to: a seam carries no named section, `turn` and `session` differ. */
function sectionsFor(scope) {
  if (scope === 'session' || scope === 'turn') return STATE_SECTIONS[scope]
  return STATE_SECTIONS.seam
}

function finding(level, rule, message, spec) {
  return { level, rule, id: isRecord(spec) && typeof spec.id === 'string' ? spec.id : null, message }
}

/**
 * The checks a machine can make on one scope's spec list.
 *
 * @param specList the scope's specs, as authored
 * @param scope the scope those specs answer for
 * @returns `{ scope, findings, checked, ok }` -- `ok` is `true` only when no finding is an `error`
 */
export function lintScope(specList, scope) {
  const specs = Array.isArray(specList) ? specList : []
  const findings = []
  if (!SCOPES.includes(scope)) {
    findings.push(finding('error', 'unknown_scope', `\`${scope}\` is not a scope this row composes (${SCOPES.join(', ')})`, null))
    return { scope, findings, checked: 0, ok: false }
  }
  const textless = TEXTLESS_SEAMS.includes(scope)
  if (textless && specs.length > 0) {
    findings.push(finding('error', 'textless_scope', `\`${scope}\` carries no text at all, so nothing can be asked at it: every question here is unanswerable, and the model will answer it anyway`, null))
  }
  // A PLAIN GROUP OBJECT, AND NOT `questionGroup(...)`. That helper assembles a SEAM's input, and it is what
  // pulled this module -- and therefore the linter -- out of the portable core: `questionGroup` lives in
  // `instrument-input.js`, which imports `host-events.js`, which imports `dsh-session-adapter`. `buildQuestions`
  // needs none of it; it reads the group it is handed. Measured: with this import gone the whole lint surface
  // loads from a directory with no `node_modules` at all, and still folds the loader's complaints in below.
  // THE LOADER'S OWN COMPLAINTS, FOLDED IN, so `lint` is a SUPERSET of `validate` rather than a second opinion that
  // can drift from the first. `buildQuestions` is the check the row itself makes at call time -- a missing abstain
  // option, a one-level ladder, a malformed spec -- so a caller who lints learns all of it in one place.
  if (specs.length > 0) {
    for (const problem of buildQuestions({ questions: { [scope]: specs } }, scope).problems ?? []) {
      findings.push(finding('error', 'loader', problem, null))
    }
  }
  const allowed = sectionsFor(scope)
  const seen = new Set()
  for (const spec of specs) {
    if (!isRecord(spec)) {
      findings.push(finding('error', 'not_an_object', 'a spec is not an object', null))
      continue
    }
    const id = typeof spec.id === 'string' ? spec.id : ''
    if (id !== '' && seen.has(id)) findings.push(finding('error', 'duplicate_id', `id "${id}" is asked twice; a line's answer is read back by id, so two questions under one id cannot be told apart`, spec))
    if (id !== '') seen.add(id)
    if (id !== '' && !/^[a-z][a-z0-9_]*$/.test(id)) {
      findings.push(finding('error', 'id_shape', `id "${id}" is not lowercase snake_case`, spec))
    } else if (id !== '' && !id.startsWith(`${scope}_`)) {
      findings.push(finding('warn', 'id_scope_prefix', `id "${id}" does not start with its scope ("${scope}_"), and the scope prefix is how a reader tells which seam a line belongs to`, spec))
    }
    const text = questionText(spec)
    for (const section of Object.values(STATE_SECTIONS).flat()) {
      if (!text.includes(section)) continue
      if (allowed.includes(section)) continue
      const may = allowed.length === 0
        ? 'nothing by name -- the text IS the subject at a seam'
        : allowed.join(', ')
      findings.push(finding('error', 'scope_state', `names "${section}", which this scope does not emit; \`${scope}\` may name ${may}`, spec))
    }
    if (spec.type === 'noul') {
      const statesPolarity = isRecord(spec.criteria) && typeof spec.criteria.true === 'string' && typeof spec.criteria.false === 'string'
      const words = /\b(is|are|does|do|did|has|have|can|would|should)\b/i.test(String(spec.instructions ?? ''))
      if (!statesPolarity && !words) {
        findings.push(finding('warn', 'polarity_unstated', 'a `noul` whose instruction never reads as a predicate: which answer means true is left to the reader, and a question that reads the same both ways is the shape that cannot be calibrated', spec))
      }
    }
    if (spec.type === 'score' && Array.isArray(spec.levels) && spec.levels.length > 0 && spec.levels.length < 3) {
      findings.push(finding('warn', 'ladder_short', `a ladder of ${spec.levels.length} level(s); the levels are what make a score calibratable, and the guide says three is usually enough`, spec))
    }
  }
  return { scope, findings, checked: specs.length, ok: !findings.some((item) => item.level === 'error') }
}

/**
 * Lint every scope of a loaded selection, and say what was NOT checked.
 *
 * @param questions the selection's `questions` map, scope name to spec list
 * @returns `{ scopes, findings, checked, ok, machineUncovered }`
 */
export function lintSelection(questions) {
  const map = isRecord(questions) ? questions : {}
  const scopes = []
  const findings = []
  for (const scope of SCOPES) {
    if (!Object.hasOwn(map, scope)) continue
    const result = lintScope(map[scope], scope)
    scopes.push(result)
    findings.push(...result.findings)
  }
  for (const scope of Object.keys(map)) {
    if (!SCOPES.includes(scope)) findings.push(finding('error', 'unknown_scope', `\`${scope}\` is not a scope this row composes`, null))
  }
  return {
    scopes,
    findings,
    checked: scopes.reduce((sum, scope) => sum + scope.checked, 0),
    ok: !findings.some((item) => item.level === 'error'),
    machineUncovered: [...MACHINE_UNCOVERED],
  }
}
