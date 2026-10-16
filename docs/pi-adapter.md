# The pi adapter — a second foreign corpus, measured

`docs/adapters-and-standards.md` names pi as "the cheapest second adapter": 223 sessions on this host, a familiar
store layout, a flat JSONL log. This is that adapter, and it is the first claim in this repository measured
**end to end through a running deployment's own tools** rather than through a script.

| | |
|---|---|
| the converter (pure, tested) | `lib/pi-session-export.js` |
| the writer | `scripts/import-pi-sessions.mjs` |
| the test | `test/pi-session-export.test.js` |
| the pi format it reads | `@earendil-works/pi-coding-agent` **0.85.1**, `docs/session-format.md` |
| the corpus measured | **223 sessions** — 188 roots, 12 forks, 23 subagent runs — under `~/.pi/<agent>/sessions/` |

## What was measured before anything was written

The corpus was read as bytes, not assumed from a spec, and every rule below cites the number that produced it:

| | measured |
|---|---|
| sessions / entries | 223 files, 41,960 entries, **0 unparseable lines** |
| conversation | **1,971** `user` · **19,874** `assistant` · 19,077 `toolResult` · 27 `bashExecution` · 14 `system` |
| assistant blocks | `text` and `thinking` and `toolCall`; **126 images** across the corpus |
| tool pairing | 19,100 advertised calls, **19,077 results, every one BEFORE the next assistant message (100%)**, 0 orphans, **23 unresolved** |
| branches | **1 session of 223** has more than one child; **3 entries** in the corpus sit off the live path |
| injection | **183 `custom_message` entries across 10 extension types** — `subagent-notify` 74, `goal-event` 34, `telegram-connection-state` 27, `intercom_message` 16, six more |
| attempts | `model_change` 294 · `thinking_level_change` 225 · `compaction` 8 · `context_edit` 6 · `custom` 23 |
| ordering | the leaf is the **last entry in file order in 223 of 223** sessions |
| asks | **0 of the 1,971 `user` messages** carry a `<system-reminder>`-style system block |

## The four conversion rules

**1. The live branch is the leaf path, not the file order.** pi's entries form a DAG (`id`/`parentId`) and pi
resolves it itself: `buildContextEntries()` walks from the current leaf to the root. Flattening the file would merge
two branches into one conversation — here it is rare (1 session), but the rule costs nothing and the alternative is
a conversation that never happened. **This is a better rule than the DeepSeek importer's**, which had to follow the
deepest subtree *because that export names no winner*; pi states which branch is live, so the guess is not needed.
Whatever is off the path is counted (`offBranchEntries`), never merged.

**2. The turn is derived from the operator ask, because pi has no turn at all.** This is the single most important
rule, and `docs/adapters-and-standards.md` already measured the failure it avoids: *"pi has no turn at all — all 44
pi messages loaded with a null turn … a 'per turn' query silently became a **dsh-only** query while looking
cross-harness."* dsh's log **refuses** an `assistant/message` that does not match an open turn and step, so a turn
has to be constructed:

```
turn N  ← one operator `user` message
  step 1..k ← one assistant message each
     assistant/message (reasoning · text · tool-call blocks)
     tool/call + tool/result for each call that has a result
  turn/end
```

The grouping is measured, not assumed: every tool result in this corpus appears **before** the next assistant
message, so "one assistant message plus its own results" is a step rather than a guess about interleaving.

**3. An ask is a `user` message, and nothing else is.** The 183 `custom_message` entries participate in the LLM
context without a human typing them — extension chatter, subagent notifications, a Telegram connection notice. Treat
them as asks and you invent **183 operator turns** out of noise. That is the "not every user message is a human"
problem `docs/adapters-and-standards.md` records for mcode, in pi's own vocabulary. They are written as
`user/message` with a **producer-owned** `source.kind` (`pi-subagent-notify`, `pi-goal-event`, …), which
`lib/exchange.js` already reads as a non-human message rather than as an ask — in the log, out of the asks.

**4. An unresolved call is left out of the block and counted.** dsh validates tool lifecycles: a `tool-call` block
inside an `assistant/message` *advertises* a call, a `tool/call` must match it by name and arguments, and
`step/end` / `turn/end` **refuse** an unresolved one. 23 of 19,100 advertised calls have no result — the tail of
aborted sessions. Fabricating a result, or emitting the block and leaving the lifecycle open, makes the log
unreadable. They are dropped from the block and counted.

## What the log deliberately does not carry

Written to the sidecar `IMPORT-MAP.json`, per session and in total, because a loss nothing reports reads as a
measurement that saw everything:

| not in the log | on this corpus | why |
|---|---|---|
| image payloads | 149 blocks | base64 bytes; a log does not need them to be readable, and a text placeholder would be evidence the model never produced |
| pi prompt sections (`system` messages) | 14 messages, 82 sections | a **section** is assembled per request and is not a message; putting it in the conversation would invent one |
| compaction summaries | 8 | see below |
| `context_edit` effects | 6 | an edit removes an entry from *future* context |
| `bashExecution` messages | 27 | pi's own record of a `!` command; no call id, so no honest pairing |
| `thinking_level_change` / `model_change` | 225 / 294 | session facts with no dsh field — **the reasoning-effort axis the register calls unrecorded in dsh is recorded first-class by pi** |
| the stream | every session | pi keeps no stream record, so `stream: []` states a fact rather than hiding one |
| per-message cost and reasoning tokens | 733,508 reasoning tokens, **$511.66** total | no dsh `usage` field; summed into the sidecar |

**THE COMPACTION LOSS IS THE ONE THAT CAN MISLEAD.** An imported log holds the whole history, while pi's model saw
only `firstKeptEntryId`-onwards (or `retainedTail`). So a measurement of a compacted session can read text the
model could no longer see, and look complete. 8 compactions across 223 sessions is why this is recorded rather
than solved; **a reading of a session with `compactionEntries > 0` must say so.**

## The writer is additive, and that is the difference from the DeepSeek one

`scripts/import-deepseek-web.mjs` **wipes and recreates** its output root. That is safe for an export directory and
**destructive** for a root a deployment reads — and this writer targets `~/.dsh/sessions`, where every dsh
conversation already is. So:

* it never deletes: sessions are built in a **staging root** and moved in;
* it **refuses to overwrite** an existing session id (`--force` is the way past), because an id collision is two
  conversations wearing one name;
* `--compression` defaults to **zstd**, which is what a deployment writes. F147 measured the alternative: one
  uncompressed artifact in a zstd root is refused at listing time and breaks the **whole root's** session list;
* `--install` is a separate, explicit commit point, so a half-finished import never leaves directories a deployment
  cannot read.

**SUBDIRECTORIES ARE WHERE 35 OF THE 223 SESSIONS LIVE**, and a shallow walk misses them silently:

```
<slug>/<timestamp>_<uuid>.jsonl                     a root session            188
<slug>/<ts>_<uuid>/forks/<ts>_<uuid>.jsonl           a /fork or /clone          12
<slug>/<ts>_<uuid>/<uuid>/run-N/session.jsonl        a SUBAGENT RUN             23
```

A subagent run is a **child agent's own conversation**, not an exchange of the operator's — 64% of the dsh library
on this host is subagent runs, and `docs/adapters-and-standards.md` records what an index that cannot tell them
apart does to a question about conversations. So they are written with dsh's own `origin: 'subagent'`, which the
`observeSubagents` knob already knows how to skip.

## What it cost to measure, and what it bought

Live, in the running deployment, after installing 223 sessions (611 → 834 session directories, 305 MB → 326 MB):

| | |
|---|---|
| the row read a pi session | `system1_sessions` — 4,950 events, 1,034 messages, 279,295 chars, 1,850 tool events |
| a pi session, judged | `system1_evaluate_session`, `session@1`, 5 segments of 57,600 chars, 16 questions, package written to `~/.dsh/measurements/` |
| searchable like a dsh session | index refresh: 834 sessions, 254 refolded, 71 s; `system1_sessions { action: 'search' }` returns pi sessions with snippets, including their reasoning |

The measurements came back **apt on data nobody here wrote** — and with the caveat F147 already earns for a foreign
corpus, in the other direction: `session@1` was authored for dsh agent sessions, and a pi session is a *different*
genre in one respect that matters — its MiniMax provider puts `<think>` markup **inside visible text**, which the
judge reads as the model saying it. `session_claim_unsupported_by_tools` at 0.73 and `session_scope_expanded` at
0.80 on this corpus are readings of a working research session, not of a harness loop.

## Running it

The importer is a **script, not a tool**, and that is a decision rather than an omission. Every other tool in this
package reads or writes files the plugin made — the trace, the packages, the question sets. This writes into
`~/.dsh/sessions`, the live deployment's own root: a mistake there is not undone by deleting something the plugin
made. It would also put an **act surface inside the instrument** — a session being measured could import sessions,
and `system1_evaluate_session` would judge whatever it found. And it would collide with `dsh-chat-import`'s
`import_chat` the day that install is unblocked (see below). So: a human runs it, reads the plan, and commits.

Three steps, and the third is the only one that changes what a deployment can see:

```bash
# 1. WHAT, AND WHAT WOULD BE LOST -- writes nothing, and the counts are the receipt
node scripts/import-pi-sessions.mjs --out /tmp/pi-staging --dry-run

# 2. BUILD the staging root, through the harness's own persistence API (so the structural rules are enforced)
node scripts/import-pi-sessions.mjs --out /tmp/pi-staging
#    → /tmp/pi-staging/IMPORT-MAP.json carries every loss: 8 compactions, 6 context_edits, 149 images,
#      23 unresolved tool calls, 183 injected messages, 3 off-branch entries, and the cost pi recorded

# 3. COMMIT: move finished sessions into a root a deployment reads
node scripts/import-pi-sessions.mjs --install /tmp/pi-staging --to ~/.dsh/sessions
```

Useful flags: `--root` (default `~/.pi`), `--agent <name>`, `--cwd <slug-filter>`, `--limit N`, `--compression
zstd|none` (**zstd against a live root** — F147 measured what the other choice does), `--force` (overwrite an existing
session id, which otherwise is refused: an id collision is two conversations wearing one name).

**Then refresh the store, or the sessions are invisible to search.** `list` and `read` see them through the harness
immediately; `search` reads a SQLite snapshot and does not:

```bash
node scripts/session-index.mjs build --text --incremental   # or session_index_refresh
```

Measured on this host: 223 sessions in 4.2 s, index refresh 254 sessions refolded in 71 s, store 1,371 MB.

## The plugin that would replace this, and why it is blocked

`dsh-chat-import` (MIT, **L5 run-tested on 15 dsh versions**, audited, 0 findings, 230 stars, last commit 2026-10-13)
imports from **30 agents including pi** as native, *resumable* DSH v4 sessions — plus export-back and retract — and
its protocol states the same turn model this converter derived from the corpus by measurement: *one user question is a
`turn`; one assistant message with its tool calls and results is a `step`*. Where the two differ:

| | `dsh-chat-import` | this converter |
|---|---|---|
| images | keeps bytes via `ctx.attachments` | **drops** them, counts them |
| injected non-human messages | **skips** them, counts | **keeps** them in the log, out of the asks |
| compaction | native checkpoint | full history; the fact reported |
| timestamps | unsupported for pi | ✅ carried on every event |
| usage | unsupported for pi | ✅ mapped into `assistant/message.data.usage` |
| reversibility | retract + export | none |

So the **intake belongs to that plugin** and this stays a **parity fixture** — the conversion whose receipts say
whether anyone else's import lost anything ours kept. The install is blocked, deterministically, on something else
entirely: adding any bundle re-resolves the whole profile and hits
`@deepseek-ai/dsh-settings@>=0.1.5 <0.2.0-0`, a range **no published version satisfies** (npmjs answers 404; the
mirror additionally reports `latest = 0.0.1-rc.1`). Same disease as the `check:deploy` drift.

## The harness rule that cost a rewrite, and is now F150

The first write was **refused**:

> `format v4 message requires a producer-owned source kind`

v4 admits a non-empty `source.kind` and **explicitly rejects the retired `"plugin"` wrapper** — the kind this
repository's own reasoning reached for (`{kind: 'plugin', plugin: 'pi:…'}`), and the shape
`docs/adapters-and-standards.md` quotes from the v3 era. The kinds a real deployment writes are named after their
**producer**: `model`, `tool`, `user`, `goal`, `subagent-settled`, `skill-invocation`, `tool-registry`,
`compact-checkpoint`. So a pi extension's message is named after the extension, `pi-<customType>`.

**This is the second time a rule that exists only in the harness's compiled validator has decided this
repository's code**, after the `step/start` pairing F147 records. Both were found by *writing through the API*
rather than by reading the type declarations.
