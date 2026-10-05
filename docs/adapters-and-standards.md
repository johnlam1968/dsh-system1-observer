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

## Status

**Nothing here is built.** This file records what was read, so a decision can be made against evidence rather than
recollection — and so that the next agent does not re-derive it, which is the failure `F79` already cost us once.
