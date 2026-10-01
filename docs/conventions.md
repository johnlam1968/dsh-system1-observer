# Harness conventions, and where this plugin stands

A working record, not a finished document. Its purpose is to make **the plugin a plugin** — built the way the
harness documents, not the way an agent inferred it from behaviour.

**Source of truth:** the official documentation mirror shipped by `dsh-plugin-dev-kb`.
Base: `~/.dsh/profiles/docdrift/node_modules/.pnpm/dsh-plugin-dev-kb@…/node_modules/dsh-plugin-dev-kb/kb`

**How to read it** (from the KB's own skill): start at `kb/meta/topics.md` — a task → file map — read that topic's
**核心** files first and its **扩展** files only when detail is needed. Chinese pages are canonical; `site/en/` mirrors
them. Large files (`reference/config-catalog.md` 165 KB, `reference/tool-catalog.md`,
`reference/subsystems/session.md`, `extra/module-graph.md`) are grepped, never read whole.

**Status values, used strictly:** `CONFORMS` (the doc states the rule and this repo follows it, evidence named) ·
`DELTA` (the doc states the rule and this repo differs, difference named) · `UNVERIFIED` (not yet checked — **not** a
synonym for "probably fine").

## Round log

| round | read | result |
|---|---|---|
| 1 | `meta/topics.md`, `basic/index.md`, `basic/config.md`, `basic/tool.md` | module shape and `Config` **CONFORM**; three deltas (five tunables unreachable from YAML, `tools` probed, tools hand-built); **HMR citation** for the ledger reset |
| 2 | `framework/service.md`, `reference/capability-seams.md` | the `inject` vs `ctx.get` split **CONFORMS** — the plugin's most-questioned pattern is exactly what the docs prescribe; the generated-service rule lands on our hand-written inventory |
| 3 | `framework/events.md` | **all four modes conform**, including the waterfall `next()` contract; the doc's Cordis-event vs session-event-type rule is the one whose absence caused the worst bug; the documented event list is the generated `cordis-surface` block |
| 4 | `framework/index.md`, `cordis-tutorial/02-lifecycle-and-effects.md` | rows 4 and 8 **CONFORM**: every registration is tracked, no unmanaged resource is held, no module-level mutable state, so dispose → apply is clean. New rules recorded: teardown ordering; and a minor delta — an unwritable `tracePath` degrades silently where the docs make it a failed load |
| 5 | `reference/agent-lifecycle.md` | the trigger's firing condition, the authority of `agent/pre-step`, and **a correction**: `agent/inbox/claimed` is documented and live-only — `agent/*` events are not persisted — so my "never emitted" verdict used an instrument that could not see it, and rounds 155–159 were right |
| 6 | the generated catalogue, grepped across the subsystem pages | **rows 11 and 16 RESOLVE**: all 14 events this plugin names are in the catalogue and **all 14 modes match**; 4 of 7 services are core seams, 3 are package services. The source map below gives every name its page and line |

---

## Read so far

| file | what it settles |
|---|---|
| `meta/topics.md` | the map: 17 topics, each with 核心/扩展 files |
| `site/develop/basic/index.md` | first plugin: module shape, `apply`, `inject`, auto-cleanup, `ctx.effect`, dev registration |
| `site/develop/basic/config.md` | `Config` schema and type, `apply(ctx, config)`, **no hardcoded tunables**, HMR replaces the instance |
| `site/develop/basic/tool.md` | tools: `inject=['tools']`, `ctx.tools.register(defineTool({…}))`, `parameters` → `args`, `output.schema`/`render` |
| `site/develop/framework/service.md` | **required vs optional dependencies**, provider disposal semantics, providing a service, service isolation, and *do not maintain a second static list of services* |
| `site/reference/capability-seams.md` | the generated package → service graph (547 lines): which services are core seams |
| `site/develop/framework/events.md` | the four event modes and their contracts, `ctx.on` as an effect, and **Cordis events vs session event types** |
| `site/develop/framework/index.md` | fiber states, the enumerated tracked-registration list, teardown ordering, `ctx.plugin` child fibers, HMR |
| `site/develop/cordis-tutorial/02-lifecycle-and-effects.md` | effects in practice: effect bodies run at load, disposers at unload, and why you rarely need to write one |
| `site/reference/agent-lifecycle.md` | the turn/step sequence diagram: `agent/*` as live coordination, `session/event` as the replayable record, and the exact condition under which `turn-stopping` fires |

## Conventions extracted

1. **A plugin is a module exporting `apply`** — `export const name`, optional `export const inject`, `export function apply(ctx)`; or the object form `export default { name, inject, apply }` (basic/index.md:19-31,107-120).
2. **`Config` is exported twice**: a `interface Config` **and** a same-named Schemastery schema, defaults in the schema, validated at load, invalid config **fails the load with a clear error**; a plain object is not acceptable (config.md:11-47,76).
3. **`apply(ctx, config)`** — the resolved config is the second argument (config.md:31).
4. **No hardcoded tunables** — *"凡是不同部署可能需要采用不同值的参数，都必须定义为配置字段"*, with the doc's own test: can you change it in `cordis.yml` without editing code? (config.md:80-94).
5. **A `config` change unloads the old instance and loads a new one**, cleaning everything effect-registered (config.md:100-102).
6. **Tools**: `inject=['tools']`, then `ctx.tools.register(defineTool({name, description, parameters, output:{schema, render}, execute}))` from `@deepseek-ai/dsh-tools`; `defineTool` **infers and validates `args` from `parameters`** (tool.md:13-38).
7. **Everything registered through `ctx` is cleaned up on unload**; `ctx.effect(fn)` returns a disposer for resources the framework cannot know about (basic/index.md:68-87).
8. **Local development registers by patch overlay with an absolute path** (basic/index.md:48-64).
9. **Required vs optional dependencies** (service.md:91-102): `export const inject = ['tools']` — *"Required: the plugin does not load while the service is absent"*; **optional** is *"omit inject and query with `ctx.get()` at the use site"*, with the framework guaranteeing injected services are ready before `apply` runs (service.md:34).
10. **When a required service disappears** (its provider unloads), dependents are **disposed automatically** and **reloaded automatically** when it returns (service.md:104-111).
11. **Providing a service** is `class X extends Service { constructor(ctx) { super(ctx, 'metrics') } }`, optionally `static inject`; consumers then declare `inject=['metrics']` and use `ctx.metrics`. Types come from `declare module '@deepseek-ai/cordis'` augmentation (service.md:38-87). **Service isolation** lets one service have per-group instances (service.md:115-143).
12. **Do not keep a second static list of built-in services.** *"服务名、公开方法和源码位置由仓库自动生成到各服务的子系统页面 … 以这些生成区块和服务的 TypeScript 接口为准，不要维护另一份静态清单"* (service.md:145-147).
13. **Four event modes, four contracts** (events.md:25-83): **`emit`** — all listeners run synchronously, **return values are ignored**; **`bail`** — listeners in order, the first return that is not `null`/`false`/`undefined` becomes the result; **`serial`** — listeners in order, **awaited**, and the first non-`null`/`false`/`undefined` return **terminates the rest**; **`waterfall`** — each listener may **wrap** the downstream value, **`next()` is mandatory**, and *not* calling it "短路整个流水线，这是故意为之的设计——用于实现拦截/网关逻辑" (short-circuits the pipeline, deliberately, to implement interception/gateway logic).
14. **Events are named `namespace/action`** (events.md:104-106), and the complete signatures and modes live in the generated **`cordis-surface`** block of `reference/subsystems/core.md`.
15. **Cordis events and persisted session event types are different things with confusingly similar names** (events.md:108): `turn/*`, `step/*`, `tool/call`, `tool/result` and `compaction/*` are **session event types, not Cordis events** — to observe them you listen to `session/event` and check `event.type`. The Cordis event is `tools/result`.
16. **Listeners are effects**: `ctx.on` registrations are removed automatically when the plugin disposes (events.md:110-119). Type-safe events come from `declare module '@deepseek-ai/cordis' { interface Events {…} }` — TypeScript only (events.md:85-102).
17. **Everything registered through `ctx` is an effect, and the tracked set is enumerated**: `ctx.on`, `ctx.tools.register`, `ctx.llm.registerAdapter`, and **service registration**; `ctx.effect(fn)` is only for resources Cordis does not manage — timers, connections, watchers (index.md:42-65, tutorial:86-94).
18. **Teardown ordering**: disposers begin in **reverse registration order**, but multiple **asynchronous** disposers run **concurrently** and are not guaranteed to complete one at a time. Steps with an order dependency must live in a **single** `ctx.effect()` disposer that awaits them sequentially (index.md:65, tutorial:96).
19. **Fiber states**: `PENDING → LOADING → ACTIVE`, `ACTIVE → UNLOADING → DISPOSED`, and **`FAILED` when `apply` or config validation throws**. PENDING means a required service is not ready — the standing answer to "why does my plugin produce nothing" (index.md:9-27, tutorial:70-84,81).
20. **`ctx.plugin()` mounts a child fiber** with its own lifecycle, disposed with its parent; `fiber.dispose()` resolves only after all asynchronous cleanup and recurses into children. A **function** plugin needs no `apply`; only the **object** form requires one (index.md:67-99, tutorial:66-68).
21. **The turn/step sequence** (agent-lifecycle.md:12-78): `turn/start` → claim queued input → `agent/pre-step` waterfall → `step/start` → one `user/message` per entered message → `system-prompt/assemble` waterfall → `agent/request` waterfall → `llm/stream` waterfall → `assistant/message` → `tool/call` → ordered pre, concurrent execute, ordered post → `tool/result` → `step/end` → optionally `agent/turn-stopping` → `turn/end`.
22. **`agent/turn-stopping` is a *serial terminal checkpoint* that fires only on a natural stop with an empty next-step inbox** (agent-lifecycle.md:65-67) — not for turns ended by error, abort or `max-tokens`.
23. **`agent/pre-step`'s returned decision is authoritative**, and a listener that wraps `next()` **preserves downstream messages and `startsRequestSeries`** unless it deliberately replaces them (agent-lifecycle.md:32-36,84).
24. **`agent/*` is live coordination; `session/event` is the replayable record.** An SDK consumer needing a transcript reads `session/event` (agent-lifecycle.md:10,86).
25. **`assistant/message` is written for every successful provider call — including empty content and `max-tokens` finishes — and empty content does NOT enter derived history**; a failure, retry, cancel or stream error that settles with no surface message is recorded as `assistant/attempt` (agent-lifecycle.md:80). Compaction handles pressure through `agent/pre-step` and canonical overflow through `agent/request-error`, opening a retry turn only when pruning or summary advanced the **surface replacement generation** (agent-lifecycle.md:82).

## Where this plugin stands

| # | convention | this repo | status |
|---|---|---|---|
| 1 | module shape and `apply(ctx, config)` | `index.js:886` — `export default { apply, name, inject, Config }` | **CONFORMS** |
| 2 | the plugin is a **TypeScript** module | plain ESM JavaScript; no `Config` interface is possible | **DELTA** — pending publish.md (queue 8) |
| 3 | `inject` for required services, `ctx.get` at the use site for optional | `agents` in `inject`, with the row's own comment giving the reason (the context proxy throws on an undeclared service); `system1`, `tools`, `sessionQuery`, `tokenMeter`, `workspaceChanges` each `ctx.get(name)` behind a guard | **CONFORMS** — service.md:91-102 states this exact split. *(Round 1 called this PARTIAL and named `tools` as wrongly probed; the docs say the opposite — an optional registry is queried at the use site.)* |
| 4 | auto-cleanup; `ctx.effect` for unmanaged resources; re-entrancy across dispose/reload | every registration is tracked: `ctx.on` ×7, `ctx.tools.register` ×3 (`index.js:346,358,373`), and the service through `ctx.provide`. **No unmanaged resource is held** — the trace write path is synchronous open/write/close (`lib/evidence.js:142`, imports `closeSync`), and the only `setTimeout` is per-request (`lib/model/wire.js:6`). **No module-level mutable state** in `lib/*` or `lib/host/*`: every Map, Set and array is created inside `apply` | **CONFORMS by inspection** — index.md:59-63 and tutorial:86-92 enumerate exactly `ctx.on`, `ctx.tools.register`, service registration and `ctx.effect` as the tracked set. The remaining gap is a **test**, not a mechanism: nothing exercises unload or apply → dispose → apply |
| 5 | dev registration by `- insert:` patch with an absolute path | the profile installs this repo as a package (`link:…`) and the row is `- id: system1-observer` | **UNVERIFIED** — publish.md (queue 8) |
| 6 | `Config` is a Schemastery schema, validated at load, loud on error | `Schema.object` with `.default()`, `.min()`, `.description()` | **CONFORMS** |
| 7 | no hardcoded tunables | **five**: feed cap (`lib/host/feed.js:31`), fs journal `DEFAULT_MAX_PATHS`/`DEFAULT_MAX_PER_PATH` (`lib/host/fs-journal.js:31`), composer `maxChars = 8000` (`lib/turn-state.js:64`), tool-block `maxChars = 4000` (`lib/tool-blocks.js:50`) | **DELTA** — each already injectable in code, none reachable from YAML |
| 8 | a `config` change replaces the instance | measured mounts at 06:57:32 and 07:08:19 were config saves, each resetting the in-memory turn ledger | **CONFORMS — and it explains a measurement.** Documented behaviour, and the reason the cadence had to move onto the session's own turn number |
| 9 | tools via `defineTool`; its `parameters` validate `args`; `execute` returns the `output.schema` value | three tools register as `tools.register(createXTool({…}))` (`index.js:346,358,373`); `lib/tool.js:8` states the definition is hand-built and why | **DELTA, reason to re-judge** — the doc says `defineTool` validates; the hand-built path must be shown to validate too |
| 10 | where is `.volatile()` documented? | used on most `Config` fields; absent from all five pages read | **UNVERIFIED** — grep `reference/config-catalog.md` (queue 12) |
| 11 | **do not keep a static list of services** — the generated subsystem pages are authoritative | `lib/host/index.js` declares 7 services, 6 events and the seam table's 9 events, with modes; `test/host-inventory.test.js` checks the source against them in both directions | **RESOLVED — a checksum, not a second list.** Every one of the 14 events is in the generated catalogue and **all 14 modes match**; the four core services are documented. The names came from the installed declaration, which is generated from the same source, so the content was right and the **citation** was what was missing. The source map below supplies it, and Phase 3 checks against those pages |
| 12 | a service is **provided** with the `Service` base class | `ctx.provide(OBSERVER_SERVICE, …)`, whose comment cites `cordis/lib/index.js:800` and says *NOT `ctx.set`* | **CONFORMS by a different API** — the tutorial shows the class form; ours is the lower-level Cordis API, checked against Cordis's own source. `reference/cordis-api/service.md` should confirm it is documented (queue 3b) |
| 13 | core seams are the ones in the generated graph | consumed: `ctx.agents` ✓, `ctx.tools` ✓, `ctx.sessionQuery` ✓, `ctx.tokenMeter` ✓ — **`workspaceChanges` is not in the graph at all**; `system1` is our own dependency | **CONFORMS with a portability note** — `workspaceChanges` comes from a package (`dsh-workspace-changes`), not a core seam, so another deployment may not have it; it is already optional access, and its lines simply do not appear |
| 14 | mode contracts: `emit` returns ignored, `serial`'s first non-undefined return terminates the rest, `waterfall`'s `next()` mandatory | `session/event`, `fs/observed`, `agent/inbox/claimed` are emit and return nothing; the `agent/turn-stopping` trigger returns `undefined` at every gate; `fs/write-intent`/`fs/edit-intent` call `next()` exactly once and `return decision`; the seam listeners call the continuation (`args[args.length-1]()`) and `return decision` — the same reference, per their own comment; `llm/stream` wraps with `tee(next(), …)`, which is the doc's documented **wrap** pattern | **CONFORMS** — events.md:25-83. And a sharper reason for the serial rule than the one the code carried: a non-`undefined` return there **terminates the remaining listeners**, it does not merely delay a close |
| 15 | Cordis events vs session event types (`tools/result` vs `tool/result`) | the seam table subscribes `tools/result` (`lib/seams.js:85`); `tool/result` appears **only** as a session event type comparison under `session/event` (`lib/tool-blocks.js:68`) | **CONFORMS** — events.md:108. This is the rule whose absence produced the worst bug of this project: two similar names, one of them not a Cordis event at all |
| 16 | the documented event list is the generated catalogue, grouped by subsystem | as above | **RESOLVED, same finding as row 11** — entries are `#### \`name\` — mode`; every name and every mode this plugin uses is present |
| 17 | teardown ordering: reverse registration order, but asynchronous disposers run **concurrently** | no `ctx.effect` is registered anywhere, so there is nothing to order | **N/A today, rule recorded** — index.md:65, tutorial:96. It becomes binding the moment an effect is added (Phase 1) |
| 18 | `ctx.plugin()` child fibers; a function plugin needs no `apply`, only the object form does | one plugin, object form with `apply`; no child plugins | **CONFORMS** — tutorial:66. The object form is the one that requires `apply`, and `index.js:886` provides it |
| 19 | **`FAILED`** is the documented outcome when `apply` **or config validation** throws | config validation is Cordis's; the trace writer degrades silently — a `tracePath` that cannot be opened produces no line and no failure | **DELTA (minor)** — a path that cannot be written is a configuration error, and the documented outcome is a failed load with a clear message, not a silent absence of records |
| 20 | `agent/turn-stopping` fires on a natural stop with an empty inbox | the trigger is `agent/turn-stopping`, and every in-scope boundary writes a `turn-boundary` line | **CONFORMS** — agent-lifecycle.md:65-67, with a coverage caveat worth stating plainly: the cadence counts **naturally completed** turns, so a turn ended by error, abort or `max-tokens` is not counted at all |
| 21 | `agent/pre-step` returns an authoritative decision; wrapping `next()` preserves downstream | the admit seam wraps `next()` and returns it untouched (`lib/register.js`, the waterfall branch) | **CONFORMS** — agent-lifecycle.md:84 |
| 22 | an empty `assistant/message` is persisted but does **not** enter derived history | the composer takes the last assistant message in the window as the response, whatever its text | **UNVERIFIED** — a turn whose provider returned empty content would yield an empty `AGENT RESPONSE` rather than a refusal; worth a check in Phase 3 |
| 23 | `assistant/attempt` records a stream for failures settling with no surface message | not consumed | **UNVERIFIED** — the refusal path covers the absence of a response, but nothing reads the attempt record, so a failed turn's state is thin |
| 24 | packaging, settings card, testing | — | **UNVERIFIED** — queue 8-10 |

## Documented sources for every name this plugin uses

Verified against the generated catalogue (`gen-cordis-catalog.ts`, `pnpm run verify-cordis-catalog`) — **14 of 14 events present, 14 of 14 modes as assumed**.

| name | kind | documented at | mode | matches |
|---|---|---|---|---|
| `session/event` | event | `reference/subsystems/session.md:1118` | **emit** | ✅ as assumed |
| `fs/observed` | event | `reference/subsystems/filesystem.md:470` | **emit** | ✅ as assumed |
| `agent/inbox/claimed` | event | `reference/subsystems/core.md:953` | **emit** | ✅ as assumed |
| `agent/turn-stopping` | event | `reference/subsystems/core.md:1146` | **serial** | ✅ as assumed |
| `fs/edit-intent` | event | `reference/subsystems/filesystem.md:451` | **waterfall** | ✅ as assumed |
| `fs/write-intent` | event | `reference/subsystems/filesystem.md:491` | **waterfall** | ✅ as assumed |
| `system-prompt/assemble` | event | `reference/subsystems/system-prompt.md:183` | **waterfall** | ✅ as assumed |
| `agent/pre-step` | event | `reference/subsystems/core.md:1019` | **waterfall** | ✅ as assumed |
| `agent/request` | event | `reference/subsystems/core.md:1044` | **waterfall** | ✅ as assumed |
| `llm/stream` | event | `reference/subsystems/llm-streaming.md:1068` | **waterfall** | ✅ as assumed |
| `tools/pre-execute` | event | `reference/subsystems/tools.md:655` | **waterfall** | ✅ as assumed |
| `tools/execute` | event | `reference/subsystems/tools.md:606` | **waterfall** | ✅ as assumed |
| `tools/post-execute` | event | `reference/subsystems/tools.md:630` | **waterfall** | ✅ as assumed |
| `tools/result` | event | `reference/subsystems/tools.md:705` | **emit** | ✅ as assumed |
| `ctx.agents` | service | `reference/subsystems/core.md:684` | — | ✅ |
| `ctx.tools` | service | `reference/subsystems/tools.md:483` | — | ✅ |
| `ctx.sessionQuery` | service | `reference/subsystems/session-query.md:378` | — | ✅ |
| `ctx.tokenMeter` | service | `reference/subsystems/token-meter.md:69` | — | ✅ |
| `ctx.configEditor` | service | **not in the documentation** | — | ✅ |
| `ctx.workspaceChanges` | service | **not in the documentation** | — | ✅ |
| `ctx.system1` | service | **not in the documentation** | — | ✅ |

The four core services (`agents`, `tools`, `sessionQuery`, `tokenMeter`) are seams in the harness; the other three are package-provided — `configEditor` and `workspaceChanges` come from packages, `system1` is this profile's own dependency — which is why **not one of them is in `inject`**: the documented rule for an optional capability is `ctx.get()` at the use site.

## Deltas worth naming

- **JavaScript, not TypeScript** — the documented plugin is a `.ts` module, which costs two documented things: the `Config` interface, and type-safe events via `interface Events` declaration merging.
- **Five tunables unreachable from `cordis.yml`** — the first cheap, concrete fix the docs produced; the factories already take them as arguments.
- **Tools are hand-built rather than `defineTool`** — a reason is recorded in `lib/tool.js:8`; it predates this reading and deserves re-judging.
- **No unload or re-entrancy story** — convention 10 says dispose/reload will happen; nothing tests it.
- **A hand-written service inventory against a doc that forbids one** — the check earns its keep, but its source of truth should be the generated pages.
- **Where the documentation *was* consulted it was the installed declaration, not the docs** — `cordis_inspect_query` gave `SessionEventMap`, `ContentBlockMap`, `SurfaceEventType` and service signatures. Authoritative for *this build*, and how four shape bugs were found; not the same as following a convention.

## The four times inference lost to reading (this session)

| assumption | what the reading said | cost |
|---|---|---|
| tool blocks are `tool_use` with `input` | `ContentBlockMap` declares `tool-call` with `arguments` as a JSON **string** | `TOOL CALLS` was **empty on every measurement ever taken** |
| a user message wraps its payload in `data.message` | `'user/message': UserMessage` — `data` **is** the message | declared-shape messages were dropped |
| `readSurface` returns `{ nodes }` | `SessionSurfaceSnapshot` = `{ session, inheritedEventCount, capturedThroughSeq, events }` | the oracle reported disagreement it never measured |
| ~~`agent/inbox/claimed` never fires~~ | **the event is documented and live** (agent-lifecycle.md:31,70) and `agent/*` events are **not persisted to the session log** (agent-lifecycle.md:86) — so grepping session logs could only ever find nothing | **my verdict was the error, not the code.** Rounds 155–159 were right; the *retraction* of them was wrong. The recorder now writes a `claimed` trace line, which is the probe that can see a live-only event |

## Reading queue

1. ~~`develop/basic/tool.md`~~ ✅ (round 2); `reference/cookbook/adding-a-tool.md` remains for nested schemas, canonical values, policy hooks, PTC mode, UI cards
2. ~~`develop/basic/config.md`~~ ✅
3. ~~`develop/framework/service.md` + `reference/capability-seams.md`~~ ✅ — **3b:** `reference/cordis-api/service.md` to confirm `ctx.provide` is documented
4. ~~`develop/framework/events.md`~~ ✅ — **4b:** the generated `cordis-surface` block at `reference/subsystems/core.md:368-1222` (855 lines, to be grepped) — the documented source for every event and service name and its mode, and therefore the source `lib/host/index.js` should cite
5. ~~`develop/framework/index.md` + `develop/cordis-tutorial/02-lifecycle-and-effects.md`~~ ✅
6. ~~`reference/agent-lifecycle.md`~~ ✅ — and it is the authority for the trigger's firing condition, for the authority of `agent/pre-step`, and for `agent/*` being live-only
7. ~~the generated catalogue across `{core,session,filesystem,system-prompt,llm-streaming,tools}.md`~~ ✅ for **every name and mode this plugin declares** — the source map above is the result. **7b remains:** `ctx.tools.guard`, which `lib/seams.js:75` uses as a *literal name* (`ctx.tools.guard` is NOT among the events; the tools page is where the guarded pipeline is described)
8. `develop/basic/publish.md` — packaging, the route the profile uses
9. `reference/cookbook/adding-a-settings-card.md` — the card
10. `extra/testing.md` + `extra/defensive-patterns.md` — testing strategy, defence patterns
11. `reference/index.md` + `reference/cordis-primer.md` — architecture, last
12. grep `reference/config-catalog.md` for `volatile`

## Plan

| phase | output |
|---|---|
| **0. Read** | this file, row by row: every `UNVERIFIED` resolved to `CONFORMS` or `DELTA`, each with a citation |
| **1. Skeleton** | the smallest conforming plugin — module shape, `Config`, `inject`, effects — proven to load through the **documented** route before any observer logic is attached |
| **2. Port** | the observer's logic moved onto that skeleton; every hand-rolled piece either justified by a citation or deleted in favour of the documented mechanism |
| **3. Conformance** | a test that checks the plugin's shape against the documented conventions — not "the tests pass", which is what let a stray file ride into a commit and four shape bugs live for rounds |
