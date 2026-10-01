# Harness conventions, and where this plugin stands

A working record, not a finished document. Its purpose is to make **the plugin a plugin** — built the way the
harness documents, not the way an agent inferred it from behaviour.

**Source of truth:** the official documentation mirror shipped by `dsh-plugin-dev-kb`.
Base: `~/.dsh/profiles/docdrift/node_modules/.pnpm/dsh-plugin-dev-kb@…/node_modules/dsh-plugin-dev-kb/kb`

**How to read it** (from the KB's own skill): start at `kb/meta/topics.md` — a task → file map — read that topic's
**核心** files first and its **扩展** files only when detail is needed. Chinese pages are canonical here; `site/en/`
mirrors them. Large files (`reference/config-catalog.md`, `reference/tool-catalog.md`,
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
| `kb/meta/topics.md` | the map: 17 topics, each with 核心/扩展 files |
| `kb/site/develop/basic/index.md` | the first-plugin conventions: module shape, `apply`, `inject`, auto-cleanup, `ctx.effect`, registration |

## What the first-plugin page states

1. **A plugin is a module exporting `apply`.** `export const name`, optional `export const inject`, `export function apply(ctx)` — or the object/class forms (`export default { name, inject, apply }`).
2. **`inject` names required services.** *"Required dependencies are ready before apply runs"* — inside `apply`, `ctx.tools` is available. The framework loads the plugin only once they are ready.
3. **Everything registered through `ctx` is cleaned up automatically on unload** — event listeners, tools, timers. *"You do not need to removeListener or clearInterval."*
4. **`ctx.effect()` is for resources the framework cannot know about** — e.g. a connection — returning a disposer that runs at unload.
5. **Development registration is a patch overlay with an absolute path** — `- insert: [{ id, name: '/abs/path/src/my-plugin.ts' }]`, applied with `dsh web --patch ./scratch-plugin/cordis.yml`. The page notes the patch contributes configuration only and does not change how the loader resolves module paths.

## Where this plugin stands, on the evidence so far

| # | convention | this repo | status |
|---|---|---|---|
| 1 | module shape: `name`, `inject`, `apply(ctx, config)` | `index.js`: `const name`, `const inject = ['agents']`, `export function apply(ctx, config)` | `UNVERIFIED` — the page shows one argument to `apply`; `config` needs `develop/basic/config.md` to confirm |
| 2 | **TypeScript** module (`.ts`) | plain ESM **JavaScript** throughout, hand-rolled `lib/*` | `DELTA` — the page treats a plugin as a `.ts` module; whether JS is sanctioned needs `develop/basic/publish.md` |
| 3 | `inject` declares required services | `inject = ['agents']` only; `system1`, `tools`, `tokenMeter`, `workspaceChanges`, `sessionQuery` are all reached with `ctx.get(name)` behind guards | `UNVERIFIED` — `develop/framework/service.md` + `reference/capability-seams.md` must say when a dependency belongs in `inject` vs `ctx.get` |
| 4 | automatic cleanup of everything registered via `ctx` | every subscription is `ctx.on(...)` → covered. The trace writer opens a file and the plugin has no unload path | `UNVERIFIED` — need `ctx.effect` for the writer if it holds anything; no test asserts unload releases listeners |
| 5 | registration by absolute-path patch overlay for development | the profile installs this repo as a package (`link:/home/john/CodingProjects/dsh-system1-observer`) and the row is `- id: system1-observer` in `cordis.patch.yml` | `UNVERIFIED` — the installed-package route is presumably `develop/basic/publish.md`; the repo has never produced a package the documented way |
| 6 | `Config` schema declared and exported | `Schema.object({...})` with per-seam keys, `.volatile()` where a live edit must arrive | `UNVERIFIED` — `develop/basic/config.md` must confirm the shape, `.volatile()` semantics and how `apply` receives the resolved config |
| 7 | events: subscribe through `ctx.on` | 7 subscriptions by literal; modes (`emit` / `serial` / `waterfall`) taken from the **installed** Event catalog, not the docs | `UNVERIFIED` — `develop/framework/events.md` is the documented rule; `reference/persistence-catalog.md` may be the documented event list |
| 8 | testing | `node:test`, hand-rolled mounted rows, 508 tests, no snapshot or e2e layer | `UNVERIFIED` — `extra/testing.md` states the strategy and unit/e2e boundaries |

Every `UNVERIFIED` above is a place where the current design rests on inference. **Six of them are places I have
already been wrong in this session in exactly this way** — see the note below.

## Deltas worth naming before reading further

- **JavaScript, not TypeScript.** The whole repo is JS with hand-rolled modules; the documented plugin is a `.ts`
  module. Either the docs permit JS and we say so with a citation, or this is the largest single convention gap.
- **No unload story.** Nothing in the repo tests that unloading the plugin releases its listeners, its trace writer,
  or its feed contents. The documentation promises that cleanup is automatic *for what goes through `ctx`* — so the
  question is which of our resources do not.
- **Services reached dynamically.** `ctx.get('sessionQuery')`, `ctx.get('tokenMeter')`, `ctx.get('workspaceChanges')`
  are each justified in comments as "optional access". The docs divide capabilities into Service Definition /
  Provider / Consumer and have a rule for `inject`; our pattern needs to be checked against it rather than argued.
- **Where the documentation *was* consulted, it was the installed declaration, not the docs** — `cordis_inspect_query`
  gave us `SessionEventMap`, `ContentBlockMap`, `SurfaceEventType` and the service signatures. That is authoritative
  for *this build*, and it is why the four shape bugs were found; but it is not the same as following a documented
  convention, and the difference matters for a plugin that should be portable between harness versions.

## The four times inference lost to reading (this session)

Recorded here because they are the argument for this document existing:

| assumption | what the reading said | cost |
|---|---|---|
| tool blocks are `tool_use` with `input` | `ContentBlockMap` declares `tool-call` with `arguments` as a JSON **string** | the `TOOL CALLS` section was **empty on every measurement ever taken** |
| a user message wraps its payload in `data.message` | `SessionEventMap` declares `'user/message': UserMessage` — `data` **is** the message | declared-shape messages were dropped |
| `readSurface` returns `{ nodes }` | `SessionSurfaceSnapshot` = `{ session, inheritedEventCount, capturedThroughSeq, events }` | the oracle comparison reported disagreement it never measured |
| `agent/inbox/claimed` announces each turn's opening message | the event is declared, and **never emitted** — zero occurrences in every session log on disk | rounds 155–159 built on a signal that does not fire |

## Reading queue, in order

1. `site/develop/basic/tool.md` + `site/reference/cookbook/adding-a-tool.md` — the tool DSL (this plugin registers three tools)
2. `site/develop/basic/config.md` + `site/develop/cordis-tutorial/05-config.md` — `Config`, resolution, what `apply` receives
3. `site/develop/framework/service.md` + `site/reference/capability-seams.md` — `inject` vs dynamic access
4. `site/develop/framework/events.md` — the documented event rules
5. `site/develop/framework/index.md` + `site/develop/cordis-tutorial/02-lifecycle-and-effects.md` — lifecycle, `ctx.effect`
6. `site/reference/agent-lifecycle.md` — the loop this observer hangs off
7. `site/reference/subsystems/{session,session-query,token-meter,tools}.md` — grep, they are large; the capabilities this plugin consumes
8. `site/develop/basic/publish.md` — packaging, which is the route the profile actually uses
9. `site/reference/cookbook/adding-a-settings-card.md` — the card
10. `extra/testing.md` + `extra/defensive-patterns.md` — testing strategy and the defence patterns
11. `site/reference/index.md` + `site/reference/cordis-primer.md` — architecture, last, so it lands on facts already read

## Plan

| phase | output |
|---|---|
| **0. Read** | this file, row by row: every `UNVERIFIED` resolved to `CONFORMS` or `DELTA`, each with its citation |
| **1. Skeleton** | the smallest conforming plugin — module shape, `Config`, `inject`, effects — proven to load through the **documented** route before any observer logic is attached |
| **2. Port** | the observer's logic moved onto that skeleton; every hand-rolled piece either justified by a citation or deleted in favour of the documented mechanism |
| **3. Conformance** | a test that checks the plugin's shape against the documented conventions — not "the tests pass", which is what let a stray file ride into a commit and four shape bugs live for rounds |
