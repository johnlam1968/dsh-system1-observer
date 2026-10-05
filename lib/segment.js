// SEGMENTING A SESSION THAT DOES NOT FIT: the technique the vendor's own limits require.
//
// WHY THIS EXISTS. `lib/model/limits.js` holds jev-1.13's published numbers: 64k tokens per request, of which **32k
// tokens cover the `state` plus the single longest question**. Measured on the freeciv session (611 messages, 259,445
// characters of message text), the whole conversation is roughly **65k tokens** -- about twice the state budget -- so
// it CANNOT be judged in one call, and the attempt does not fail loudly: it comes back as answers nobody can read.
// `docs.typesafe.ai/model-jaggedness/jev-1.13.md` says the same thing from the quality side, making "large state full
// of irrelevant detail" failure mode 5 and advising "filter first; send only what the question needs".
//
// SO THE SESSION IS SPLIT INTO CONTIGUOUS SEGMENTS, each composed and judged on its own, and the readings are
// COMBINED IN CODE. Two decisions in that sentence are deliberate:
//
// 1. **Contiguous and message-aligned, never mid-message.** A question's criteria refer to messages and to the tool
//    calls between them, so a segment that cut a message in half would be judging something the author never wrote.
//    Each segment carries the same WINDOW `lib/session-subject.js` builds for a whole session -- the messages it
//    covers plus every tool call and result between them -- which is why a segment can answer a question about a
//    lookup at all.
//
// 2. **The aggregate is ARITHMETIC, NOT A MODEL CALL.** Asking the session questions again over a digest of
//    per-segment answers would be asking them about a state with no SESSION TRANSCRIPT and no TOOL CALLS in it, while
//    their criteria name those sections -- a category error dressed as thoroughness. So the combination happens in
//    code, where it is inspectable, and `lib/model/limits.js` is not the only reason: the vendor's composite-scoring
//    pattern says the same.
//
// WHAT AN AGGREGATE IS NOT, stated here because the output will be read as an overall judgement: a segment reading is
// a judgement about THAT SEGMENT. `session_request_served` asked of seven segments yields "the request was served in
// five of them", not "the request was served", and a question whose evidence lives at the END of a session is answered
// by the LAST segment, not by the median. `firstAndLast` exists for that reason: for a whole-session question the two
// ends are the informative readings, and the middle is where a session's work happens rather than where its outcome
// is decided.
import { textOfEvent } from 'dsh-session-adapter/session-format'
import { stateBudgetChars } from './model/limits.js'

/**
 * The default segment size in characters.
 *
 * SIXTY PERCENT OF THE ESTIMATED STATE BUDGET, because a segment's composed state is its message text PLUS section
 * labels PLUS the tool record, and none of those three is free. The estimate itself is soft (`limits.js` says so), so
 * this leaves room for the parts of a composed state that are not message text.
 */
export const DEFAULT_SEGMENT_CHARS = Math.floor(stateBudgetChars * 0.6)

/**
 * THE SEGMENTS: contiguous runs of the selected messages, each with the window the composer needs.
 *
 * @param events   the full window a whole-session judgement would use (`readStoredSubject(...).events`)
 * @param messages the messages that window was built from (`readStoredSubject(...).messages`)
 * @returns `[{ index, from, to, messages, chars, events }]` -- `from`/`to` index into `messages`, `to` exclusive, and
 *          `events` is the slice of `events` spanning them so tool calls travel with the messages they answered.
 */
export function segmentsOf(events, messages, { maxChars = DEFAULT_SEGMENT_CHARS } = {}) {
  const window = Array.isArray(events) ? events : []
  const list = Array.isArray(messages) ? messages : []
  const budget = Number.isFinite(maxChars) && maxChars > 0 ? Math.floor(maxChars) : DEFAULT_SEGMENT_CHARS
  const segments = []
  let start = 0
  let chars = 0
  const close = (end) => {
    if (end <= start) return
    const covered = list.slice(start, end)
    // THE WINDOW IS FOUND BY IDENTITY, exactly as `sliceEvents` finds it: the harness may hand back events whose `seq`
    // is absent, and a window built from a field that is sometimes missing is a window nothing can verify.
    const first = window.indexOf(covered[0])
    const last = window.indexOf(covered[covered.length - 1])
    segments.push({
      index: segments.length,
      from: start,
      to: end,
      messages: covered.length,
      chars,
      events: first === -1 || last === -1 ? covered : window.slice(first, last + 1),
    })
  }
  for (let index = 0; index < list.length; index += 1) {
    const size = textOfEvent(list[index]).length
    // A SINGLE MESSAGE LARGER THAN THE BUDGET IS ITS OWN SEGMENT. It cannot be split -- a question's criteria refer to
    // messages -- so it goes alone and the caller can see from `chars` that it is over budget rather than being told a
    // comfortable lie by a splitter that cut it in half.
    if (chars > 0 && chars + size > budget) {
      close(index)
      start = index
      chars = 0
    }
    chars += size
  }
  close(list.length)
  return segments
}

/** The median of a list of numbers, or `null`. Even counts average the middle two, which is stated rather than implied. */
function median(values) {
  const sorted = values.filter((value) => typeof value === 'number' && Number.isFinite(value)).sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/**
 * THE READINGS, COMBINED IN CODE per question.
 *
 * One row per segment (`{ index, from, to, answers, failure }`), one entry per question. Every entry keeps its RAW
 * per-segment readings, because an aggregate that hides its own members cannot be argued with: `noul` keeps the
 * probabilities, `score` the levels, `choice` the labels. A question that failed in some segments reports how many,
 * rather than dropping them from `n` as though they had never been asked.
 */
export function aggregateReadings(rows, questions = {}) {
  const per = {}
  const ids = Object.keys(questions)
  for (const id of ids) {
    const type = questions[id]?.type ?? null
    const readings = []
    let unreadable = 0
    let failed = 0
    for (const row of rows) {
      if (row.failure !== undefined) { failed += 1; continue }
      const answer = row.answers?.[id]
      if (answer === null || answer === undefined || answer.type === 'unreadable') { unreadable += 1; continue }
      if (type === 'noul' && typeof answer.probability === 'number') readings.push({ segment: row.index, value: answer.probability })
      else if (type === 'score' && typeof answer.level === 'number') readings.push({ segment: row.index, value: answer.level })
      else if (type === 'choice' && typeof answer.label === 'string') readings.push({ segment: row.index, value: answer.label })
      else unreadable += 1
    }
    const entry = { id, type, n: readings.length, unreadable, failed, readings }
    if (type === 'noul' || type === 'score') {
      const values = readings.map((reading) => reading.value)
      entry.median = median(values)
      entry.min = values.length === 0 ? null : Math.min(...values)
      entry.max = values.length === 0 ? null : Math.max(...values)
      // THE SHARE ABOVE THE LINE, which is what a `noul` aggregate means in practice: "in how many segments was this
      // true", never "the probability that this was true of the session".
      entry.aboveHalf = values.length === 0 ? null : values.filter((value) => value >= 0.5).length / values.length
    }
    if (type === 'choice') {
      const counts = new Map()
      for (const reading of readings) counts.set(reading.value, (counts.get(reading.value) ?? 0) + 1)
      entry.labels = [...counts.entries()].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
      entry.modal = entry.labels[0]?.label ?? null
      entry.agreement = readings.length === 0 ? null : (entry.labels[0]?.n ?? 0) / readings.length
    }
    per[id] = entry
  }
  return per
}

/**
 * THE TWO ENDS, for the questions whose evidence is not spread across the middle.
 *
 * A session's request is in its first messages and its outcome is in its last, so for those a median over segments is
 * the wrong statistic -- it averages the decision with the work. These are returned beside the aggregate rather than
 * chosen for the reader, because which end matters is a property of the QUESTION.
 */
export function firstAndLast(rows) {
  if (rows.length === 0) return { first: null, last: null }
  return { first: rows[0], last: rows[rows.length - 1] }
}
