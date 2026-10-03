// ONE READER FOR THE TRACE, so the three views of it cannot drift apart.
//
// Measured before this file existed: THREE modules parsed the same JSONL (`lib/trace-report.js:45 readTraceWindow`,
// `lib/results-tool.js:69 readLines`, and `lib/trace-data.js`'s fold), THREE tallied the same events under different key
// sets (`trace-data` counted `error` and `rotate`, the results view counted `config` and `other`), and THREE read an
// answer (`answersOf`, `answersText`, `answerValue`). Each was individually reasonable and together they were a
// vocabulary that could disagree with itself -- the exact failure the repository's "one home per fact" rule exists to
// prevent, arriving as arithmetic rather than as prose.
//
// So this module owns four facts and nothing else:
//   1. what a line is           -- `readTraceLines`
//   2. how lines are counted    -- `EVENT_KINDS`, `tallyEvents`
//   3. what a line ANSWERED     -- `answersOf`, `specsOf`, `answerOf`
//   4. who wrote it and why not -- `writerOf`, `skipReasons`
//
// It renders nothing and decides nothing: a reader may summarise, refuse or print, and the accounting beneath it is the
// same accounting either way.

/** Every kind of line this plugin writes, plus the bucket for anything unrecognised. One vocabulary, one list. */
export const EVENT_KINDS = Object.freeze(['call', 'skip', 'mount', 'config', 'error', 'rotate', 'other'])

/** Sort a record's kind into that vocabulary, so a new event kind lands in `other` and is COUNTED rather than dropped. */
export function kindOf(record) {
  const event = String(record?.event ?? '')
  return EVENT_KINDS.includes(event) ? event : 'other'
}

/** Parse the trace text. An unparseable line is counted, never dropped: a file nobody can fully read is a finding. */
export function readTraceLines(text) {
  const lines = []
  let broken = 0
  for (const raw of String(text ?? '').split('\n')) {
    if (raw.trim() === '') continue
    try {
      const record = JSON.parse(raw)
      if (record !== null && typeof record === 'object' && !Array.isArray(record)) lines.push(record)
      else broken += 1
    } catch {
      broken += 1
    }
  }
  return { lines, broken }
}

/** The most recent `tail` lines, or all of them. A bounded read says so; it never pretends to be the whole file. */
export function tailOf(lines, tail) {
  return typeof tail === 'number' && Number.isFinite(tail) && tail > 0 ? lines.slice(-Math.floor(tail)) : lines
}

/** Every line, counted. `broken` is passed in rather than guessed, because only the reader knows it. */
export function tallyEvents(lines, broken = 0) {
  const counts = { total: lines.length, broken }
  for (const kind of EVENT_KINDS) counts[kind] = 0
  for (const line of lines) counts[kindOf(line)] += 1
  return counts
}

/** Why nothing was asked, by reason and count -- the first honest line of any report about this device. */
export function skipReasons(lines) {
  const byReason = new Map()
  for (const line of lines) {
    if (kindOf(line) !== 'skip') continue
    const reason = String(line.reason ?? 'no reason recorded')
    byReason.set(reason, (byReason.get(reason) ?? 0) + 1)
  }
  return [...byReason.entries()].map(([reason, n]) => ({ reason, n })).sort((a, b) => b.n - a.n)
}

/**
 * WHICH WRITER PRODUCED THIS LINE.
 *
 * The seams write `questions` and `answer`; the scheduled turn path writes `questionIds` and `answers` (finding O17 in
 * `docs/findings.md`). Both are read, and the two are never pooled -- the difference is reported rather than erased.
 */
export function writerOf(record) {
  if (record?.answer !== undefined) return 'seam'
  if (record?.answers !== undefined) return 'turn'
  return 'unknown'
}

// `writerOf` RETURNS A SHAPE NAME, NOT A PROVENANCE. 'seam' is the `{answer: {answers}}` shape and 'turn' is the
// `{answers, questionIds}` shape the TURN writer first used -- and `system1_decide` (hook `tool`), a stored-session
// evaluation (hook `session-review`) and every failed call line use that same second shape. Grouping by it is right,
// because two shapes must never be pooled; REPORTING it as a writer is not, and `lib/results-tool.js` counts the turn
// writer by its hook for that reason.

/**
 * THE ANSWERS ON A LINE, normalised across both writers and both shapes.
 *
 * Returns `{ [questionId]: answered }` -- `{}` when the line asked nothing. Normalising on read is what stops one
 * writer's subset from being silently invisible to a reader that only knew the other shape.
 */
export function answersOf(record) {
  if (record === null || typeof record !== 'object') return {}
  if (writerOf(record) === 'seam') {
    const answer = record.answer
    return answer !== null && typeof answer === 'object' && answer.answers !== null && typeof answer.answers === 'object' && !Array.isArray(answer.answers)
      ? answer.answers
      : {}
  }
  return record.answers !== null && typeof record.answers === 'object' && !Array.isArray(record.answers) ? record.answers : {}
}

/**
 * THE SPECS ON A LINE, which the turn writer records as a bare id list and the seam writer as the full map.
 *
 * A turn line therefore yields `{ [id]: null }`: the id is known and the spec is not, and `null` says so rather than an
 * empty object pretending the question had no fields.
 */
export function specsOf(record) {
  if (writerOf(record) === 'seam') {
    const questions = record?.questions
    return questions !== null && typeof questions === 'object' && !Array.isArray(questions) ? questions : {}
  }
  if (Array.isArray(record?.questionIds)) return Object.fromEntries(record.questionIds.map((id) => [String(id), null]))
  return {}
}

/**
 * ONE ANSWER AS A VALUE A READER CAN COUNT.
 *
 * The shapes come from the model's own narrowing: a `noul` carries a probability, a `score` a level, a `choice` a
 * label, and any of them may carry a `probabilities` map. Anything else is `null` -- and a null is COUNTED as
 * unreadable rather than treated as a value, because an answer that cannot be read is a fact about the question's
 * shape, not an answer of "unknown".
 *
 * A CONFIDENCE IS NOT AN ANSWER. A `noul` carrying only a `confidence` has no probability to report, and reading the
 * confidence as one would invent a reading that no question produced.
 */
export function answerOf(answered) {
  if (answered === null || typeof answered !== 'object') return null
  if (typeof answered.label === 'string' && answered.label !== '') return { value: answered.label, kind: 'label' }
  if (typeof answered.level === 'string' && answered.level !== '') return { value: answered.level, kind: 'level' }
  for (const key of ['probability', 'probabilityTrue', 'p']) {
    const number = answered[key]
    if (typeof number === 'number' && Number.isFinite(number)) return { value: number, kind: 'probability' }
  }
  return null
}

/** The lines in a window, by the four filters every reader offers. */
export function windowOf(lines, { run = null, hook = null, question = null, agent = null } = {}) {
  return lines.filter((line) => {
    if (run !== null && String(line.run ?? '') !== run) return false
    if (hook !== null && line.hook !== hook) return false
    if (agent !== null && !String(line.agentId ?? '').includes(agent)) return false
    if (question !== null && !Object.hasOwn(answersOf(line), question) && !Object.hasOwn(specsOf(line), question)) return false
    return true
  })
}

/**
 * THE RUN TABLE: what each run started with, and how many calls it produced.
 *
 * The mount line carries identity (`questionSetHash`, `harnessHash`, `userHash`, the model) and the call lines carry
 * readings and name only their run, so this is the join. `lib/probe-score.js` joins the same two facts the same way.
 * A field is absent rather than null when the run did not record it, because "unrecorded" is a gap to report.
 */
export function runsOf(lines, { calls = null } = {}) {
  const callLines = calls ?? lines.filter((line) => kindOf(line) === 'call')
  return lines.filter((line) => kindOf(line) === 'mount').map((mount) => {
    const run = String(mount.run ?? '')
    const entry = { run, calls: callLines.filter((call) => String(call.run ?? '') === run).length }
    for (const [field, key] of [['model', 'model'], ['questionSetHash', 'questionSetHash'], ['harnessHash', 'harnessHash'], ['userHash', 'userHash']]) {
      if (mount[field] !== undefined) entry[key] = String(mount[field])
    }
    return entry
  })
}
