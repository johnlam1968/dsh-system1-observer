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

## Status

**Nothing here is built.** This file records what was read, so a decision can be made against evidence rather than
recollection — and so that the next agent does not re-derive it, which is the failure `F79` already cost us once.
