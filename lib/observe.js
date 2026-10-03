// THE CALL AND THE LINE. Everything that can go wrong is contained here: this code sits in the critical path
// of every turn, so a timeout, a refusal, a malformed body and a throwing trace must all end as a line in a
// file rather than as a failed turn.
import { TOOL_SEAMS, exitCodeOf, probeHook, seamCallsEnabled } from './seams.js'
import { sessionObserved } from './sessions.js'
import { readConfigValue } from './config-value.js'
import { cutHeadTail, redactPolicy, sanitizeField } from './redact.js'
import { buildQuestions } from './questions.js'

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/** Cut a string to the configured bound, reporting whether anything was cut. */
// THE MODEL'S CUT IS THE RECORD'S CUT. Both copies go through `cutHeadTail`, so a reader comparing what the
// model saw with what was written is never comparing two conventions -- and the tail, where a tool's failure
// marker lives, survives on both.
// ONE ALIAS, so every cut in this module -- the model's copy and the record's -- keeps the same convention, which is
// what the single-cut rule is for. THE TAIL IS PASSED AT THE CALL, not read here: this line is at module scope and
// `config` is a per-row parameter, which the first version of this got wrong -- it made `cut` throw
// `config is not defined` for every observation, and a pre-existing test said so.
const cut = cutHeadTail

/**
 * The identity of one seam firing, shared by `observe` and `skip` so both describe a line the same way.
 *
 * `probeHook` throws on an unknown seam, which is why every caller evaluates this INSIDE a trace thunk: the
 * evidence sink contains a throwing thunk as a line carrying `fields_unavailable`, where a throw at the call
 * site would abort the listener.
 */
function whereOf(hook, meta = {}) {
  return {
    hook,
    hostEvent: probeHook(hook),
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
 * @param decide     `(request) => Promise<result>`, a runtime model client's `decide`
 * @param trace      the runtime evidence sink's `trace(event, fields)`; best-effort by construction
 * @param readConfig an ACCESSOR, read at call time, so a live edit reaches the next call:
 *                   `{ transport, provider, model, maxFieldChars }`
 * @returns `{ observe(hook, text, meta), skip(hook, meta, reason) }`, neither of which throws
 */
export function createObserver({ decide, trace, readConfig }) {
  /**
   * Write one `skip` line, best-effort by construction. Synchronous on purpose: a suppressed `draft` seam
   * records its skip before it hands the stream back to the harness.
   *
   * `problems` carries the reasons a configured question could not be used, so a misconfiguration is a line
   * that names itself rather than a seam that quietly went silent. It is built INSIDE the thunk: `whereOf`
   * calls `probeHook`, which throws on an unknown seam, and that throw has to land inside `trace`'s own try
   * to become a `fields_unavailable` line instead of no line at all.
   */
  function skipLine(hook, meta, reason, problems = []) {
    try {
      trace('skip', () => {
        // A SKIP REASON IS AN INTERNAL CONSTANT, EXCEPT WHEN IT IS NOT. Most are literals chosen here
        // ("no text at this seam"), but one interpolates the operator's own question text, and an operator can
        // paste a token into a question. Sanitized at the record's edge like every other field.
        const policy = redactPolicy(readConfig() ?? {})
        const fields = { ...whereOf(hook, meta), reason: sanitizeField(reason, 512, policy).text }
        if (problems.length > 0) fields.problems = problems
        return fields
      })
    } catch { /* recording is best-effort, never load-bearing */ }
  }

  async function observe(hook, text, meta = {}) {
    const config = readConfig() ?? {}
    const where = () => whereOf(hook, meta)
    // THE MASTER SWITCH FIRST, before anything else is computed or asked. Read at the POINT OF USE, so
    // flipping it off in the card stops the next seam from calling the model with no restart. It is
    // `=== false` rather than `!== true` on purpose: an absent field leaves the observer ON, because a
    // switch that turns itself off when nobody set it is worse than no switch at all. The LINE is written
    // rather than nothing, so a run with the calls off is a run you can see and count.
    if (readConfigValue(config.callsEnabled) === false) {
      skipLine(hook, meta, 'calls disabled')
      return
    }
    // THEN WHO: is this session one the row was pointed at? THE SESSION GATE COMES BEFORE THE SEAM GATE,
    // because a session the row does not watch should say exactly that at every seam -- a mixed reason would
    // make "another conversation is running" indistinguishable from "I switched this seam off".
    if (!sessionObserved(config, meta.agentId)) {
      skipLine(hook, meta, 'session not observed')
      return
    }
    // THEN THE SEAM'S OWN SWITCH, with a DIFFERENT reason: "everything is paused" and "this one seam is
    // off" are different facts about a run, and a trace that spelled them the same way could not tell an
    // operator's deliberate scope from their panic button.
    if (!seamCallsEnabled(config, hook)) {
      skipLine(hook, meta, 'calls disabled at this seam')
      return
    }
    // NO TEXT, NO QUESTION. Two seams carry no text at all (`agent/request` is routing parameters and
    // `agent/turn-stopping` is `{agent, turn, signal}`), and the runtime's own probe refuses to ask at an
    // empty excerpt for the reason its comment records: a text-classification question with no text in it
    // produces an answer, and an answer that looks like a measurement is worse than no measurement. A skip
    // LINE is written instead of a call line, because in a chronological record the absence must be visible.
    const subject = typeof text === 'string' ? text : ''
    if (subject.trim() === '') {
      skipLine(hook, meta, 'no text at this seam')
      return
    }
    // NO QUESTION, NO CALL -- the same rule one level up. `buildQuestions` returns an empty map for a seam
    // with no configured question (the per-seam mode's whole point), and it never throws: a spec it cannot
    // turn into a question arrives here as a `problem`, and asking nothing while SAYING WHY beats asking
    // something the config did not describe.
    const built = buildQuestions(config, hook)
    const problems = built.problems ?? []
    if (Object.keys(built.questions).length === 0) {
      skipLine(hook, meta, problems.length === 0
        ? 'no question configured for this seam'
        : `no usable question: ${problems.join('; ')}`, problems)
      return
    }
    const configuredMax = readConfigValue(config.maxFieldChars)
    const max = typeof configuredMax === 'number' && configuredMax > 0 ? configuredMax : 20000
    const started = Date.now()
    // THE DESIGN DECISION THIS PLUGIN EXISTS ON. `state` is the model's INPUT and `excerpt` is the EVIDENCE,
    // and they are built from one source into TWO objects on purpose: the model's copy stays raw, because a
    // model asked to classify `[REDACTED]` measures the scrubber rather than the loop, and only the record's
    // copy is redacted. Redact the wrong one and every accuracy figure in this repository becomes a figure
    // about this file.
    const policy = redactPolicy(config)
    // BOTH BOUNDS ARE LIVE: the cap was already read per call, and the tail -- how much of the END survives -- is the
    // second half of how the budget is spent, so it is read at the same moment.
    const excerpt = cut(subject, max, readConfigValue(config.tailChars))
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
          transport: config.transport ?? 'service',
          provider: config.provider ?? null,
          model: config.model ?? null,
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
    skipLine(hook, meta, reason)
  }

  return { observe, skip }
}
