// SYSTEM1_BATTERY: run a LABELLED battery against a question set, and record the result as an EXPERIMENT.
//
// The loop this plugin is built around -- ask, read, rewrite, ask again -- could already say that two sets answer
// DIFFERENTLY (`system1_measurements`, with its run table and its three axes of refusal). It could not say which one
// is RIGHT, because nothing held a case whose answer was known before the rewrite. `lib/battery.js` holds those cases
// and scores them; this file is the part that spends the model calls and writes the one line that makes the result
// comparable.
//
// WHY A RUN IS AN `experiment` LINE AND NOT A READING. A reading is what a question answered about a subject. This is
// what a BATTERY answered about a QUESTION -- a statement about the instrument, not about the session -- and mixing
// the two would let an accuracy measured on five fabricated cases sit in the same table as a judgement of somebody's
// real conversation. So it is its own event kind, it carries the battery's path AND hash, and when a rewrite is being
// judged it carries the `parent` hash it is being compared against. Without that link, "better" is indistinguishable
// from "different" -- which is the whole reason this exists.
//
// IT REFUSES BEFORE IT SPENDS:
//   * a battery that cannot be read, or that has fewer cases than the floor (`lib/battery.js`);
//   * a set that cannot be resolved, or a scope it does not declare;
//   * a battery and a set that do not cover each other, in EITHER direction -- refused by `checkBattery`, because a
//     run that cannot attribute its numbers is a spend with no result;
//   * a `parent` that is not a hash, so a comparison cannot be claimed without naming what is compared.
//
// NOTHING HERE THROWS. Every failure is a named problem on the value, because a tool that throws loses the subject
// with it, and the record is the thing being built.
import { checkAgainst } from './tool-args.js'
import { join } from 'node:path'
import { BATTERY_SUFFIX, listBatteries, readBatteryFile, scoreBattery, checkBattery, MIN_CASES } from './battery.js'
import { buildQuestions } from './questions.js'
import { questionGroup } from './instrument-input.js'
import { readSelectedSet } from './question-sets.js'

export const BATTERY_TOOL_NAME = 'system1_battery'

const DESCRIPTION = [
  'Run a LABELLED battery against a question set, and see whether a rewrite made the questions BETTER or merely',
  'different. A battery is a file of cases whose answers were known BEFORE the rewrite (`cases: [{id, state,',
  'expected}]`, at least ' + MIN_CASES + '); `run` asks the set\'s questions of every case, scores each answer against the',
  'expectation and records ONE `experiment` line carrying the battery\'s hash, the set\'s hash and -- when a `parent`',
  'hash is given -- the rewrite it is being compared against. `validate` checks a battery against a set WITHOUT',
  'spending a call. Every rate is per question and is refused below the case floor. This measures the INSTRUMENT,',
  'never the session: an experiment line is not a reading and never enters the probe calibration.',
].join(' ')

const parameters = {
  type: 'object', additionalProperties: false,
  properties: {
    action: { type: 'string', enum: ['list', 'validate', 'run'], description: '`list` shows the batteries and what they cover; `validate` checks one against a set without calling a model; `run` scores it.' },
    battery: { type: 'string', description: 'The battery, by name (the file\'s stem). Required for `validate` and `run`.' },
    set: { type: 'string', description: 'The question set to judge, by name. Required for `validate` and `run`.' },
    scope: { type: 'string', description: 'Which scope of the set to judge, e.g. `session`, `turn`, `draft`. Defaults to the only scope the set declares, and is refused when the set declares more than one.' },
    parent: { type: 'string', description: 'For `run`: the hash of the set this one is a REWRITE of. Present, the run is a comparison and the recorded line links the two; absent, it is a baseline.' },
    reason: { type: 'string', description: 'For `run`: why the rewrite was made. Recorded on the line, because a rewrite that cannot say why is the symptom treatment this exists to refuse.' },
  },
}

export function createBatteryTool({ dir = () => '', setsDir = () => '', decide = null, record = null, toolId = 'system1-observer' } = {}) {
  const empty = { action: 'list', count: 0, batteries: [], problems: [] }

  /** One model call per case, all of the set's questions at once -- the cheapest shape a battery can be run in. */
  async function ask(built, state, signal) {
    // THE CALLER'S SIGNAL REACHES THE TRANSPORT, which is the only thing here that can be interrupted in flight: a
    // battery is one model call per case, and `wire.js` already knows how to abort and how to tell a cancellation
    // from a timeout. Without this the calls would run to completion after the caller walked away.
    const result = await decide({ state, questions: built.questions }, signal === undefined ? undefined : { signal })
    if (result === null || typeof result !== 'object') return { answers: {}, problem: 'the model returned no result' }
    if (result.kind === 'error') return { answers: {}, problem: String(result.reason ?? 'the model could not answer') }
    const answers = result.answers !== null && typeof result.answers === 'object' && !Array.isArray(result.answers) ? result.answers : {}
    return { answers, problem: null }
  }

  return {
    name: BATTERY_TOOL_NAME,
    description: DESCRIPTION,
    parameters,
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          action: { type: 'string' },
          count: { type: 'number' },
          batteries: {
            type: 'array',
            description: 'For `list`: the batteries, with the case count and the questions each covers.',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                name: { type: 'string' },
                hash: { type: 'string' },
                cases: { type: 'number' },
                questions: { type: 'array', items: { type: 'string' } },
                problem: { type: 'string' },
              },
            },
          },
          battery: { type: 'object', additionalProperties: false, properties: { name: { type: 'string' }, hash: { type: 'string' }, cases: { type: 'number' } } },
          set: { type: 'object', additionalProperties: false, properties: { name: { type: 'string' }, scope: { type: 'string' }, hash: { type: 'string' } } },
          questions: {
            type: 'array',
            description: 'For `run`: one row per question -- n, correct, unreadable, and an accuracy only when `publishable`.',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                id: { type: 'string' },
                type: { type: 'string' },
                n: { type: 'number' },
                correct: { type: 'number' },
                unreadable: { type: 'number' },
                accuracy: { type: 'number' },
                publishable: { type: 'boolean' },
              },
            },
          },
          wrong: {
            type: 'array',
            description: 'For `run`: the cases that were not fully right, so a run can be inspected rather than only counted.',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                caseId: { type: 'string' },
                wrong: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, expected: { type: 'json', description: 'What the battery said.' }, got: { type: 'json', description: 'What the instrument answered.' }, reason: { type: 'string' } } } },
              },
            },
          },
          refusals: { type: 'array', description: 'Numbers that may NOT be read from this run, and why.', items: { type: 'string' } },
          problems: { type: 'array', description: 'Anything that could not be done, named rather than silent.', items: { type: 'string' } },
          problem: { type: 'string', description: 'Set when the call could not be made at all.' },
        },
      },
      render(_args, value) {
        if (typeof value.problem === 'string' && value.problem !== '') return [{ type: 'text', text: 'UNAVAILABLE: ' + value.problem }]
        const lines = []
        if (value.action === 'list') {
          lines.push(`${value.count} battery(ies)`)
          for (const row of value.batteries ?? []) {
            lines.push(row.problem === undefined
              ? `  ${row.name} [${row.hash}] ${row.cases} case(s) covering ${(row.questions ?? []).join(', ')}`
              : `  ${row.name} BROKEN: ${row.problem}`)
          }
        } else if (value.action === 'validate') {
          lines.push(`battery ${value.battery?.name ?? '?'} [${value.battery?.hash ?? '?'}] ${value.battery?.cases ?? 0} case(s) against set ${value.set?.name ?? '?'} scope ${value.set?.scope ?? '?'}`)
          lines.push((value.problems ?? []).length === 0 ? '  the battery and the set cover each other, and no model call was made' : '')
        } else {
          lines.push(`battery ${value.battery?.name ?? '?'} [${value.battery?.hash ?? '?'}] against set ${value.set?.name ?? '?'} scope ${value.set?.scope ?? '?'}`)
          lines.push('  per question (accuracy is the share of cases whose EXPECTED answer was given):')
          for (const q of value.questions ?? []) {
            lines.push(`    ${q.id} [${q.type ?? '?'}]: ` + (q.publishable === true
              ? `${q.correct}/${q.n} = ${Math.round(q.accuracy * 1000) / 10}%${q.unreadable > 0 ? ' (unreadable ' + q.unreadable + ')' : ''}`
              : `n=${q.n}, BELOW the floor of ${MIN_CASES}: no rate is published`))
          }
          for (const entry of (value.wrong ?? []).slice(0, 5)) {
            lines.push(`  case ${entry.caseId}: ` + entry.wrong.map((w) => `${w.id} expected ${JSON.stringify(w.expected)}${w.reason === null || w.reason === undefined ? '' : ' (' + w.reason + ')'}`).join('; '))
          }
        }
        for (const refusal of value.refusals ?? []) lines.push('REFUSED: ' + refusal)
        for (const problem of value.problems ?? []) lines.push('PROBLEM: ' + problem)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args, exec) {
      // THE CALLER'S CANCELLATION, HONOURED BEFORE ANY WORK. `reference/cookbook/adding-a-tool.md:49` requires it:
      // "honour `exec.signal`; cancel in-flight work when it fires". What this tool does is interruptible BETWEEN CASES, so the check below is not the whole
      // maximum here.
      if (exec?.signal?.aborted === true) throw new Error('the call was cancelled before it started')
      let asked
      try {
        checkAgainst(parameters, args ?? {}, BATTERY_TOOL_NAME)
        asked = args ?? {}
      } catch (error) {
        return Object.assign({}, empty, { problem: error instanceof Error ? error.message : String(error) })
      }
      const action = String(asked.action ?? 'list')
      const where = String(dir() ?? '')
      if (where === '' && action === 'list') return Object.assign({}, empty, { action, problem: 'no battery directory is configured for this row' })

      if (action === 'list') {
        const listed = listBatteries(where)
        if (listed.problem !== null) return Object.assign({}, empty, { action, problem: listed.problem })
        return { action, count: listed.batteries.length, batteries: listed.batteries, problems: [] }
      }

      if (typeof asked.battery !== 'string' || asked.battery.trim() === '') return Object.assign({}, empty, { action, problems: ['`battery` is required'] })
      if (typeof asked.set !== 'string' || asked.set.trim() === '') return Object.assign({}, empty, { action, problems: ['`set` is required'] })
      const name = asked.battery.trim()
      const read = readBatteryFile(join(where, name + BATTERY_SUFFIX))
      if (read.problem !== null) return Object.assign({}, empty, { action, problems: [read.problem] })

      // THE SET, AND THE SCOPE WITHIN IT. A scope the set does not declare is refused rather than defaulted: judging
      // `turn` questions that live under `session` would measure a composition nobody wrote.
      const selected = readSelectedSet(String(setsDir() ?? ''), String(asked.set).trim())
      if (selected.problem !== null) return Object.assign({}, empty, { action, problems: [selected.problem] })
      const scopes = Object.keys(selected.questions ?? {})
      const scope = typeof asked.scope === 'string' && asked.scope.trim() !== ''
        ? asked.scope.trim()
        : (scopes.length === 1 ? scopes[0] : '')
      if (scope === '') return Object.assign({}, empty, { action, problems: ['`scope` is required: this set declares ' + (scopes.length === 0 ? 'no scopes' : scopes.join(', '))] })
      if (!scopes.includes(scope)) return Object.assign({}, empty, { action, problems: ['`' + scope + '` is not a scope this set declares (' + scopes.join(', ') + ')'] })

      const built = buildQuestions(questionGroup({ questions: { [scope]: selected.questions[scope] } }), scope)
      if (built.problems.length > 0) return Object.assign({}, empty, { action, problems: [built.problems[0]] })
      const questionIds = Object.keys(built.questions)
      const battery = { name, hash: read.hash, cases: read.battery.cases.length }
      const set = { name: String(asked.set).trim(), scope, hash: selected.hash }

      const check = checkBattery(read.battery, questionIds)
      if (action === 'validate') {
        const problems = [...check.problems]
        if (typeof asked.parent === 'string' && asked.parent.trim() !== '' && !/^[0-9a-f]{6,}$/.test(asked.parent.trim())) {
          problems.push('`parent` must be a set hash, so a comparison says which two things are compared')
        }
        return { action, count: 0, batteries: [], battery, set, questions: questionIds.map((id) => ({ id })), problems }
      }

      // REFUSE BEFORE SPENDING. A battery and a set that do not cover each other cannot attribute their numbers, and a
      // run of five cases is the floor for a rate -- so a mis-covering battery is refused rather than run and caveated.
      if (check.problems.length > 0) return { action, count: 0, batteries: [], battery, set, questions: [], problems: check.problems }
      if (typeof decide !== 'function') return { action, count: 0, batteries: [], battery, set, questions: [], problems: ['no model client is wired, so a battery cannot be run here'] }
      const parent = typeof asked.parent === 'string' && asked.parent.trim() !== '' ? asked.parent.trim() : null
      if (parent !== null && !/^[0-9a-f]{6,}$/.test(parent)) {
        return { action, count: 0, batteries: [], battery, set, questions: [], problems: ['`parent` must be a set hash, so a comparison says which two things are compared'] }
      }

      const answersByCase = {}
      const problems = []
      for (const entry of read.battery.cases) {
        // AND BETWEEN CASES, because a battery is the longest thing an agent can ask for here -- one model call per
        // case. A PARTIAL RUN IS NOT RECORDED AS AN EXPERIMENT: a rate over the cases that happened to finish is a
        // different measurement under the battery's own name, which this repository refuses everywhere else, so the
        // cancellation is returned as the named refusal it is rather than scored.
        if (exec?.signal?.aborted === true) {
          return {
            action, count: 0, batteries: [], battery, set, questions: [],
            problems: ['the run was cancelled after ' + Object.keys(answersByCase).length + ' of ' + read.battery.cases.length + ' case(s); no experiment was recorded, because a rate over the cases that finished is a different measurement under this battery\'s name'],
          }
        }
        const asked2 = await ask(built, entry.state, exec?.signal)
        answersByCase[entry.id] = asked2.answers
        if (asked2.problem !== null) problems.push('case "' + entry.id + '": ' + asked2.problem)
      }
      const score = scoreBattery({
        battery: read.battery,
        answersByCase,
        questionTypes: Object.fromEntries(Object.entries(built.questions).map(([id, question]) => [id, question.type])),
      })

      // THE LINE, AND IT IS NOT A READING. `event: 'experiment'` carries what was compared and what came of it; the
      // three axes a reader needs to tell two experiments apart are the battery's hash, the set's hash and the parent.
      if (typeof record === 'function') {
        record({
          event: 'experiment',
          tool: toolId,
          set: set.name,
          setHash: set.hash,
          scope,
          battery: read.path,
          batteryHash: read.hash,
          cases: read.battery.cases.length,
          parent,
          reason: typeof asked.reason === 'string' && asked.reason.trim() !== '' ? asked.reason.trim() : null,
          questions: score.perQuestion.map((row) => ({ id: row.id, n: row.n, correct: row.correct, unreadable: row.unreadable, accuracy: row.accuracy })),
          // WHICH CASES WERE WRONG, AND WHAT THEY GOT. A per-question accuracy alone cannot be diagnosed -- 12.5% is
          // either a broken question, a broken battery or a broken model, and the labels that were given are what
          // tells the three apart. Compact on purpose: four fields per miss, and only for the misses.
          wrong: score.perCase
            .filter((entry) => entry.wrong.length > 0)
            .map((entry) => ({ case: entry.id, misses: entry.wrong.map((miss) => ({ id: miss.id, expected: miss.expected, got: miss.got })) })),
        })
      }
      return {
        action,
        count: 0,
        batteries: [],
        battery,
        set,
        questions: score.perQuestion,
        wrong: score.perCase.filter((entry) => entry.wrong.length > 0).map((entry) => ({ caseId: entry.id, wrong: entry.wrong })),
        refusals: score.refusals,
        problems,
      }
    },
  }
}
