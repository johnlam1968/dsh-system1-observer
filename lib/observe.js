// THE CALL AND THE LINE. Everything that can go wrong is contained here: this code sits in the critical path
// of every turn, so a timeout, a refusal, a malformed body and a throwing trace must all end as a line in a
// file rather than as a failed turn.
import { probeHook } from 'dsh-system1-runtime/guard/hooks.js'
import { readConfigValue } from './config-value.js'
import { buildQuestions } from './questions.js'

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/** Cut a string to the configured bound, reporting whether anything was cut. */
function cut(value, max) {
  if (typeof value !== 'string' || value.length <= max) return { text: value, cut: false }
  return { text: value.slice(0, max), cut: true }
}

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
   */
  function skipLine(hook, meta, reason) {
    try {
      trace('skip', () => ({ ...whereOf(hook, meta), reason }))
    } catch { /* recording is best-effort, never load-bearing */ }
  }

  async function observe(hook, text, meta = {}) {
    const config = readConfig() ?? {}
    const where = () => whereOf(hook, meta)
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
    const configuredMax = readConfigValue(config.maxFieldChars)
    const max = typeof configuredMax === 'number' && configuredMax > 0 ? configuredMax : 20000
    const started = Date.now()
    const excerpt = cut(subject, max)
    const state = { hook, text: excerpt.text }
    const questions = buildQuestions(config)
    let result
    try {
      result = await decide({ state, questions })
    } catch (error) {
      // A throw is OUR bug or the transport's, and either way it is not the loop's.
      try {
        trace('error', () => ({ ...where(), ms: Date.now() - started, error: messageOf(error) }))
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
          error: result?.reason ?? 'the model client returned an error',
        }))
      } catch { /* recording is best-effort, never load-bearing */ }
      return
    }
    try {
      trace('call', () => ({
        ...where(),
        ms: Date.now() - started,
        transport: config.transport ?? 'service',
        provider: config.provider ?? null,
        model: config.model ?? null,
        excerpt: excerpt.text,
        state,
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
        truncated: excerpt.cut,
      }))
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
