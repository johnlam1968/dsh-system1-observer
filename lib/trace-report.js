// THE AGENT-FACING TRACE READER.
//
// `scripts/trace.mjs` is the reader for a PERSON at a terminal: colour, alignment, and the newest run by
// default. This is the same trace read for an AGENT: plain text, bounded, and summarised before it is
// listed -- because a tool result goes into a model's context, and the 39 MB this deployment had produced
// after a few hours of seven seams would not fit in one.
//
// THE SPLIT IS DELIBERATE AND IT IS PRESENTATION ONLY. Both read the same JSONL fields written by
// `lib/evidence.js`; neither invents a field. A change to what a line MEANS belongs in `observe.js`, and
// both readers follow it.
//
// WHY THE FILE IS READ IN A WINDOW. A trace is append-only and grows without rotation, so "read the file"
// is not a bounded operation. The last WINDOW_BYTES are read, the first partial line is dropped, and the
// output SAYS SO when the window applied -- a reader that silently showed only part of a run would be the
// same class of defect as an answer read from the wrong argument.
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'node:fs'
import { describeSubject } from './subject.js'
import { probeScore } from './probe-score.js'
import { costOf } from './cost.js'
import { egressLines } from './egress.js'
import { compareRuns } from './compare.js'

/** How many events to print unless asked for more. */
export const DEFAULT_TAIL = 30
/** The most events one call may print: a tool result is context, and context is the scarce thing. */
export const MAX_TAIL = 200
/** How far back from the end of the file to read. */
export const WINDOW_BYTES = 8 * 1024 * 1024

/** The nine seams, so the tool's `hook` parameter can name them without importing the runtime. */
export const TRACE_SEAMS = Object.freeze([
  'assemble', 'admit', 'request', 'draft', 'pre_execute',
  'execute', 'post_execute', 'result', 'close',
])

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The events in the last `maxBytes` of the trace, oldest first.
 *
 * @returns `{ events, truncated, bytes }`; `truncated` is true when older bytes were not read.
 */
export function readTraceWindow(path, maxBytes = WINDOW_BYTES) {
  if (!existsSync(path)) return { events: [], truncated: false, bytes: 0, missing: true }
  const size = statSync(path).size
  const start = size > maxBytes ? size - maxBytes : 0
  let text
  if (start === 0) {
    text = readFileSync(path, 'utf8')
  } else {
    const buffer = Buffer.alloc(size - start)
    const fd = openSync(path, 'r')
    try {
      readSync(fd, buffer, 0, buffer.length, start)
    } finally {
      closeSync(fd)
    }
    text = buffer.toString('utf8')
    // The window starts mid-line, so the first line is a fragment and is dropped rather than parsed.
    const firstBreak = text.indexOf('\n')
    text = firstBreak === -1 ? '' : text.slice(firstBreak + 1)
  }
  const events = []
  for (const line of text.split('\n')) {
    if (line === '') continue
    try {
      const parsed = JSON.parse(line)
      if (parsed !== null && typeof parsed === 'object') events.push(parsed)
    } catch { /* a torn last line from a concurrent write is skipped, not fatal */ }
  }
  return { events, truncated: start > 0, bytes: size }
}

/** Every run id in the events, oldest first. */
export function runIds(events) {
  const ids = []
  for (const event of events) {
    if (typeof event.run === 'string' && !ids.includes(event.run)) ids.push(event.run)
  }
  return ids
}

/** One answer, as a person reads it: the label and its probability, or the level, or why it is unreadable. */
function answerText(answer) {
  if (answer === null || typeof answer !== 'object') return 'no answer'
  if (answer.type === 'unreadable') return `UNREADABLE ${String(answer.reason ?? '')}`
  if (answer.type === 'choice') return `${answer.label}${typeof answer.answerConfidence === 'number' ? ` p=${answer.answerConfidence}` : ''}`
  if (answer.type === 'noul') return `p=${answer.probability}`
  if (answer.type === 'score') return `level=${answer.level}`
  return 'no answer'
}

/** The answers of one `call`, id by id. */
function answersText(event) {
  const answers = event.answer?.answers
  if (answers === null || typeof answers !== 'object') return `(${String(event.answer?.kind ?? 'none')})`
  return Object.entries(answers).map(([id, answer]) => `${id}=${answerText(answer)}`).join(' · ')
}

function clockOf(at) {
  return typeof at === 'string' ? at.slice(11, 19) : '--:--:--'
}

/**
 * The session a line belongs to, short enough to sit in a column.
 *
 * It is on EVERY line because this observer can be scoped to sessions, and a `session not observed` skip that
 * does not say WHICH session is a line the reader cannot act on. The full ids are in the summary above.
 */
function sessionOf(event) {
  const id = event.agentId
  if (typeof id !== 'string' || id === '') return '(no session)'
  return id.length <= 14 ? id : `${id.slice(0, 13)}…`
}

function clip(text, max) {
  const value = typeof text === 'string' ? text : ''
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

function median(values) {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2)
}

/** A byte count a person reads, so a test window does not print as `0 MB`. */
function size(bytes) {
  return bytes >= 1024 * 1024 ? `${Math.round(bytes / 1024 / 1024)} MB` : `${bytes} bytes`
}

function countBy(events, key) {
  const counts = new Map()
  for (const event of events) {
    const value = key(event)
    if (value === undefined || value === null) continue
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return counts
}

function tally(counts) {
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name, n]) => `${name} ${n}`).join(' · ') || '(none)'
}

/**
 * The trace as an agent needs it: what was asked, what came back, what was skipped and why.
 *
 * @param options.path       the trace file
 * @param options.run        `current` (default), `all`, or a run-id prefix
 * @param options.hook       one seam to filter to
 * @param options.tail        how many events to list (bounded by MAX_TAIL)
 * @param options.full        also print the question as asked and the model envelope
 * @param options.liveAgents  live agent ids, so a session can be targeted by id
 * @returns a plain-text report, never a throw
 */
export function reportTrace(options = {}) {
  const path = options.path
  const full = options.full === true
  // The rate is an OPTION rather than a constant here, so a row that configures one re-prices its own report.
  const pricePerMTokInput = options.pricePerMTokInput
  const idleGapMs = options.idleGapMs
  const maxCompareLanes = options.maxCompareLanes
  const windowBytes = Number.isInteger(options.windowBytes) && options.windowBytes > 0 ? options.windowBytes : WINDOW_BYTES
  const tail = Math.max(1, Math.min(MAX_TAIL, Number.isInteger(options.tail) ? options.tail : DEFAULT_TAIL))
  let window
  try {
    window = readTraceWindow(path, windowBytes)
  } catch (error) {
    return `the trace could not be read: ${messageOf(error)}`
  }
  if (window.missing) return `no trace at ${path} yet: nothing has been observed, or the path is different.`

  const all = window.events
  const ids = runIds(all)
  const wanted = typeof options.run === 'string' && options.run !== '' ? options.run : 'current'
  let selected
  if (wanted === 'all') selected = ids
  else if (wanted === 'current') selected = ids.slice(-1)
  else selected = ids.filter(id => id.startsWith(wanted))
  if (selected.length === 0) {
    return `no run matching ${JSON.stringify(wanted)} in ${path}.\nruns present: ${ids.join(', ') || '(none)'}`
  }

  const inRuns = all.filter(event => selected.includes(event.run))
  // MOUNTS ARE SUMMARISED ON THEIR OWN LINE, so they are excluded here. Counting them in the event tally
  // made the arithmetic not add up -- `6 events · 2 calls · 2 skips · 1 errors` leaves one unaccounted, and a
  // reader who cannot add up the header stops trusting the rest of it.
  const byHook = inRuns.filter(event => event.event !== 'mount' && (typeof options.hook === 'string' && options.hook !== '' ? event.hook === options.hook : true))
  const calls = byHook.filter(event => event.event === 'call')
  const skips = byHook.filter(event => event.event === 'skip')
  const errors = byHook.filter(event => event.event === 'error')
  const mounts = inRuns.filter(event => event.event === 'mount')

  const out = []
  out.push(`trace ${path}`)
  if (window.truncated) {
    out.push(`NOTE: only the last ${size(windowBytes)} of ${size(window.bytes)} was read, so an earlier run may be missing.`)
  }
  out.push(`runs ${selected.join(', ')}${wanted === 'all' ? ' (all)' : ''}`)
  for (const mount of mounts.slice(-3)) {
    // THE SCOPE THE RUN STARTED WITH, so a quiet run is readable as a whole. The per-event `reason` stays
    // the authority on any single firing; this says what the row was asked to do when it started.
    out.push(`  mounted ${mount.at} · hooks ${(mount.hooks ?? []).join(', ') || '(none)'} · transport ${mount.transport} · ${mount.provider ?? '?'}/${mount.model ?? '?'} · questions ${(mount.questionIds ?? []).join(', ')}`
      + ` · calls ${mount.callsEnabled === false ? 'OFF' : 'on'}`
      + ` · seams off ${(mount.seamsOff ?? []).join(', ') || 'none'}`
      + ` · sessions ${(mount.sessions ?? []).join(', ') || 'NONE (observes nothing)'}`
      + (mount.probeHash === undefined ? '' : ` · probe ${mount.probeHash}`)
      + (mount.rotated === undefined || mount.rotated === null || mount.rotated.count === 0
        ? ''
        : ` · rotated ${mount.rotated.count}× (${mount.rotated.bytes} bytes, ${mount.rotated.lines} lines)`))
  }
  // THE EGRESS CONTRACT, once, for the newest mount -- the whole point of recording it is that an operator can
  // read what the row sends without reading the source, and burying it per mount would be worse than omitting it.
  const newestMount = mounts[mounts.length - 1]
  if (newestMount?.egress !== undefined) {
    for (const line of egressLines(newestMount.egress)) out.push(`  ${line}`)
  }
  if (mounts.length > 0) {
    // A RUN CAN CHANGE SCOPE WHILE IT IS RUNNING -- these fields are live, and the mount line is written once.
    // Measured: a run whose mounted line said `calls OFF` recorded calls minutes later, after a save. Without
    // this sentence the header reads as current fact and the events below read as contradicting it.
    out.push('  (the mounted line is a SNAPSHOT of the moment it was written; the reason on each event below is authoritative)')
  }
  if (options.hook !== undefined && options.hook !== '') out.push(`filtered to seam ${options.hook}`)
  out.push('')
  const rotations = inRuns.filter(event => event.event === 'rotate')
  out.push(`${byHook.length} events · ${calls.length} calls · ${skips.length} skips · ${errors.length} errors${rotations.length === 0 ? '' : ` · ${rotations.length} rotations`}`)
  if (calls.length > 0) out.push(`  calls by seam: ${tally(countBy(calls, event => event.hook))}`)
  if (skips.length > 0) out.push(`  skips by reason: ${tally(countBy(skips, event => event.reason))}`)
  if (errors.length > 0) out.push(`  errors: ${tally(countBy(errors, event => clip(event.error, 60)))}`)
  const timing = costOf(inRuns, { pricePerMTokInput, idleGapMs })
  const latencies = calls.map(event => event.ms).filter(ms => typeof ms === 'number')
  if (timing.latency.msSum > 0) {
    out.push(`  latency: min ${timing.latency.min}ms · median ${timing.latency.median}ms · p95 ${timing.latency.p95}ms · max ${timing.latency.max}ms`)
    out.push(`    client/transport overhead ${timing.latency.overheadMsSum}ms total, ${timing.latency.overheadMsPerCall}ms/call — NOT network: the default transport is loopback, where the observed round trip IS the server handling time`)
  }
  out.push(`  sessions seen here: ${tally(countBy(inRuns, event => event.agentId))}`)
  if (Array.isArray(options.liveAgents)) {
    out.push(`  sessions live now: ${options.liveAgents.join(', ') || '(none)'}`)
  }
  // WHICH MODEL GRADED, AND WHICH WAS ASKED FOR, ARE TWO FACTS. `jev-latest` is a moving target; the server
  // answers with the revision it actually ran, and System One guidance is explicit that "a threshold measured on
  // one server does not transfer to another" and to pin the revision when a threshold was tuned against it.
  const models = calls.map(event => event.executed?.model ?? event.answer?.envelope?.executed?.model).filter(Boolean)
  const requested = calls.map(event => event.requested?.model ?? event.answer?.envelope?.requested?.model).filter(Boolean)
  // `routing` IS THE ONLY FEEDBACK THAT SAYS WHICH CHECKPOINT READ THE TEXT. Language picks the checkpoint, and
  // the guidance's guard -- "when `is_english` is false, never auto-clear" -- depends on it. Counted rather than
  // assumed, because a reader has to know whether that guard was AVAILABLE on this deployment.
  const routingSeen = calls.filter(event => event.answer?.envelope?.routing !== undefined && event.answer?.envelope?.routing !== null).length
  if (models.length > 0) {
    out.push(`  graded by: ${tally(countBy(models, model => model))}${requested.length === 0 ? '' : ` · requested as ${[...new Set(requested)].join(', ')}`} · routing reported in ${routingSeen} of ${calls.length} calls`)
    if (routingSeen === 0) {
      out.push('    the server returned no `routing` in any call, so language detection -- the one field that says which checkpoint read the text -- is NOT recorded here. A judgement made on a non-English seam is indistinguishable from an English one in this trace, and no threshold should auto-clear on these records.')
    }
  }
  // THE OTHER HALF OF THE COMPARISON, and the one that was missing: `graded by` is the judge, this is the
  // model whose text was judged. An accuracy figure without it is not comparable across sessions -- the same
  // question scores differently on different models' output.
  // THE MONEY, WITH EVERYTHING THAT MAKES IT HONEST. Labelled as the JUDGE's cost rather than the session's,
  // because the subject model's tokens are never captured at all; paired with the rate and the date it was
  // transcribed, because a bare dollar figure is a figure nobody can check; and carrying the count of calls with
  // no usage, because a total that silently omits them is a total that lies.
  if (timing.cost.pricedCalls > 0) {
    out.push(`  cost of judgement: $${timing.cost.estimatedUsd.toFixed(6)} for ${timing.cost.pricedCalls} judged call(s) · ${timing.cost.inputTokens} in / ${timing.cost.outputTokens} out tokens`)
    out.push(`    ${timing.cost.priceSource} · covers ${timing.cost.covers}${timing.cost.unpricedCalls === 0 ? '' : ` · ${timing.cost.unpricedCalls} call(s) carried no usage`}`)
    out.push(`    by seam: ${timing.bySeamCost.map(seam => `${seam.key} $${seam.usd.toFixed(6)} (${timing.cost.estimatedUsd === 0 ? '0' : ((seam.usd / timing.cost.estimatedUsd) * 100).toFixed(1)}%)`).join(' · ')}`)
  }
  const subjects = inRuns.map(event => describeSubject(event.subject)).filter(route => route !== '(unknown)')
  if (subjects.length > 0) out.push(`  subject model: ${tally(countBy(subjects, route => route))}`)
  // THE FIGURE THE README PROMISED. It is computed over the RUN's events, not the hook-filtered ones, because
  // a filter would change which seams the confusion matrix covers while the matrix still read as the run's.
  // THE RUNS SIDE BY SIDE, with the comparability verdict printed FIRST because it gates the reading: two lanes of
  // numbers look comparable, and only the verdict says whether they are.
  const compare = compareRuns(inRuns, { limit: maxCompareLanes })
  if (compare.selected >= 2) {
    out.push(`  runs compared: ${compare.note}`)
    for (const lane of compare.lanes) {
      out.push(`    ${lane.id} · ${lane.calls} calls · ${lane.errors} errors · ${lane.skips} skips · ${(lane.msSum / 1000).toFixed(1)}s of calls · ${lane.seamMix.slice(0, 4).map(seam => `${seam.key} ${seam.count}`).join(' ')}`)
    }
    if (compare.selected < compare.total) out.push(`    (the newest ${compare.selected} of ${compare.total} runs in this window)`)
  }
  const probe = probeScore(inRuns)
  if (probe.scored > 0) {
    out.push(`  probe: ${probe.calls} calls · ${probe.scored} scored · ${probe.unreadable} unreadable`)
    const pct = value => value === null ? 'n/a' : `${(value * 100).toFixed(2)}%`
    out.push(`    accuracy ${pct(probe.accuracy)} against a majority-class floor of ${pct(probe.majority.floor)} (${probe.majority.label}) · kappa ${probe.kappa === null ? 'n/a' : probe.kappa.toFixed(4)}`)
    out.push(`    abstain ${pct(probe.abstain.rate)} · selective accuracy ${pct(probe.selective.accuracy)}`)
    // PER TIER, because the two measure different things: a truncated excerpt is not a smaller version of a full
    // one. Measured on this deployment's own trace, the gap is 25 points. A tier below the sample floor prints
    // its count and WITHHOLDS the percentage -- a rate over a handful is not a weaker result, it is not a result.
    out.push(`    by tier: ${probe.byTier.map(entry => entry.reported
        ? `${entry.tier} ${pct(entry.accuracy)} (n=${entry.n})`
        : `${entry.tier} NOT REPORTED (n=${entry.n}, below the ${probe.tierFloor}-sample floor)`).join(' · ')}`)
    // CALIBRATION: accuracy says how often the judge is right, this says whether its own number means anything.
    // The headline scalar is `probabilities[chosen]`, and the SIGN is printed because ECE cannot carry it: this
    // model is under-confident, so a gate that treats a high confidence as usable DISCARDS CORRECT ANSWERS.
    const cal = probe.calibration
    const headline = cal.scalars.find(entry => entry.scalar === 'probabilities[chosen]')
    if (headline.n > 0) {
      const signed = (value) => `${value >= 0 ? 'OVER' : 'UNDER'}-confident`
      out.push(`    calibration (top-1 over ${headline.scalar}): ECE ${headline.ece.toFixed(4)} over ${headline.bins.length} non-empty bin(s) covering ${(headline.eceWeight * 100).toFixed(0)}% of samples · bias ${headline.bias.toFixed(4)} (${signed(headline.bias)}) · Brier ${headline.brier.toFixed(4)}`)
      out.push(`      other scalars: ${cal.scalars.filter(entry => entry !== headline).map(entry => `${entry.scalar} ECE ${entry.ece.toFixed(4)} bias ${entry.bias.toFixed(4)}`).join(' · ')}`)
    }
    if (cal.classwise.n > 0) {
      const brier = cal.multiclass.brier
      out.push(`      classwise ECE ${cal.classwise.ece.toFixed(4)} over ${cal.classwise.options} option(s) (n=${cal.classwise.n}) · multi-class Brier ${brier.perCall.toFixed(4)}/call (${brier.perPair.toFixed(4)}/pair) · logLoss ${cal.multiclass.logLoss.toFixed(4)} · mean P(correct) ${cal.multiclass.meanPCorrect.toFixed(4)} · normalized entropy ${cal.multiclass.meanEntropy.toFixed(4)}`)
    }
    if (headline.n > 0) {
      // THE BIN TABLE IS THE EVIDENCE: ECE alone is sign-blind and ranking-blind, and a weight below 1 means it
      // describes only the samples that landed somewhere.
      out.push(`      bins (says -> actually right): ${headline.bins.map(bin => `${bin.low.toFixed(1)}-${bin.high.toFixed(1)} ${(bin.meanP * 100).toFixed(1)}% -> ${(bin.meanY * 100).toFixed(1)}% (n=${bin.n})`).join(' · ')}`)
    }
    // COVERAGE: "looked and found nothing" is not "could not look", and the digest mixes the skips in so a read
    // that could not see something never hashes the same as one that saw everything and found it empty.
    out.push(`    coverage: scored ${probe.coverage.scored.n} (full ${probe.coverage.scored.full} · truncated ${probe.coverage.scored.truncated}) · unreadable ${probe.coverage.unreadable} · skipped ${Object.values(probe.coverage.skipped).reduce((total, n) => total + n, 0)} (${Object.entries(probe.coverage.skipped).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([reason, n]) => `${reason} ${n}`).join(' · ')}) · digest ${probe.coverage.digest}`)
    out.push(`    ${probe.seams.map(seam => `${seam.seam} ${pct(seam.accuracy)} (n=${seam.n}${seam.thin ? ', thin' : ''})`).join(' · ')}`)
  }
  out.push('')

  const listed = byHook.slice(-tail)
  out.push(`last ${listed.length} of ${byHook.length} events${byHook.length > listed.length ? ' (raise `tail`, max ' + MAX_TAIL + ')' : ''}:`)
  if (full) {
    // TWO NUMBERS THAT LOOK LIKE A CONTRADICTION. `p=` is the model's stated confidence in its own answer; the
    // distribution is the probability mass per option. For a CHOICE they are not the same number -- measured on
    // one reply: confidence 0.75 beside answer_confidence 0.94, and thresholding the first withheld a correct
    // answer as "weakly supported". A reader who assumes they must agree reads a correct pair as a bug.
    out.push('  (in `p=`, that is the model\u2019s ANSWER CONFIDENCE; the distribution on the next line is the probability mass per option. For a choice they differ on purpose.)')
  }
  for (const event of listed) {
    const head = `${clockOf(event.at)} ${String(event.event).toUpperCase().padEnd(5)} ${String(event.hook ?? '').padEnd(12)} ${sessionOf(event).padEnd(14)}`
    const indent = ' '.repeat(head.length)
    if (event.event === 'call') {
      out.push(`${head} ${String(event.ms ?? '?')}ms ${clip(event.excerpt, 74)}`)
      out.push(`${indent} -> ${answersText(event)}`)
    } else if (event.event === 'skip') {
      out.push(`${head} ${String(event.reason ?? '')}${Array.isArray(event.problems) && event.problems.length > 0 ? ` (${event.problems.join('; ')})` : ''}`)
    } else if (event.event === 'error') {
      out.push(`${head} ${String(event.error ?? '')}`)
    } else if (event.event === 'mount') {
      out.push(`${head} hooks ${(event.hooks ?? []).join(',')}`)
    }
    if (full && event.event === 'call') {
      for (const [id, question] of Object.entries(event.questions ?? {})) {
        out.push(`${indent}    question ${id} [${question.type}] ${clip(question.instructions, 110)}`)
      }
      const probabilities = Object.values(event.answer?.answers ?? {}).map(a => a?.probabilities).filter(Boolean)
      for (const distribution of probabilities) out.push(`${indent}    ${JSON.stringify(distribution)}`)
    }
  }
  return out.join('\n')
}
