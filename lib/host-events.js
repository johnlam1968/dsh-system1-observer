// THE APPLICATION'S HALF OF THE POINT DESCRIPTOR: which dsh event each of the instrument's points attaches to.
//
// WHY THIS IS NOT IN `lib/seams.js`. The instrument owns the loop's VOCABULARY -- nine point ids and what is true of
// each (a point with no text, a point whose subject is a tool). This file owns the HARNESS BINDING: the event names,
// which are dsh's and change with dsh. Keeping them together was the single reason `lib/seams.js` imported
// `dsh-session-adapter`, and it is the difference between an instrument that can be extracted and one that carries
// the harness in its pocket.
//
// IT IS ALSO THE ONLY VALIDATION. `probeHook` asks the instrument whether the id exists (`pointOf`, which throws on
// an unknown one) and then looks up the event, so a point cannot be declared here and missing there, or the reverse:
// one list of ids, one map of events, and a mismatch refuses by name.
import { EVENT } from 'dsh-session-adapter/session-format'
import { pointOf } from './seams.js'

/**
 * The event each point attaches to, in the order the points are declared.
 *
 * `ctx.tools.guard` is deliberately absent and cannot be added: it is synchronous, so it can never await an HTTP
 * request, and a point there would be a seam that can only ever record a timeout.
 */
export const HOST_EVENTS = Object.freeze({
  assemble: 'system-prompt/assemble',
  admit: 'agent/pre-step',
  request: 'agent/request',
  draft: 'llm/stream',
  pre_execute: 'tools/pre-execute',
  execute: 'tools/execute',
  post_execute: 'tools/post-execute',
  result: 'tools/result',
  close: EVENT.AGENT_TURN_STOPPING,
})

/**
 * The event a point attaches to, or a throw naming every point there is.
 *
 * @param seam the point id, from the instrument's vocabulary
 */
export function probeHook(seam) {
  return HOST_EVENTS[pointOf(seam).id]
}

/**
 * The point as the INPUT OBJECT carries it: the id, the event beside it, and the row's switch for it.
 *
 * The event travels on the input because a trace line records it (`lib/observe.js` writes `hostEvent` on every call,
 * skip and error), and the instrument must not know the name to write it down.
 */
export function hostPoint(seam, enabled) {
  const point = pointOf(seam)
  return { id: point.id, hostEvent: HOST_EVENTS[point.id], enabled }
}
