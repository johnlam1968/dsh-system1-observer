# Depth of measurement: what L0–L4 mean

This file exists because the depth levels are referred to by shorthand — **L0**, **L1**, **L2** — and shorthand is not
a specification. Every claim below is measured against a real session and the numbers are given, so a reader can check
them rather than take them.

**Where the numbers come from:** the freeciv session, `session-bba92d44-16f5-497e-8d8b-0d620e1686cd`
(`~/.dsh/sessions/--home-john-freeciv--/`), 611 messages, 2,996 events, 4.7 MB of JSONL (906 KB compressed), 855,812
characters of dialogue text. **Prices are from ONE session and vary with the session's shape** — the layer
*structure* is general, the weights are not.

---

## Quick reference

| short | name | one line | adds |
|---|---|---|---|
| **L0** | **the exchange** | what the human asked, and what came back | `user/message` (human only) + the turn's final assistant text |
| **L1** | **the working record** | everything done between the two | all assistant text, `tool/call` arguments, `tool/result` text |
| **L2** | **the harness's own acts** | what was done *to* the agent, not by it | `agent/inbox/spliced`, `tool-addition`/`tool-removal`, `turn/end.reason`, sandbox/permission/approval/model conditions |
| **L3** | **the pacing** | how the work was distributed in time | stream deltas (`dt`, `time0`), `usage` token counts, step durations |
| **L4** | **the measurer's own record** | what this measurement did to the session | `stateChars`, truncation flags, segment rows, state hash, refusals |

**Read the numbering as how much of the session is COVERED, not as a chain of prerequisites.** The event sets are
**disjoint categories**: L2's events are not inside L1's, and L1's are not inside L0's. So a measurement may take any
subset of them — and the pricing below says it usually should. The ladder describes coverage; a measurement is a
*selection* from it.

That distinction is why a strategy can read **L0 + L2**: the exchange plus the harness's own acts, deliberately
*skipping* the working record. It is not a rung on the way to L2; it is a different selection, and the pricing says it
is the cheap one.

---

## L0 — the exchange

**What the human typed, and what the human read.** Nothing between.

| | |
|---|---|
| includes | `user/message` where `data.source.kind == "user"`; the LAST `assistant/message` text of each turn |
| excludes | narration, tool calls, tool results, injections, everything the harness did |
| can answer | was the request clear; was it served; is the outcome usable; did the operator have to repeat themselves |
| cannot answer | anything about process: verification, loops, recovery, scope, context, work handed back |
| price here | **~186,000 chars** for the whole session's 37 exchanges |

**L0 is not necessarily small.** Here it is large because the operator's asks and the final answers are long reviews.
"A shallow measurement" is not the same claim as "a cheap one".

## L1 — the working record

**Everything done between the ask and the answer** — what the UI shows when you unfold `Took 6m 08s`.

| | |
|---|---|
| includes | every assistant text block (the narration), every `tool/call` (name + `arguments`), every `tool/result` text |
| can answer | did it verify before asserting; did it recover from an empty result; did it stay in scope; did it use the tools it had |
| cannot answer | whether the harness gave it what it needed, or stopped it — that is L2 |
| price here | **1,426,401 chars** — 8× L0 |

**The figure the tool reports as "chars of conversation" is not this.** That figure counts dialogue only
(855,812), so it understates the working record by ~570,000 characters.

**Inside L1, the parts are not equally sized, and not where you'd guess:** in the exchange priced below, tool call
*arguments* were 42,458 chars, tool *results* 24,215, dialogue 24,589.

## L2 — the harness's own acts

**What was done to the agent rather than by it.** The layer that makes attribution possible at all.

| | |
|---|---|
| includes | `agent/inbox/spliced` (84 here — each with `source.kind`, target and text); `tool-addition` / `tool-removal` blocks (11 / 6); `turn/end.reason` (36 `completed`, 1 `interrupted`); `permission/preset`, `sandbox/mode`, `approval/policy`, `subagent/model-selection-policy`; the tool list in `request/header` (written **on change** — 4 times in 37 turns) and `request/context.contextWindow` |
| can answer | was the context ever given to it; did the harness instruct the scope; who ended the turn; what was it allowed to do; under what conditions did it run |
| price here | **+9,924 chars — 0.7% of L1** |

**This is the asymmetry worth remembering: the layer that fixes attribution is the cheapest one.** Those 84 splices
are ~10 KB, and they are the difference between *"the LLM expanded scope"* and *"the harness told it to"*.

## L3 — the pacing

**How the work was distributed in time.** Not text — derived numbers.

| | |
|---|---|
| includes | stream entries (`chunk`, `text-chunks`, `tool-call-chunks` — 3,533 here), per-delta `dt`, `time0`, `usage` (`inputTokens`, `outputTokens`, `totalTokens`, `cacheReadTokens` — 146,807 output tokens here) |
| can answer | how many model calls a turn took; where it stalled; what it cost |
| caution | **pacing is not deliberation.** A long pause is a long pause. Do not let a question read `dt` as thinking |

There is **no reasoning-token bucket and no reasoning block** in this session: content blocks are `text` (803),
`tool-call` (529), `tool-addition` (11), `tool-removal` (6); stream blocks are `text` (272) and `tool-call` (529).
Reasoning *effort* is configurable (the `subagent` tool exposes it) while reasoning *content* is neither metered nor
stored — so two runs differing only in reasoning effort are indistinguishable in the file.

## L4 — the measurer's own record

**What the measurement did to the session.** Metadata, not content.

| | |
|---|---|
| includes | `stateChars`, the `TRUNCATED` flag, the segment rows (`messages A–B`, chars, `OVER BUDGET`), the composed state hash, the window's refusals, the model and probe that answered |
| why it is a level | without it, an L1–L3 reading is uninterpretable: you cannot tell the session from the cut |
| price | none |

The rule that follows: **any reading that depends on the composed state must carry the composition's flags**, or it
attributes the measurer's cut to the agent.

---

## The three rules

**R1 — a cut of a deep layer measures nothing in particular; a whole layer measures that layer.** A whole L0 is a
valid measurement *of the exchange*. L1 rendered down to 8,000 characters is a measurement of a cut, wearing the
clothes of a session judgement.

**R2 — prefer deterministic projections of the log over generative paraphrases of it.** L0 is a projection:
auditable, re-derivable, cheap. A summary is a *claim* about the log, and the claim has an author — acceptable only
if the summary itself is stored in the package, or the reading is anchored to an unrecorded transformation.

**R3 — match evidence to question; more evidence is not better.** The judge's documented weakness is *"large state
full of irrelevant detail"*. Sending too little makes the answer a guess about the wrong thing; sending too much makes
it a guess about everything.

---

## The measurement that shows why this matters

Turn 36 of the freeciv session — the operator's *"I am playing, check the game saved…"* and the agent's
*"🎯 Found it. `city_population()` is `size × (size+1) × 5`"*.

| | chars |
|---|---|
| the exchange's working record (L1) | **91,262** |
| of which dialogue / results / arguments | 24,589 / 24,215 / **42,458** |
| **what the judge was given** | **8,000 — 9%** |
| **L0 of that exchange — the ask + the final answer** | **10,821 — fits the 96,000 budget whole** |

Measured at that 9% cut, the reading came back **low** (`session_request_served` 0.27,
`session_outcome_reusable` 0.03) for an exchange that is, read whole, one of the more impressive in the session. The
evidence that made the conclusion credible — the save-file parsing, in the tool results — was the part dropped.

**So the constraint does not merely make the measurement shallow. It can invert it.** And L0 is not the consolation
prize: it is *whole*, which is the property the current default lacks.

---

## Strategies, ordered

**Which selection answers which question.** The choices are combinations, not rungs — pick by what the question reads:

| the question is about | select | price here |
|---|---|---|
| the exchange and its outcome | L0 (+L4) | ~186,000 |
| the process — verification, recovery, scope | L0 + L1 (+L4) | ~1,426,000 |
| attribution, conditions, who ended it | **L0 + L2** (+L4) | ~196,000 |
| cost and pacing | any of the above + L3 | derived numbers |

**L0 + L2 breaks the ladder on purpose.** L2 is 0.7% of L1's price — 9,924 against 1,426,401, **144×** — so buying the
working record in order to obtain attribution pays 144 times for evidence those questions never read. The converse is
also true and worth stating: without L1, no question about verification or recovery can be answered at all. **The
level a measurement needs is a property of the question, not a setting on the session.**

| strategy | verdict |
|---|---|
| **whole, at a level that fits** (see the combinations above) | first choice: whole, auditable, cheap |
| **whole L1, when it fits** | fine — no cap, no cut |
| **question-directed selection** from L1 | when it does not fit: give `claim_unsupported_by_tools` the *results*, give a code question the *arguments*. Never a positional cut |
| **mechanical segmentation** | only when even the chosen level does not fit — every segment whole, the aggregate computed in code |
| **generated summaries** | only if the summary ships in the package |
| **LLM-chosen semantic boundaries** | implicit-intent risk is real; the deeper problem is **reproducibility** — an LLM boundary is not re-derivable without the same model and prompt. If used, the boundary list ships in the package |
| **regex truncation** | this is what the 4,000-character tool cap already is: −91% of the evidence, sign inverted |

---

## Capabilities this exposes

1. **No "exchange" selector.** L0 cannot be asked for today: `lastMessages`/`offset` take contiguous slices, and the
   ask and the final answer of a turn are separated by the working record. An exchange selector is the prerequisite
   for the test above.
2. **Question-directed evidence** — per-question declaration of the level needed, then one call per group of
   questions that share a level, replacing the positional cap.
3. **A `source.kind` filter.** Of the 46 `operator` messages in the freeciv session, **38 are the human (3,868 chars)
   and 8 are the harness (15,521 chars)** — four skill catalogues alone are 14,524. So the `operator` stream is 83%
   human **by count** and **20% by volume**, and `human-conduct-session@1` is asked about all of it. Any L0 selector
   must take `source.kind == "user"` for the human's ask, or it will hand the judge a skill catalogue as a question.

---

## Not depth: the other axes

Deeper than L2 you stop buying depth and start buying something else. These are **axes, not levels**:

| axis | what it buys |
|---|---|
| **breadth** | the same reading over many sessions, so a number becomes a distribution. `n=1` readings are anecdotes no matter how deep |
| **effect** | what changed in the world: `workspace/changes`, `deliverables/presented`, git state — the outcome rather than a judgement about it |
| **conditions** | the comparability keys: model route, reasoning effort, sandbox/approval, the tool list in force |
| **other parties** | a session can hold several models' work — 11 `web/deepseek-search-llm-request` and 1 `session/title-llm-request` here. A reading about "the agent" may be a reading about a route |

---

## Related register rows

* **F32 / F34 / F35** — the composer cut tool evidence and the report did not say so; the origin of the `truncated`
  flag and the both-ends clipping.
* **F74** — a subject over the estimate now segments itself rather than being judged from a few thousand characters.
* **F75 / F76** — a package pooled two conversations; and the tool's own wording invited a write nobody asked for.
