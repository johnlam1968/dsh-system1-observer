// THE ROW'S SETTINGS, TURNED INTO THE INSTRUMENT'S INPUT — the ONE place that bridge exists.
//
// WHY THIS FILE EXISTS. The instrument (`lib/observe.js`, `lib/questions.js`, `lib/question-sets.js`, `lib/seams.js`,
// `lib/redact.js`) is meant to become a package with no dependency on this plugin, and a package cannot read this
// row's config. Measured before this file: six instrument files called `readConfigValue(...)` on our keys, so
// extracting them meant carrying the row with them. Now they take a PLAIN object — the input — and everything a row
// knows is mapped here.
//
// TWO RULES, and both are load-bearing:
//
//   1. VOLATILE FIELDS ARE UNWRAPPED HERE, NEVER INSIDE. A `.volatile()` field arrives as a Cordis accessor, and
//      reading it as a value silently yields the accessor object — every `=== true`, `typeof x === 'string'` and
//      `Array.isArray(x)` false — so the plugin runs on its defaults while the settings card shows the saved value
//      (`lib/config-value.js` records the measurement). The caller passes `plainConfig(config)`; this file never
//      imports `config-value.js`, and it never needs to: it is handed plain values and must be.
//
//   2. THE INPUT IS BUILT PER CALL, NOT PER MOUNT. `readInput(point)` is evaluated at each firing, so a setting
//      saved while the row runs reaches the next line — the same property `readConfig` had, kept deliberately.
//
// THE FIELD NAMES ARE THE SETTINGS CARD'S. Inside a group, a field keeps the name an operator can find in the card
// (`probeQuestion`, `redactKeys`), because a `problem` string the instrument produces quotes that name and the
// operator has to be able to act on it. What changes is WHO READS IT: this file, not the instrument.
//
// NOT A DSH MODULE, NOT A SERVICE, NOT A PLUGIN — plain functions, so the host edge stays in `index.js`.
import { isRecord } from './is-record.js'
import { labelHash } from './label-hash.js'
import { seamCallsEnabled } from './seams.js'
import { hostPoint } from './host-events.js'
import { sessionObserved } from './sessions.js'

/** The question group: what `lib/questions.js` asks, with the set location beside it. */
export function questionGroup(config) {
  const source = isRecord(config) ? config : {}
  return {
    questions: source.questions,
    question: source.question,
    probeQuestion: source.probeQuestion,
    maxQuestionChars: source.maxQuestionChars,
    // THE SET LOCATION TRAVELS WITH THE QUESTIONS because it decides which questions exist: `buildQuestions`
    // resolves the selected set and lets it replace the inline map wholesale. `dir` is left as written (possibly
    // `undefined`) so the instrument's own default — the `criteria/` directory it ships — still answers.
    sets: { dir: source.questionSetsDir, name: source.questionSet },
  }
}

/** The redaction group: what may be written down, as `lib/redact.js` compiles it. */
export function redactionGroup(config) {
  const source = isRecord(config) ? config : {}
  return {
    redactEnabled: source.redactEnabled,
    redactKeys: source.redactKeys,
    pathMode: source.pathMode,
    redactPatterns: source.redactPatterns,
  }
}

/**
 * The declared axes, hashed, with an undeclared axis ABSENT rather than empty.
 *
 * `labelHash('')` is `''`, and `{ harnessHash: '' }` would say "a label was declared and it hashes to nothing" —
 * a different fact from "nothing was declared", which is what an absent key says.
 */
export function declaredAxes(config) {
  const source = isRecord(config) ? config : {}
  const harness = labelHash(source.harnessLabel)
  const user = labelHash(source.operatorLabel)
  return {
    ...(harness === '' ? {} : { harnessHash: harness }),
    ...(user === '' ? {} : { userHash: user }),
  }
}

/**
 * THE INPUT OBJECT, for one firing at one point.
 *
 * @param config    the row's config, PLAIN (`plainConfig(config)`), read fresh by the caller
 * @param point     the point id this firing is at, from the instrument's own vocabulary
 * @param transport `'wire'` or `'service'`: the transport is a closure the row built, not a config field
 *                 (the mount-bound snapshot is what keeps this honest — `index.js` passes the live kind)
 * @returns the object `lib/observe.js` reads; never throws
 */
export function instrumentInput(config, { point, transport = 'service' } = {}) {
  const source = isRecord(config) ? config : {}
  return {
    // THE POINT IS RESOLVED HERE, so the instrument's id, the harness event it attaches to and the row's per-seam
    // switch meet in one place. `seamCallsEnabled` keeps the rule that an ABSENT key means ON; a boolean is all the
    // instrument sees, and the event name is only ever written down by the instrument, never interpreted.
    point: hostPoint(point, seamCallsEnabled(source.seamEnabled, point)),
    callsEnabled: source.callsEnabled !== false,
    // THE ALLOW-LIST IS A PREDICATE, NOT A LIST: the rule lives in `lib/sessions.js` (it is ours, and it is not about
    // a session format), and the instrument asks it about the session this firing belongs to.
    subjects: { observed: (agentId) => sessionObserved(source, agentId) },
    axes: declaredAxes(source),
    questions: questionGroup(source),
    limits: { maxFieldChars: source.maxFieldChars, tailChars: source.tailChars },
    redaction: redactionGroup(source),
    transport: { kind: transport, provider: source.provider ?? null, model: source.model ?? null },
  }
}
