# Session tools — what moved, what stayed, and why

**Status: step 1 deferred, steps 2 and 3 done (2026-10-14).** Four repositories are involved, so the plan is written
down here rather than held in anyone's head. Each step names the repository it lands in, because the order is the
whole safety property.

| | repo | state |
|---|---|---|
| **1** | `dsh-session-index` | **deferred** — expand `session_index_read` to the subject-window shape |
| **2** | this one | **done** — `list`, `search`, `refresh` retired; the read kept |
| **3** | this one | **done** — the read is `system1_session_subject`, named for what it is |
| — | `dsh-chat-import` | **deferred** — the dependency mess; see the end of this document |

## What was measured before anything changed

| | |
|---|---|
| `system1_sessions { action: 'list' }` | **~54 s** (7 samples, 52,977–56,176 ms), against a library of 834 sessions — `sessionQuery.listSessions()` plus a title per row |
| `node scripts/session-index.mjs stats` | **78 ms** |
| `session-index find <term>` | **1 ms** (13–99 ms including process start) |
| `system1_sessions { action: 'search' }` | milliseconds, because it already **fell back** to the store |

So the tool was carrying a two-backend precedence policy — [the deleted `lib/sessions-search.js`](core/README.md) —
whose first backend this deployment leaves at `openAt: never` (F98). The fallback was always the answer, and the
policy around it was always dead code.

## Step 1 — expand `session_index_read` (DEFERRED, and it is the load-bearing one)

Deferred on purpose: `dsh-session-index` is an installed **npm package** here, not a local checkout, so "editing the
tool hint" and "expanding the tool" are the same act of editing someone else's published package. When it is done, it
needs three things, and none of them is the message list it already returns:

1. **The event window, tool traffic included.** `composeTurnState` is handed the *surface*, not the messages
   ([dsh/turn-state.js:59-60](dsh/turn-state.js:59)): `tool/call` and `tool/result` are not messages, so filtering to
   messages first discards the whole tool record. `session_index_read` counts tool events today; it does not return
   them.
2. **The surface, and whose rule it follows.** For a stored subject this repository asks the host
   (`currentSurfaceSeqs`) and only falls back to its own fold. The store excludes `surfaceOp.replace` ranges too — by
   its own rule, without the host's answer. Adjacent, not interchangeable. This store holds **20,118 shadowed
   messages**; a reader that drops the surface rule measures text the model could no longer see.
3. **A path for an id the store has never seen.** `session_index_read` finds the file *through SQLite*, so a session
   that has never been indexed is simply not readable — where `system1_sessions read` reads any stored session by id
   today. The pi import was exactly that case: 223 sessions were invisible to search until a 71 s refresh. An id the
   store does not hold must fall back to the `sessionsDir` walk **and say it did**, rather than answering "not found".

Also owed there, and deliberately not done by editing a package: the tool **hint**. `session_index_read`'s
description should say what it now returns and point here for the measurement semantics — the same way
`system1_session_subject`'s description points back.

## Step 2 — retire the three duplicated actions (DONE)

Deleted: `lib/sessions-tool.js`'s `list`/`search`/`refresh`, `lib/sessions-search.js`, `lib/sessions-tool-output.js`
(the schema and render for all four actions). Kept and moved into `dsh/session-subject-tool.js`: the read, its schema
and its render — **unchanged**, because a retirement that also changes behaviour is two changes at once.

One thing rode along and did not get lost: `newest` is resolved against the service and sorted by `header.createdAt`,
because a parameter must not promise a value it then rejects. That resolution lived in the **evaluation** path, not the
tool ([index.js:693-708](index.js)), and it stays.

## Step 3 — `system1_session_subject` (DONE)

Renamed, because what remains is not a session tool: it composes the **subject** a judgement is made from. The
description states the division in the first two sentences and names `session_index_list`, `session_index_search` and
`session_index_refresh` — asserted by a test, so the pointer cannot rot quietly.

The count is still nine. Three actions left this row, and the read came back under a name that says what it is.

### A consequence nobody had priced

**This package no longer imports `dsh-session-index` at all.** `lib/sessions-search.js` and the `refresh` action were
the only two consumers, so the store-drift guard — [the deleted `test/store-copy-is-current.test.js`](core/README.md),
which existed because this repo ran the store's *builder* and could execute a stale one against a fresh store
(`F117`) — has no premise left here. It was deleted rather than left passing for the wrong reason. The equivalent
guard belongs in `dsh-session-index`, where the builder and the store now live in the same package.

`dsh-session-index` stays in `package.json`: `scripts/session-index.mjs`, which the docs and several habits point at,
still resolves its CLI at run time. It is a **script-only** dependency now, which is worth knowing before anyone
reasons about the install graph.

## The pi importer, and `dsh-chat-import` (BOTH OPEN)

The question put to this repository was whether the hand-rolled pi import belongs in `dsh-session-index`.

**What the evidence says.** `dsh-chat-import` (MIT, L5 run-tested on 15 dsh versions, audited, 0 findings, 230 stars,
last commit 2026-10-13) imports from **30 agents including pi**, as native DSH v4 sessions that are *resumable*, with
`import_chat`, a GUI, a service, a CLI, plus export-back and retract. Its protocol doc
([INTERCHANGE.md](https://github.com/Nwflower/dsh-chat-import/blob/main/docs/INTERCHANGE.md)) states the same turn
model this repository derived from the corpus by measurement: *"一条用户提问 = 一个 `turn`；一条助手消息（含其工具调用与
结果）= 一个 `step`"*. Its pi row claims tool results, reasoning, **images with bytes**, cwd, **branches** and
**compaction**. Two independent derivations of one rule is decent evidence the rule is right.

Where the two differ, measured:

| | `dsh-chat-import` | ours |
|---|---|---|
| images | keeps bytes via `ctx.attachments` | **drops** them, counts them |
| injected non-human messages | **skips** them, counts | **keeps** them in the log, out of the asks |
| compaction | native checkpoint | full history; the fact reported |
| timestamps | pi row: none | ✅ carried on every event |
| usage | pi row: none | ✅ mapped into `assistant/message.data.usage` |
| loss reporting | `degradations` on every import | `IMPORT-MAP.json` sidecar |
| reversibility | retract + export | none |

**So: the import belongs in `dsh-chat-import`, not in `dsh-session-index`.** A session *store* plugin that imported
pi transcripts would be doing intake work its author explicitly scoped out — *"it is not the observer's subject
composition… a session library that carried them would be useless to a deployment that measures nothing"* — and it
would duplicate a maintained, L5-tested, 30-source importer. What stays here is the **parity fixture**: the corpus
conversion whose receipts are 1,971 operator asks, 19,874 assistant messages, 19,077 paired tool results, 23
unresolved calls dropped and counted, 3 off-branch entries reported, 126 images lost — the measurement that says
whether anyone else's import lost anything ours kept.

Two of ours are genuinely not covered by theirs (timestamps, usage), so the comparison is worth running rather than
assuming.

## Why the install is deferred, exactly

`dsh-chat-import@0.25.2` failed twice, deterministically, on both registries:

```
[ERR_PNPM_NO_MATCHING_VERSION] No matching version found for
  @deepseek-ai/dsh-settings@>=0.1.5 <0.2.0-0
```

It is **not** that plugin's fault: its dependencies are `fzstd` and six peers that all resolve. Installing any bundle
re-resolves the **whole profile**, and that surfaced a range **no published version satisfies** — npmjs answers 404
for `@deepseek-ai/dsh-settings@>=0.1.5 <0.2.0-0` (it publishes `0.1.5-rc.3`, a prerelease, and then jumps to
`0.1.6-alpha.1`; a semver range without a prerelease cannot match one). The configured mirror is worse: it reports
`latest = 0.0.1-rc.1`, published 8/10/2026.

Same disease as the `check:deploy` drift this repository already records: **the profile's recorded dependencies no
longer describe the machine.** Until that is fixed, no new bundle can be added to `docdrift` by this path.
