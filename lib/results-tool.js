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
import { checkAgainst } from './tool-args.js'

export const RESULTS_TOOL_NAME = 'system1_results'

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
  type: 'object',
  additionalProperties: false,
  properties: {
    run: { type: 'string', description: 'Which run to summarise: a run id or its prefix, `current` for the newest, or omitted for every run in the file.' },
    hook: { type: 'string', description: 'Only this point: a seam name, `turn`, or `session-review`.' },
    question: { type: 'string', description: 'Only this question id.' },
    agent: { type: 'string', description: 'Only lines whose `agentId` contains this text.' },
    group_by: { type: 'string', enum: ['hook', 'agent', 'model', 'run'], description: 'How to group the calls. Defaults to `hook`.' },
    tail: { type: 'number', description: 'Read only the last N lines. Defaults to the whole file, which is what the counts then describe.' },
  },
}

/** Parse the trace text into records, counting what could not be parsed rather than dropping it silently. */
export function readLines(text) {
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

/**
 * THE ANSWER, as one value a reader can count.
 *
 * The shapes come from the model's own narrowing (`lib/model/service-answers.js`): a `noul` carries a probability, a
 * `score` a level, a `choice` a label, and every one may carry a `probabilities` map. Anything else is `unreadable`,
 * and unreadable answers are COUNTED rather than treated as a value -- an answer that cannot be read is a fact about
 * the question's shape, not an answer of "unknown".
 */
export function answerValue(answered) {
  if (answered === null || typeof answered !== 'object') return null
  if (typeof answered.label === 'string' && answered.label !== '') return { value: answered.label, kind: 'label' }
  if (typeof answered.level === 'string' && answered.level !== '') return { value: answered.level, kind: 'level' }
  for (const key of ['probability', 'probabilityTrue', 'p']) {
    const number = answered[key]
    if (typeof number === 'number' && Number.isFinite(number)) return { value: number, kind: 'probability' }
  }
  if (answered.type === 'noul' && typeof answered.confidence === 'number') return null
  return null
}

/** Aggregate calls into per-question readings, refusing to invent a summary the n cannot carry. */
/**
 * WHICH WRITER PRODUCED THIS LINE.
 *
 * The seams write `questions` and `answer`; the scheduled turn path writes `questionIds` and `answers` (finding O17).
 * The distinction is reported rather than erased: both are read, and the two are never pooled.
 */
export function writerOf(record) {
  if (record.answer !== undefined) return 'seam'
  if (record.answers !== undefined) return 'turn'
  return 'unknown'
}

export function summariseQuestions(calls) {
  const byQuestion = new Map()
  for (const call of calls) {
    // NORMALISED ON READ, so no line's answer is lost -- and the WRITER is carried through, so the two can be
    // reported side by side and never pooled: the turn subset is written by a different code path, and a pooled
    // number across it would be a comparison of two records rather than of two measurements.
    const answer = writerOf(call) === 'seam' ? call.answer : null
    const answered = writerOf(call) === 'seam'
      ? (answer !== null && typeof answer === 'object' && answer.answers !== null && typeof answer.answers === 'object' ? answer.answers : null)
      : (call.answers !== null && typeof call.answers === 'object' && !Array.isArray(call.answers) ? call.answers : null)
    const specs = writerOf(call) === 'seam'
      ? (call.questions !== null && typeof call.questions === 'object' && !Array.isArray(call.questions) ? call.questions : {})
      : {}
    const ids = answered === null ? Object.keys(specs) : Object.keys(answered)
    for (const id of ids) {
      const entry = byQuestion.get(id) ?? { id, type: null, asked: 0, read: 0, unreadable: 0, labels: new Map(), levels: new Map(), probabilities: [] }
      entry.asked += 1
      const spec = specs[id]
      if (entry.type === null && spec !== null && typeof spec === 'object' && typeof spec.type === 'string') entry.type = spec.type
      if (answered !== null && answered[id] !== undefined) {
        const read = answerValue(answered[id])
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
      reading.note = (reading.note === undefined ? '' : reading.note + '; ') + 'every answer was the same: this question is not separating'
    }
    return reading
  }).sort((a, b) => b.read - a.read || a.id.localeCompare(b.id))
}

/** The whole summary, over already-parsed lines. Pure, so the tests can drive it without a file. */
export function summarise(lines, { run = null, hook = null, question = null, agent = null, groupBy = 'hook', broken = 0, tail = null } = {}) {
  const inWindow = lines.filter((record) => {
    if (run !== null && String(record.run ?? '') !== run) return false
    if (hook !== null && record.hook !== hook) return false
    if (agent !== null && !String(record.agentId ?? '').includes(agent)) return false
    return true
  })
  const counts = { total: lines.length, call: 0, skip: 0, mount: 0, config: 0, other: 0 }
  const skips = new Map()
  const calls = []
  const secondWriter = []
  for (const record of inWindow) {
    const event = String(record.event ?? 'other')
    if (event === 'call') {
      counts.call += 1
      // THE SECOND WRITER IS READ TOO, and kept in its own group by `writerOf` -- the review's correction of this
      // file's first draft, which counted those lines and dropped them. Dropping them loses evidence; pooling them
      // with the seam lines compares two records instead of two measurements. Reading both and never merging them
      // does neither.
      if (record.answer === undefined && record.answers !== undefined) secondWriter.push(record)
      calls.push(record)
      continue
    }
    if (event === 'skip') { counts.skip += 1; skips.set(String(record.reason ?? 'no reason recorded'), (skips.get(String(record.reason ?? 'no reason recorded')) ?? 0) + 1); continue }
    if (event === 'mount') { counts.mount += 1; continue }
    if (event === 'config') { counts.config += 1; continue }
    counts.other += 1
  }
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
  const mountFacts = inWindow.filter((r) => r.event === 'mount').slice(-1)[0] ?? null
  const refusals = []
  if (counts.skip > 0) {
    refusals.push('asked nothing at ' + counts.skip + ' point(s); the reasons are listed, because a skip is a decision the record made and not silence')
  }
  if (secondWriter.length > 0) {
    refusals.push(secondWriter.length + ' call line(s) came from the turn writer, which records `answers` and `questionIds` instead of `questions` and `answer`: COUNTED here and not aggregated, because a summary of a shape the other path does not write would mix two records (finding O17)')
  }
  if (calls.length > 0) {
    refusals.push('no call line records the question set or the harness technique, so a reading cannot be attributed to the set or the technique in force; the mount line below carries the model and the probe hash only')
    refusals.push('no line records whether a question was ever scored against known-answer cases, so this view cannot say whether a reading is CALIBRATED -- and an uncalibrated question at n=1000 is weaker evidence than a calibrated one at n=10')
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
  if (tail !== null) window.tail = tail
  const out = {
    window,
    counts: { ...counts, broken, secondWriter: secondWriter.length },
    skips: [...skips.entries()].map(([reason, n]) => ({ reason, n })).sort((a, b) => b.n - a.n),
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

export function createResultsTool({ path, runId = () => null, readFile } = {}) {
  const read = readFile ?? ((file) => readFileSync(file, 'utf8'))
  const tool = {
    name: RESULTS_TOOL_NAME,
    description: DESCRIPTION,
    parameters,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          window: {
            type: 'object',
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
            type: 'object',
            description: 'Every line in the window, by kind -- including the ones no summary can use.',
            properties: {
              total: { type: 'number' }, call: { type: 'number' }, skip: { type: 'number' }, mount: { type: 'number' },
              config: { type: 'number' }, other: { type: 'number' }, broken: { type: 'number' }, secondWriter: { type: 'number' },
            },
          },
          skips: {
            type: 'array',
            description: 'Why nothing was asked, by reason and count.',
            items: { type: 'object', properties: { reason: { type: 'string' }, n: { type: 'number' } } },
          },
          groups: {
            type: 'array',
            description: 'The calls, grouped, with what each question\'s answers were.',
            items: {
              type: 'object',
              properties: {
                by: { type: 'string' }, key: { type: 'string' }, writer: { type: 'string', description: 'Which writer produced these lines: `seam` or `turn`. Never pooled.' }, calls: { type: 'number' },
                agents: { type: 'array', items: { type: 'string' } },
                models: { type: 'array', items: { type: 'string' } },
                runs: { type: 'array', items: { type: 'string' } },
                questions: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      type: { type: 'string' },
                      asked: { type: 'number' }, read: { type: 'number' }, unreadable: { type: 'number' },
                      values: { type: 'array', items: { type: 'object', properties: { value: { type: 'string' }, n: { type: 'number' } } } },
                      separates: { type: 'boolean' },
                      probabilities: {
                        type: 'object',
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
            type: 'object',
            description: 'What the run mounted with. ABSENT when no mount line is in the window.',
            properties: {
              model: { type: 'string' }, provider: { type: 'string' },
              hooks: { type: 'array', items: { type: 'string' } },
              probeHash: { type: 'string' }, sessions: { type: 'number' },
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
        lines.push(`lines ${c.total} = call ${c.call} + skip ${c.skip} + mount ${c.mount} + config ${c.config} + other ${c.other}${c.broken > 0 ? ' + unparseable ' + c.broken : ''}`)
        // THE SHARE OF SILENCE, because it is the fact most easily lost in a table of answers.
        if (c.total > 0) lines.push(`  asked something at ${c.call} of ${c.total} lines (${Math.round((c.call / c.total) * 1000) / 10}%)`)
        if (c.secondWriter > 0) lines.push(`  of those calls, ${c.secondWriter} came from the turn writer and are counted, not aggregated`)
        if (value.mount !== undefined) lines.push(`  mounted: model ${value.mount.model ?? '?'} provider ${value.mount.provider ?? '?'} probeHash ${value.mount.probeHash ?? '?'} hooks ${value.mount.hooks.length}`)
        for (const group of value.groups) {
          lines.push('')
          lines.push(`${group.by} ${group.key} [${group.writer} writer]: ${group.calls} call(s)`)
          for (const q of group.questions) {
            const counts = q.values.map((v) => `${v.value}=${v.n}`).join(' ')
            const probs = q.probabilities === undefined ? '' :
              ` p[min ${q.probabilities.min} max ${q.probabilities.max} ${q.probabilities.atOrAboveHalf}/${q.probabilities.n} at/above 0.5]` +
              (q.probabilities.listed === undefined ? '' : ` raw ${q.probabilities.listed.join(', ')}`)
            lines.push(`  ${q.id} [${q.type ?? '?'}]: n=${q.read}${q.unreadable > 0 ? ' unreadable=' + q.unreadable : ''} ${counts}${probs}`)
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
        problem: '', counts: { total: 0, call: 0, skip: 0, mount: 0, config: 0, other: 0, broken: 0, secondWriter: 0 },
        skips: [], groups: [], mount: null, refusals: [],
        window: { run: null, hook: null, question: null, agent: null, groupBy: 'hook', tail: null },
      }
      try {
        // `checkAgainst` THROWS on a bad argument rather than returning a problem -- measured, after an earlier draft
        // of this file read `.problem` off its `undefined` return and failed every call.
        checkAgainst(parameters, args ?? {}, RESULTS_TOOL_NAME)
      } catch (error) {
        return { ...empty, problem: error instanceof Error ? error.message : String(error) }
      }
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
      const parsed = readLines(text)
      const tail = typeof args.tail === 'number' && Number.isFinite(args.tail) && args.tail > 0 ? Math.floor(args.tail) : null
      const lines = tail === null ? parsed.lines : parsed.lines.slice(-tail)
      // `current` is the newest run in the file, which is what an agent iterating wants by default.
      const wanted = args.run === 'current' ? (String(lines[lines.length - 1]?.run ?? '') || runId()) : (args.run ?? null)
      return summarise(lines, {
        run: wanted === '' ? null : wanted,
        hook: args.hook ?? null,
        question: args.question ?? null,
        agent: args.agent ?? null,
        groupBy: args.group_by ?? 'hook',
        broken: parsed.broken,
        tail,
      })
    },
  }
  return tool
}
