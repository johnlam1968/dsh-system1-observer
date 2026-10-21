// THE INSTRUMENT'S INPUT SHAPE, WITH NO HARNESS IN IT.
//
// WHY THIS FILE EXISTS. `core/instrument-input.js` is the BRIDGE: it turns this row's settings into the one object the
// instrument reads. It was COUPLED, and the coupling was TWO BINDINGS DEEP -- the point descriptor, whose event name
// belongs to the harness (`dsh/host-events.js`), and the session scope, which reads this row's own config
// (`core/sessions.js`). `ROADMAP.md` §14.8 step 1 is to take the PURE part out of that coupling, so a second host --
// a pi extension, or anything else that wants to measure -- can build the SAME shape without carrying this harness.
//
// THE PURE PART IS THE SHAPE, AND THE SHAPE IS A CONTRACT. `test/fixtures/instrument-shape/contract.mjs` states it and
// pins its digest, exactly as the rows contract states the rows: because the two producers of rows drifted (`F173`-
// `F180` -- who spoke, the digest, the text, the NUL), and a shape that two hosts build drifts the same way unless
// something says what it must be.
//
// THE TWO BINDINGS ARE BINDINGS RATHER THAN IMPORTS BECAUSE A HOST IS NOT A MODULE HERE. `describePoint` says which
// harness event a point attaches to, and `observed` says which sessions are in scope. What they ANSWER belongs to the
// host; the shape only cares that they answer, and that they were supplied -- a missing one is a PROGRAMMING error and
// is refused by name rather than defaulted, because a shape built against a stub is a measurement of the stub.
//
// THE TWO RULES THE BRIDGE INHERITS, unchanged and for the same reasons: a volatile field is unwrapped by the CALLER
// (`plainConfig(config)`), so what arrives here is a value and never an accessor; and the input is built PER FIRING
// rather than per mount, so a setting saved while the row runs reaches the next line.
//
// NOT A DSH MODULE, NOT A SERVICE, NOT A PLUGIN -- plain functions, so the host edge stays in `instrument-input.js`.
import { isRecord } from './is-record.js'
import { labelHash } from './label-hash.js'
import { seamCallsEnabled } from './seams.js'

/** The question group: what `core/questions.js` asks, with the set location beside it. */
export function questionGroup(config) {
  const source = isRecord(config) ? config : {}
  return {
    questions: source.questions,
    question: source.question,
    probeQuestion: source.probeQuestion,
    maxQuestionChars: source.maxQuestionChars,
    // THE SET LOCATION TRAVELS WITH THE QUESTIONS because it decides which questions exist: `buildQuestions`
    // resolves the selected set and lets it replace the inline map wholesale. `dir` is left as written (possibly
    // `undefined`) so the instrument's own default -- the `criteria/` directory it ships -- still answers.
    sets: { dir: source.questionSetsDir, name: source.questionSet },
  }
}

/** The redaction group: what may be written down, as `core/redact.js` compiles it. */
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
 * `labelHash('')` is `''`, and `{ harnessHash: '' }` would say "a label was declared and it hashes to nothing" --
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
 * THE INPUT OBJECT, for one firing at one point -- with the two host bindings supplied.
 *
 * @param config    the row's config, PLAIN (`plainConfig(config)`), read fresh by the caller
 * @param point     the point id this firing is at, from the instrument's own vocabulary
 * @param transport `'wire'` or `'service'`: the transport is a closure the row built, not a config field
 *                 (the mount-bound snapshot is what keeps this honest -- the host passes the live kind). **THE
 *                 DEFAULT LIVES HERE**, in ONE place: the two kinds are the INSTRUMENT's vocabulary, and a bridge
 *                 that carried a second copy of the default would agree with this one only by accident.
 * @param describePoint  the HOST's binding: `(seam, enabled) -> { id, hostEvent, enabled }`
 * @param observed       the HOST's binding: `(config, agentId) -> boolean`
 * @returns the object the instrument reads; a malformed CONFIG is answered, never thrown at
 */
export function instrumentShape(config, { point, transport = 'service', describePoint, observed } = {}) {
  // A MISSING BINDING IS REFUSED BY NAME, and refused BEFORE anything is built. A shape built against a default
  // predicate would answer "every session is in scope" for a host that meant to scope it -- and a measurement that
  // observes a conversation nobody scoped is not a measurement anybody can trust.
  if (typeof describePoint !== 'function') {
    throw new TypeError("instrumentShape: describePoint is required -- it is the host's binding, and the shape cannot name a harness event")
  }
  if (typeof observed !== 'function') {
    throw new TypeError("instrumentShape: observed is required -- it is the host's binding, and the shape cannot know which sessions are in scope")
  }
  const source = isRecord(config) ? config : {}
  return {
    // THE POINT IS RESOLVED HERE, so the instrument's id, the harness event it attaches to and the row's per-seam
    // switch meet in one place. `seamCallsEnabled` keeps the rule that an ABSENT key means ON; a boolean is all the
    // instrument sees, and the event name is only ever written down by the instrument, never interpreted.
    point: describePoint(point, seamCallsEnabled(source.seamEnabled, point)),
    callsEnabled: source.callsEnabled !== false,
    // THE ALLOW-LIST IS A PREDICATE, NOT A LIST: the rule lives in `core/sessions.js` (it is ours, and it is not about
    // a session format), and the instrument asks it about the session this firing belongs to.
    subjects: { observed: (agentId) => observed(source, agentId) },
    axes: declaredAxes(source),
    questions: questionGroup(source),
    limits: { maxFieldChars: source.maxFieldChars, tailChars: source.tailChars },
    redaction: redactionGroup(source),
    transport: { kind: transport, provider: source.provider ?? null, model: source.model ?? null },
  }
}
