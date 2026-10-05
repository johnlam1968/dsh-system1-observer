// SYSTEM1_RESULTS: read the trace as MEASUREMENTS rather than as a chronology.
//
// `system1_trace` answers "what happened, in order". This answers "what do I have", which is the question an agent
// asks before it changes a setting or writes a report -- and it is a different question, because the honest answer to
// it is usually about n and about silence rather than about answers.
//
// FOUR RULES ARE THE WHOLE DESIGN, and each exists because the alternative produces a number an agent would act on:
//
// 1. **A rate is refused below `MIN_N_FOR_RATE`.** Three answers is not a rate; it is three answers, and printing
//    "67%" for them invites a decision the evidence does not support. Below the bound the raw values are printed and
//    no summary is offered.
// 2. **A mean of probabilities is never reported.** The mean of `0.9`, `0.1` and `0.5` is `0.5`, which describes no
//    answer that was given. The range and the count of answers on each side are shown instead, and below the bound
//    the individual probabilities are listed.
// 3. **A question whose answers never differ is called out as not separating.** A label that never changes is a
//    question that needs rewriting rather than a model that is wrong -- and it is invisible in a distribution that
//    only reports the most common value.
// 4. **Skips are reported beside answers, not after them.** Measured on the live trace: 39,400 of 39,707 lines are
//    skips. A view that showed only answers would describe 0.09% of what the plugin recorded and hide that the
//    ordinary state of a row is "asked nothing, and said why".
//
// TWO GAPS ARE NAMED RATHER THAN SMOOTHED OVER, because a results view that quietly averages across them would be
// manufacturing a measurement:
//
// - **The second writer.** One path (the seams) writes `questions` and `answer`; the scheduled turn path writes
//   `answers` and `questionIds` instead. Those lines are COUNTED and NOT aggregated, with the reason in `refusals`.
//   (`O17` in `docs/findings.md`; the fix is one writer, not two shapes.)
// - **No set and no harness on the line.** A call line records the model but not the question set or the harness
//   technique that produced it, so a reading cannot be attributed to the set or the technique in force. The run's
//   `mount` line is reported as context, and the gap is in `refusals`.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { attachInterpretation, buildPackage, buildSkeleton, defaultPackageDir, packageId, questionsById, writePackage } from './report.js'
import { checkAgainst } from './tool-args.js'
import { answerOf, answersOf, kindOf, readTraceLines, runsOf, skipReasons, specsOf, tallyEvents, tailOf, windowOf, writerOf } from './trace-read.js'
import { TURN_HOOK } from './questions.js'

export const RESULTS_TOOL_NAME = 'system1_measurements'

/**
 * Below this many answers, no rate and no percentage is reported -- the raw values are.
 *
 * Five is a judgement, not a measurement, and it is written down so it can be argued with: at four answers a single
 * outlier moves a rate by 25 points, and an agent reading "75%" cannot see that from the number.
 */
export const MIN_N_FOR_RATE = 5

/** At or below this many probabilities, they are listed individually. */
export const MAX_LISTED_PROBABILITIES = 8

const DESCRIPTION = [
  'Read this row\'s measurements as a summary rather than as a timeline: how many lines were calls, skips and mounts;',
  'which questions were asked and what the answers were; which questions never separate; and why nothing was asked at',
  'the points where nothing was. Grouped by hook, agent, model or run, with the filters `run`, `hook`, `question` and',
  '`agent`. Rates are refused below a stated n and probabilities are never averaged, so a summary here cannot be',
  'mistaken for a measurement it is not. Records what it could NOT aggregate, with the reason.',
].join(' ')

const parameters = {
  type: 'object', additionalProperties: false,
  properties: {
    run: { type: 'string', description: 'Which run to summarise: a run id or its prefix, `current` for the newest, or omitted for every run in the file.' },
    subject: { type: 'string', description: 'Which SESSION to summarise, by id. A run is a window over the process\'s lifetime, so two measurements of two different sessions share one, and pooling them reports a count about two conversations at once -- measured: `n=3` from 1 call about one session and 2 about another. `package` narrows its window with this, and `package: true` on `system1_evaluate_session` passes the session it just measured.' },
    hook: { type: 'string', description: 'Only this point: a seam name, `turn`, or `session-review`.' },
    question: { type: 'string', description: 'Only this question id.' },
    agent: { type: 'string', description: 'Only lines whose `agentId` contains this text.' },
    group_by: { type: 'string', enum: ['hook', 'agent', 'model', 'run'], description: 'How to group the calls. Defaults to `hook`.' },
    tail: { type: 'number', description: 'Read only the last N lines. Defaults to the whole file, which is what the counts then describe.' },
    action: { type: 'string', enum: ['summary', 'package', 'interpret', 'skeleton'], description: '`summary` (the default) returns the aggregate. `package` WRITES a measurement report package to disk: the files below, with every file\'s sha256 on the manifest, so a reader can re-derive the readings from the trace slice the package carries. `interpret` ATTACHES a written reading of those numbers to an existing package -- attributed and anchored to the exact revision of `readings.json` it was written against, because prose kept in a chat is prose divorced from its evidence. A package is never overwritten, and holds one interpretation. `skeleton` RETURNS the report FORMAT with every number already filled in and the reading column left blank, so a report cannot mistype a median; name one table per instrument with `tables`.' },
    against: { type: 'string', description: 'For `action`: `skeleton`: the directory of ANOTHER package to compare against. Its `readings.json` fills a third column with the same questions, which is what turns a table of numbers into a comparison.' },
    againstTitle: { type: 'string', description: 'For `action`: `skeleton`: what to call that comparison in the column header, e.g. "the 40,000-char single call". Defaults to the package id.' },
    tables: { type: 'array', description: 'For `action`: `skeleton`: one entry per instrument, `{ title, set, setHash, questions: [id, ...] }`. The CALLER names them because which questions belong to the model and which to the operator is a fact about the question sets, not about the numbers -- and the window records ONE set hash for both (register row F59), so the caller should give `setHash` per table when it knows it.', items: { type: 'object', additionalProperties: false, properties: { title: { type: 'string' }, set: { type: 'string' }, setHash: { type: 'string' }, questions: { type: 'array', items: { type: 'string' } } } } },
    package: { type: 'string', description: 'For `action`: `interpret`: which package to amend -- its directory, or its id under `dir`. The readings it is anchored to are read from that package.' },
    text: { type: 'string', description: 'For `action`: `interpret`: the interpretation itself, in markdown. It is stored verbatim under a generated header that records who wrote it, when, and which revision of the readings it is about.' },
    by: { type: 'string', description: 'For `action`: `interpret`: who is writing it -- an agent id, `operator`, or a label. Recorded, because an unattributed reading of a measurement is an anonymous claim.' },
    dir: { type: 'string', description: 'For `action`: `package`: which directory to write into. Defaults to `data/measurements`, which is this repository\'s gitignored local-data directory. The package is written to `<dir>/<id>/`.' },
  },
}

/**
 * WHAT A GROUP'S LINES ACTUALLY CAME FROM, because `writerOf` returns a SHAPE name. Its 'turn' value is the
 * `{answers, questionIds}` shape the turn writer first used, and `system1_decide` (hook `tool`) and a stored-session
 * evaluation (hook `session-review`) write that same shape -- so a group label reading "turn writer" was wrong about
 * every one of them, and a reader tuning questions would go looking at the scheduled measurement.
 */
function writerLabel(group) {
  if (group.writer === 'seam') return 'the seam writer'
  if (group.writer === 'turn') return group.key === TURN_HOOK ? 'the turn writer' : 'the `answers` shape -- a tool or evaluation line, NOT the turn writer'
  return 'an unrecognised shape'
}

export function summariseQuestions(calls) {
  const byQuestion = new Map()
  for (const call of calls) {
    // BOTH WRITERS, NORMALISED IN ONE PLACE (`lib/trace-read.js`), so neither shape can be invisible to a reader that
    // only knew the other -- and the writer rides each group so the two are never pooled.
    const answered = answersOf(call)
    const specs = specsOf(call)
    const ids = Object.keys(answered).length > 0 ? Object.keys(answered) : Object.keys(specs)
    for (const id of ids) {
      const entry = byQuestion.get(id) ?? { id, type: null, asked: 0, read: 0, unreadable: 0, failed: 0, labels: new Map(), levels: new Map(), probabilities: [] }
      entry.asked += 1
      // A CALL THAT FAILED WAS STILL ASKED, AND PRODUCED NOTHING -- register row O18. It is counted separately from
      // `unreadable` (which AN ANSWER existed for and could not be read) because the two call for different repairs,
      // and separately from `read` so that a question asked ten times with three timeouts does not report `n=7`
      // without saying where the other three went.
      if (call.failure !== undefined) entry.failed += 1
      const spec = specs[id]
      if (entry.type === null && spec !== null && typeof spec === 'object' && typeof spec.type === 'string') entry.type = spec.type
      if (answered[id] !== undefined) {
        const read = answerOf(answered[id])
        if (read === null) entry.unreadable += 1
        else {
          entry.read += 1
          if (read.kind === 'label') entry.labels.set(read.value, (entry.labels.get(read.value) ?? 0) + 1)
          else if (read.kind === 'level') entry.levels.set(read.value, (entry.levels.get(read.value) ?? 0) + 1)
          else entry.probabilities.push(read.value)
        }
      }
      byQuestion.set(id, entry)
    }
  }
  return [...byQuestion.values()].map((entry) => {
    const values = [...entry.labels.entries()].map(([value, n]) => ({ value: String(value), n }))
      .concat([...entry.levels.entries()].map(([value, n]) => ({ value: String(value), n })))
    const probabilities = [...entry.probabilities].sort((a, b) => a - b)
    const above = probabilities.filter((p) => p >= 0.5).length
    // ONE VALUE EVERY TIME IS THE FINDING, and it is reported even when the n is small: a question that never
    // separates separates nothing at any n, and no amount of further asking will change that.
    let separates = null
    if (entry.read >= 2) {
      const distinct = values.length + (probabilities.length > 0 ? (above === 0 || above === probabilities.length ? 1 : 2) : 0)
      separates = distinct > 1
    }
    const reading = {
      id: entry.id,
      asked: entry.asked,
      failed: entry.failed,
      read: entry.read,
      unreadable: entry.unreadable,
      values,
    }
    if (entry.type !== null) reading.type = entry.type
    if (separates !== null) reading.separates = separates
    if (probabilities.length > 0) {
      const middle = Math.floor(probabilities.length / 2)
      reading.probabilities = {
        n: probabilities.length,
        min: probabilities[0],
        max: probabilities[probabilities.length - 1],
        // A MEDIAN, NOT A MEAN: the mean of 0.9, 0.1 and 0.5 is 0.5, which describes no answer that was given.
        median: probabilities.length % 2 === 1 ? probabilities[middle] : (probabilities[middle - 1] + probabilities[middle]) / 2,
        atOrAboveHalf: above,
        // A MEAN IS DELIBERATELY ABSENT. Listing them is honest at small n and unnecessary at large n, where the
        // range and the split are the two facts a reader can act on.
        ...(probabilities.length <= MAX_LISTED_PROBABILITIES ? { listed: probabilities } : {}),
      }
    }
    if (entry.read > 0 && entry.read < MIN_N_FOR_RATE) {
      reading.note = 'n=' + entry.read + ' is below the ' + MIN_N_FOR_RATE + ' needed for a rate, so counts are shown instead'
    }
    if (separates === false) {
      // THE TWO CASES ARE NOT THE SAME FINDING, and one sentence for both MISLED AN INDEPENDENT AGENT on a live run.
      // For a `choice` or a `score` every answer really was the same value. For a `noul` the probabilities can differ
      // and merely all fall on one side of 0.5 -- and that is what `separates` measures, because a noul that always
      // says yes separates nothing. Measured: `session_scope_expanded` reads 0.53..0.87 across 16 segments, and the
      // note "every answer was the same" led to the conclusion that the question was "reading a default, not
      // conversation variability". The values DIFFER; the direction does not. The note says that now.
      const unanimous = probabilities.length > 0 && values.length === 0
      reading.note = (reading.note === undefined ? '' : reading.note + '; ') + (unanimous
        ? 'every answer fell on the same side of 0.5 (' + (above === 0 ? 'all below' : 'all at or above') + '), so nothing separates between answers: the DIRECTION is unanimous, which is not the same finding as identical answers'
        : 'every answer was the same value: this question is not separating')
    }
    return reading
  }).sort((a, b) => b.read - a.read || a.id.localeCompare(b.id))
}

/** The whole summary, over already-parsed lines. Pure, so the tests can drive it without a file. */
export function summarise(lines, { run = null, hook = null, question = null, agent = null, subject = null, groupBy = 'hook', broken = 0, tail = null } = {}) {
  const inWindow = windowOf(lines, { run, hook, agent, subject })
  // ONE TALLY, in `lib/trace-read.js`, so this view and the trace report cannot count the same file differently.
  const counts = { ...tallyEvents(inWindow, broken), secondWriter: 0 }
  const skips = skipReasons(inWindow)
  const calls = inWindow.filter((record) => kindOf(record) === 'call')
  // THE SECOND WRITER IS READ TOO, and kept in its own group: dropping those lines loses evidence, pooling them
  // compares two records instead of two measurements, and reading both without merging does neither.
  // THE TURN WRITER, COUNTED BY ITS HOOK -- NOT BY ITS SHAPE. This read `answer === undefined && answers !== undefined`,
  // which is also true of every `system1_decide` line (hook `tool`), every stored-session evaluation line (hook
  // `session-review`) and every FAILED call line, so the refusal below announced "came from the turn writer" about
  // lines that came from a tool. `writerOf` names the SHAPE, and the group key keeps shapes apart; this counts the
  // one writer the sentence is about.
  counts.secondWriter = calls.filter((record) => record.hook === TURN_HOOK).length
  const groupOf = (record) => {
    if (groupBy === 'agent') return String(record.agentId ?? '(no agent)')
    if (groupBy === 'model') return String(record.model ?? '(no model)')
    if (groupBy === 'run') return String(record.run ?? '(no run)')
    return String(record.hook ?? '(no hook)')
  }
  const groups = new Map()
  for (const call of calls) {
    const key = groupOf(call) + '\u0000' + writerOf(call)
    const bucket = groups.get(key) ?? { key, writer: writerOf(call), calls: 0, agents: new Set(), models: new Set(), runs: new Set() }
    bucket.calls += 1
    if (call.agentId !== undefined) bucket.agents.add(String(call.agentId))
    if (call.model !== undefined) bucket.models.add(String(call.model))
    if (call.run !== undefined) bucket.runs.add(String(call.run))
    groups.set(key, bucket)
  }
  const mounts = inWindow.filter((r) => kindOf(r) === 'mount')
  const mountFacts = mounts.slice(-1)[0] ?? null
  // THE RUN IS THE JOIN, and this is the repository's own precedent (`lib/probe-score.js` joins the same way): a
  // MOUNT line carries what the run started with -- the model, the probe hash, and now the question set and the two
  // declared axes -- while the CALL lines carry the readings and name only their run. Without this join an agent can
  // see that a question separates and cannot say which set or which technique produced that, which is the whole of
  // item 4 of the plan.
  const runs = runsOf(inWindow, { calls })
  const refusals = []

  // THE DECLARED AXES, with "no label" counted as a VALUE rather than skipped: a window holding both labelled and
  // unlabelled lines cannot be assigned to a technique, and pretending otherwise is how an unattributed reading
  // becomes an attributed one.
  const techniques = new Set(calls.map((c) => (typeof c.harnessHash === 'string' ? c.harnessHash : 'none-declared')))
  if (techniques.size > 1) {
    refusals.push('the window spans ' + techniques.size + ' harness technique(s) (' + [...techniques].join(', ') + '): those are different treatments, so they are reported per group and never pooled' + (techniques.has('none-declared') ? ' -- and at least one line carries NO declared technique, which cannot be assigned to any of them' : ''))
  }
  const operators = new Set(calls.map((c) => (typeof c.userHash === 'string' ? c.userHash : 'none-declared')))

  if (counts.skip > 0) {
    refusals.push('asked nothing at ' + counts.skip + ' point(s); the reasons are listed, because a skip is a decision the record made and not silence')
  }
  if (counts.secondWriter > 0) {
    refusals.push(counts.secondWriter + ' call line(s) came from the turn writer, which records `answers` and `questionIds` instead of `questions` and `answer`: COUNTED here and not aggregated, because a summary of a shape the other path does not write would mix two records (finding O17)')
  }
  if (calls.length > 0) {
    if (techniques.size === 1 && techniques.has('none-declared')) {
      refusals.push('no call line records a harness technique, so a reading cannot be attributed to the technique in force; the run table below carries what each run mounted with')
    }
    if (mounts.every((m) => m.questionSetHash === undefined)) {
      refusals.push('no mount line records the QUESTION SET, so a reading cannot be attributed to the set that produced it: the runs below name the model and the probe hash only')
    }
    refusals.push('no line records whether a question was ever scored against known-answer cases, so this view cannot say whether a reading is CALIBRATED -- and an uncalibrated question at n=1000 is weaker evidence than a calibrated one at n=10')
  }
  if (operators.size > 1) {
    refusals.push('the window spans ' + operators.size + ' operator(s) (' + [...operators].join(', ') + '): comparing them is a question worth asking, but only under ONE common question set -- under two sets the comparison is of two different questions')
  }
  // THE SET AXIS, the one that matters most for the loop: a question set is part of the instrument, so two runs
  // that mounted different sets answered different questions. This refusal is what stops an iteration from being
  // read as an improvement -- the run table shows the change, and the view declines to pool across it.
  const setHashes = new Set(runs.filter((r) => r.questionSetHash !== undefined).map((r) => r.questionSetHash))
  if (setHashes.size > 1) {
    refusals.push('the window spans ' + setHashes.size + ' question set(s) (' + [...setHashes].join(', ') + '): each set asks its own questions, so these readings are reported per run and never pooled' + (runs.some((r) => r.questionSetHash === undefined) ? ' -- and at least one run mounted with no recorded set, which cannot be assigned to any of them' : ''))
  }

  const models = new Set(calls.map((c) => String(c.provider ?? '') + '/' + String(c.model ?? '')))
  if (models.size > 1) {
    refusals.push('the window spans ' + models.size + ' backend(s) (' + [...models].join(', ') + '): a probability from one is not the same event as one from another, so these are reported per group and never pooled across')
  }
  const truncated = calls.filter((c) => c.truncated === true).length
  if (truncated > 0) {
    refusals.push(truncated + ' call(s) were asked about a TRUNCATED state: a truncated excerpt is a different observation from a whole one, and the two are not pooled here')
  }
  const configChanges = inWindow.filter((r) => r.event === 'config')
  if (configChanges.length > 0) {
    const knobs = [...new Set(configChanges.map((r) => String(r.knob ?? '?')))].join(', ')
    refusals.push(configChanges.length + ' configuration change(s) fall inside this window (' + knobs + '): the lines before and after are two experiments, so read them as separate windows rather than one reading')
  }
  if (broken > 0) refusals.push(broken + ' line(s) in the file could not be parsed and are in no count but this one')
  // ABSENT RATHER THAN NULL, everywhere: the runtime's enforced schema subset takes a scalar `type`, so a field that
  // is `null` half the time cannot be declared honestly -- and declaring it as a plain string would be a lie. The
  // fields are therefore omitted when they hold nothing, which is also what a reader wants: a missing `hook` means
  // "unfiltered", and a missing `mount` means "no mount line in this window".
  const window = { groupBy }
  if (run !== null) window.run = run
  else if (mountFacts !== null && mountFacts.run !== undefined) window.run = String(mountFacts.run)
  if (hook !== null) window.hook = hook
  if (question !== null) window.question = question
  if (agent !== null) window.agent = agent
  // CARRIED ON THE WINDOW, because the package rows re-filter from it: a subject the summary forgot is a package that
  // pools every session measured since the process started, which is the defect this filter exists to close.
  if (subject !== null) window.subject = subject
  if (tail !== null) window.tail = tail
  const out = {
    window,
    counts,
    skips,
    runs,
    groups: [...groups.values()].map((bucket) => ({
      by: groupBy,
      key: bucket.key.split('\u0000')[0],
      writer: bucket.writer,
      calls: bucket.calls,
      agents: [...bucket.agents],
      models: [...bucket.models],
      runs: [...bucket.runs],
      questions: summariseQuestions(calls.filter((call) => groupOf(call) + '\u0000' + writerOf(call) === bucket.key))
        .filter((reading) => question === null || reading.id === question),
    })).filter((group) => group.questions.length > 0 || group.calls > 0).sort((a, b) => b.calls - a.calls),
    refusals,
  }
  if (mountFacts !== null) {
    const mount = { hooks: Array.isArray(mountFacts.hooks) ? mountFacts.hooks : [] }
    if (mountFacts.model !== undefined) mount.model = String(mountFacts.model)
    if (mountFacts.provider !== undefined) mount.provider = String(mountFacts.provider)
    if (mountFacts.probeHash !== undefined) mount.probeHash = String(mountFacts.probeHash)
    if (Array.isArray(mountFacts.sessions)) mount.sessions = mountFacts.sessions.length
    out.mount = mount
  }
  return out
}

export function createResultsTool({ path, runId = () => null, readFile, meta = null, version = null } = {}) {
  const read = readFile ?? ((file) => readFileSync(file, 'utf8'))
  const tool = {
    name: RESULTS_TOOL_NAME,
    description: DESCRIPTION,
    parameters,
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          skeleton: { type: 'string', description: 'For `action`: `skeleton`: the report format, numbers filled, readings blank.' },
          interpretation: {
            type: 'object', additionalProperties: false,
            description: 'For `action`: `interpret`: what was attached and the anchor it was attached to.',
            properties: {
              problem: { type: 'string', description: 'Set when nothing was attached, and why.' },
              file: { type: 'string' },
              anchor: { type: 'string', description: 'The sha256 of the `readings.json` this interpretation was written against. `sha256sum readings.json` in the package must equal it.' },
              bytes: { type: 'number' },
            },
          },
          package: {
            type: 'object', additionalProperties: false,
            description: 'For `action`: `package`: what was written, and where. ABSENT for a summary.',
            properties: {
              id: { type: 'string' },
              dir: { type: 'string', description: 'The absolute-or-relative directory written, one directory per package.' },
              files: { type: 'array', items: { type: 'string' }, description: 'manifest.json, report.md, readings.json, trace.jsonl.' },
              bytes: { type: 'number' },
              problem: { type: 'string', description: 'Set when the package could NOT be written -- most often because one is already there. A package is never overwritten.' },
            },
          },
          window: {
            type: 'object', additionalProperties: false,
            description: 'What this summary covers, so a bounded read is visible rather than implied.',
            properties: {
              run: { type: 'string', description: 'The run summarised. ABSENT when every run is in view.' },
              hook: { type: 'string', description: 'The point filtered to. ABSENT when unfiltered.' },
              question: { type: 'string', description: 'The question filtered to. ABSENT when unfiltered.' },
              agent: { type: 'string', description: 'The agent filter. ABSENT when unfiltered.' },
              groupBy: { type: 'string', description: 'How the calls were grouped.' },
              tail: { type: 'number', description: 'The line bound. ABSENT when the whole file was read.' },
            },
          },
          counts: {
            type: 'object', additionalProperties: false,
            description: 'Every line in the window, by kind -- including the ones no summary can use.',
            properties: {
              total: { type: 'number' }, call: { type: 'number' }, skip: { type: 'number' }, mount: { type: 'number' },
              config: { type: 'number' }, error: { type: 'number' }, rotate: { type: 'number' },
              other: { type: 'number' }, broken: { type: 'number' }, secondWriter: { type: 'number' },
              experiment: { type: 'number', description: 'Battery runs: statements about the INSTRUMENT, not readings about a session. Counted here and never pooled with calls.' },
            },
          },
          skips: {
            type: 'array',
            description: 'Why nothing was asked, by reason and count.',
            items: { type: 'object', additionalProperties: false, properties: { reason: { type: 'string' }, n: { type: 'number' } } },
          },
          groups: {
            type: 'array',
            description: 'The calls, grouped, with what each question\'s answers were.',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                by: { type: 'string' }, key: { type: 'string' }, writer: { type: 'string', description: 'Which writer produced these lines: `seam` or `turn`. Never pooled.' }, calls: { type: 'number' },
                agents: { type: 'array', items: { type: 'string' } },
                models: { type: 'array', items: { type: 'string' } },
                runs: { type: 'array', items: { type: 'string' } },
                questions: {
                  type: 'array',
                  items: {
                    type: 'object', additionalProperties: false,
                    properties: {
                      id: { type: 'string' },
                      type: { type: 'string' },
                      asked: { type: 'number' }, read: { type: 'number' }, unreadable: { type: 'number' }, failed: { type: 'number' },
                      values: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { value: { type: 'string' }, n: { type: 'number' } } } },
                      separates: { type: 'boolean' },
                      probabilities: {
                        type: 'object', additionalProperties: false,
                        properties: {
                          n: { type: 'number' }, min: { type: 'number' }, max: { type: 'number' }, median: { type: 'number' }, atOrAboveHalf: { type: 'number' },
                          listed: { type: 'array', items: { type: 'number' } },
                        },
                      },
                      note: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
          mount: {
            type: 'object', additionalProperties: false,
            description: 'What the run mounted with. ABSENT when no mount line is in the window.',
            properties: {
              model: { type: 'string' }, provider: { type: 'string' },
              hooks: { type: 'array', items: { type: 'string' } },
              probeHash: { type: 'string' }, sessions: { type: 'number' },
            },
          },
          runs: {
            type: 'array',
            description: 'One entry per mount line in the window: what that run started with, and how many calls it made. This is the JOIN between a reading and the set, model and technique that produced it.',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                run: { type: 'string' },
                calls: { type: 'number' },
                model: { type: 'string' },
                questionSetHash: { type: 'string' },
                harnessHash: { type: 'string' },
                userHash: { type: 'string' },
              },
            },
          },
          refusals: { type: 'array', description: 'What this view could NOT aggregate, and why.', items: { type: 'string' } },
          problem: { type: 'string', description: 'Set when the trace could not be read; when present, nothing else is a reading.' },
        },
      },
      render(_args, value) {
        if (typeof value.problem === 'string' && value.problem !== '') return [{ type: 'text', text: 'UNAVAILABLE: ' + value.problem }]
        const lines = []
        const c = value.counts
        lines.push(`lines ${c.total} = call ${c.call} + skip ${c.skip} + mount ${c.mount} + config ${c.config} + other ${c.other}${c.error > 0 ? ' + error ' + c.error : ''}${c.rotate > 0 ? ' + rotate ' + c.rotate : ''}${c.broken > 0 ? ' + unparseable ' + c.broken : ''}`)
        // THE SHARE OF SILENCE, because it is the fact most easily lost in a table of answers.
        if (c.total > 0) lines.push(`  asked something at ${c.call} of ${c.total} lines (${Math.round((c.call / c.total) * 1000) / 10}%)`)
        if (c.secondWriter > 0) lines.push(`  of those calls, ${c.secondWriter} came from the turn writer and are counted, not aggregated`)
        if (c.experiment !== undefined && c.experiment > 0) lines.push(`  ${c.experiment} battery run(s): statements about the QUESTIONS, not readings about a session -- and not in the call counts above`)
        if (value.skeleton !== undefined) return [{ type: 'text', text: value.skeleton }]
        if (value.interpretation !== undefined) {
          lines.push(value.interpretation.problem === undefined
            ? `  INTERPRETATION attached as ${value.interpretation.file}, anchored to readings.json sha256:${value.interpretation.anchor} -- an interpretation is NOT re-derivable, and the anchor is how it is checked`
            : `  INTERPRETATION NOT attached: ${value.interpretation.problem}`)
        }
        if (value.package !== undefined) {
          lines.push(value.package.problem === undefined
            ? `  PACKAGE written to ${value.package.dir} -- ${value.package.files.join(', ')} (${value.package.bytes} bytes), manifest.json carries every file's sha256`
            : `  PACKAGE NOT written: ${value.package.problem}`)
        }
        if (Array.isArray(value.runs) && value.runs.length > 0) {
          lines.push('runs (what each mounted with, and what it produced):')
          for (const run of value.runs) {
            lines.push(`  ${run.run} calls=${run.calls} model=${run.model ?? '?'} set=${run.questionSetHash ?? 'unrecorded'} harness=${run.harnessHash ?? 'unrecorded'} operator=${run.userHash ?? 'unrecorded'}`)
          }
        }
        if (value.mount !== undefined) lines.push(`  mounted: model ${value.mount.model ?? '?'} provider ${value.mount.provider ?? '?'} probeHash ${value.mount.probeHash ?? '?'} hooks ${value.mount.hooks.length}`)
        for (const group of value.groups) {
          lines.push('')
          lines.push(`${group.by} ${group.key} [${writerLabel(group)}]: ${group.calls} call(s)`)
          for (const q of group.questions) {
            const counts = q.values.map((v) => `${v.value}=${v.n}`).join(' ')
            const probs = q.probabilities === undefined ? '' :
              ` p[min ${q.probabilities.min} max ${q.probabilities.max} ${q.probabilities.atOrAboveHalf}/${q.probabilities.n} at/above 0.5]` +
              (q.probabilities.listed === undefined ? '' : ` raw ${q.probabilities.listed.join(', ')}`)
            lines.push(`  ${q.id} [${q.type ?? '?'}]: n=${q.read}${q.unreadable > 0 ? ' unreadable=' + q.unreadable : ''}${q.failed > 0 ? ' FAILED=' + q.failed + ' (asked, no answer -- a timeout or a transport failure)' : ''} ${counts}${probs}`)
            if (q.separates === false) lines.push('    NOT SEPARATING: every answer was the same')
            if (typeof q.note === 'string' && q.separates !== false) lines.push('    ' + q.note)
          }
        }
        if (value.skips.length > 0) {
          lines.push('')
          lines.push('not asked, by reason:')
          for (const skip of value.skips) lines.push(`  ${skip.n}x ${skip.reason}`)
        }
        if (value.refusals.length > 0) {
          lines.push('')
          for (const refusal of value.refusals) lines.push('NOT REPORTED: ' + refusal)
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args) {
      const empty = {
        problem: '', counts: { total: 0, call: 0, skip: 0, mount: 0, config: 0, experiment: 0, other: 0, broken: 0, secondWriter: 0 },
        skips: [], groups: [], mount: null, refusals: [],
        window: { run: null, hook: null, question: null, agent: null, subject: null, groupBy: 'hook', tail: null },
      }
      try {
        // `checkAgainst` THROWS on a bad argument rather than returning a problem -- measured, after an earlier draft
        // of this file read `.problem` off its `undefined` return and failed every call.
        checkAgainst(parameters, args ?? {}, RESULTS_TOOL_NAME)
      } catch (error) {
        return { ...empty, problem: error instanceof Error ? error.message : String(error) }
      }
      const at = new Date().toISOString()
      const file = typeof path === 'function' ? path() : path
      if (typeof file !== 'string' || file === '') {
        return { ...empty, problem: 'no trace path is configured for this row' }
      }
      let text
      try {
        text = read(file)
      } catch (error) {
        return { ...empty, problem: 'cannot read ' + file + ': ' + (error instanceof Error ? error.message : String(error)) }
      }
      const parsed = readTraceLines(text)
      const tail = typeof args.tail === 'number' && Number.isFinite(args.tail) && args.tail > 0 ? Math.floor(args.tail) : null
      const lines = tailOf(parsed.lines, tail)
      // `current` is the newest run in the file, which is what an agent iterating wants by default.
      const wanted = args.run === 'current' ? (String(lines[lines.length - 1]?.run ?? '') || runId()) : (args.run ?? null)
      const summary = summarise(lines, {
        subject: typeof args.subject === 'string' && args.subject.trim() !== '' ? args.subject.trim() : null,
        run: wanted === '' ? null : wanted,
        hook: args.hook ?? null,
        question: args.question ?? null,
        agent: args.agent ?? null,
        groupBy: args.group_by ?? 'hook',
        broken: parsed.broken,
        tail,
      })
      // ---------------------------------------------------------------------------------------------
      // THE INTERPRETATION. It is amended onto an existing package rather than written into `report.md`,
      // because the report is RE-DERIVABLE and an interpretation is not -- see `lib/report.js`.
      // ---------------------------------------------------------------------------------------------
      if (args.action === 'skeleton') {
        // THE FORMAT, EMITTED RATHER THAN DESCRIBED: numbers filled from the summary, reading column blank. See
        // `buildSkeleton` for why this is code and not a convention in a skill.
        // THE COMPARISON IS READ HERE, not inside the pure formatter: one fs read, and a missing or unreadable
        // package is a NAMED problem rather than a silently absent column.
        let against = null
        let againstProblem = null
        if (typeof args.against === 'string' && args.against.trim() !== '') {
          try {
            const readings = JSON.parse(readFile(join(args.against.trim(), 'readings.json')))
            against = { title: args.againstTitle ?? args.against.trim(), questions: questionsById(readings) }
          } catch (error) {
            againstProblem = 'the comparison at ' + args.against.trim() + ' could not be read: ' + messageOf(error)
          }
        }
        const skeleton = buildSkeleton({ summary, tables: Array.isArray(args.tables) ? args.tables : [], against, at })
        return { ...summary, skeleton: againstProblem === null ? skeleton : skeleton + '\n> COMPARISON NOT INCLUDED: ' + againstProblem + '\n' }
      }
      if (args.action === 'interpret') {
        const root = typeof args.dir === 'string' && args.dir.trim() !== '' ? args.dir.trim() : defaultPackageDir()
        const asked = typeof args.package === 'string' ? args.package.trim() : ''
        if (asked === '') return { ...summary, interpretation: { problem: '`package` is required: an interpretation is attached to a package, and there is none to attach it to' } }
        // A PATH OR AN ID. An id is resolved under `dir`, which is where `package` writes; a path is taken as given so
        // a package can be amended wherever it was put.
        const where = asked.includes('/') ? asked : join(root, asked)
        const attached = attachInterpretation(where, { text: args.text, by: args.by ?? 'unknown', at })
        // A SUCCESSFUL ATTACH CARRIES NO `problem` AT ALL. Returning `problem: null` made the render say "NOT attached:
        // null", which is the same trap `listBatteries` fell into: `null` is not a reason, and only `undefined` is
        // absent. The caller's outcome is the absence of a problem, not a null one.
        return {
          ...summary,
          interpretation: attached.problem === null
            ? { file: attached.file, anchor: attached.anchor, bytes: attached.bytes }
            : { problem: attached.problem },
        }
      }
      if (args.action !== 'package') return summary

      // ---------------------------------------------------------------------------------------------
      // THE PACKAGE. `report.md` is produced by THIS tool's own renderer over the summary that is written to
      // `readings.json`, so the prose and the data cannot describe different measurements.
      // ---------------------------------------------------------------------------------------------
      const id = packageId({ at, run: summary.window?.run ?? null })
      // THE PROSE COMES FROM THIS TOOL'S OWN RENDERER over the same summary, so `report.md` cannot describe a
      // different measurement from the one `readings.json` holds.
      const report = tool.output.render({}, summary)[0].text
      // AND THE TRACE SLICE IS THE SAME WINDOW `summarise` READ, filtered by the reader that owns that rule.
      const rows = windowOf(lines, { run: summary.window?.run ?? null, hook: summary.window?.hook ?? null, agent: summary.window?.agent ?? null, subject: summary.window?.subject ?? null })
      const pkg = buildPackage({
        id, at, report, summary, lines: rows,
        meta: { plugin: 'dsh-system1-observer', version, dsh: meta?.dsh ?? null },
      })
      const where = typeof args.dir === 'string' && args.dir.trim() !== '' ? args.dir.trim() : defaultPackageDir()
      const written = writePackage(join(where, id), pkg)
      if (written.problem !== null) return { ...summary, package: { id, dir: written.dir, files: [], problem: written.problem } }
      return { ...summary, package: { id, dir: written.dir, files: written.files, bytes: pkg.files.reduce((total, file) => total + Buffer.byteLength(file.body, 'utf8'), 0) } }
    },
  }
  return tool
}
