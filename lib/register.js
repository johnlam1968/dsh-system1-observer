// WHICH SEAMS ARE SUBSCRIBED, AND THE SHAPE EACH ONE NEEDS.
//
// The runtime owns the seam names, the seam-to-event map and the per-seam text extractor; this file owns only
// the decision about which of them this deployment calls, and the harness contract for each kind of listener.
// Nothing here may return anything but what the loop produced.
import { PROBE_SEAMS, probeHook, probeText } from 'dsh-system1-runtime/guard/hooks.js'
import { textOf, tee } from './stream.js'

/** The hooks called when a deployment names none: the user message, the reply, a tool call, a tool result. */
export const DEFAULT_HOOKS = Object.freeze(['admit', 'draft', 'pre_execute', 'post_execute'])

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
 * Subscribe one listener per selected seam.
 *
 * @param ctx       the Cordis context; `ctx.on` installs its own fiber effect and returns the disposer
 * @param hooks     the seams from `readHooks`
 * @param deps      `{ observe, readConfig, captureAgent }`
 */
export function registerListeners(ctx, hooks, deps) {
  const { observe } = deps
  for (const seam of hooks) {
    const event = probeHook(seam)
    if (seam === 'draft') {
      // A STREAM, NOT A DECISION. Relay each chunk as it arrives and call the model once, after the last one.
      ctx.on(event, (options, next) => {
        const include = deps.readConfig?.()?.includeNonOperatorFacing === true
        if (!include && options?.purpose !== undefined) return next()
        const agentId = deps.captureAgent?.()
        return tee(next(), (chunks) => observe('draft', textOf(chunks), { agentId, purpose: options?.purpose ?? null }))
      })
      continue
    }
    if (seam === 'result') {
      // AN EMIT: the harness does not await it, so neither may a failure in it.
      ctx.on(event, (exec, result) => {
        observe('result', probeText('result', [exec, result]), deps.meta?.(exec)).catch(() => {})
      })
      continue
    }
    // A WATERFALL OR A SERIAL SEAM: the real decision first, then the observation, then the decision returned
    // untouched -- the same reference, never a copy, so nothing downstream sees a different object.
    ctx.on(event, async (...args) => {
      if (seam === 'close') {
        await observe('close', probeText('close', args), deps.meta?.(args[0]))
        return undefined
      }
      const decision = await args[args.length - 1]()
      await observe(seam, probeText(seam, args, decision), deps.meta?.(args[0]))
      return decision
    })
  }
}
