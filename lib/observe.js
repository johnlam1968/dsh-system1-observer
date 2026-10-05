// THE CALL AND THE LINE. Everything that can go wrong is contained here: this code sits in the critical path
// of every turn, so a timeout, a refusal, a malformed body and a throwing trace must all end as a line in a
// file rather than as a failed turn.
import { TOOL_SEAMS, exitCodeOf, pointOf } from './seams.js'
import { cutHeadTail, redactPolicy, sanitizeField } from './redact.js'
import { buildQuestions } from './questions.js'
import { isRecord } from './is-record.js'

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/** Cut a string to the configured bound, reporting whether anything was cut. */
// THE MODEL'S CUT IS THE RECORD'S CUT. Both copies go through `cutHeadTail`, so a reader comparing what the
// model saw with what was written is never comparing two conventions -- and the tail, where a tool's failure
// marker lives, survives on both.
// ONE ALIAS, so every cut in this module -- the model's copy and the record's -- keeps the same convention, which is
// what the single-cut rule is for. THE TAIL IS PASSED AT THE CALL, not read here: this line is at module scope and
// the tail arrives on the per-firing INPUT, which the first version of this got wrong -- it read a per-row `config`
// at module scope, made `cut` throw `config is not defined` for every observation, and a pre-existing test said so.
const cut = cutHeadTail

/**
 * The identity of one seam firing, shared by `observe` and `skip` so both describe a line the same way.
 *
 * `whereOf` throws on an unknown seam (`pointOf`), which is why every caller evaluates it INSIDE a trace thunk: the
 * evidence sink contains a throwing thunk as a line carrying `fields_unavailable`, where a throw at the call
 * site would abort the listener.
 */
/**
 * THE DECLARED AXES, read live at the point of use.
 *
 * `harnessHash` and `userHash` ride every line for the same reason `subject` does: "which technique was in force" and
 * "who was driving" are questions a SKIP line should be able to answer, and a trace where only some lines carry them
 * has to be cross-checked against itself. Read per line rather than per row, because a label can change while the row
 * runs -- and then the lines either side of the change are two groups, which is the honest reading.
 *
 * IT TAKES THE INPUT AS AN ARGUMENT and is not called from `whereOf`, which is module-scope: reading a per-firing
 * value there threw a ReferenceError on every observation, and the observer swallows a throwing trace thunk, so the
 * symptom was a seam that recorded NOTHING rather than an error. Eight tests said so.
 */
function declaredAxes(input) {
  // ALREADY HASHED, ALREADY OMITTED WHEN EMPTY: the application builds this (`lib/instrument-input.js`), because a
  // hash is a fact about the row's labels and this module is not allowed to know the row has labels.
  return isRecord(input?.axes) ? input.axes : {}
}

/**
 * Whether the row watches the session this firing belongs to.
 *
 * A PREDICATE IN, A BOOLEAN OUT: the allow-list rule is the application's (`lib/sessions.js`), and the instrument
 * asks it rather than re-implementing it. ABSENT MEANS OBSERVED, which is the row's own default — a session gate that
 * closed when nobody configured one would turn the observer off for every existing install.
 */
function subjectObserved(input, agentId) {
  const subjects = isRecord(input?.subjects) ? input.subjects : {}
  if (typeof subjects.observed === 'function') return subjects.observed(agentId) === true
  return subjects.observed !== false
}

function whereOf(hook, meta = {}, input = {}) {
  // THE ID IS VALIDATED HERE AND THE EVENT NAME COMES FROM THE INPUT. `pointOf` throws on an unknown point, and that
  // throw belongs INSIDE the caller's trace thunk -- an unknown seam must become a `fields_unavailable` line rather
  // than no line at all. The dsh event name is the application's (`lib/host-events.js`) and rides the input, because
  // an instrument that names harness events is an instrument that cannot be extracted.
  pointOf(hook)
  return {
    hook,
    hostEvent: input.point?.hostEvent ?? null,
    agentId: meta.agentId ?? null,
    initiator: meta.agentId === undefined ? 'none' : 'agent',
    turn: meta.turn ?? null,
    step: meta.step ?? null,
    purpose: meta.purpose ?? null,
    // THE MODEL THAT PRODUCED THE TEXT, when the seam knows it -- see `lib/subject.js`. It rides EVERY line,
    // not only the calls: "which model's text did we decline to judge" is a question a skip line should be
    // able to answer, and a trace where only some lines name the subject is a trace you have to cross-check
    // against itself. Absent, never null, when nothing is known -- an unreadable field is worse than none.
    ...(meta.subject === undefined ? {} : { subject: meta.subject }),
  }
}

/**
 * Build the observer.
 *
 * @param decide    `(request) => Promise<result>`, a runtime model client's `decide`
 * @param trace     the runtime evidence sink's `trace(event, fields)`; best-effort by construction
 * @param readInput an ACCESSOR for the instrument's INPUT OBJECT, read at call time, so a live edit reaches the
 *                  next call: `(point) => ({ point, callsEnabled, subjects, axes, questions, limits, redaction,
 *                  transport })`. The application builds it (`lib/instrument-input.js`); this module reads no
 *                  config key of its own, and `readConfig` — the row's plain config — is deliberately no longer a
 *                  parameter, because passing one is how the instrument came to depend on the row.
 * @returns `{ observe(hook, text, meta), skip(hook, meta, reason) }`, neither of which throws
 */
export function createObserver({ decide, trace, readInput }) {
  /**
   * Write one `skip` line, best-effort by construction. Synchronous on purpose: a suppressed `draft` seam
   * records its skip before it hands the stream back to the harness.
   *
   * `problems` carries the reasons a configured question could not be used, so a misconfiguration is a line
   * that names itself rather than a seam that quietly went silent. It is built INSIDE the thunk: `whereOf`
   * calls `whereOf`, which throws on an unknown seam, and that throw has to land inside `trace`'s own try
   * to become a `fields_unavailable` line instead of no line at all.
   */
  function skipLine(input, hook, meta, reason, problems = []) {
    try {
      trace('skip', () => {
        // A SKIP REASON IS AN INTERNAL CONSTANT, EXCEPT WHEN IT IS NOT. Most are literals chosen here
        // ("no text at this seam"), but one interpolates the operator's own question text, and an operator can
        // paste a token into a question. Sanitized at the record's edge like every other field.
        const policy = redactPolicy(input?.redaction)
          // THE DECLARED AXES RIDE A SKIP TOO, which is why they are carried on the input rather than read only at
          // mount: "which technique was in force when nothing was asked" is a question a report has to answer.
        const fields = { ...whereOf(hook, meta, input), ...declaredAxes(input), reason: sanitizeField(reason, 512, policy).text }
        if (problems.length > 0) fields.problems = problems
        return fields
      })
    } catch { /* recording is best-effort, never load-bearing */ }
  }

  async function observe(hook, text, meta = {}) {
    const input = readInput(hook) ?? {}
    const where = () => ({ ...whereOf(hook, meta, input), ...declaredAxes(input) })
    // THE MASTER SWITCH FIRST, before anything else is computed or asked. Read at the POINT OF USE, so
    // flipping it off in the card stops the next seam from calling the model with no restart. It is
    // `=== false` rather than `!== true` on purpose: an absent field leaves the observer ON, because a
    // switch that turns itself off when nobody set it is worse than no switch at all. The LINE is written
    // rather than nothing, so a run with the calls off is a run you can see and count.
    if (input.callsEnabled === false) {
      skipLine(input, hook, meta, 'calls disabled')
      return
    }
    // THEN WHO: is this session one the row was pointed at? THE SESSION GATE COMES BEFORE THE SEAM GATE,
    // because a session the row does not watch should say exactly that at every seam -- a mixed reason would
    // make "another conversation is running" indistinguishable from "I switched this seam off".
    if (!subjectObserved(input, meta.agentId)) {
      skipLine(input, hook, meta, 'session not observed')
      return
    }
    // THEN THE SEAM'S OWN SWITCH, with a DIFFERENT reason: "everything is paused" and "this one seam is
    // off" are different facts about a run, and a trace that spelled them the same way could not tell an
    // operator's deliberate scope from their panic button.
    if (input.point?.enabled === false) {
      skipLine(input, hook, meta, 'calls disabled at this seam')
      return
    }
    // NO TEXT, NO QUESTION. Two seams carry no text at all (`agent/request` is routing parameters and
    // `agent/turn-stopping` is `{agent, turn, signal}`), and the runtime's own probe refuses to ask at an
    // empty excerpt for the reason its comment records: a text-classification question with no text in it
    // produces an answer, and an answer that looks like a measurement is worse than no measurement. A skip
    // LINE is written instead of a call line, because in a chronological record the absence must be visible.
    const subject = typeof text === 'string' ? text : ''
    if (subject.trim() === '') {
      skipLine(input, hook, meta, 'no text at this seam')
      return
    }
    // NO QUESTION, NO CALL -- the same rule one level up. `buildQuestions` returns an empty map for a seam
    // with no configured question (the per-seam mode's whole point), and it never throws: a spec it cannot
    // turn into a question arrives here as a `problem`, and asking nothing while SAYING WHY beats asking
    // something the config did not describe.
    // THE QUESTIONS COME FROM THE INPUT'S GROUP, built by the application: this module cannot see `questionSet`,
    // `questionSetsDir` or the row's inline map, and does not need to.
    const built = buildQuestions(input.questions ?? {}, hook)
    const problems = built.problems ?? []
    if (Object.keys(built.questions).length === 0) {
      skipLine(input, hook, meta, problems.length === 0
        ? 'no question configured for this seam'
        : `no usable question: ${problems.join('; ')}`, problems)
      return
    }
    const configuredMax = input.limits?.maxFieldChars
    const max = typeof configuredMax === 'number' && configuredMax > 0 ? configuredMax : 20000
    const started = Date.now()
    // THE DESIGN DECISION THIS PLUGIN EXISTS ON. `state` is the model's INPUT and `excerpt` is the EVIDENCE,
    // and they are built from one source into TWO objects on purpose: the model's copy stays raw, because a
    // model asked to classify `[REDACTED]` measures the scrubber rather than the loop, and only the record's
    // copy is redacted. Redact the wrong one and every accuracy figure in this repository becomes a figure
    // about this file.
    const policy = redactPolicy(input.redaction)
    // BOTH BOUNDS ARE LIVE: the cap was already read per call, and the tail -- how much of the END survives -- is the
    // second half of how the budget is spent, so it is read at the same moment.
    const excerpt = cut(subject, max, input.limits?.tailChars)
    const state = { hook, text: excerpt.text }
    const traced = sanitizeField(subject, max, policy)
    const questions = built.questions
    let result
    try {
      result = await decide({ state, questions })
    } catch (error) {
      // A throw is OUR bug or the transport's, and either way it is not the loop's.
      try {
        trace('error', () => ({ ...where(), ms: Date.now() - started, error: sanitizeField(messageOf(error), 512, policy).text }))
      } catch { /* recording is best-effort, never load-bearing */ }
      return
    }
    // A RETURNED ERROR IS AN ERROR, NOT A CALL. The runtime's clients do not throw on a timeout, a non-2xx,
    // a malformed body or an unreachable service -- they RETURN `{kind: 'error', reason}`
    // (`model/service.ts`, `model/client.ts`) -- so containing only the throw recorded a provider outage as
    // a `call` line whose `answer.kind` was `'error'`, invisible to anyone counting `error` lines. Spec 6
    // binds: each of those becomes an `error` line. Same containment, same best-effort `try`.
    if (result?.kind === 'error') {
      try {
        trace('error', () => ({
          ...where(),
          ms: Date.now() - started,
          error: sanitizeField(result?.reason ?? 'the model client returned an error', 512, policy).text,
        }))
      } catch { /* recording is best-effort, never load-bearing */ }
      return
    }
    try {
      trace('call', () => {
        const line = {
          ...where(),
          ms: Date.now() - started,
          transport: input.transport?.kind ?? 'service',
          provider: input.transport?.provider ?? null,
          model: input.transport?.model ?? null,
          // THE MODEL'S INPUT AND THE EVIDENCE ARE THE SAME OBJECT, so writing both wrote the excerpt twice:
          // measured on all 4,379 call lines across this deployment's two traces, `excerpt === state.text`
          // every time, and `state` is reconstructible from `hook` and `excerpt` because it is exactly
          // `{hook, text: excerpt}`. Call lines were 95.9% of the bytes in the all-seams trace, and half of
          // that was this duplicate. One field, gone; nothing lost.
          excerpt: traced.text,
          // TWO FACTS THE RESULT SEAMS DO NOT OTHERWISE CARRY. The name is on the payload of every tool seam,
          // and the exit code is appended to the end of the tool's own output -- read from the UNTRUNCATED text,
          // which is why it is computed here rather than after the cut.
          tool: typeof meta.toolName === 'string' && meta.toolName !== '' ? meta.toolName : null,
          toolExit: TOOL_SEAMS.includes(hook) ? exitCodeOf(subject) : null,
          questions,
          answer: result,
          // FROM THE ENVELOPE, AND ONLY FROM THE ENVELOPE. The runtime's ModelResult is
          // `{kind, answers, worstCase, envelope, rawAnswers}` -- it has no top-level `requested` or
          // `executed`, and the service keeps both inside the envelope it builds from `meta`. Reading
          // `result?.requested` here wrote null on every live `call` line while the envelope beside it was
          // populated, which is the kind of field that reads as a measurement and is not one. There is
          // deliberately NO fallback to a top-level field: a second dead projection is what caused this.
          requested: result?.envelope?.requested ?? null,
          executed: result?.envelope?.executed ?? null,
          envelope: result?.envelope ?? null,
          // THE RECORD'S cut, not the model's: the redacted copy is what this line carries, and redaction runs
          // BEFORE the cut, so the two can differ in length and only one of them describes this text.
          truncated: traced.cut,
        }
        // A spec that could not be used is recorded BESIDE the ones that were, because "asked two of your
        // three questions" and "asked your three questions" are different measurements.
        if (problems.length > 0) line.problems = problems
        return line
      })
    } catch { /* recording is best-effort, never load-bearing */ }
  }

  /**
   * Record a seam that was deliberately NOT observed, carrying the reason, without asking a question about it.
   *
   * @param hook   the runtime seam name
   * @param meta   the same identity `observe` takes
   * @param reason the distinct reason, for example `'subagent session'`; never `'no text at this seam'`
   */
  function skip(hook, meta = {}, reason = 'skipped') {
    skipLine(readInput(hook) ?? {}, hook, meta, reason)
  }

  return { observe, skip }
}
