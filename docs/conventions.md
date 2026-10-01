# Harness conventions, and where this plugin stands

A working record, not a finished document. Its purpose is to make **the plugin a plugin** — built the way the
harness documents, not the way an agent inferred it from behaviour.

**Source of truth:** the official documentation mirror shipped by `dsh-plugin-dev-kb`.
Base: `~/.dsh/profiles/docdrift/node_modules/.pnpm/dsh-plugin-dev-kb@…/node_modules/dsh-plugin-dev-kb/kb`

**How to read it** (from the KB's own skill): start at `kb/meta/topics.md` — a task → file map — read that topic's
**核心** files first and its **扩展** files only when detail is needed. Chinese pages are canonical here; `site/en/`
mirrors them. Large files (`reference/config-catalog.md` 165 KB, `reference/tool-catalog.md`,
`reference/subsystems/session.md`, `extra/module-graph.md`) are to be grepped, never read whole.

**Status values, used strictly:**

| status | meaning |
|---|---|
| `CONFORMS` | the doc states the rule and this repo follows it — with the evidence named |
| `DELTA` | the doc states the rule and this repo differs — with the difference named |
| `UNVERIFIED` | not yet checked against the doc. **Not** a synonym for "probably fine" |

---

## Read so far

| file | what it settles |
|---|---|
| `meta/topics.md` | the map: 17 topics, each with 核心/扩展 files |
| `site/develop/basic/index.md` | first plugin: module shape, `apply`, `inject`, auto-cleanup, `ctx.effect`, dev registration |
| `site/develop/basic/config.md` | `Config` schema and type, `apply(ctx, config)`, **no hardcoded tunables**, HMR replaces the instance |
| `site/develop/basic/tool.md` | tools: `inject=['tools']`, `ctx.tools.register(defineTool({…}))`, `parameters` → `args`, `output.schema`/`render` |

## Conventions extracted

1. **A plugin is a module exporting `apply`** — `export const name`, optional `export const inject`, `export function apply(ctx)`; or the object form `export default { name, inject, apply }`; class form also exists (basic/index.md:19-31,107-120).
2. **`Config` is exported twice**: a TypeScript `interface Config` *and* a same-named Schemastery schema — `export const Config: Schema<Config> = Schema.object({…})` with defaults in the schema. Cordis validates at load and fills defaults; an invalid config **fails the load with a clear error**. A plain object is not acceptable — it must satisfy Standard Schema (config.md:11-47,76).
3. **`apply(ctx, config)`** — the resolved config is the second argument (config.md:31).
4. **No hardcoded tunables.** *"凡是不同部署可能需要采用不同值的参数，都必须定义为配置字段"* — every parameter a different deployment might set must be a config field. The doc's own test: **can you change this in `cordis.yml` without editing code?** (config.md:80-94).
5. **A `config` change unloads the old instance and loads a new one** (HMR). Because registrations are effects they are cleaned automatically, so nothing of the old instance remains (config.md:100-102).
6. **Tools**: `export const inject = ['tools']` lets Cordis wait for the registry; then `ctx.tools.register(defineTool({ name, description, parameters, output: { schema, render }, execute }))`, imported from `@deepseek-ai/dsh-tools`. `defineTool` **infers and validates `args` from `parameters`**; `execute` returns the canonical value its `output.schema` declares, and `output.render` turns that value into model-facing content (tool.md:13-38).
7. **Everything registered through `ctx` is cleaned up on unload** — listeners, tools, timers. Use `ctx.effect(fn)` for resources the framework cannot know about, returning a disposer (basic/index.md:68-87).
8. **Local development registers by patch overlay with an absolute path** — `- insert: [{ id, name: '/abs/path/src/my-plugin.ts' }]`, run with `dsh web --patch ./scratch-plugin/cordis.yml`. The patch contributes configuration only (basic/index.md:48-64).

## Where this plugin stands

| # | convention | this repo | status |
|---|---|---|---|
| 1 | module shape and `apply(ctx, config)` | `index.js:886` — `export default { apply, name, inject, Config }`, and `apply` takes `(ctx, config)` | **CONFORMS** |
| 2 | the plugin is a **TypeScript** module | plain ESM JavaScript throughout, hand-rolled `lib/*`; no `Config` interface is possible | **DELTA** — whether publish.md sanctions JS is queue item 8 |
| 3 | `inject` declares required services | `inject = ['agents']` declared; **`tools` is probed instead** (`index.js:345` guards `typeof tools.register === 'function'`) where the docs' own tool example declares `inject=['tools']`; `system1`/`sessionQuery`/`tokenMeter`/`workspaceChanges` are reached with `ctx.get` | **PARTIAL** — must be judged against `framework/service.md` + `capability-seams.md` (queue 3) |
| 4 | auto-cleanup, and `ctx.effect` for manual resources | every subscription is `ctx.on(...)`, so covered; the trace writer opens a file and there is **no unload path or unload test** | **UNVERIFIED** |
| 5 | dev registration by `- insert:` patch with an absolute path | the profile installs this repo as a package (`link:/home/john/CodingProjects/dsh-system1-observer`) and the row is `- id: system1-observer` | **UNVERIFIED** — the package route is presumably publish.md (queue 8) |
| 6 | `Config` is a Schemastery schema, validated at load, loud on error | `Schema.object` with `.default()`, `.min()`, `.description()`; no plain object | **CONFORMS** |
| 7 | **no hardcoded tunables** — settable from `cordis.yml` without editing code | **five tunables are module defaults only**: the feed cap `DEFAULT_MAX_PER_SESSION` (`lib/host/feed.js:31`), the fs journal's `DEFAULT_MAX_PATHS` and `DEFAULT_MAX_PER_PATH` (`lib/host/fs-journal.js:31`), the composer's `maxChars = 8000` (`lib/turn-state.js:64`), and the tool-block `maxChars = 4000` (`lib/tool-blocks.js:50`). Each is injectable in code and none is reachable from YAML | **DELTA** |
| 8 | a `config` change replaces the instance; effect-registered things are cleaned | every subscription is an effect (covered), but the in-memory feed, fs journal, claimed boundary and turn ledger all reset. Measured mounts at 06:57:32 and 07:08:19 were config saves, and each reset the turn ledger | **CONFORMS — and it explains a measurement.** The doc says the instance is replaced; the ledger reset is documented behaviour, not a quirk. State that must survive a save cannot live in the instance, which is *why* the cadence was moved onto the session's own turn number |
| 9 | tools via `ctx.tools.register(defineTool({…}))`; `defineTool` validates `args` from `parameters`; `execute` returns the `output.schema` value and `render` renders it | three tools register as `tools.register(createXTool({…}))` (`index.js:346,358,373`). `lib/tool.js:8` states the definition is **hand-built rather than `defineTool`** and gives a reason | **DELTA, with a reason to re-examine** — the doc says `defineTool` validates arguments; the hand-built path must be shown to validate them, or the reason must be re-read and judged now that the docs are in hand |
| 10 | *where is `.volatile()` documented?* | `.volatile()` is used on most fields; it appears in **none** of the three pages read | **UNVERIFIED** — grep `reference/config-catalog.md` |
| 11 | events, services, packaging, settings card, testing | — | **UNVERIFIED** — queue items 3-10 |

## Deltas worth naming before reading further

- **JavaScript, not TypeScript.** The documented plugin is a `.ts` module; this repo is JS with hand-rolled modules. Either publish.md sanctions JS and we cite it, or this is the largest convention gap — and it is why there is no `Config` type, only the schema.
- **Five tunables are unreachable from `cordis.yml`.** This is the first *cheap and concrete* conformance fix the docs produced: two to five `Config` fields, and the factories already accept them as arguments.
- **`tools` is probed, not injected.** The docs' tool example declares `inject=['tools']`; we guard our call instead.
- **Tools are hand-built rather than `defineTool`.** A reason is recorded in `lib/tool.js:8`; it predates this reading and deserves re-judging against tool.md.
- **No unload story.** Nothing tests that unloading releases the listeners, the trace writer or the feed.
- **Where the documentation *was* consulted it was the installed declaration, not the docs** — `cordis_inspect_query` gave us `SessionEventMap`, `ContentBlockMap`, `SurfaceEventType`, service signatures. Authoritative for *this build*, and the reason four shape bugs were found; not the same as following a documented convention.

## The four times inference lost to reading (this session)

| assumption | what the reading said | cost |
|---|---|---|
| tool blocks are `tool_use` with `input` | `ContentBlockMap` declares `tool-call` with `arguments` as a JSON **string** | the `TOOL CALLS` section was **empty on every measurement ever taken** |
| a user message wraps its payload in `data.message` | `SessionEventMap` declares `'user/message': UserMessage` — `data` **is** the message | declared-shape messages were dropped |
| `readSurface` returns `{ nodes }` | `SessionSurfaceSnapshot` = `{ session, inheritedEventCount, capturedThroughSeq, events }` | the oracle reported disagreement it never measured |
| `agent/inbox/claimed` announces each turn's opening message | declared, and **never emitted** — zero occurrences in every session log on disk | rounds 155–159 built on a signal that does not fire |

## Reading queue

1. ~~`develop/basic/tool.md`~~ — **done** (round 1); `reference/cookbook/adding-a-tool.md` remains for nested schemas, canonical values, policy hooks, PTC mode, UI cards
2. ~~`develop/basic/config.md`~~ — **done** (round 1)
3. `develop/framework/service.md` + `reference/capability-seams.md` — `inject` vs dynamic access; Service Definition / Provider / Consumer
4. `develop/framework/events.md` — the documented event rules
5. `develop/framework/index.md` + `develop/cordis-tutorial/02-lifecycle-and-effects.md` — lifecycle, `ctx.effect`, unload
6. `reference/agent-lifecycle.md` — the loop this observer hangs off
7. `reference/subsystems/{session,session-query,token-meter,tools}.md` — grep; the capabilities consumed here, plus `ctx.tools.guard` (seen at `lib/seams.js:75`, undocumented in the pages read)
8. `develop/basic/publish.md` — packaging, the route the profile actually uses
9. `reference/cookbook/adding-a-settings-card.md` — the card
10. `extra/testing.md` + `extra/defensive-patterns.md` — testing strategy, defence patterns
11. `reference/index.md` + `reference/cordis-primer.md` — architecture, last, so it lands on facts already read
12. **grep `reference/config-catalog.md` for `volatile`** (row 10)

## Plan

| phase | output |
|---|---|
| **0. Read** | this file, row by row: every `UNVERIFIED` resolved to `CONFORMS` or `DELTA`, each with its citation |
| **1. Skeleton** | the smallest conforming plugin — module shape, `Config`, `inject`, effects — proven to load through the **documented** route before any observer logic is attached |
| **2. Port** | the observer's logic moved onto that skeleton; every hand-rolled piece either justified by a citation or deleted in favour of the documented mechanism |
| **3. Conformance** | a test that checks the plugin's shape against the documented conventions — not "the tests pass", which is what let a stray file ride into a commit and four shape bugs live for rounds |
