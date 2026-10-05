# Adapters, and what the rest of the industry actually standardised

Written because the operator's strategic point — *spend the time on the core business logic; adapters are separate* — turned
out to have a checkable answer, and the answer changes what the core should speak.

Everything below was read rather than assumed. Two claims are **measured on this machine**, two are **read from
sources**, and each says which.

## What is standard, and what is not

| layer | standard? | evidence |
|---|---|---|
| **live** agent ↔ client session protocol | **YES — ACP, the Agent Client Protocol** | the harness ships both sides: a server (`packages/acp`: *"lets programs and automation run persistent DeepSeek Harness agents over the standard Agent Client Protocol … create, list, resume, and close sessions … receive semantic updates"*) and a client that spawns such a server from another harness (`subagent/subagent-acp`). The spec is public ([agent-client-protocol schema v1](https://github.com/agentclientprotocol/agent-client-protocol/blob/700e441e55bd7ce50f3cc0447395305e08f3068c/docs/protocol/v1/schema.mdx)) |
| **session / trajectory FILE** | **EMERGING — ATIF, the Agent Trajectory Interchange Format** | an active RFC, v1.6, Oct 2025, Boxuan Li, for the Harbor project ([RFC text](https://github.com/Mascobot/harbor/blob/main/rfcs/0001-trajectory-format.md), [Harbor docs](https://mintlify.wiki/harbor-framework/harbor/core-concepts/agents/atif)) with **a vendor implementation in [NVIDIA NeMo Relay](https://docs.nvidia.com/nemo/relay/v0.6.0/configure-plugins/observability/atif)**. Its own comparison table covers MiniSweAgent, OpenHands and Gemini-CLI trajectories, and it exists precisely because those four disagreed |
| **provider-neutral session INTAKE** | **YES, as a library — `@tangle-network/agent-eval`** | [its intake doc](https://raw.githubusercontent.com/tangle-network/agent-eval/2121aa6d79a50ba3f2aa54c9815755310e1a7869/docs/code-agent-intake.md): *"One function per harness"* — `fromCodexSession`, `fromClaudeCodeSession`, `fromOpenCodeSession`, `fromKimiCodeSession`, **`fromPiSession`** — *"They share one implementation and one options shape; the harness decides how a session id, a terminal state, and a cost receipt are read out of the entries."* |
| **dsh's own session log** | **NO — and that is fine** | measured here: `~/.dsh/sessions/<slug>/<id>/session.v{N}.jsonl.zstd`, an **event log** (`turn/start`, `user/message`, `assistant/message`, `tool/call`, `tool/result`, `surfaceOp`, `step/*`) with versions and migrations — `dsh-session` + `dsh-session-projection` |
| **Hermes Agent's trajectory** | **NO — it does not share dsh's format** | measured here: `~/hermes-agent/trajectory_compressor.py` post-processes *"completed agent trajectories … JSONL files"* in **role-tagged turns** (*"Protect first turns (system, human, first gpt, first tool) … Compress MIDDLE turns … Replace compressed region with a single human summary message"*). That is a **turn list**, where dsh writes an **event log** — different in kind, not just in naming |

So the honest landscape: **the live protocol is standardised (ACP), the file is not — ATIF is the emerging candidate,
and the practical answer today is one adapter per harness.**

## What ATIF already models that we recorded as MISSING

This is the part that should change our plan. Three things this repository wrote down as absent capabilities are
ordinary fields in ATIF:

| our register said | ATIF has |
|---|---|
| *"reasoning content is neither metered nor stored"* (`F83` corrected this) | **`reasoning_content`** per step, *"the agent's explicit internal reasoning"* |
| reasoning **effort** is configurable and unrecorded — *"an unrecorded comparability axis"* | **`reasoning_effort`**, per step: *"Qualitative or quantitative measure of effort (e.g. low, medium, or a float score)"* |
| compaction/checkpointing is a harness act we collect as G2 | **`continued_trajectory_ref`** — *"Enables agents to link trajectory segments when context management strategies (e.g., summarization) produce multiple trajectory files"* — plus `observation` on **system steps** for *"subagent delegation, context management, environment resets, checkpoint creation"* |

And its `metrics` block carries exactly what our G3 pacing is derived from: `prompt_tokens` (all input, cached
included), `completion_tokens` (*"including reasoning and tool calls"*), `cached_tokens`, `cost_usd`, plus optional
`prompt_token_ids`, `completion_token_ids` and `logprobs`.

## The mapping, dsh → ATIF

| dsh | ATIF | fidelity |
|---|---|---|
| `user/message` **with `source.kind === 'user'`** | `step { source: "user", message }` | ✓ — our G0 asks |
| `assistant/message` text | `step { source: "agent", message }` | ✓ — and the turn's LAST one is still our G0 answer |
| `reasoning` content block | `reasoning_content` | ✓ |
| `tool/call` + `tool/result` | `tool_calls[]` + `observation.results[]` (paired by `tool_call_id` / `source_call_id`) | ✓ |
| `assistant/message.usage` | `metrics { prompt_tokens, completion_tokens, cached_tokens }` | ✓ |
| `turn/end.reason`, `agent/inbox/spliced`, `developer/message`, `request/header` | `step { source: "system" }` + `extra` | ~ needs our own convention; ATIF has no field for a turn's end reason |
| **`surfaceOp: replace`** | **NOTHING** | ✗ **lossy** |
| `assistant/attempt` (failed, retried, cancelled) | **NOTHING** | ✗ lossy |

**The two losses matter, and they are the reason this is a decision rather than an obvious upgrade.**

1. **ATIF cannot express a replaced message.** A step list is a history; a `replace` means something that WAS in the
   surface is not. Projected to ATIF, the shadowed version simply vanishes — and `F..`'s whole refusal rule ("a turn
   whose response was shadowed has NO response, and the composer refuses rather than picking another out of the log")
   becomes unanswerable, because the projection cannot tell "never said" from "said and withdrawn".
2. **ATIF cannot express a failed attempt.** A retried call is one step in ATIF, where dsh records both the attempt and
   its stream. So a measurement of *"did the agent struggle"* loses its direct evidence.

## So where does the boundary go?

Not "our own subject model" as previously recommended, and not "ATIF everywhere". Both, at different distances:

```
   dsh event log  ──►  lib/host/session-format.js  ──►  THE MEASUREMENT CORE  ──►  packages, readings
   (lossless, in                                 (vocabulary + shape)     (questions, scoring,
    the harness)                                                            batteries, calibration)
                              │
                              └──►  ATIF export  ──►  other harnesses' tools, other eval frameworks,
                                                     agent-eval's one-function-per-harness intake
```

* **Keep dsh's log as the evidence**, because the surface and the attempts are only there.
* **Make the core speak one provider-neutral shape**, and let the shape be ATIF where ATIF can carry it — because the
  alternative is asking every other framework to learn ours.
* **Emit ATIF as an export, not as the substrate.** An export is checkable (ATIF ships a validator), it makes our
  readings comparable outside this repo, and it costs nothing where the two losses above do not apply.

## Two disciplines worth stealing outright

From `agent-eval`, both of which are already rules in `docs/findings.md` and are now known to be industry practice:

* a malformed line is **counted, never dropped silently** — *"a line that is not JSON is counted"*;
* **absence is not zero** — *"A run whose diagnostic says `hasCost: false` has no cost, not a cost of zero — check the
  flag before you aggregate the field."* That is this repository's presence-versus-absence rule, stated by someone else.

## Measured on this host: five harnesses, five substrates, and one shared concept list

Read directly from disk, not from documentation.

| harness | where it lives here | substrate | boundaries | its name for the model's reasoning |
|---|---|---|---|---|
| **dsh** | `~/.dsh/sessions/<slug>/<id>/session.v{N}.jsonl.zstd` | zstd **event log**, `seq` + `surfaceOp` | `turn/start` … `turn/end`, `step/*` | block `{ type: 'reasoning', text }` |
| **pi** (183 sessions, still in use) | `~/.pi/<agent>/sessions/<slug>/<ts>_<uuid>.jsonl` | plain JSONL **append log with a parent-linked DAG** (`id`/`parentId`) | `session` header (`version: 3`) + `id`/`parentId` | block `{ type: 'thinking', thinking }` — **a different block type AND a different field name** |
| **zeroclaw** (Rust, OpenClaw variant) | `~/.zeroclaw/data/sessions/*.db` | **SQLite**, plus FTS5 search | `session_metadata.turn_id` | column **`reasoning_content`** |
| **Hermes** | `~/hermes-agent/trajectory_compressor.py` | JSONL **turn list** ("system, human, first gpt, first tool") | turn order | — |
| **ATIF** (the emerging standard) | not installed; read from the RFC | JSON | `step_id` | **`reasoning_content`** + a separate **`reasoning_effort`** |
| **mcode** (minimax-code, a vendor's own harness) | `~/.minimax/v2/sessions/<YYYY>/<MM>/<DD>/<ts>-session_<b64>/` | **a directory per session**: `manifest.json` (declares the layout), `messages.jsonl`, **`user-message-locators.jsonl`**, `ledger.jsonl`, `display.jsonl`, `snapshot`, `llm-call.json` | `message.turn_id` (`turn_mu8ritzb_…`) | see below — it is the closest of the six to what this repo is building |

### The concepts that survive all five

This is the whole argument for a thin core, and it is a SHORT list: **an ask** (role `user`), **an answer** (role
`assistant`), **the model's reasoning** (four names, four shapes), **tool traffic** (dsh `tool/call`+`tool/result`; pi
blocks `toolCall` + role `toolResult`; zeroclaw `acp_tool_calls`; ATIF `tool_calls[]`+`observation.results[]`), and **a
boundary**. Everything else is a harness's own business — and our G0/G1/G2 are selections over exactly those five.

Counted on this host: pi writes **`text` 27,261, `thinking` 3,159, `toolCall` 15,429, `image` 131** blocks across
**1,707 `user` and 16,291 `assistant` messages** in 183 sessions, and its record types include **`compaction`** (7),
**`context_edit`** (6), **`model_change`** (230) and **`thinking_level_change`** (185).

### Three findings that change the plan

1. **pi and dsh share the STORE LAYOUT** — `sessions/<slug>/<timestamp>_<uuid>.jsonl`, the same `--home-john-…--` slug
   convention, and a `version` field on the session header (pi writes 3). They differ in the RECORD schema, not in the
   shape of the tree. **So the cheapest second adapter is pi, not ATIF**: 183 local sessions, a familiar store, and a
   flat JSONL log. That is the adapter that would actually test the core's interface.
2. **The "unrecorded comparability axis" is unrecorded only HERE.** pi records `thinking_level_change` as a first-class
   event (185 of them), and ATIF carries `reasoning_effort` per step. Our `R`-axis problem is dsh's, not the field's —
   which means a comparison across harnesses could control for it while a comparison within dsh cannot.
3. **zeroclaw already solves intake twice over**: it speaks **ACP** (`acp_sessions`, `acp_messages`,
   `acp_tool_calls`, `acp_session_events` — and its message table has a `reasoning_content` column, ATIF's name), and it
   carries a **`jsonl_import_receipts`** table (`source_name`, `source_hash`, `source_len`) for importing JSONL
   sessions **with a receipt** — the same "count what you ingested, hash what it was" discipline this repository applies
   to a batch. On this host that table is empty (0 rows), so the path exists rather than being in use.

## mcode, read in full: an index, a ledger, and a manifest

The sixth harness, and the most instructive, because it solves the same problems by name:

| mcode file | what it is | our equivalent |
|---|---|---|
| `manifest.json` | `schemaVersion`, `sessionId`, timestamps, `source`, **`layout: "v2-final-dated-session"`**, and a `paths` map naming every other file | the package manifest + `lib/host/session-format.js`'s stated layout |
| `messages.jsonl` | `{ message_id, turn_id, message: { role, content: [{ type: 'text', text }] } }` | the event log, minus the control plane |
| **`user-message-locators.jsonl`** | **an ask index by BYTE OFFSET and LINE NUMBER**, each entry carrying `generation` and **`artifactRevision: "sha256:…"`** | the ask index we derived by hand two turns ago — mcode ships it, and pins the revision it was built against |
| `ledger.jsonl`, `display.jsonl`, `snapshot` | separate projections of one session | our G0/G1/G2 selections, and the Composer |
| `llm-call.json` | `api: 'anthropic-messages'`, `maxTokens`, `model`, `maxSerializedInputBytes`, an output-revision instruction | `lib/model/limits.js` + the question set |

Two transferable lessons. **The index is pinned to a revision** (`sha256` of the artifact it indexes), so a stale index
is detectable rather than silently wrong — the same discipline as zeroclaw's `jsonl_import_receipts` and agent-eval's
malformed-line count. And **mcode's first `user` message is a `<system-reminder>` carrying agent context**
(`agentName`, `agentRole`, `SESSION ROLE: root`): the "not every user message is the human" problem is not dsh's, it
is universal, and any G0-style selection in any harness needs the same discrimination.

## Slice and dice: the index question, measured

The operator's proposal — *a translation to a database might be much easier for slice and dice* — was tested rather
than argued. A throwaway SQLite index over **183 pi sessions plus the two dsh sessions measured throughout this file**
(30,499 message rows, one FTS5 table):

| | |
|---|---|
| build | **4.1 s** for 185 sessions, from cold |
| size | **103.5 MB** — the full-text index duplicates the text, so the index costs about what the content does |
| Q1 sessions by human asks | **0.2 ms** — a per-session aggregate the tools cannot produce at all today |
| Q2 full-text across every session | **5.4 ms** — today `search` is a substring of the TITLE or ID only; the top hit is a pi session matching `telegram` 2,316 times, which no current tool would ever surface |
| Q3 reasoning-to-visible ratio per harness | **0.1 ms** — dsh **4.21** (10,022,200 reasoning chars against 2,376,466 visible) versus pi **0.19** (6,063,677 against 31,207,980): the dsh sessions on this host are reasoning-dominated, pi's are visible-dominated, and that is a comparison no current tool can make at all |
| Q5 one session's asks, paged | **7.7 ms**, without decoding a 23 MB zstd log |

### The design, if this is built

1. **A derived index, never a second source of truth.** The log stays the evidence, because `surfaceOp: replace` and
   `assistant/attempt` exist only there — and an index PROJECTS the log rather than the ATIF export, or it inherits
   ATIF's two losses.
2. **Rebuildable, with a receipt.** Sessions are append-only, so an incremental import keyed on the high-water `seq`,
   with the source hash and length stored (mcode's `artifactRevision`, zeroclaw's `jsonl_import_receipts`), makes
   "is this index current?" a query rather than a hope. A 4.1 s full rebuild also makes the receipt optional.
3. **The schema must carry what the export loses**: a `shadowed` flag and an `attempt` row kind, or the index quietly
   becomes ATIF with extra steps.
4. **Cost the size.** 103 MB for 30k rows is the FTS table mirroring the text; an index over asks and counts alone
   would be a fraction of that, and only the text worth searching needs to be in it.

## Where the schema came from: derived from bytes, when the source declares it

Asked directly, and the honest answer is **derived from real logs**, with the source read only for the parts being
hunted at the time. That is measurably worse than reading first, and `session-persistence-jsonl` proves it:

```ts
// packages/session/session-persistence-jsonl/lib/types/format.d.ts -- the DECLARED first record
interface HeaderLine {
  type: 'session'; version: number; id: SessionId; createdAt: number; cwd?: string
  parentSession?: SessionId; isSeeded: boolean; origin?: 'subagent'; delegationDepth: number; agentPreset?: string
}
```

`cwd` and `createdAt` were derived by reading a file -- and the first attempt read them from `data.cwd`, which is
wrong, giving **0 of 498** rows a directory. The other five fields were never derived at all, and adding them says
something the index could not previously see:

| | |
|---|---|
| sessions that are a **subagent** (`origin: 'subagent'`) | **318 of 498** |
| sessions naming a **parent** session | **319** |
| presets | `cordis` 356, `standard` 34, `minimal` 2, none 106 |

**Sixty-four per cent of this library is subagent runs, not conversations** -- exactly the distinction the observer's
own `observeSubagents` knob encodes (default OFF: *"records a subagent's streams and tool calls as skip lines"*). An
index of "sessions" that cannot tell them apart answers a question about conversations with the wrong population, and
a derived schema is how that happens. It is the third time in this file that reading the producer would have replaced
a derivation (`F79`, `F89`, `F95`).

## How a LIVING session refreshes: file-level today, offset-level designed

**Today it is file-level, and that is the weak spot.** The receipt is `mtime` + `bytes`, so a session being appended to
invalidates its receipt on every turn and the WHOLE file is decoded again: measured, one incremental run refolded
exactly one session -- the one being written in -- and cost **26.5 s** for a 33 MB log, a cost that grows with the
session. Every earlier claim about "incremental" is about the 497 files that did **not** change.

**The design follows from what the backend already is.** `session-persistence-jsonl` states its own model: *"stores
each session in a current append-only JSONL log ... checksummed Zstandard frames by default"*, and the package exposes
a `SessionLogOffset` plus a *"truncation-repair offset computation"*. So the correct refresh is per-Sequence, not
per-file:

1. **Store the offset consumed and the high-water `seq`** per session, not the file's mtime.
2. **Decode only the frames after that offset** -- frames are independently decodable, which is why the format is
   multi-frame at all.
3. **Make the append IDEMPOTENT** by keying rows on `(session_id, seq)` and inserting with conflict-replace, so
   re-reading a little overlap is harmless: the boundary need only be no LATER than the last event already stored.
4. **Derive the counters with SQL** (`asks`, `messages`, `shadowed` are aggregates over rows already present) instead
   of accumulating them in the reader, so an append cannot drift from a count.
5. **Treat a torn tail as the backend does**: the last frame is checksummed, so a partial frame at the end of a crashed
   session fails to decode -- stop at the last good frame and record THAT offset, which is the truncation-repair case
   the package documents.
6. **Fall back to a full refold when the offset cannot be used, and say so on the row** -- the rule `F94` added after
   a stale receipt skipped 498 sessions and left a column empty.

**Not built yet.** What exists is the file-level refresh plus the schema version that voids receipts when the shape
moves; the offset-level refresh is the next step, and it is the one that makes a LIVING session cost its last frame
rather than its whole life.

## The cost of the service path, measured from the session's OWN log

The harness writes a `time` on every tool call and its result, so the calls this plugin made can be timed after the
fact rather than estimated. Seven `system1_sessions` `list`+`search` calls in the session this was written in:

```
52977  53153 (aborted)  53796  53951  54359  54950  56176   ms      median ~53,951 ms = ~54 s
```

and the same tool's `read` action, for contrast: **703-1,384 ms** -- because `read` opens ONE session where `list`
resolves a title for every session in the library.

| path | one title search | source |
|---|---|---|
| `sessionQuery` through `system1_sessions` | **~54 s** (7 samples, 52,977-56,176 ms) | this session's own log |
| the index (`scripts/session-index.mjs find`) | **1-2 ms** (9 runs) | measured, 33 MB store |
| the index build, once | **120.3 s** (33 MB, titles and counts) | measured over 498 sessions |
| the same build with tool RESULTS and text | **328 s**, 75.1 MB | measured after the results table was added |
| an incremental re-run, nothing changed | **2 ms** of walking (one project); ~0.2 s across the library | measured |
| an incremental re-run where ONE session changed | **26.5 s**, of which essentially all of it is that session's refold | measured -- the session was the one being written in |
| SELECT the rows a composition needs, one session | **0.2 ms** (19 messages, 14 calls, 14 results) | measured on a text-enabled store |

**So the index pays for itself after about 2.2 title searches**, and the difference per query is roughly four orders of
magnitude. That is the honest form of the speed argument: not "a database is faster", but *54 seconds against one
millisecond* -- and the 54 seconds is paid on EVERY search by an agent who does not yet know which session it wants,
which is exactly the agent this tool exists for.

**So the warm-up is a background job and the re-runs are not warm-ups at all**: `--incremental` skips a file whose
`mtime` and size are unchanged, which is every file except the session currently being appended to. Lookup, select and
the row-gathering a composition needs are then milliseconds, against ~54 s for a title search and 0.7-1.4 s for a
single `read` through the service.

**AND ONE HONEST GAP**: the default store holds no message TEXT (`messages` is filled only with `--text`), so a
composition cannot yet be built from rows alone -- the text is a size decision nobody has taken for 498 sessions, and
`tool_calls`/`tool_results` do not carry `turn` yet, so a PER-TURN composition needs that column too. What is measured
is the row-gathering, not the composition: the labels, the cuts and the refusals stay in JavaScript, because they are
the semantics rather than the data.

Three caveats, two of them about my own measurement:

1. **The aborted call cannot be blamed on a timeout**: it stopped at 53,153 ms while another completed at 56,176 ms, so
   the operator's message arriving mid-call is the likelier cause. It is recorded as an abort, not as a limit.
2. **Pairing a result to its call needs `(turn, step, callId)`**, not `callId` alone: ids repeat across turns, and
   pairing on the id alone produced absurd deltas (one `read` appeared to take 14,265,497 ms). The seven `list`
   samples above are consistent and were re-derived with the full key.
3. One 30 ms entry is excluded: it is the pre-mount `UNAVAILABLE` call, not a search.

## The normalized schema, tested rather than proposed

One SQLite schema, **seven sessions across three harnesses** — 2 dsh (this one and the freeciv play session), 3 pi, 2
mcode — 5,127 message rows, 4,380 tool calls, 8 attempts. The tables are the five shared concepts plus the per-harness
facts and a receipt:

```
sessions(harness, id, path, schema_version, cwd, started_at)
turns(session_id, ordinal, label, parent_label, end_reason, extra)
messages(session_id, turn_label, exchange, ordinal, role, kind, text, reasoning,
         interrupted, shadowed, extra)
tool_calls(session_id, call_id, name, args, result, turn_label, outcome)
attempts(session_id, turn_label, kind, stream_chars)
session_facts(session_id, fact, value)          -- thinking_level, compaction, ask locator…
receipts(session_id, source, source_bytes, source_sha256, high_water, built_at)
messages_fts(text, session_id, role)
```

**One query spans all three harnesses**, and it needed no per-harness branch:

| harness | exchanges | asks | answers | reasoning chars | visible chars |
|---|---|---|---|---|---|
| dsh | 309 | 309 | 4,452 | 10,042,653 | 3,142,667 |
| pi | 8 | 8 | 22 | 1,917 | 89,533 |
| mcode | 2 | 2 | 2 | 114 | 1,256 |

### Four rules the test produced

1. **Normalize only the five shared concepts** — an ask, an answer, the reasoning, tool traffic, a boundary. Anything a
   single harness says about itself goes in a typed column or `extra`.
2. **DERIVE the boundary where a harness has none.** dsh has `turn`; **pi has no turn at all** — measured: *all 44* pi
   messages loaded with a null turn, so a "per turn" query silently became a **dsh-only** query while looking
   cross-harness. Grouping each session by its human asks (the ask-group derived three turns ago) gives every harness a
   comparable unit, and the same per-exchange query then answers for dsh, pi and mcode alike. **This is the single most
   important rule here, because the failure is silent.**
3. **A per-harness fact is a column whose ABSENCE is a value.** `shadowed`, `interrupted`, `attempts`, `parent_id`,
   the mcode ask locator. The number that justifies them: **3,417 messages in one dsh session are shadowed** — inside a
   `replace` range, withdrawn from the surface by compaction. The log holds what the surface no longer does, so an
   index without that column measures text **the model can no longer see** while looking complete.
4. **`extra` carries the rest, but the prototype was wrong about the DAG**: pi's `id`/`parentId` chain survived only in
   the JSON `extra` column. A typed `parent_id` is the correct design — the rule above is the recommendation, not my
   prototype.

Two defects in my own prototype, disclosed rather than left to be found: the per-session tool count in the first run
was a **global** count printed per session, and pi's DAG was stored as JSON rather than as a column.

## What already exists (checked 2026-10, not assumed)

The operator's guess was right: **there are many, and two are nearly this design** — for a different harness. Checked
in both ecosystems: `find_dsh_plugin` returns **nothing** for session/database/index/search (no dsh plugin does this),
while the wider field has several.

| project | harness | store | what it does |
|---|---|---|---|
| [**Alfredvc/cct**](https://github.com/alfredvc/cct) | Claude Code | **DuckDB** (Rust + React viewer) | *"Your Claude Code transcripts as SQL… **The primitive is the database. The skills are playbooks on top.**"* Ingests `~/.claude/projects`, serves a viewer on `:8766`, reports cost per turn, expands subagents. Ships a **typed parser crate** with *"strongly-typed `Entry` variants and a **round-trip validator for catching schema drift**"* |
| [**spences10/ccrecall**](https://github.com/spences10/ccrecall) | Claude Code | **SQLite** (`node:sqlite`) | incremental `sync` that *"reports what it found"*, `search` (FTS), `tools`, `query "<sql>"`, `schema`. Its `sync_state(file_path, last_modified, **last_byte_offset**)` is the receipt this file proposed, already built |
| [apache/maka #2263](https://github.com/apache/maka/pull/2263) | generic | SQLite | *"import legacy JSONL session transcripts into SQLite"* |
| [Claude-Code-Agent-Monitor](https://github.com/hoangsonww/Claude-Code-Agent-Monitor) | Claude Code + Codex | SQLite + web dashboard | sessions, tool usage, subagent orchestration, live analytics, an import API |
| [`agent-recorder`](https://pypi.org/project/agent-recorder/), [`daily-claude-log`](https://pypi.org/project/daily-claude-log/) | various | files/reports | flight-recorder style capture and per-day summaries |
| **the generic layer** | any | DuckDB / SQLite | `duckdb 'select * from read_json_auto(...)'`, `jsonl-to-sqlite`, `sqlite-utils insert --nl` — **SQL over any JSONL in one line, no adapter** |

### ccrecall's schema is the closest reusable artifact

It solved the same normalization by hand, and its shape validates ours from the outside:

```sql
messages(uuid, session_id, parent_uuid, type, model, content_text, content_json,
         thinking, timestamp, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens)
tool_calls(id, message_uuid, session_id, tool_name, tool_input, timestamp)
tool_results(id, tool_call_id, message_uuid, session_id, content, is_error, timestamp)
sync_state(file_path, last_modified, last_byte_offset)
```

`thinking` as a column, `parent_uuid` for the DAG, `is_error` on a tool result, and `sync_state` for incremental
resumption — four of the five decisions this file reached independently. It also carries `teams`/`team_members`/
`team_tasks` for Claude Code's swarm mode, which is our subagent axis.

### The gap, stated precisely

Every one of those is **per-harness** (almost all Claude Code), and **none carries dsh's `surfaceOp`/`shadowed` or
`assistant/attempt`**. So:

* **Reuse rather than rebuild**: the generic JSONL/DuckDB layer, the schema SHAPE above, incremental sync keyed on a
  byte offset, and cct's best idea — **the query playbook as an agent skill**, which is what our question sets already
  are.
* **Build only what is missing**: the **cross-harness** adapter (dsh, pi, mcode, Hermes as sources into one schema) and
  the **fidelity columns** (`shadowed`, attempts, turn-end reason) that the per-harness tools do not need and dsh does.
* **And a principle the survey suggests**: cct uses *skills as playbooks* for questions SQL can answer, while this repo
  asks a decision model. The split should follow the evidence — **facts in SQL, judgements in system1**. "Asks per
  session", "reasoning share", "tool error rate", "cost per turn" are SQL facts; "was the request served" is not.
  Asking a model what arithmetic can answer is the failure our own calibration register is built to catch.

Third-party code: if any of it is adopted, review the source and pin a commit — the same rule this repository applies
to plugins.

## What `sessionQuery` already does, and what this plugin adds

Asked directly, and the answer corrects a claim in the section below. **`sessionQuery` is a dsh SERVICE on `ctx`
(not an agent tool): our agent-facing surface is the tool `system1_sessions`.** It exposes **fifteen methods**:

```
read           readSession(id) · listEvents(id) · readEvent({sessionId, seq, before, after})
surface        readSurface(id)
filter         filterSessions(filters) · filterEvents(id, filters)
search         searchSessions(request)          -- full text across the corpus
               searchEvents(request)            -- full text within one session
titles         readTitle · readTitleSnapshot · readTitleSnapshots
attribution    traceSession(id) · traceEvent(request)   -- which agent/plugin caused an event
observe        observeSession(id, options)
```

**This plugin calls two of them: `listSessions()` and `readSession(id)`.** `readSurface` is additionally used as the
ORACLE that `lib/host/surface.js` is checked against (`test/surface-compare.test.js`), while the live path takes the
surface from the session object instead.

### The harness's own search index exists, and this profile turns it OFF

Confirmed live after a restart: `system1_sessions { action: 'search' }` refuses in **51 ms** with

> *"session search is disabled: this deployment configures the session-query index with `openAt` \"never\""*

`@deepseek-ai/dsh-session-query-sqlite` is *"ranked SQLite FTS5 search across session history, either across sessions or
within one session, with cursor pagination … a separate derived database, so searches reflect current state"* —
**the same design as `scripts/session-index.mjs`**, shipped by the harness. Its `openAt` is
`'startup' | 'first-search' | 'never'` and **defaults to `startup`**; the refusal is a base-bundle default, not a
choice made in this profile:

```yaml
- id: session-query-sqlite          # in the @deepseek-ai/dsh-base layer
  name: '@deepseek-ai/dsh-session-query-sqlite'
  config:
    path: ':memory:'
    openAt: never
```

Other knobs, read from the package: `journalMode` (default `wal`), `defaultLimit` 20, `maxLimit` 100, `snippetChars`
240, `persistedReadConcurrency` 4, `preparedSessionCacheSize` 5. Two properties matter for us: **results match tokens
and phrases, not arbitrary substrings**, and **each index path has a single process owner**.

**To enable it**, override that row in the profile patch — `openAt: first-search` so startup is not delayed, and a
FILE path so the index survives a restart:

```yaml
- id: session-query-sqlite
  name: '@deepseek-ai/dsh-session-query-sqlite'
  config:
    path: !!js dshHomePath('session-query.db')
    openAt: first-search
```

**The cost is the one this file already measured for its own index**: the first search pays a build over the whole
library (505 files, 191 MB — our own build was 120-330 s), and a persistent path means later starts reuse it. What I
did NOT read is the incremental mechanism behind `_ensureReady`/`_open`, which is awaited before serving a search; the
README states only that the index is derived and that searches reflect current state.

### What the service CANNOT do: match a TITLE

Checked because it is the obvious next question after full text. Three declarations settle it:

* **`SessionRecord` is `{ header, live, persisted }` — there is no title field.** That is why `listSessions()`
  cannot return titles and a separate `readTitleSnapshots(ids)` call exists at all.
* **`searchSessions` indexes EVENTS, not sessions**: the corpus is built by
  `buildSessionEventSearchDocuments(sessionId, events)`, one document per event from `extractSessionEventText(event)`.
* **`SessionResultFilter` is `{ id | cwd | created-at | parent | availability }`** — there is no title clause, so a
  title cannot be filtered for either.

So **a title can only be matched by listing sessions, reading their titles in one batched `readTitleSnapshots` call, and
comparing** — which is exactly what `system1_sessions`'s `list` `search` argument already does. That makes the tool's two
mechanisms **complementary rather than redundant**: a folded title may be a paraphrase whose words never appear in the
messages, and a phrase inside the conversation never appears in a title. Neither argument covers the other, which is why
both exist and why the description now points from one to the other.

A bonus found in the same read: those search documents carry a per-event **`surface`** classification (defaulting to
`log-only`), so the harness's own index already distinguishes what the model saw — further evidence that `filterEvents`
with `{kind: 'surface', values: ['current']}` is the authoritative form of the fold this plugin approximates.

### The title IS an event — and the search layer refuses it BY POLICY

The challenge was fair: if the UI shows a title, the data exists. It does, and it is in the same log:

```ts
// declared by packages/session/session-title (a MERGE into SessionEventMap, not core)
'session/title': {
  title: string              // normalized non-empty title text
  messageSeqs: SessionSeq[]  // the exact human `user/message` seqs it was derived from
  source: SessionTitleSource // 'fallback' | provider | 'user' (an explicit rename)
}
```

`session-title-llm` generates it (appending `session/title-llm-request` for the call itself), and the UI shows it
because the UI goes through the **title service** — `readTitleSnapshots` reads the latest `session/title` event. So
there is no side store, no missing file, and no asymmetry in storage: **two consumers read one log.**

**What differs is declared semantics.** `extractSessionEventText` in the search layer handles `user/message`,
`assistant/message`, `tool/call`, `tool/result`, `todo/write` and `turn/end`, returns `''` for
`turn/start`, `step/start`, `step/end`, `assistant/attempt` and `request/header`, and **returns `'' for anything it
does not know** — with the reason written next to it:

> *"SessionEventMap is merge-extensible. Unknown events remain non-searchable until a concrete first-party consumer
> defines semantics."*

`session/title` is merge-declared by `session-title`, so to the search layer it is an unknown event. **The refusal is
the design, and it is the same rule this repository applies to a filter that matches nothing**: guessing a text field
for an arbitrary event would index provider payloads and JSON blobs as prose, which is worse than not indexing them.

Three consequences worth keeping:

1. **A plugin-merged event is invisible to every first-party consumer that switches on event type** — search and
   extraction here — while the format MIGRATIONS handle it explicitly (`session-format-v1-to-v2`, `v3-to-v4` both list
   `session/title`). So "the UI shows it" and "search cannot find it" are consistent, not contradictory.
2. **The service will not change from our side.** The fix upstream is one line — a `case 'session/title'` returning the
   title, by whoever owns those semantics. We cannot inject into a switch that lives in the harness.
3. **We can index it ourselves.** `session/title` events arrive in the same `readSession` list this plugin already
   consumes, so an index we build can carry the title, its `messageSeqs` and its `source` **without calling the title
   service at all** — and can therefore search and rank it. That is a capability no service call provides, and it is
   the same shape as the argument below: the platform refuses by policy; a store we own need not.

**AND THIS IS WHERE AN INDEX ADDS A CAPABILITY RATHER THAN SPEED.** A title is a column, so:

```sql
-- a title match and a text match in ONE question, with the title ranked first
SELECT s.id, s.title, 0 AS matched_in FROM sessions s WHERE s.title LIKE '%' || ? || '%'
UNION
SELECT s.id, s.title, 1 FROM sessions s JOIN messages_fts f ON f.session_id = s.id
WHERE messages_fts MATCH ?
ORDER BY matched_in;
```

Three things follow, and they are worth separating from the speed argument:

1. **Enumerating a title is not searching it.** The service can give us every title (one batched `readTitleSnapshots`
   call), and our `list` then scans them — so a title search EXISTS today, as an O(n) scan of titles fetched per query.
   What a table adds is the index: at 185 sessions the scan is nothing; at 10,000 it is 10,000 titles per question.
2. **The real gain is composition, not lookup.** Title OR text, ranked against each other, in one statement — impossible
   with two mechanisms that live in different calls and return different shapes. This is the same class as the other
   entries on the list: not "faster", but "askable".
3. **And a cost transfers to us with it.** The service takes the query *"interpreted as data, never executable FTS
   syntax"*; a database we own means we own that escaping, and `MATCH` against user text is exactly where an unescaped
   quote or operator becomes a syntax error or a different query. Whoever builds the index inherits the guard the
   service performs for us today — worth stating plainly, because "easy" is true and incomplete.

A bonus found in the same read: the search documents carry a per-event **`surface`** classification (defaulting to
`log-only`), so the harness's own index already distinguishes what the model saw — further evidence that `filterEvents`
with `{kind: 'surface', values: ['current']}` is the authoritative form of the fold this plugin approximates.

### So we hand-roll three things the service already offers

| the service has | what this plugin does instead | verdict |
|---|---|---|
| `searchSessions`, `searchEvents` | was: nothing — `system1_sessions`'s `search` compares a **title or id** | **FIXED**: `system1_sessions` now has `action: 'search'`, which calls `searchSessions` and hands the query over as data. The substring remains for `list` only, and where the index is absent the tool **refuses by name** instead of silently scanning titles |
| `filterEvents(id, filters)`, `listEvents(id)` | `lib/session-subject.js` slices raw events by kind by hand | the filter vocabulary is `{seq \| time \| **type** \| **surface** \| text}`, so `{kind:'type'}` IS our kind slice and `{kind:'surface', values:['current']}` is the surface fold done AUTHORITATIVELY. Still hand-rolled, and the next thing to replace |
| `readTitle`/`readTitleSnapshots` | **WRONG — corrected**: the tool DOES call `readTitleSnapshots` (`lib/sessions-tool.js:108`) | this row was my error, not a gap |
| `traceEvent`, `traceSession` | unused, though attribution was recorded as a missing capability | available and unclaimed |

### And what this plugin does that `sessionQuery` cannot, by construction

1. **The selection semantics**: what an ASK is (the `source.kind` discrimination — the harness speaks on the same
   channel), what an ANSWER is (the turn's last word), and what G0/G1 mean. The service reads events; it has no notion
   of a group, of a subject, or of a refusal when a group cannot be composed.
2. **The derived unit**: a turn is not an ask (**253 asks across 487 turns**), so the unit a measurement wants has to be
   derived. The service offers the harness's own boundaries only.
3. **Composition for a judge**: the labelled sections, the head/tail cut, and the surface-aware refusal (`a turn whose
   response was shadowed has NO response` — refused, not re-read from the log).
4. **Sizing**: `coverageOf` and `lib/segment.js`, which fit a subject to the decision model's character budget.
5. **The register**: the trace, the readings, the packages, reproducibility. `sessionQuery` has no concept of a
   measurement, a question, or a reading.
6. **Cross-harness**: the service is dsh-only. pi, mcode and Hermes need their own readers.
7. **The instrument**: asking system1 a question set and turning probabilities into readings.
8. **The agent-facing tool**: `system1_sessions` exists because dsh's session plugins are UI-first and expose no host
   tool — which is the reason this plugin built one.

### The order this implies

**Expose what the service already offers before building a database to replace it.** Search, filtered event reads and
titles are service calls; the index's own case is aggregates, the derived unit, cross-harness normalization and
materialization. Building the DB first would re-implement search that is already mounted.

## Why convert a session to a database at all

The operator asked for the rationale rather than the build. Every claim below is tied to a measurement taken in this
repository; none of it is a general preference for databases.

### The case FOR, as capabilities bought and costs paid today

| what a database buys | what it costs us today, measured |
|---|---|
| **Seek instead of scan.** A query reads rows; a session read decodes everything. | One session's asks paged from an index in **7.7 ms**, against decoding a **23 MB** zstd log of **10,939 concatenated frames** whose decoder stops at the first frame — and `readSession` hands back the whole event list regardless of how little is wanted |
| **A boundary the harness may not have.** The index can hold a DERIVED unit for every source. | **All 44** pi messages loaded with a null turn, so a "per turn" query **looked cross-harness and answered for dsh alone**. The failure is silent, which is what makes this the strongest single argument |
| **Arithmetic stays arithmetic.** Counting, filtering, grouping and joining belong in SQL, not in a model call. | There is **no per-session ask count at all** — nothing in the harness or here answers "asks per session". **CORRECTED: full-text search is NOT missing from the platform**; `sessionQuery` exposes `searchSessions` and `searchEvents`, and `filterEvents` and `readTitle*` besides (see the next section). The gap is in OUR TOOL, which offers a title/id substring and nothing else. So the index's case rests on **aggregates, the derived unit, cross-harness normalization and materialization** — not on search |
| **A distribution to read a number against.** A reading means more beside the population it came from. | `dsh 4.21` against `pi 0.19` reasoning-to-visible — a cross-harness comparison nothing here can currently make, and `1.85 of 2` means little without other sessions' readings |
| **The fidelity facts become addressable.** `shadowed`, attempts and turn-end reasons stop being re-derived per request. | **3,417 messages are shadowed** in one session, **8 attempts**, **541 turn-end reasons** — today only `surfaceEvents()` and the composer ever see them, and "which readings judged withdrawn text?" is not a question anyone can ask |
| **The cost is small and known.** | **4.1 s** to build over 185 sessions and **103 MB**, which is the FTS mirroring the text; an asks-and-counts index is a fraction of it. A disposable index costs nothing to throw away |
| **Title search, and any query that joins two fields.** The service searches EVENTS and a `SessionRecord` carries no title, so a title can only be ENUMERATED and compared, never searched or joined. | Today `list` `search` reads every title in one batched call and scans them; a title and a phrase cannot be asked for together, and neither can be ranked against the other. In a table both are one `WHERE`, and the two mechanisms the service keeps separate become one query |
| **It is convergent practice, including by a harness vendor.** | mcode ships an ask index with **byte offsets and a `sha256` artifact revision**; zeroclaw ships **SQLite + FTS + import receipts**; cct and ccrecall do it for Claude Code; agent-eval streams transcripts with per-session diagnostics. A vendor shipping an index alongside its own log is evidence that the log alone is not enough to query |
| **It collapses duplicated readers, which this repo has already paid for.** | `textOf` existed twice with different rules; `F78` had to be fixed twice; when they were finally unified the divergence turned out to be a **4.5× overstatement** of conversation (12,774,434 chars reported against 2,839,380 visible) |

### The case AGAINST, and what answers each

| the objection | the answer |
|---|---|
| **It is a second copy of a fact**, and this repository's rule is one home per fact. | It must be **derived, rebuildable and receipted** — never the source of truth. Forensic questions read the log. A 4.1 s rebuild makes "derived" real rather than aspirational |
| **A schema is an interface, and interfaces drift.** | Version it and validate on read, as mcode does (`schemaVersion`, `artifactRevision`) and as `dsh-system1-runtime` does (`interface-version.js`). Our `check:compat` gate is the pattern |
| **Flattening loses the surface.** | It does — unless the schema carries `shadowed` and an attempt kind. Without them the index silently becomes an ATIF-style step list, and the **3,417** number is exactly the risk |
| **It invites questions measurement should not answer.** | "Tokens" is not "quality"; a cheap session is not a good one. That warning is already in the register, and a database makes it easier to forget |
| **It may be premature.** | The trigger is concrete: build it when a question you want is **arithmetic** and **not answerable now**. Three such questions are listed in the first table |
| **The harness may provide it.** | `sessionQuery` already exists, so the index must add SQL, FTS, cross-harness normalization or materialization — otherwise it is a third reader. If dsh ships query support, the index should be droppable without loss |

### Why NOT scrape the session logic and go straight to a database

Asked directly, and the measurement answers it. **A database does not replace this plugin's session logic; it replaces
about 114 lines of paging arithmetic and then CONSUMES the rest as its ingester.**

| piece | lines | a database would… |
|---|---|---|
| `session-subject.js` `sliceEvents` (kinds, `lastMessages`, `offset`) | 40 | **replace with `WHERE`/`LIMIT`** |
| `session-subject.js` `coverageOf` (counts and character totals) | 24 | **replace with aggregates** |
| `session-subject.js` `listStoredSessions` | 27 | **replace with a list query** |
| `sessions-tool.js` `rowsOf` (cwd/availability/title filtering) | 23 | **replace with a predicate** |
| `session-subject.js` `readStoredSubject` | 36 | **become the INGESTER** — the same `readSession` call, once per session rather than once per question |
| `session-subject.js` `eventTypesOf`, `subjectSettings` | 51 | **stay** — the kind→event-type mapping IS the format knowledge |
| `lib/host/session-format.js` | 138 | **stay** — the vocabulary the ingester reads through |
| `sessions-tool.js` `createSessionsTool` (contract, render, refusals) | 309 | **stay** — a tool must exist whatever answers it |
| `lib/exchange.js` (G0/G1), `turn-state.js`, `segment.js`, `tool-blocks.js` | ~860 | **stay** — this is the business logic, and no schema holds a judgement |
| `lib/host/surface.js` (the fold) | 20 | **replace with a SERVICE CALL**, not a database: `filterEvents(id, [{kind:'surface', values:['current']}])` |

So the deletion is about **114 of ~11,100 lines — roughly 1%** — and the schema would need `eventTypesOf`,
`readStoredSubject`, `session-format.js` and every semantic module anyway. **"Go straight to the database" is a
relabelling, not a simplification**, and it discards knowledge that is expensive to re-derive: the two message shapes,
the `source.kind` discrimination, the fact that a turn is not an ask, the surface refusal, and the 4.5x reader bug
(`F82`). The schema is a projection OF that knowledge, so it has to be written into the ingester rather than deleted
with the paging.

### Three things a database cannot cover at all

1. **The live path.** `host/feed.js`, the turn observer, the seams, `readSurfaceSeqs` from the session object — these
   are event *subscriptions*, not queries. A store has nothing to say about a turn that is happening now.
2. **The semantics.** `exchange.js`, `turn-state.js`, `segment.js`, `tool-blocks.js`: what an ask is, what the judge is
   shown, how the subject is sized, and the refusal when a group cannot be composed.
3. **Freshness of the session being measured.** `readSession` returns the present state every time; an index is stale
   by construction, and the session this was written in is being appended to as it is written. A disposable rebuild is
   4.1 s, which is fine — but it is a decision the service reader never has to make.

### And the trap this repository has already fallen into three times

`F89`/`F90`: we hand-rolled search, event filtering and titles that `sessionQuery` already provided. Replacing a
working, service-backed reader with a private store **doubles down on that risk and freezes a snapshot of a service
that is still moving** — the title policy, for instance, changes with one line upstream.

### The two questions are different, and they want different shapes

| the question | the shape |
|---|---|
| **"read THIS session"** — one at a time, live or stored, as a judge would see it | the **service**, through the code that already works |
| **"study a CORPUS"** — 183 sessions, aggregates, titles, cross-harness | the **database**, where the existing code is not scrapped but simply not in the path |

So: do not scrape. Add the index for corpus questions, **reusing the existing reader as its ingester**, and let the
deletion — about 114 lines of paging — follow once the index has proven itself. Deleting first would discard the
knowledge and re-derive it badly, which is what `F79` was.

### The decision test

| the question | where it belongs |
|---|---|
| arithmetic, across many sessions, many pages, or needing the derived unit | **the index** |
| a judgement — was the request served, was the operator clear, was the claim supported | **system1**, because no schema holds it |
| one session, one read, one time | **the raw log**, because the index is not yet worth its build |

### The temporary index is the strongest form of the argument

"Even temporarily" removes most of the cost side. A disposable index needs **no schema versioning, no staleness owner
and no maintenance**: build it for one analysis, keep the SQL and the source hashes with the finding, and drop it. That
turns a one-off question from a script into a line of SQL — measured repeatedly in this session, where six throwaway
Python scripts each existed to answer one such question — and it makes a reading **reproducible by query** rather than
by trust, which is what `docs/measurement-depth.md` already asks of a package.

## Two channels: in-band and out-of-band

The operator's split — **work with the live session (mainly its seams) and with every non-live session, the second
through a database** — is the right shape. One property is worth sharpening, because it decides what each channel may
do:

> **The cut is IN-BAND versus OUT-OF-BAND, not live versus stored.** A live session can be read out of band — this
> plugin has been evaluating the running session all along, by id — and a stored session can be judged in neither.
> What separates the channels is the DIRECTION of the data and what a result may change.

| | channel 1: IN-BAND | channel 2: OUT-OF-BAND |
|---|---|---|
| data direction | the harness **pushes** events to us (`session/event`, `agent/pre-step`, `agent/turn-stopping`, `fs/observed`, `fs/*-intent`) | we **pull** (`sessionQuery.readSession`, or a store we built) |
| what answers | the live session object: the surface seqs, the claimed inbox message, the mounted services | the durable log, projected into rows |
| may it change a turn? | **yes** — a judgement here can refuse, or return an intent that owns a decision | **no** — a reading cannot change anything that already happened |
| latency | constrained by the harness's own event modes | irrelevant |
| code | `host/feed.js`, `host/fs-journal.js`, `host/surface.js`, `register.js`, `seams.js`, `observe.js`, `stream.js`, the `turn-*` path | the ingester, the schema, the queries, the per-harness readers |
| covers other harnesses | **no, by construction** | **yes** — pi, mcode, Hermes |

The constraints in `lib/host/index.js` are why channel 1 is a different engineering problem rather than a different
data source: `agent/turn-stopping` is **serial**, so no O(surface) work may run inside it; `fs/write-intent` is
**waterfall, single slot**, so the first returned intent owns a decision; `fs/observed` is `emit` but *a throw fails the
tool call*. A store cannot be consulted inside those — which is why the two channels are not one channel with a cache.

### What the channels SHARE, and why that is the real architectural move

They must share **the selection semantics and the vocabulary**, or the same question gets two different instruments:

```
        channel 1 (in-band)                    channel 2 (out-of-band)
   live events ──► normalized records      rows ──► normalized records
                          └──────────┬──────────┘
                                     ▼
                    ONE instrument: G0/G1 selections, composition,
                    segmentation, question sets, readings, packages
```

The normalized shape is the five concepts already derived — **an ask, an answer, the reasoning, tool traffic, a
boundary** — plus the per-harness facts (`shadowed`, `interrupted`, `attempts`, the boundary label). `lib/host/session-format.js`
is channel 1's reader of dsh's log; an ingester is channel 2's. **When both produce that shape, the same question set
can be asked of a live seam judgement and of a corpus reading — and of pi's sessions through its own reader.** That,
not the database, is what makes measuring another harness reachable.

### Five rules, each from something measured here

1. **Channel 1 never waits on channel 2.** No query inside a seam listener: `agent/turn-stopping` is serial and a throw
   in `fs/observed` fails the tool call. The live path takes the surface from the session object, not from a store.
2. **The index ingests only from the DURABLE log**, never from the live feed. A dropped subscription or a restart would
   otherwise become a permanent hole in the index that looks like a gap in the session.
3. **Every index reading carries the high-water `seq` it was built to.** A running session is being appended to as it is
   read, so a reading without its receipt is a reading of an arbitrary past prefix — and this session has been measured
   while running more than once.
4. **The service stays the fallback and the oracle.** Where the index is absent the service answers; where the two
   disagree, **the log wins** — the pattern already in `test/surface-compare.test.js`, which compares this plugin's fold
   against `sessionQuery.readSurface` rather than trusting either alone.
5. **The index is droppable.** Derived, rebuildable (4.1 s over 185 sessions), receipted, and never the source of truth
   for a forensic question.

### Open work, in the order the evidence supports

1. **`filterEvents` with `{kind: 'surface', values: ['current']}`** — replaces the fold (20 lines) with the authority,
   a service call, no store needed.
2. **The ingester**, built on `readStoredSubject` so nothing is duplicated, with the schema above and a receipt per
   session.
3. **A channel-agreement test**: the same turn composed from live events and from rows must produce the same state, or
   the divergence is reported rather than averaged.
4. **The pi reader**, since pi shares dsh's store layout and 183 of its sessions are on this disk.

## Status

**Nothing here is built.** This file records what was read, so a decision can be made against evidence rather than
recollection — and so that the next agent does not re-derive it, which is the failure `F79` already cost us once.
