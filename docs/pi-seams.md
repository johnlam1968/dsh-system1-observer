# pi seams — in-band measurement in a second harness

**Status: design, not built.** The adapter (`docs/pi-adapter.md`) measures pi sessions **after the fact**; this is
about measuring a **running** pi instance, at the points its loop yields control. Per the operator, the act layer
is **not decided** — so this document names the surfaces an act would use and implements none of them.

It belongs to its own repository (a pi extension is loaded from `~/.pi/agent/extensions/`, from an npm package,
or from a git source — `extensions.md` §Extension Locations), because it imports no dsh code and must not be able
to. The vocabulary is the shared one: `VOCABULARY.md` in the system1-plugins repository.

## Why the nine points carry over

pi's loop has **the same shape** as dsh's, which is the finding that makes this cheap: a turn is a loop that calls
the model, the model may call tools, and control is yielded at the same boundaries. Nine points, nine pi hooks,
and — measured from `extensions.md`, not assumed — the same **point classes**, which is what decides whether an
effect is even possible at a point.

| our point | dsh host event | **pi hook** | class | what pi yields there |
|---|---|---|---|---|
| `assemble` | `system-prompt/assemble` | `before_agent_start` | decision | `event.systemPrompt` + `systemPromptOptions`; may replace the prompt |
| `admit` | tools guard / agent gate | `input` | decision | `continue` · `transform` · **`handled`** (the agent never runs) |
| `request` | `llm/request` | `before_provider_request` | decision | the provider payload, replaceable |
| `draft` | `llm/stream` | `message_update` | content | the token-by-token `assistantMessageEvent` |
| `pre_execute` | `tools/pre-execute` | `tool_call` | decision | **`{ block: true, reason?, terminate? }`** |
| `execute` | `tools/execute` | `tool_execution_start` / `_update` / `_end` | content | toolCallId, name, args, result, isError |
| `post_execute` | `tools/post-execute` | `tool_result` | decision | may patch `content` / `details` / `isError` |
| `result` | `tools/result` | `message_end` | observation | may replace the finalized message |
| `close` | `agent/turn-stopping` | `turn_end` · `agent_settled` | boundary | turnIndex, message, toolResults |

Two pi-specific hooks have no dsh counterpart and are worth a question of their own rather than a forced fit:

* **`context`** — fires before *every* LLM call with the message list, modifiable non-destructively. This is the
  closest thing either harness has to dsh's assembled prompt, and the only place the **whole** conversation
  crosses a seam.
* **`after_provider_response`** — status and headers before the stream is consumed. dsh has no equivalent point,
  and a 429 is a fact about pacing that no seam otherwise carries.

## The measurement itself, and the one thing that changes

Everything above is a *host event* name. The **point vocabulary, the instrument, the trace, and the questions are
this repository's** and carry over unchanged — that is the whole reason the nine points are worth reusing rather
than inventing pi-specific ones.

**What genuinely changes is the QUESTION, and it is the `draft` point.** pi keeps no stream record and hands the
finalised message to `message_end`; more importantly, on this host the MiniMax provider puts `<think>` markup
**inside visible text** (measured while reading an imported session: the text block begins `OK, I now
understand…`). In dsh, reasoning is a `reasoning` block the reader drops by design (`F79`). In pi it arrives as
visible text. **So a pi reading of "did the model reason before answering" is structurally a reading of something
else**, and the instrument must say which content kinds it was shown — the vocabulary's unresolved
**content kind** axis, which no field carries anywhere yet.

## In band, which is a real cost

pi's hooks are **awaited inside the loop**, so a judge call at `tool_call` adds its latency to every tool
execution, and `before_provider_request` to every model call. Two consequences, both of which decide the design:

1. **A call must have a budget and a refusal.** A measurement that hangs is not a measurement, it is a stall.
   The dsh row's `timeoutMs` and its `skip` line (with a reason) are the pattern; a pi hook that times out must
   return *nothing* and write a `skip` — never a partial answer, and never a guess.
2. **The one-call rule survives the translation.** One call per `(point, subject, window, instrument, model)`. A
   read-only hook firing on every token (`message_update`) is not a seam — it is a channel, and the vocabulary
   already says so: *the stream is a channel; the payload kinds carry the meaning*.

## The trace: same vocabulary, so two harnesses are comparable

A pi run should write the **same JSONL line kinds** — `mount`, `call`, `skip`, `config`, `error` — with the same
`enforcement: "declarative"`, `verified: false`, the same instrument hash, and the same `hook` names. Then:

* `docs/measurement-depth.md`'s G0–G4 evidence selection works on pi sessions with no change;
* a run from pi and a run from dsh can be **compared** by the comparability key, because the point names match;
* the register's lessons (read the producer; derive the boundary where a harness has none; a loss nothing reports
  reads as completeness) apply to the extension too.

## The act layer — deliberately undecided, and what is already on the table

pi's hooks return values, so an intervention is **available** at `input`, `before_provider_request`, `tool_call`,
`tool_result`, `message_end` and `session_before_compact`. That is a wider act surface than dsh's, and it is
exactly why nothing is built here. The vocabulary's terms for what would be needed: an **act** (not "effect"),
its **capability**, the operator's **grant**, the **shadow** (computed and recorded, not delivered), and
**hysteresis** (confirmations + cooldown + budget).

The acceptance gate is the same one `nudge` was built behind: a shadow act that is recorded on every firing and
delivered on none, until someone reads whether the readings were worth acting on.

## What still has to be read before any of this is written

Not guessed, listed:

* `packages/agent/src/types.ts` and the agent loop itself — for whether `message_update` can fire outside a turn,
  and what `turnIndex` counts (the import already had to **derive** the turn for pi sessions; the live path
  should not have to).
* `docs/rpc.md` — whether a pi instance can be driven headlessly, which decides whether the "same measure-session
  tool inside pi" half is an extension tool or an RPC client.
* `docs/sdk.md` (`SessionManager`) — for writing and forking a session from inside, which is how a delivered act
  would arrive.
* `examples/extensions/` — for the shapes that already work, rather than the ones that merely typecheck.
