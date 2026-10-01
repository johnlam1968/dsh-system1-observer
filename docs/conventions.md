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

## Where this plugin stands

| # | convention | this repo | status |
|---|---|---|---|
| 1 | module shape and `apply(ctx, config)` | `index.js:886` — `export default { apply, name, inject, Config }` | **CONFORMS** |
| 2 | the plugin is a **TypeScript** module | plain ESM JavaScript; no `Config` interface is possible | **DELTA** — pending publish.md (queue 8) |
| 3 | `inject` for required services, `ctx.get` at the use site for optional | `agents` in `inject`, with the row's own comment giving the reason (the context proxy throws on an undeclared service); `system1`, `tools`, `sessionQuery`, `tokenMeter`, `workspaceChanges` each `ctx.get(name)` behind a guard | **CONFORMS** — service.md:91-102 states this exact split. *(Round 1 called this PARTIAL and named `tools` as wrongly probed; the docs say the opposite — an optional registry is queried at the use site.)* |
| 4 | auto-cleanup; `ctx.effect` for manual resources; **and re-entrancy across dispose/reload** | every subscription is `ctx.on(...)`; the trace writer opens a file and there is no unload path, no unload test, and no apply → dispose → apply test | **UNVERIFIED** — now sharper, because convention 10 says a required service's disappearance *will* dispose and reload this plugin |
| 5 | dev registration by `- insert:` patch with an absolute path | the profile installs this repo as a package (`link:…`) and the row is `- id: system1-observer` | **UNVERIFIED** — publish.md (queue 8) |
| 6 | `Config` is a Schemastery schema, validated at load, loud on error | `Schema.object` with `.default()`, `.min()`, `.description()` | **CONFORMS** |
| 7 | no hardcoded tunables | **five**: feed cap (`lib/host/feed.js:31`), fs journal `DEFAULT_MAX_PATHS`/`DEFAULT_MAX_PER_PATH` (`lib/host/fs-journal.js:31`), composer `maxChars = 8000` (`lib/turn-state.js:64`), tool-block `maxChars = 4000` (`lib/tool-blocks.js:50`) | **DELTA** — each already injectable in code, none reachable from YAML |
| 8 | a `config` change replaces the instance | measured mounts at 06:57:32 and 07:08:19 were config saves, each resetting the in-memory turn ledger | **CONFORMS — and it explains a measurement.** Documented behaviour, and the reason the cadence had to move onto the session's own turn number |
| 9 | tools via `defineTool`; its `parameters` validate `args`; `execute` returns the `output.schema` value | three tools register as `tools.register(createXTool({…}))` (`index.js:346,358,373`); `lib/tool.js:8` states the definition is hand-built and why | **DELTA, reason to re-judge** — the doc says `defineTool` validates; the hand-built path must be shown to validate too |
| 10 | where is `.volatile()` documented? | used on most `Config` fields; absent from all five pages read | **UNVERIFIED** — grep `reference/config-catalog.md` (queue 12) |
| 11 | **do not keep a static list of services** — the generated subsystem pages are authoritative | `lib/host/index.js` hand-declares `HOST_SERVICES` (6), `HOST_EVENTS` (4+), their modes and constraints, checked by `test/host-inventory.test.js` | **DELTA against the letter, valuable against the intent** — the inventory makes every host dependency explicit and is what caught two real mistakes, but the doc says the generated pages are the list and not to maintain another. Resolution: keep the check, cite the generated pages as its source (queue 7/11) |
| 12 | a service is **provided** with the `Service` base class | `ctx.provide(OBSERVER_SERVICE, …)`, whose comment cites `cordis/lib/index.js:800` and says *NOT `ctx.set`* | **CONFORMS by a different API** — the tutorial shows the class form; ours is the lower-level Cordis API, checked against Cordis's own source. `reference/cordis-api/service.md` should confirm it is documented (queue 3b) |
| 13 | core seams are the ones in the generated graph | consumed: `ctx.agents` ✓, `ctx.tools` ✓, `ctx.sessionQuery` ✓, `ctx.tokenMeter` ✓ — **`workspaceChanges` is not in the graph at all**; `system1` is our own dependency | **CONFORMS with a portability note** — `workspaceChanges` comes from a package (`dsh-workspace-changes`), not a core seam, so another deployment may not have it; it is already optional access, and its lines simply do not appear |
| 14 | events, packaging, settings card, testing | — | **UNVERIFIED** — queue 4-10 |

## Deltas worth naming

- **JavaScript, not TypeScript** — the documented plugin is a `.ts` module; this is why there is no `Config` type.
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
| `agent/inbox/claimed` announces each turn's opening message | declared, and **never emitted** — zero in every session log on disk | rounds 155–159 built on a signal that does not fire |

## Reading queue

1. ~~`develop/basic/tool.md`~~ ✅ (round 2); `reference/cookbook/adding-a-tool.md` remains for nested schemas, canonical values, policy hooks, PTC mode, UI cards
2. ~~`develop/basic/config.md`~~ ✅
3. ~~`develop/framework/service.md` + `reference/capability-seams.md`~~ ✅ — **3b:** `reference/cordis-api/service.md` to confirm `ctx.provide` is documented
4. `develop/framework/events.md` — the documented event rules
5. `develop/framework/index.md` + `develop/cordis-tutorial/02-lifecycle-and-effects.md` — lifecycle, `ctx.effect`, unload, re-entrancy
6. `reference/agent-lifecycle.md` — the loop this observer hangs off
7. `reference/subsystems/{session,session-query,token-meter,tools}.md` — grep; the consumed capabilities, plus `ctx.tools.guard` (the graph calls `ctx.tools` *"Tool registry and guarded execution pipeline"*, giving `lib/seams.js:75` a documented home)
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
