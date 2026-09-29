// WHICH SEAMS ARE SUBSCRIBED, AND THE SHAPE EACH ONE NEEDS.
//
// The runtime owns the seam names, the seam-to-event map and the per-seam text extractor; this file owns only
// the decision about which of them this deployment calls, and the harness contract for each kind of listener.
// Nothing here may return anything but what the loop produced.
import { PROBE_SEAMS, probeHook, probeText } from 'dsh-system1-runtime/guard/hooks.js'
import { textOf, tee } from './stream.js'

/** The hooks called when a deployment names none: the user message, the reply, a tool call, a tool result. */
export const DEFAULT_HOOKS = Object.freeze(['admit', 'draft', 'pre_execute', 'post_execute'])

/** The reason a deliberately suppressed subagent seam records, distinct from `no text at this seam`. */
export const SUBAGENT_SKIP_REASON = 'subagent session'

/**
 * Read and validate the hook list.
 *
 * A TYPO IS A MOUNT ERROR, not a `ProbeError` on the first turn: a seam nothing listens at looks exactly like
 * a seam that never fires.
 *
 * @param config the row's config
 * @returns the seams to subscribe, in the order the loop runs them
 */
export function readHooks(config) {
  const given = Array.isArray(config?.hooks) && config.hooks.length > 0 ? config.hooks : DEFAULT_HOOKS
  const ordered = PROBE_SEAMS.filter(seam => given.includes(seam))
  const unknown = given.filter(seam => !PROBE_SEAMS.includes(seam))
  if (unknown.length > 0) {
    throw new Error(`system1-observer: unknown hook(s) ${unknown.join(', ')}; known hooks are: ${PROBE_SEAMS.join(', ')}`)
  }
  return ordered
}

/**
 * IS THIS SEAM'S AGENT A SUBAGENT? `agent.session.header.origin === 'subagent'` -- the discriminator three
 * shipped packages already read this way (`packages/client/file-upload/src/index.ts`, and the types at
 * `packages/core/agent/src/runtime-types.ts`, `packages/core/session/src/index.ts`,
 * `packages/core/session/src/types.ts`). PROPERTY CHECKS ONLY: a payload with no session, or no agent at all,
 * is an ordinary agent, never a throw.
 */
export function isSubagent(agent) {
  return agent?.session?.header?.origin === 'subagent'
}

/** Off unless the config says exactly `true`: an absent `observeSubagents` means false. */
function subagentsEnabled(deps) {
  return deps.readConfig?.()?.observeSubagents === true
}

/** Record the skip, best-effort; the optional call keeps a bare deps object (a unit test) working. */
function skipSubagent(deps, hook, meta) {
  return deps.skip?.(hook, meta, SUBAGENT_SKIP_REASON)
}

/** A subagent is suppressed only when the config has not opted in. */
function suppresses(deps, agent) {
  return isSubagent(agent) && !subagentsEnabled(deps)
}

/**
 * Subscribe one listener per selected seam.
 *
 * @param ctx       the Cordis context; `ctx.on` installs its own fiber effect and returns the disposer
 * @param hooks     the seams from `readHooks`
 * @param deps      `{ observe, skip, readConfig, captureAgent, meta }`; `captureAgent` returns the AGENT
 *                  (not its id) so `draft` can read both `agent.id` and the session origin from one object
 */
export function registerListeners(ctx, hooks, deps) {
  const { observe } = deps
  for (const seam of hooks) {
    const event = probeHook(seam)
    if (seam === 'draft') {
      // A STREAM, NOT A DECISION. Relay each chunk as it arrives and call the model once, after the last one.
      ctx.on(event, (options, next) => {
        // THE EXISTING PURPOSE GATE COMES FIRST, so `observeSubagents` only ever changes a stream that would
        // otherwise have reached the model: a purpose-tagged stream the operator already excludes stays
        // un-recorded rather than gaining a skip line from this knob.
        const include = deps.readConfig?.()?.includeNonOperatorFacing === true
        if (!include && options?.purpose !== undefined) return next()
        const agent = deps.captureAgent?.()
        const meta = { agentId: agent?.id, purpose: options?.purpose ?? null }
        // A SUBAGENT'S STREAM IS RELAYED UNTOUCHED AND NEVER TEE'D: returning `next()` is the whole
        // intervention, so no chunk is buffered, reordered or dropped. The skip line records why.
        if (suppresses(deps, agent)) {
          skipSubagent(deps, 'draft', meta)
          return next()
        }
        return tee(next(), (chunks) => observe('draft', textOf(chunks), meta))
      })
      continue
    }
    if (seam === 'result') {
      // AN EMIT: the harness does not await it, so neither may a failure in it.
      ctx.on(event, (exec, result) => {
        const agent = exec?.agent
        const meta = deps.meta?.(exec)
        if (suppresses(deps, agent)) {
          skipSubagent(deps, 'result', meta)
          return
        }
        observe('result', probeText('result', [exec, result]), meta).catch(() => {})
      })
      continue
    }
    // A WATERFALL OR A SERIAL SEAM: the real decision first, then the observation, then the decision returned
    // untouched -- the same reference, never a copy, so nothing downstream sees a different object.
    ctx.on(event, async (...args) => {
      if (seam === 'close') {
        const meta = deps.meta?.(args[0])
        if (suppresses(deps, args[0]?.agent)) {
          await skipSubagent(deps, 'close', meta)
          return undefined
        }
        await observe('close', probeText('close', args), meta)
        return undefined
      }
      // THE REAL DECISION FIRST, ALWAYS. A waterfall cannot proceed without it, and a suppressed subagent
      // seam must still hand the loop exactly what the loop produced -- the same reference.
      const decision = await args[args.length - 1]()
      const meta = deps.meta?.(args[0])
      if (suppresses(deps, args[0]?.agent)) {
        await skipSubagent(deps, seam, meta)
        return decision
      }
      await observe(seam, probeText(seam, args, decision), meta)
      return decision
    })
  }
}
