// THE LABELLED BATTERY: the only thing that can tell a BETTER question from a DIFFERENT one.
//
// WHY THIS EXISTS, in the words of the review that named the trap (ROADMAP §13.5): rewriting a question *because* its
// answers did not separate is symptom treatment, and rewriting *until* something separates is the garden of Eden --
// the surviving number is conditioned on having searched until separation appeared. `system1_measurements` can say
// "these two sets answer differently". Nothing in this repository could say which one is RIGHT, because nothing held
// a case whose answer was known BEFORE the rewrite.
//
// A CASE IS A STATE AND WHAT THE ANSWER TO IT SHOULD BE. `{ id, state, expected }` -- `state` is the text a judge is
// shown, and `expected` is keyed by question id, so one battery can score a whole composition. The labels are written
// by a person and must be written BEFORE the run they judge; nothing here can check when a file was authored, which
// is why the run line records the battery's PATH AND HASH rather than trusting the order of events.
//
// WHAT IT REFUSES, and each refusal is a way a battery could flatter a question instead of measuring it:
//   * FEWER THAN `MIN_CASES` CASES. A rate over three cases is not a rate; four correct out of five is the smallest
//     battery whose accuracy can move at all without being a coin toss dressed as a measurement.
//   * A CASE WITH NO `expected`, because a case nothing is expected of cannot be wrong.
//   * AN EXPECTATION FOR A QUESTION THE SET DOES NOT ASK (`checkBattery`), because it would be scored as a permanent
//     miss by a battery that never had a chance to be right -- a number about the battery, filed as a number about
//     the question.
//   * A QUESTION THE BATTERY DOES NOT COVER, reported rather than ignored: a question with no cases has no accuracy,
//     and an unreported absence reads as a pass.
//   * A TYPE MISMATCH between the expectation and the question (`isCorrect`): `true`/`false` for a `noul`, a label for
//     a `choice`, a level text for a `score`. Anything else is refused by name rather than counted wrong.
//
// IT IS PURE. Reading, checking and scoring take values and return values; the model calls belong to the tool that
// owns them (`lib/battery-tool.js`), so every rule here is testable without a harness and without a backend.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

/** A battery is ONE file: cases are a list, and a list does not need a directory of its own. */
export const BATTERY_SUFFIX = '.battery.json'

/**
 * THE FLOOR. Below this a rate is not reportable, and the number matches the one the measurements view uses for the
 * same reason (`lib/results-tool.js`'s `MIN_N_FOR_RATE`): a proportion over a handful of cases moves by tens of
 * points per case, so publishing it invites a decision it cannot support.
 */
export const MIN_CASES = 5

/** The label a `choice` uses for "none of these fits", which is a legitimate expectation and not a missing one. */
export const ABSTAIN_EXPECTATION = 'unclear'

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/** The battery a file holds, or the reason it is not one. Every problem is a sentence, never a throw. */
export function parseBattery(text, path = '') {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return { battery: null, problem: (path === '' ? 'the battery' : path) + ' is not JSON: ' + messageOf(error) }
  }
  if (!isRecord(parsed)) return { battery: null, problem: 'a battery must be an object with a `cases` array' }
  const cases = parsed.cases
  if (!Array.isArray(cases)) return { battery: null, problem: 'a battery must have a `cases` array' }
  const seen = new Set()
  for (const [index, entry] of cases.entries()) {
    if (!isRecord(entry)) return { battery: null, problem: `cases[${index}] is not an object` }
    const id = typeof entry.id === 'string' ? entry.id.trim() : ''
    if (id === '') return { battery: null, problem: `cases[${index}] needs a non-empty id` }
    if (seen.has(id)) return { battery: null, problem: `two cases share the id "${id}": a case must be identifiable to be argued about` }
    seen.add(id)
    if (typeof entry.state !== 'string' || entry.state.trim() === '') {
      return { battery: null, problem: `case "${id}" has no \`state\`: a case with nothing in it cannot be judged` }
    }
    if (!isRecord(entry.expected) || Object.keys(entry.expected).length === 0) {
      return { battery: null, problem: `case "${id}" has no \`expected\`: a case nothing is expected of cannot be wrong` }
    }
  }
  // THE FLOOR IS CHECKED LAST, so a broken case is reported before a count that would be true of it.
  if (cases.length < MIN_CASES) {
    return { battery: null, problem: `a battery of ${cases.length} case(s) cannot separate a better question from a luckier one: the floor is ${MIN_CASES}` }
  }
  const battery = {
    cases: cases.map((entry) => ({
      id: String(entry.id).trim(),
      state: entry.state,
      expected: { ...entry.expected },
      note: typeof entry.note === 'string' ? entry.note : undefined,
    })),
  }
  if (typeof parsed.appliesTo === 'string') battery.appliesTo = parsed.appliesTo
  if (typeof parsed.rationale === 'string') battery.rationale = parsed.rationale
  return { battery, problem: null }
}

/**
 * A battery's identity, as its own content.
 *
 * HASHED OVER THE CASES AND NOT THE FILE, so a battery that was reformatted or commented is the same instrument while
 * a battery whose STATES OR LABELS changed is not -- and a run line naming this hash says which one produced the
 * number. The rationale and `appliesTo` are outside it, deliberately: they explain a battery rather than measure with
 * it, and the question-set hash draws the same line.
 */
export function batteryHash(battery) {
  const stable = JSON.stringify((battery?.cases ?? []).map((entry) => ({ id: entry.id, state: entry.state, expected: entry.expected })))
  return createHash('sha256').update(stable).digest('hex').slice(0, 12)
}

/** One battery read from a path, or a named problem. Never a throw: the caller is a tool that has to explain itself. */
export function readBatteryFile(path) {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    return { battery: null, path, hash: '', problem: 'cannot read ' + path + ': ' + messageOf(error) }
  }
  const read = parseBattery(text, path)
  return Object.assign({ path, hash: read.battery === null ? '' : batteryHash(read.battery) }, read)
}

/** Every battery in a directory, newest-name-last, each with its case count and coverage. */
export function listBatteries(dir) {
  const where = typeof dir === 'string' ? dir.trim() : ''
  if (where === '') return { batteries: [], problem: 'no battery directory is configured' }
  let names
  try {
    names = readdirSync(where)
  } catch (error) {
    return { batteries: [], problem: 'cannot list ' + where + ': ' + messageOf(error) }
  }
  const batteries = []
  for (const name of names.filter((entry) => entry.endsWith(BATTERY_SUFFIX)).sort()) {
    const path = join(where, name)
    try {
      if (!statSync(path).isFile()) continue
    } catch {
      continue
    }
    const read = readBatteryFile(path)
    const row = {
      name: name.slice(0, name.length - BATTERY_SUFFIX.length),
      path,
      hash: read.hash,
      cases: read.battery === null ? 0 : read.battery.cases.length,
      questions: read.battery === null ? [] : coveredQuestions(read.battery),
    }
    // `problem` IS PRESENT ONLY WHEN THERE IS ONE, so a render cannot mistake `null` for a reason -- which is exactly
    // what the first version did, printing "BROKEN: null" for every working battery.
    if (read.problem !== null) row.problem = read.problem
    batteries.push(row)
  }
  return { batteries, problem: null }
}

/** Every question id the battery holds an expectation for, sorted. */
export function coveredQuestions(battery) {
  const ids = new Set()
  for (const entry of battery?.cases ?? []) for (const id of Object.keys(entry.expected ?? {})) ids.add(id)
  return [...ids].sort()
}

/**
 * A battery against the questions a set actually asks.
 *
 * BOTH DIRECTIONS ARE REFUSED, because both produce a number about the battery filed as a number about the question:
 * an expectation for a question nobody asks is a permanent miss, and a question with no cases is invisible.
 */
export function checkBattery(battery, questionIds) {
  const asked = new Set(Array.isArray(questionIds) ? questionIds.map(String) : [])
  const covered = coveredQuestions(battery)
  const problems = []
  const unexpected = covered.filter((id) => !asked.has(id))
  if (unexpected.length > 0) {
    problems.push('the battery holds expectations for question(s) the set does not ask: ' + unexpected.join(', ') + ' -- they would score as permanent misses')
  }
  const uncovered = [...asked].filter((id) => !covered.includes(id)).sort()
  if (uncovered.length > 0) {
    problems.push('the set asks question(s) the battery does not cover: ' + uncovered.join(', ') + ' -- a question with no cases has no accuracy, and an unreported absence reads as a pass')
  }
  return { problems, unexpected, uncovered, covered }
}

/**
 * WHETHER ONE ANSWER MATCHES WHAT THE CASE SAYS IT SHOULD BE.
 *
 * The expectation's TYPE decides the comparison, and a mismatch is REFUSED rather than counted wrong: a battery that
 * wrote `true` for a `choice` question has not measured anything, and scoring it `false` would report a question as
 * bad when the battery was. An abstain option is a legitimate expectation (`unclear`), which is what stops a battery
 * from punishing a question for refusing to guess.
 */
export function isCorrect(answer, expected) {
  if (answer === null || answer === undefined) return { readable: false, correct: false, reason: 'no answer' }
  const type = answer.type
  if (type === 'unreadable') return { readable: false, correct: false, reason: 'the answer could not be read: ' + String(answer.reason ?? 'no reason') }
  if (type === 'choice') {
    if (typeof expected !== 'string') return { readable: true, correct: false, reason: 'the battery expects ' + JSON.stringify(expected) + ' for a choice; it needs a label' }
    return { readable: true, correct: answer.label === expected, reason: null }
  }
  if (type === 'noul') {
    if (typeof expected !== 'boolean') return { readable: true, correct: false, reason: 'the battery expects ' + JSON.stringify(expected) + ' for a noul; it needs true or false' }
    if (typeof answer.probability !== 'number') return { readable: false, correct: false, reason: 'the noul carries no probability' }
    return { readable: true, correct: (answer.probability >= 0.5) === expected, reason: null }
  }
  if (type === 'score') {
    // SCORED BY DISTRIBUTION, NOT BY ROUNDING. A score is answered as a probability over ordered levels, so the
    // expected level is right when it is the MOST PROBABLE one -- and `level` is the mean, which rounds a near-tie
    // into a definite answer the model did not give.
    const probabilities = answer.probabilities
    if (!isRecord(probabilities)) return { readable: false, correct: false, reason: 'the score carries no distribution to decide a level from' }
    const ranked = Object.entries(probabilities).sort((a, b) => b[1] - a[1])
    if (ranked.length === 0) return { readable: false, correct: false, reason: 'the score distribution is empty' }
    if (typeof expected !== 'string') return { readable: true, correct: false, reason: 'the battery expects ' + JSON.stringify(expected) + ' for a score; it needs a level text' }
    return { readable: true, correct: ranked[0][0] === expected, reason: null }
  }
  return { readable: false, correct: false, reason: 'an answer of type ' + JSON.stringify(type ?? null) + ' is not one this can score' }
}

/**
 * THE RUN, SCORED. `answersByCase` maps a case id to the answer map one model call produced for that case.
 *
 * @returns `{ perQuestion, perCase, refusal }` -- `refusal` is set when no rate may be published, and it is a sentence
 *          rather than a throw, because the caller has to explain why a run produced no usable number.
 */
export function scoreBattery({ battery, answersByCase, questionTypes = {} } = {}) {
  const cases = Array.isArray(battery?.cases) ? battery.cases : []
  const perQuestion = new Map()
  const perCase = []
  let typeMismatches = 0
  for (const entry of cases) {
    const answers = answersByCase?.[entry.id] ?? {}
    const wrong = []
    for (const [id, expected] of Object.entries(entry.expected)) {
      const verdict = isCorrect(answers[id], expected)
      if (verdict.reason !== null && verdict.readable && /the battery expects/.test(verdict.reason)) typeMismatches += 1
      const row = perQuestion.get(id) ?? { id, type: questionTypes[id] ?? null, n: 0, correct: 0, unreadable: 0 }
      row.n += 1
      if (verdict.readable !== true) row.unreadable += 1
      else if (verdict.correct) row.correct += 1
      if (verdict.correct !== true) {
        // `reason` IS OMITTED WHEN THERE IS NONE. A plain wrong answer has no reason -- the expectation was simply not
        // met -- and emitting `null` for it FAILED the harness's own schema check on the first live run ("must be a
        // string"), which is the lesson `lib/decide-tool.js` records from its own first live call: every emitted field
        // must match the schema that declares it, and the enforced subset has no nullable type.
        const row = { id, expected, got: answers[id] ?? null }
        if (verdict.reason !== null) row.reason = verdict.reason
        wrong.push(row)
      }
      perQuestion.set(id, row)
    }
    perCase.push({ id: entry.id, wrong })
  }
  const questions = [...perQuestion.values()].map((row) => Object.assign({}, row, {
    accuracy: row.n >= MIN_CASES ? row.correct / row.n : null,
    publishable: row.n >= MIN_CASES,
  })).sort((a, b) => a.id.localeCompare(b.id))
  const refusals = []
  // A TYPE MISMATCH IS A BATTERY DEFECT, NOT A QUESTION'S, and it must not be averaged in: the run is refused rather
  // than reported with rows that say the question was wrong when the expectation was.
  if (typeMismatches > 0) {
    refusals.push(typeMismatches + ' expectation(s) do not match the type of the question they are for, so this battery cannot score those questions -- fix the battery before reading anything from these numbers')
  }
  const thin = questions.filter((row) => !row.publishable)
  if (thin.length > 0) {
    refusals.push('no rate is published for ' + thin.map((row) => row.id + ' (n=' + row.n + ')').join(', ') + ': the floor is ' + MIN_CASES + ' cases')
  }
  if (questions.length === 0) refusals.push('this battery scored no questions at all, so it says nothing about the set')
  return { perQuestion: questions, perCase, refusals, hash: batteryHash(battery) }
}
