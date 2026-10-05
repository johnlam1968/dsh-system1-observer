// WHICH SEAMS ARE SUBSCRIBED, AND THE SHAPE EACH ONE NEEDS.
//
// The runtime owns the seam names, the seam-to-event map and the per-seam text extractor; this file owns only
// the decision about which of them this deployment calls, and the harness contract for each kind of listener.
// Nothing here may return anything but what the loop produced.
import { PROBE_SEAMS, probeText } from './seams.js'
import { probeHook } from './host-events.js'
import { subjectOfAgent, subjectOfRequest } from './subject.js'
import { readConfigValue } from './config-value.js'
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
  // Unwrapped defensively: `hooks` is not volatile today, but it is handed the raw config at mount,
  // and a volatile `hooks` read as a plain value would fall back to DEFAULT_HOOKS -- which are the same
  // four seams, so the substitution would be invisible until someone configured another set.
  const configured = readConfigValue(config?.hooks)
  const given = Array.isArray(configured) && configured.length > 0 ? configured : DEFAULT_HOOKS
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
        // A HOOK SWITCHED OFF LIVE STILL RELAYS: returning `next()` untouched is the whole intervention, so
        // removing a seam from `hooks` cannot swallow a chunk the model would otherwise have seen.
        if (deps.hookEnabled?.(seam) === false) return next()
        const include = deps.readConfig?.()?.includeNonOperatorFacing === true
        if (!include && options?.purpose !== undefined) return next()
        const agent = deps.captureAgent?.()
        // THE REQUEST AS SENT, which is the only place the model that produced THIS text is written down.
        const meta = { agentId: agent?.id, purpose: options?.purpose ?? null, subject: subjectOfRequest(options) }
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
        if (deps.hookEnabled?.(seam) === false) return
        const agent = exec?.agent
        const meta = deps.meta?.(exec, agent)
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
        if (deps.hookEnabled?.(seam) === false) return undefined
        const meta = deps.meta?.(args[0], args[0]?.agent)
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
      // THE DECISION IS TAKEN FIRST AND RETURNED UNTOUCHED even when this seam is switched off: a waterfall that
      // skipped `next()` would short-circuit the loop, which is the one thing this plugin must never do.
      if (deps.hookEnabled?.(seam) === false) return decision
      // `assemble` IS THE ONE SEAM WHOSE AGENT IS ON THE SECOND ARGUMENT, NOT THE FIRST.
      // `system-prompt/assemble(assembly, context, next)`: args[0] is a `PromptAssembly`
      // {sections, contexts, tools, variables} with no `agent`, and the loop builds args[1] with
      // `assembleContextFor(agent, signal)` -> `{agent, scope: agent}` (`packages/core/agent/src/dispatch.ts`,
      // called from `packages/core/agent-loop/src/agent.ts`). The field reaches `AssembleContext` by MODULE
      // AUGMENTATION (`packages/core/agent/src/runtime-types.ts`), so reading the interface in its own package
      // shows only `{scope, signal}` -- which is why `args[0].agent` here looked right while suppressing
      // nothing: it was always `undefined`, and a subagent's assembled prompt reached the model. The
      // event-local field is deliberate; on a diagnostic assembly it is absent, and an ambient
      // `captureAgent()` would mis-attribute that assembly to whatever initiator happens to be current.
      const source = seam === 'assemble' ? args[1] : args[0]
      const agent = source?.agent
      // THE META READS THE SAME ARGUMENT AS THE AGENT, and that is not tidiness. `meta.agentId` is what the
      // session allow-list tests, so building it from `args[0]` made `assemble` permanently unattributable --
      // measured live: every assembled prompt recorded `session not observed`, including inside the session
      // the row was pointed at, because the agent is simply not on that argument. Nothing is lost by moving:
      // a `PromptAssembly` carries no turn or step either.
      const meta = deps.meta?.(source, agent)
      if (suppresses(deps, agent)) {
        await skipSubagent(deps, seam, meta)
        return decision
      }
      await observe(seam, probeText(seam, args, decision), meta)
      return decision
    })
  }
}
