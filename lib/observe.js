// THE CALL AND THE LINE. Everything that can go wrong is contained here: this code sits in the critical path
// of every turn, so a timeout, a refusal, a malformed body and a throwing trace must all end as a line in a
// file rather than as a failed turn.
import { probeHook } from 'dsh-system1-runtime/guard/hooks.js'
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
 * Build the observer.
 *
 * @param decide     `(request) => Promise<result>`, a runtime model client's `decide`
 * @param trace      the runtime evidence sink's `trace(event, fields)`; best-effort by construction
 * @param readConfig an ACCESSOR, read at call time, so a live edit reaches the next call:
 *                   `{ transport, provider, model, maxFieldChars }`
 * @returns `{ observe(hook, text, meta) }`, which never throws and never returns a value
 */
export function createObserver({ decide, trace, readConfig }) {
  async function observe(hook, text, meta = {}) {
    const config = readConfig() ?? {}
    const max = typeof config.maxFieldChars === 'number' && config.maxFieldChars > 0 ? config.maxFieldChars : 20000
    const started = Date.now()
    const excerpt = cut(text ?? '', max)
    const state = { hook, text: excerpt.text }
    const questions = buildQuestions(config)
    const where = () => ({
      hook,
      hostEvent: probeHook(hook),
      agentId: meta.agentId ?? null,
      initiator: meta.agentId === undefined ? 'none' : 'agent',
      turn: meta.turn ?? null,
      step: meta.step ?? null,
      purpose: meta.purpose ?? null,
    })
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
        requested: result?.requested ?? null,
        executed: result?.executed ?? null,
        envelope: result?.envelope ?? null,
        truncated: excerpt.cut,
      }))
    } catch { /* recording is best-effort, never load-bearing */ }
  }
  return { observe }
}
