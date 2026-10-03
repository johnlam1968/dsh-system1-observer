// THE SAME TRACE, IN A SHAPE A RENDERER CAN DRAW.
//
// `reportTrace` renders text for a model to read; this produces the structured facts behind it, which the
// client half draws as a card. The two are separate on purpose: the model wants prose it can argue with, and
// a renderer wants numbers it can lay out, and neither should have to parse the other's output.
//
// IT RIDES `output.presentationMeta`, NOT THE MODEL-FACING CONTENT. The tool contract's output declaration has
// a `schema` enforced against the return value, a `render` that produces what the model sees, and an optional
// `presentationMeta` that is "persisted verbatim on `tool/result` for Host presenters and Client renderers to
// narrow independently". That is the sanctioned channel, and it is exactly how the shipped `read` tool gets
// its line numbers to the UI without putting them in the model's context.
//
// BOUNDED LIKE THE TEXT: the card lists the same window the report lists, because a renderer that tried to
// draw every event in an 8 MB window would freeze the page it is trying to inform.
import { MAX_TAIL, WINDOW_BYTES, readTraceWindow, runIds } from './trace-report.js'
import { describeSubject } from './subject.js'
import { costOf } from './cost.js'
import { MAX_LANES, compareRuns } from './compare.js'
import { probeAnswerOf, probeScore } from './probe-score.js'
// Re-exported so the reader that wants the probe block does not have to know which module owns it.
export { probeAnswerOf, probeScore }

/** How many rows the card may carry, whatever `tail` asks for -- a DOM budget, not a data limit. */
export const MAX_CARD_ROWS = 60

function clockOf(at) {
  return typeof at === 'string' ? at.slice(11, 19) : ''
}

function clip(text, max) {
  const value = typeof text === 'string' ? text : ''
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

/** The chosen labels and their probabilities, so a card can show what the question actually answered. */
function answersOf(event) {
  const answers = event?.answer?.answers
  if (answers === null || typeof answers !== 'object') return []
  const out = []
  for (const [id, answer] of Object.entries(answers)) {
    if (answer === null || typeof answer !== 'object') continue
    out.push({
      id,
      type: typeof answer.type === 'string' ? answer.type : null,
      label: typeof answer.label === 'string' ? answer.label : null,
      confidence: typeof answer.confidence === 'number' ? answer.confidence : null,
      // THE SCALAR TOP-1 CALIBRATION NEEDS, and the one a `score` answer carries instead of a label. Without
      // both, the card can show a label and a confidence but cannot check either against the outcome.
      answerConfidence: typeof answer.answerConfidence === 'number' ? answer.answerConfidence : null,
      level: typeof answer.level === 'number' ? answer.level : null,
      probabilities: answer.probabilities !== null && typeof answer.probabilities === 'object' ? answer.probabilities : null,
      invalid: answer.invalid === true ? true : null,
      invalidReason: typeof answer.invalidReason === 'string' ? answer.invalidReason : null,
    })
  }
  return out
}

function eventRow(event) {
  const row = {
    at: typeof event.at === 'string' ? event.at : '',
    clock: clockOf(event.at),
    event: typeof event.event === 'string' ? event.event : 'unknown',
    hook: typeof event.hook === 'string' ? event.hook : null,
    session: typeof event.agentId === 'string' && event.agentId !== ''
      ? event.agentId.slice(0, 13)
      : null,
  }
  if (row.event === 'call') {
    row.ms = typeof event.ms === 'number' ? event.ms : null
    row.excerpt = clip(event.excerpt, 220)
    row.truncated = event.truncated === true
    row.answers = answersOf(event)
    // Whether this call is a SCORED probe call, which is a different question from whether it happened.
    row.probe = probeAnswerOf(event) !== null
    row.questions = Object.entries(event.questions ?? {}).map(([id, question]) => ({
      id,
      type: typeof question?.type === 'string' ? question.type : null,
      instructions: clip(question?.instructions, 240),
      options: Array.isArray(question?.options) ? question.options.slice(0, 12) : null,
    }))
  } else if (row.event === 'skip') {
    row.reason = typeof event.reason === 'string' ? event.reason : null
    row.problems = Array.isArray(event.problems) ? event.problems.slice(0, 6) : null
  } else if (row.event === 'error') {
    row.error = clip(event.error, 300)
  }
  const subject = describeSubject(event.subject)
  if (subject !== '(unknown)') row.subject = subject
  return row
}

function countInto(map, key) {
  if (key === null || key === undefined || key === '') return
  map.set(key, (map.get(key) ?? 0) + 1)
}

function tally(map, limit = 12) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }))
}

/**
 * The trace as data, for the card.
 *
 * @param options.path        the trace file
 * @param options.run         a run id or prefix; omitted means the current run
 * @param options.hook        restrict to one seam
 * @param options.tail        rows for the card, capped at {@link MAX_CARD_ROWS}
 * @param options.liveAgents  `() => string[]`, the sessions live now
 * @param options.windowBytes how much of the tail of the file to read
 * @returns a plain JSON value: no closures, no class instances, nothing a wire has to translate
 */
export function traceData({ path, run, hook, tail, liveAgents, pricePerMTokInput, idleGapMs, maxCompareLanes, calibrationBins, windowBytes = WINDOW_BYTES } = {}) {
  const { events, truncated } = readTraceWindow(path, windowBytes)
  const ids = runIds(events)
  const runs = [...ids].reverse()
  const wanted = typeof run === 'string' && run !== '' && run !== 'all'
    ? runs.filter(id => id.startsWith(run))
    : (run === 'all' ? runs : runs.slice(0, 1))
  // An unknown run id is not an empty card: say which runs exist, so the reader can retry rather than guess.
  const matched = wanted.length > 0 ? new Set(wanted) : new Set()
  const inRun = matched.size > 0 ? events.filter(event => matched.has(event.run)) : []
  const byHook = hook === undefined || hook === '' ? inRun : inRun.filter(event => event.hook === hook)
  const listed = byHook.slice(-Math.min(Math.max(tail ?? MAX_CARD_ROWS, 1), MAX_CARD_ROWS))

  const timing = costOf(inRun, { pricePerMTokInput, idleGapMs })
  const counts = { call: 0, skip: 0, error: 0, mount: 0, rotate: 0 }
  const bySeam = new Map()
  const byReason = new Map()
  const bySession = new Map()
  const bySubject = new Map()
  const byModel = new Map()
  const byRequested = new Map()
  let routingSeen = 0
  let callCount = 0
  for (const event of inRun) {
    if (typeof counts[event.event] === 'number') counts[event.event] += 1
    countInto(bySession, typeof event.agentId === 'string' ? event.agentId.slice(0, 13) : null)
    const subject = describeSubject(event.subject)
    if (subject !== '(unknown)') countInto(bySubject, subject)
    if (event.event === 'call') {
      countInto(bySeam, event.hook ?? null)
      const model = event.executed?.model ?? event.answer?.envelope?.executed?.model
      if (typeof model === 'string') countInto(byModel, model)
      // WHICH MODEL GRADED, AND WHICH WAS ASKED FOR, ARE TWO FACTS. `jev-latest` is a moving target; the server
      // answers with the revision it actually ran, and System One guidance is explicit that "a threshold measured
      // on one server does not transfer to another" and to pin the revision when a threshold was tuned against it.
      const requested = event.requested?.model ?? event.answer?.envelope?.requested?.model
      if (typeof requested === 'string') countInto(byRequested, requested)
      // `routing` IS THE ONLY FEEDBACK THAT SAYS WHICH CHECKPOINT READ THE TEXT -- language picks the checkpoint,
      // and the guidance's guard ("when `is_english` is false, never auto-clear") depends on it. Counted rather
      // than assumed, because a reader has to know whether that guard was AVAILABLE on this deployment.
      routingSeen += event.answer?.envelope?.routing === null || event.answer?.envelope?.routing === undefined ? 0 : 1
      if (event.event === 'call') callCount += 1
    } else if (event.event === 'skip') {
      countInto(byReason, event.reason ?? null)
    }
  }

  const mounts = inRun.filter(event => event.event === 'mount').map(event => ({
    at: event.at ?? '',
    hooks: Array.isArray(event.hooks) ? event.hooks : [],
    transport: event.transport ?? null,
    provider: event.provider ?? null,
    model: event.model ?? null,
    questions: Array.isArray(event.questionIds) ? event.questionIds : [],
    callsEnabled: event.callsEnabled !== false,
    seamsOff: Array.isArray(event.seamsOff) ? event.seamsOff : null,
    sessions: Array.isArray(event.sessions) ? event.sessions : null,
    tracePath: event.tracePath ?? null,
    // WHAT THE BOUND HAS ALREADY MOVED. A cap nobody can read is a cap nobody can audit, and the mount line is
    // where this run's own facts live.
    rotated: event.rotated !== null && typeof event.rotated === 'object'
      ? { count: event.rotated.count ?? 0, lines: event.rotated.lines ?? 0, bytes: event.rotated.bytes ?? 0, archived: event.rotated.archived ?? null }
      : null,
  }))

  return {
    path: typeof path === 'string' ? path : '',
    run: wanted[0] ?? null,
    runs: runs.slice(0, 20),
    unknownRun: typeof run === 'string' && run !== '' && run !== 'all' && matched.size === 0,
    hook: hook ?? null,
    window: { events: events.length, truncated: truncated === true },
    counts: { ...counts, events: byHook.length },
    seams: tally(bySeam),
    reasons: tally(byReason),
    sessions: tally(bySession),
    subjects: tally(bySubject),
    models: tally(byModel),
    provenance: {
      // The revision that GRADED, the alias that was ASKED FOR, and whether the server said how it routed. All
      // three measured, none assumed: on this deployment `executed` names a pinned revision while the request
      // named `jev-latest`, and `routing` came back in 0 of 4,369 calls.
      requested: tally(byRequested),
      routingReported: routingSeen,
      routingCalls: callCount,
      routingNote: routingSeen === 0 && callCount > 0
        ? 'the server returned no `routing` in any call, so language detection -- the one field that says which checkpoint read the text -- is NOT recorded here. A judgement made on a non-English seam is indistinguishable from an English one in this trace, and no threshold should auto-clear on these records.'
        : null,
    },
    // THE RUN'S EVENTS, NOT `byHook`: a hook filter would silently change which seams the confusion matrix
    // covers while leaving the matrix labelled as if it covered the run.
    // The bin count travels with the request for the same reason the rate does: it changes what the number means.
    probe: probeScore(inRun, { calibrationBins }),
    // THE COST AND TIMING BLOCK, from `lib/cost.js` so both readers and the card compute one answer. It carries
    // the provenance the money needs: `covers: 'the decision model only'`, the rate and the date it was
    // transcribed, and how many calls had no usage at all -- because a total that silently omits them is a
    // total that lies.
    //
    // NAMED `runSummaries`, NOT `runs`: `runs` is already the list of run IDS this reader offers when a
    // requested run does not match, and the card renders it. Two different things under one name would break
    // the card, so the summary keeps a distinct one.
    cost: timing.cost,
    bySeamCost: timing.bySeamCost,
    latency: timing.latency,
    runSummaries: timing.runs,
    turns: timing.turns,
    // THE MULTI-RUN BLOCK, and its verdict is the gate: `same` means the lanes may be read together, `diff` means
    // they are different experiments, and `no-task-key` means nobody can tell -- which is a third fact and not a
    // kind of the second. Over the RUN's events, like the probe block, so a `hook` filter cannot change it.
    // THE LANE LIMIT IS THE CALLER'S, falling back to the constant: how many runs a comparison may show is a
    // reading decision, and `compareRuns` already treats a junk limit as the default.
    compare: compareRuns(inRun, { limit: maxCompareLanes }),
    liveAgents: typeof liveAgents === 'function' ? liveAgents() : [],
    mounts,
    listed: listed.map(eventRow),
    listedOf: byHook.length,
  }
}
