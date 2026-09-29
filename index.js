// THE ROW. What it does: call a System One model at the configured points of the agent loop, and write the
// call -- request and response -- to a trace. What it must never do: change anything the loop decided.
//
// THE RUNTIME IS LOADED LAZILY, by subpath, for the reason `dsh-docdrift` measured: a static import of a
// missing dependency fails ESM resolution BEFORE `apply`, so the harness sees an unattributable
// module-not-found instead of a row that is merely inert. Here the import is static -- this package declares
// the runtime as its own dependency -- but the interface is CHECKED at mount, because the runtime and its
// consumers version separately.
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Schema from '@deepseek-ai/schemastery'
import { PROBE_SEAMS } from 'dsh-system1-runtime/guard/hooks.js'
import { createEvidence } from 'dsh-system1-runtime/guardrail/evidence.js'
import { checkInterfaceVersion } from 'dsh-system1-runtime/interface-version.js'
import { createModel } from 'dsh-system1-runtime/model/client.js'
import { createServiceModel } from 'dsh-system1-runtime/model/service.js'
import { createObserver } from './lib/observe.js'
import { registerListeners, readHooks } from './lib/register.js'

/** The runtime interface this build was written against. Checked at mount; a mismatch refuses. */
const EXPECTED_INTERFACE_VERSION = 1

const name = 'system1-observer'

// `agents` is a HARD dependency because the observer reads `ctx.agents.currentInitiator()` inside listeners,
// and Cordis's context proxy throws on an undeclared service property. `system1` is deliberately NOT here:
// a profile without it would leave the row PENDING and inert instead of falling back to the wire, which is
// what `ctx.inject` below is for.
const inject = ['agents']

/**
 * Where the trace goes when nothing overrides it.
 *
 * The spec's default is `<DSH_HOME>/logs/…`, so a trace is discoverable beside the harness's own logs; with no
 * `DSH_HOME` (a bare `node` run) it falls back to the package's own data directory. `tracePath` wins over both,
 * and `SYSTEM1_OBSERVER_TRACE` is applied by the evidence sink on top of whatever this returns.
 */
export function resolveTracePath(config, packageDir, env = process.env) {
  const given = typeof config?.tracePath === 'string' ? config.tracePath.trim() : ''
  if (given !== '') return given
  const home = typeof env?.DSH_HOME === 'string' && env.DSH_HOME !== '' ? env.DSH_HOME : undefined
  return home === undefined
    ? join(packageDir, 'data', 'system1-observer.jsonl')
    : join(home, 'logs', 'system1-observer.jsonl')
}

const Config = Schema.object({
  hooks: Schema.array(Schema.string())
    .description(`Points of the loop to call, from: ${PROBE_SEAMS.join(', ')}. Read once, at mount, so this is YAML-only.`),
  provider: Schema.string().description('The system1 provider id, for example `typesafe` for Jev or `laya`. Read once, at mount, so this is YAML-only.'),
  model: Schema.string().description('The model id to pass to that provider, for example `jev-latest`. Read once, at mount, so this is YAML-only.'),
  timeoutMs: Schema.number().min(0).description('Per-call bound in milliseconds. Read once, at mount, so this is YAML-only.'),
  wireUrl: Schema.string().description('Base URL used only when the profile mounts no system1 service. Read once, at mount, so this is YAML-only.'),
  question: Schema.string().description('Replaces the runtime probe question with a noul built from this text. Empty uses the probe question. Read once, at mount, so this is YAML-only.'),
  tracePath: Schema.string().description('Where the JSONL trace is written. Empty uses SYSTEM1_OBSERVER_TRACE, else `<DSH_HOME>/logs/`, else the package’s data directory. Read once, at mount, so this is YAML-only.'),
  includeNonOperatorFacing: Schema.boolean().volatile().description('Also call the model for the harness’s own streaming calls: session titles, compaction, subagents. Off keeps the trace to what an operator would read.'),
  maxFieldChars: Schema.number().min(1).volatile().description('Longest state field recorded in one trace line. Longer values are cut and the line is marked truncated.'),
})

async function apply(ctx, config) {
  const verdict = checkInterfaceVersion(EXPECTED_INTERFACE_VERSION)
  if (!verdict.ok) {
    throw new Error(`system1-observer was written against runtime interface version ${EXPECTED_INTERFACE_VERSION} and the installed runtime provides ${verdict.found}`)
  }

  const here = dirname(fileURLToPath(import.meta.url))
  const hooks = readHooks(config)                       // a typo refuses the mount, naming the seam
  const evidence = createEvidence({ defaultPath: resolveTracePath(config, here), envVar: 'SYSTEM1_OBSERVER_TRACE' })
  const transport = { kind: 'wire', provider: config?.provider ?? null, model: config?.model ?? null }
  const wire = createModel({ baseUrl: config?.wireUrl || 'http://127.0.0.1:8766', timeoutMs: config?.timeoutMs ?? 8000 })
  // BOTH FACTORIES RETURN A CLIENT `{decide, health}`, NOT A FUNCTION. This indirection is what keeps one call
  // site working across the two transports; assigning the client itself to `decide` made every call throw
  // "decide is not a function", which no unit test saw because `apply` was never executed.
  let decide = (request) => wire.decide(request)

  // THE MOUNT LINE IS WRITTEN WHEN THE TRANSPORT IS KNOWN -- NOT WHEN `apply` RETURNS. `ctx.inject`'s
  // callback runs through a cordis fiber, so at the end of `apply` the transport is still `wire`: measured
  // live, the mount line read `"transport":"wire"` at 17:20:41.319Z while every `call` line and the real
  // transport were `service`, and the swap landed 355 ms later. A microtask does not fix that (it fires
  // within microseconds and would write `wire` again). This writer is idempotent and is called by whichever
  // comes first: the service arriving, or the first observation (so a profile with no service still gets a
  // mount line, in `wire`, before the first call or skip it belongs to). It reads `config` directly because
  // the `provider`/`model` consts below are in their temporal dead zone if the callback runs synchronously.
  let mountTraced = false
  function writeMount() {
    if (mountTraced) return
    mountTraced = true
    evidence.trace('mount', () => ({
      hooks,
      transport: transport.kind,
      provider: config?.provider ?? null,
      model: config?.model ?? null,
      questionIds: ['probe'],
      tracePath: evidence.path,
    }))
  }

  // THE SERVICE, IF THE PROFILE MOUNTS ONE. Read through `ctx.inject` and never captured: the callback runs
  // when the service arrives, which may be after this row mounts. Everything it needs is read from `config` and
  // `evidence` directly, because the `provider`/`model` consts below are in their temporal dead zone if the
  // callback runs synchronously during this call.
  ctx.inject(['system1'], (child) => {
    const service = child.get('system1')
    if (service === undefined) return
    const viaService = createServiceModel({
      service,
      provider: config?.provider ?? undefined,
      model: config?.model ?? undefined,
    })
    decide = (request) => viaService.decide(request)
    transport.kind = 'service'
    writeMount()
  })

  const provider = config?.provider ?? null
  const model = config?.model ?? null
  const readConfig = () => ({
    ...(config ?? {}),
    transport: transport.kind,
    provider,
    model,
  })
  const observer = createObserver({ decide: (request) => decide(request), trace: evidence.trace, readConfig })

  registerListeners(ctx, hooks, {
    // THE MOUNT LINE PRECEDES THE FIRST OBSERVATION when no service ever appeared. Calling the writer here
    // rather than at the end of `apply` is what keeps "no service" from being recorded before it is known.
    observe: (hook, text, meta) => { writeMount(); return observer.observe(hook, text, meta) },
    readConfig,
    captureAgent: () => ctx.agents.currentInitiator()?.id,
    meta: (payload) => ({ agentId: payload?.agent?.id, turn: payload?.turn, step: payload?.step }),
  })
}

export { apply, name, inject, Config }
export default { apply, name, inject, Config }
