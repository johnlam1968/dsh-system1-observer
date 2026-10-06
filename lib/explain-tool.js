// WHAT THIS OBSERVER CAN DO, WHAT IT IS SET TO DO NOW, AND WHAT ONLY YAML CAN CHANGE.
//
// WHY A TOOL RATHER THAN A PARAGRAPH. The README explains all of this and an agent on a task does not read it: a tool
// is advertised in the list the model is handed before it chooses anything, so the explanation arrives at the moment
// it is relevant. That is the whole argument, and the operator made it.
//
// AND WHY IT DERIVES RATHER THAN RESTATES. Every fact below that CAN be read from the runtime IS read from it at call
// time: which knobs are writable comes from the schema's own `volatile` metadata, the live values from the running
// row, the set list from the directory the row points at. Only the sentence "what this is" and the two mount-bound
// REASONS are prose, and `test/explain-tool.test.js` asserts the derived halves EQUAL the schema's facts -- so a knob
// added tomorrow appears here without anybody remembering to write it down, and the day one of these lists disagrees
// with the code the test fails rather than the reader being misled. That is the failure this repository has already
// paid for twice (a README row that named a seam-to-event map `lib/seams.js` no longer had, and a comment promising a
// probe fallback the code never had -- `F123`).
import { isRecord } from './is-record.js'
import { PROBE_SEAMS, TEXTLESS_SEAMS, PROBE_QUESTION } from './seams.js'

/** The tool's name, in the `system1_` namespace the other eight use. */
export const EXPLAIN_TOOL_NAME = 'system1_explain'

/** One line per tool this plugin registers. The NAMES come from the modules; this is what each one is for. */
export const TOOL_SUMMARIES = Object.freeze({
  system1_explain: 'this brief: what can be changed live, what is set now, and what a reading does not cover',
  system1_settings: 'read or change this row: 42 of the 44 settings are writable live, and a change is recorded on the trace first',
  system1_decide: 'ask the decision model one question set about one state, without a session',
  system1_evaluate_session: 'judge a WHOLE session (stored or live): name the set, the scope and the evidence groups in the call',
  system1_measurements: 'read the trace as measurements: per-question rates, windows, and a durable package on request',
  system1_sessions: 'find a session and read it: the list can be filtered to conversations or to subagent runs',
  system1_question_sets: 'list, read, VALIDATE and WRITE question sets -- the agent authors the instruments here',
  system1_battery: 'score a question set against labelled cases: the only thing that tells a better set from a different one',
  system1_trace: 'read the raw record: what was asked at each seam, what came back, and every skip with its reason',
})

/** Why the two mount-bound fields are mount-bound. The LIST is derived; these sentences are the author's. */
const MOUNT_BOUND_REASONS = Object.freeze({
  probeQuestion: 'its text IS the instrument identity: `probeFingerprint` hashes it onto the MOUNT line and into the comparability key, so a mid-run change would score calls under one question and key them under another. Reword it in YAML and re-mount; the new hash then makes the runs honestly incomparable. The answer set is fixed for the same reason',
  tracePath: 'the sink is opened once, when the row is applied, and the path is written on the MOUNT line. A live change would split one run across two files under a single mount line',
})

/** The cautions that decide whether a reading may be trusted. Each one is measured, and each names its row. */
const CAUTIONS = Object.freeze([
  'A WHOLE-SESSION JUDGEMENT IS CAPPED unless you segment it: the row composes about `composeMaxChars` (default 8000) and says `TRUNCATED`. Pass `segmentChars: 57600` for a long session, or read the coverage line as a fraction of the conversation.',
  'SELECTING A SET DISABLES THE PROBE AT THE SEAMS IT DOES NOT NAME. A set declaring only `session` puts the row in per-seam mode, so every seam asks NOTHING and records `no question configured for this seam` -- a session-only set turns the seam probe off. To have both, select a set that declares seam scopes or select none.',
  'THE PROBE\'S ACCURACY DEPENDS ON THE SEAM MIX, and the four tool seams are shown two texts and asked four labels: `pre_execute`/`execute` both receive `name + arguments`, and `post_execute`/`result` both receive the result envelope. One member of each pair therefore scores near 1 and the other near 0, and a tool-heavy window measures the instrument at its weakest.',
  'A ROW WHOSE DEFAULT SET DECLARES NO `session` SCOPE ANSWERS A WHOLE-SESSION JUDGEMENT WITH ITS **TURN** QUESTIONS. The resolution ladder is the caller\'s set, then the row\'s set, then the plugin\'s own `session@1`, and the middle rung falls through BY SCOPE: selecting a set that declares only `turn` makes a session judgement ask the turn questions rather than refuse. Name the set in the call (`set: \'session@1\'`) when the row\'s default is not what you mean.',
  'READINGS EITHER SIDE OF A CONFIG CHANGE ARE NOT COMPARABLE, which is why every change writes a `config` line first. The mount line carries the probe hash and the set hash; `system1_measurements` refuses to attribute a reading to a technique or a set a run never recorded.',
  'A SKIP LINE IS THE RECORD OF NOT MEASURING, and it names which gate stopped it -- the master switch, the session allow-list, that seam\'s switch, no text at the seam, or no question for it. A quiet trace is read through those reasons, never assumed.',
])

/**
 * The facts, read from the runtime. Never throws: a partial config is a partial answer, not an error in a tool whose
 * whole purpose is to be safe to call first.
 */
export function explainFacts({ dict = {}, config = {}, sets = null, tracePath = '', measurementsDir = '', tools = [] } = {}) {
  const names = Object.keys(isRecord(dict) ? dict : {})
  const source = isRecord(config) ? config : {}
  const writable = names.filter((name) => dict[name]?.meta?.volatile === true).sort()
  const mountBound = names.filter((name) => dict[name]?.meta?.volatile !== true).sort()
  const seamEnabled = isRecord(source.seamEnabled) ? source.seamEnabled : {}
  return {
    what: 'A seam observer for the DeepSeek Harness: it calls a System One decision model at configured points of the agent loop, writes every call, every skip and every answer to a JSONL trace, and DECIDES NOTHING -- each listener returns the loop\'s own decision by reference, and every line says `enforcement: "declarative", verified: false`.',
    agentWritable: writable,
    mountBound: mountBound.map((name) => ({ name, reason: MOUNT_BOUND_REASONS[name] ?? 'read once, when the row is applied, so it is YAML-only' })),
    live: {
      callsEnabled: source.callsEnabled !== false,
      // THE SEAMS THAT ARE OFF, minus the two that carry no text: those are inapplicable, not switched off, and a list
      // that could not tell them apart would report a decision nobody made.
      seamsOff: PROBE_SEAMS.filter((seam) => !TEXTLESS_SEAMS.some((textless) => textless === seam) && seamEnabled[seam] === false),
      sessions: Array.isArray(source.sessions) ? source.sessions.map((id) => String(id)) : [],
      questionSet: typeof source.questionSet === 'string' ? source.questionSet : '',
      questionSetsDir: typeof source.questionSetsDir === 'string' ? source.questionSetsDir : '',
      turnEveryNTurns: Number.isFinite(Number(source.turnEveryNTurns)) ? Number(source.turnEveryNTurns) : 0,
      observeSubagents: source.observeSubagents === true,
      includeNonOperatorFacing: source.includeNonOperatorFacing === true,
      probe: typeof source.probeQuestion === 'string' && source.probeQuestion.trim() !== '' ? 'reworded in YAML (a different instrument; its hash is on the MOUNT line)' : `the built-in one (${PROBE_QUESTION.instructions})`,
      tracePath: String(tracePath ?? ''),
      measurementsDir: String(measurementsDir ?? ''),
    },
    questionSets: isRecord(sets) ? sets : { dir: '', selected: '', available: [] },
    tools: Array.isArray(tools) ? tools : [],
    cautions: [...CAUTIONS],
  }
}

const OUTPUT = {
  type: 'object', additionalProperties: false,
  properties: {
    what: { type: 'string', description: 'What this observer is, and the one property that makes it safe to run: it decides nothing.' },
    agentWritable: { type: 'array', items: { type: 'string' }, description: 'Every setting an agent may change LIVE with `system1_settings`. Derived from the schema, so it cannot go stale.' },
    mountBound: {
      type: 'array',
      description: 'The settings that are NOT live-writable, and why. Two today: the probe question and the trace path.',
      items: { type: 'object', additionalProperties: false, properties: { name: { type: 'string' }, reason: { type: 'string' } } },
    },
    live: {
      type: 'object', additionalProperties: false,
      description: 'What the row is set to do RIGHT NOW, so an agent does not have to read the settings table to find out.',
      properties: {
        callsEnabled: { type: 'boolean' },
        seamsOff: { type: 'array', items: { type: 'string' }, description: 'The seams whose calls are switched off. A seam absent from this list is on.' },
        sessions: { type: 'array', items: { type: 'string' }, description: 'The observe allow-list: `["*"]` is every session, `[]` is none.' },
        questionSet: { type: 'string', description: 'The set the row uses when a call does not name one. Empty means the row\'s inline questions, and then the probe.' },
        questionSetsDir: { type: 'string' },
        turnEveryNTurns: { type: 'number', description: 'The scheduled turn measurement: 0 is off, otherwise one measurement every N turns.' },
        observeSubagents: { type: 'boolean', description: 'Whether worker (subagent) sessions are observed like any other. Off means their seams record a skip.' },
        includeNonOperatorFacing: { type: 'boolean', description: 'Whether the harness\'s own purpose-tagged streams (titles, compaction) are observed.' },
        probe: { type: 'string', description: 'Which probe question is in force, and whether it is the built-in one.' },
        tracePath: { type: 'string' },
        measurementsDir: { type: 'string' },
      },
    },
    questionSets: {
      type: 'object', additionalProperties: false,
      description: 'The sets this row can see. Every one of these can be chosen per call without changing the row.',
      properties: {
        dir: { type: 'string' },
        selected: { type: 'string' },
        available: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { name: { type: 'string' }, scopes: { type: 'array', items: { type: 'string' } }, hash: { type: 'string' } } } },
      },
    },
    tools: { type: 'array', description: 'Every tool this plugin registers, and what it is for.', items: { type: 'object', additionalProperties: false, properties: { name: { type: 'string' }, what: { type: 'string' } } } },
    cautions: { type: 'array', items: { type: 'string' }, description: 'What a reading from this trace does and does not cover. Each one is a measured observation, not a hedge.' },
  },
}

const render = (_args, value) => {
  const lines = []
  lines.push(value.what)
  lines.push('')
  lines.push(`WRITABLE LIVE (${value.agentWritable.length}): ${value.agentWritable.join(', ')}`)
  for (const entry of value.mountBound) lines.push(`MOUNT-BOUND: ${entry.name} -- ${entry.reason}`)
  const live = value.live ?? {}
  lines.push('')
  lines.push('SET NOW:')
  lines.push(`  calls ${live.callsEnabled === false ? 'OFF' : 'on'} | seams off: ${(live.seamsOff ?? []).length === 0 ? 'none' : live.seamsOff.join(', ')}`)
  lines.push(`  sessions: ${(live.sessions ?? []).join(', ') || '(none -- nothing is observed)'} | worker sessions: ${live.observeSubagents === true ? 'observed' : 'skipped'} | harness streams: ${live.includeNonOperatorFacing === true ? 'observed' : 'skipped'}`)
  lines.push(`  set in force: ${live.questionSet === '' ? '(none -- the row\'s inline questions, then the probe)' : live.questionSet} | sets dir: ${live.questionSetsDir}`)
  lines.push(`  scheduled turn measurement: ${live.turnEveryNTurns > 0 ? 'every ' + live.turnEveryNTurns + ' turn(s)' : 'off'}`)
  lines.push(`  probe: ${live.probe}`)
  lines.push(`  trace: ${live.tracePath} | packages: ${live.measurementsDir}`)
  const sets = value.questionSets ?? {}
  lines.push('')
  lines.push(`QUESTION SETS (${(sets.available ?? []).length} visible in ${sets.dir || '?'}) -- name one in a call with the \`set\` parameter, or write a new one with system1_question_sets:`)
  for (const set of (sets.available ?? []).slice(0, 12)) lines.push(`  ${set.name} [${set.hash}] ${(set.scopes ?? []).join(', ')}`)
  if ((sets.available ?? []).length > 12) lines.push(`  ... and ${sets.available.length - 12} more`)
  lines.push('')
  lines.push('TOOLS:')
  for (const tool of value.tools ?? []) lines.push(`  ${tool.name} -- ${tool.what}`)
  lines.push('')
  lines.push('BEFORE YOU TRUST A READING:')
  for (const caution of value.cautions ?? []) lines.push(`  - ${caution}`)
  return [{ type: 'text', text: lines.join('\n') }]
}

/**
 * The tool. `facts` is a function so that every call reports the row AS IT IS, not as it was when it was mounted.
 *
 * @param facts `() => explainFacts(...)`, built by `index.js` from the live config, the schema and the set directory
 */
export function createExplainTool({ facts = () => explainFacts() } = {}) {
  return {
    name: EXPLAIN_TOOL_NAME,
    description: 'Call this FIRST, before configuring or measuring: what this observer can do, which settings you may change live (all but two), which question sets are visible and how to choose, write or validate one, what the row is set to right now, and the cautions that decide whether a reading can be trusted.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    output: { schema: OUTPUT, render },
    async execute(args, exec) {
      void args
      // THE CALLER'S CANCELLATION, HONOURED BEFORE ANY WORK (`adding-a-tool.md:49`); nothing here can be interrupted
      // mid-flight, so the entry check is the honest maximum.
      if (exec?.signal?.aborted === true) throw new Error('the call was cancelled before it started')
      return facts()
    },
  }
}
