# Evidence groups: what G0–G4 mean

This file exists because these evidence groups are referred to by shorthand — **G0**, **G1**, **G2** — and shorthand
is not a specification. Every claim below is measured against a real session and the numbers are given, so a reader
can check them rather than take them.

**They are GROUPS, not levels.** The sets are disjoint categories, and the numbering is an ordering by *coverage*, not
a chain of prerequisites. This file used the prefix `L` for a while, which is what invited the reading that G2
contains G1 contains G0 — it does not. `G` is for group, and the rename fixes a semantic error that produced two
rounds of confusion.

**Where the numbers come from:** the freeciv session, `session-bba92d44-16f5-497e-8d8b-0d620e1686cd`
(`~/.dsh/sessions/--home-john-freeciv--/`), 611 messages, 2,996 events, 4.7 MB of JSONL (906 KB compressed), 855,812
characters of dialogue text. **Prices are from ONE session and vary with the session's shape** — the layer
*structure* is general, the weights are not.

---

## Two questions, in this order

1. **What do we want to measure?** A *decision* about the subject, answered by what a reader needs to know — not by
   what happens to be available. "The result-oriented performance of the agent", "how the LLM behaved", and "was that
   behaviour induced" are three different subjects with three different evidence sets.
2. **Can the judge's constraint fit that evidence?** A *calculation* — arithmetic against the token budget, not a
   judgement about what matters.

**The order matters because the calculation must not be allowed to make the decision.** When the evidence a purpose
needs does not fit, that is a fact about the **method**. It licenses: selecting the parts the question reads,
projecting deterministically (G0 is exactly such a projection), segmenting mechanically, or storing a generated
summary inside the package. It does **not** license measuring a smaller subject and reporting it under the original
name — which is what a positional cut does, and how a rendering at 9% of the evidence came back looking like a
session-level verdict.

## Quick reference

| short | name | one line | adds |
|---|---|---|---|
| **G0** | **the exchange** | what the human asked, and what came back | `user/message` (human only) + the turn's final assistant text |
| **G1** | **the working record** | everything done between the two | all assistant text, `tool/call` arguments, `tool/result` text |
| **G2** | **the harness's own acts** | what was done *to* the agent, not by it | `agent/inbox/spliced`, `tool-addition`/`tool-removal`, `turn/end.reason`, sandbox/permission/approval/model conditions |
| **G3** | **the pacing** | how the work was distributed in time | stream deltas (`dt`, `time0`), `usage` token counts, step durations |
| **G4** | **the measurer's own record** | what this measurement did to the session | `stateChars`, truncation flags, segment rows, state hash, refusals |

**Read the numbering as how much of the session is COVERED, not as a chain of prerequisites.** The event sets are
**disjoint categories**: G2's events are not inside G1's, and G1's are not inside G0's. So a measurement may take any
subset of them — and the pricing below says it usually should. The ladder describes coverage; a measurement is a
*selection* from it.

That distinction is why a strategy can read **G0 + G2**: the exchange plus the harness's own acts, deliberately
*skipping* the working record. It is not a rung on the way to G2; it is a different selection, and the pricing says it
is the cheap one.

---

## The words: ask, turn, exchange, ask-group, block

Five things get conflated in conversation, and the two most recent findings turn on the difference. **None of them was
defined in this file before — including "ask", which it used freely eight times.**

| word | what it is | how to see it in the log | measured |
|---|---|---|---|
| **ask** | ONE message the HUMAN typed | `user/message` whose `data.source.kind == "user"` | freeciv **38**, this session **253** |
| **turn** | one driver excursion | `turn/start` … `turn/end` | freeciv **37**, this session **487** |
| **exchange** | what G0 selects *today*: the ask(s) before a turn, and that turn's last assistant message | derived, **turn-anchored** | — |
| **ask-group** | an ask and EVERY turn it drove, up to the next ask | derived | freeciv ≈1 turn/ask; **this session ≈2** |
| **block** | a run of ask-groups about one subject | a segmentation, stored with the reading | 4 blocks from a 3B model over freeciv's 38 asks |

### A turn, measured

```
turn/start
  agent/inbox/spliced      the HARNESS speaks first: 37 of 37 turns in the freeciv session
  user/message             the ask, inside the turn (index 2 in 34 of 37)
  assistant/message …      narration and tool calls
  tool/result …
  assistant/message        the turn's last MESSAGE          <- what G0 keeps
  step/end                 the turn's last EVENT
turn/end {reason}
```

`turn/end.reason` is the AUTHORITY for a boundary — 36 `completed`, 1 `interrupted`. A `blocked` turn (a reject, zero
steps) has **no assistant message at all**, so "a turn ends with an assistant message" holds for `completed` turns and
for no other reason automatically.

### Two measured warnings

**A turn is not an ask.** The freeciv session nearly coincides — 37 turns, 38 asks. This one does not: **253 asks
across 487 turns**, because one ask drives several turns. So the unit a G0 measurement wants is the **ask-group** — and
**that is not what is built.** `exchangesOf` is TURN-anchored: it attaches an ask to the first turn that follows it, so
the second and third turns of a multi-turn ask become exchanges with an **empty ask**. On a session of this shape,
selecting G0 by turn selects a fragment. An **ask-based selector** is the missing capability.

**And not every message on the human's channel is the human's.** Of the freeciv session's 46 `user/message` events,
**38 are the human (3,868 chars) and 8 are the harness (15,521 chars)** — four skill catalogues alone are 14,524. An
ask is the ones whose `source.kind` is `user`, and **a missing source is not an ask**. The harness has a second
injection mechanism as well — `agent/inbox/spliced`, 84 of them in that session — which never appears on the human's
channel at all.

## What each group IS, in the harness's own terms

**We invented the group NAMES; we did not invent the evidence.** Every group is a SELECTION over mechanisms the
harness defines and documents, and this table states each selection as a citation rather than a description — because
a private vocabulary that merely renames someone else's concepts drifts, and the drift is invisible.

Citations are to the harness checkout (`~/deepseek-harness`), file and line, so each one can be re-checked.

| group | composed of | documented at | whose concept |
|---|---|---|---|
| **G0** the asks and the answers | `user/message` whose `source` marks a **direct human prompt**, plus the turn's last `assistant/message` | `packages/core/session/src/types.ts:309` — *"a direct human prompt …, a synthetic `agent.inject()` context …, or an entered goal continuation round. All three project their `content` verbatim; `source` tells them apart."* | **theirs** (the three kinds); **ours** (selecting only the first kind, and only the turn's last word) |
| **G1** the working record | the turn's `assistant/message` narration, `tool/call`, `tool/result` — and their `stream` | `types.ts:341` (`stream`, `usage`, `interrupted?`), `:296` (*"step … one model call plus the tool executions it requested"*) | **theirs** — and this is what the Web Trajectory view renders per turn: `packages/client/ui-trajectory/src/client/TrajectoryTable.tsx:601,650` |
| **G2** the harness's own acts | `user/message` with a non-human `source` (the `agent.inject()` and goal-round kinds), `developer/message`, `turn/end.reason`, `request/header`/`request/context`, and the permission/sandbox/approval records | `types.ts:309` (the injected kinds), `:288` (`turn/end` reason), `request/*` in the same map | **entirely theirs** — we merely collect them into one selectable set |
| **G3** the pacing | `assistant/message.stream` (deltas with `time`/`time0`), `usage`, `assistant/attempt.stream` | `types.ts:341`, `:352` — *"one model attempt that committed no surface message … a failed, retried, cancelled, or stream-error attempt"* | **entirely theirs**, and we currently ignore `assistant/attempt` |
| **G4** the measurer's own record | `stateChars`, truncation, segment rows, the state hash, the refusals | — | **ENTIRELY OURS.** No harness equivalent exists, because it describes the measurement rather than the session. It is also the group that must always be attached |

### So are the groups redundant?

**No, but they are not primitives either.** The harness offers *per-turn rendering* and a *current surface*
(`SessionEventSurface = 'current' | 'shadowed' | 'log-only'`, `packages/session-query/session-query/lib/types/types.d.ts:12`)
— it does not offer "the asks and the final answers only" nor "the harness's own acts as a separate set". Those
selections are what G0 and G2 add, and they are selections **over** documented events, not a new model of the log.

Two consequences to keep:

* **A group's definition is its citation.** If the format version moves, the table is stale and the groups are
  undefined until it is re-checked. `SESSION_FORMAT_VERSION = 4` (`types.ts:89`) while the released format is 3
  (`docs/session-format-status.md`) — so we are pinned to the checkout writer, and a version bump is a review trigger
  in the same spirit as the compatibility gate.
* **Where we have a vocabulary, ask whether the harness already has one.** `ask`, `turn`, `exchange` and `ask-group`
  above survive that test — `turn` and `step` are theirs, the other three are ours and are defined by the events they
  select. The Trajectory view's own fold (`collapsedSummaryKind: 'turn' | 'assistant'`,
  `packages/client/ui-trajectory/src/client/trajectory-virtual-rows.ts:13`) is a third, and it is why the view's rows
  are turns rather than asks.

## Two axes, and only ONE of them is the group

A selection is always **(groups × scope)**, and conflating the two is what makes "G0" sound ambiguous:

| axis | what it answers | values |
|---|---|---|
| **group** | WHICH evidence | **G0** the asks and the answers · **G1** the working record · **G2** the harness's acts · **G3** the pacing · **G4** the measurer's record (always attached) |
| **scope** | HOW MUCH of the session | `exchange` one · `session` every one · `end` the last one |

**SEVERAL EXCHANGES ARE STILL G0.** They are the same evidence category at a larger scope, so they need no group of
their own — and the disjointness test that made these *groups* rather than levels settles it: a "trajectory" group
would contain G0 exactly and contain nothing else.

But the SUBJECT does change, which is why it feels like it needs a name:

| scope | the subject | what it can answer |
|---|---|---|
| `exchange` | an **episode** | was this answered, and was the answer any good |
| `session` | a **trajectory** | did the goal drift, did they have to repeat, was context lost |
| `end` | the **closing state** | was anything left blocked |

Six of the sixteen shipped questions need `session`, and one needs `end` (`docs/question-suitability.md`).

### And at `session` scope there is a second question: whole, or aggregated?

A trajectory can be judged two ways, and they are **not the same claim**:

* **whole** — every exchange in one state, one judgement about the conversation;
* **aggregated** — one judgement per exchange, combined in code (`segmentChars` over the exchange boundaries).

The aggregate is honest about itself — "`one_goal` in 12 of 16 exchanges" — but it can **mask the very thing a
trajectory question asks about.** A goal that changed four times reads as 12 of 16 agreeing, which sounds like
stability. **For a trajectory question, drift IS the subject, and an average is the one summary that cannot show it.**

## Choosing by what you want to know

The groups are selected by the QUESTION, and two questions that look similar need different groups:

| what you want to know | group(s) | why |
|---|---|---|
| did the agent (LLM + harness) serve the request, and is the outcome usable | **G0** | result-oriented. The exchange is also exactly what the human experiences |
| how did the LLM BEHAVE — what it called, what came back, how it narrated its way there | **G0 + G1** | behaviour study. A tool result depends on the tool's own code *and* on the input it was given |
| was that behaviour the LLM's own, or induced | **+ G2** | G1 shows the harness's impact through its **consequences**; G2 records the harness's **actions** — injections, tool-list changes, who ended the turn |
| what did it cost, how was the work paced | + G3 | derived numbers, not text |
| can I trust this reading at all | **G4, always** | without it a cut is indistinguishable from the session |

**Result-oriented measurement and behaviour study are different subjects, and neither substitutes for the other.** A
high G0 reading with a G1 showing the work grinding is a different finding from the same G0 with a clean G1: same
result, different behaviour. And a careful process can produce a poor result. They are independent axes, not a
hierarchy — which is the other reason these are groups and not levels.

---

## G0 — the exchange

*Defined as a selection over the harness mechanisms cited in "What each group IS" above.*

**What the human typed, and what the human read.** Nothing between. One exchange at `exchange` scope, or every
exchange at `session` scope — the same group, and a different subject.

| | |
|---|---|
| includes | `user/message` where `data.source.kind == "user"`; the LAST `assistant/message` text of each turn |
| excludes | narration, tool calls, tool results, injections, everything the harness did |
| can answer | was the request clear; was it served; is the outcome usable; did the operator have to repeat themselves |
| cannot answer | anything about process: verification, loops, recovery, scope, context, work handed back |
| price here | **10,885 chars** for one exchange of the freeciv session; **~186,000** for all 37 |

**G0 is not necessarily small.** Here it is large because the operator's asks and the final answers are long reviews.
"A shallow measurement" is not the same claim as "a cheap one".

## G1 — the working record

*Defined as a selection over the harness mechanisms cited in "What each group IS" above.*

**Everything done between the ask and the answer** — what the UI shows when you unfold `Took 6m 08s`.

| | |
|---|---|
| includes | every assistant text block (the narration), every `tool/call` (name + `arguments`), every `tool/result` text |
| can answer | did it verify before asserting; did it recover from an empty result; did it stay in scope; did it use the tools it had |
| cannot answer | whether the harness gave it what it needed, or stopped it — that is G2 |
| price here | **1,426,401 chars** — 8× G0 |

**The figure the tool reports as "chars of conversation" is not this.** That figure counts dialogue only
(855,812), so it understates the working record by ~570,000 characters.

**Inside G1, the parts are not equally sized, and not where you'd guess:** in the exchange priced below, tool call
*arguments* were 42,458 chars, tool *results* 24,215, dialogue 24,589.

## G2 — the harness's own acts

*Defined as a selection over the harness mechanisms cited in "What each group IS" above.*

**What was done to the agent rather than by it.** The layer that makes attribution possible at all.

| | |
|---|---|
| includes | `agent/inbox/spliced` (84 here — each with `source.kind`, target and text); `tool-addition` / `tool-removal` blocks (11 / 6); `turn/end.reason` (36 `completed`, 1 `interrupted`); `permission/preset`, `sandbox/mode`, `approval/policy`, `subagent/model-selection-policy`; the tool list in `request/header` (written **on change** — 4 times in 37 turns) and `request/context.contextWindow` |
| can answer | was the context ever given to it; did the harness instruct the scope; who ended the turn; what was it allowed to do; under what conditions did it run |
| price here | **+9,924 chars — 0.7% of G1** |

**This is the asymmetry worth remembering: the layer that fixes attribution is the cheapest one.** Those 84 splices
are ~10 KB, and they are the difference between *"the LLM expanded scope"* and *"the harness told it to"*.

## G3 — the pacing

*Defined as a selection over the harness mechanisms cited in "What each group IS" above.*

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

## G4 — the measurer's own record

*Defined as a selection over the harness mechanisms cited in "What each group IS" above.*

**What the measurement did to the session.** Metadata, not content.

| | |
|---|---|
| includes | `stateChars`, the `TRUNCATED` flag, the segment rows (`messages A–B`, chars, `OVER BUDGET`), the composed state hash, the window's refusals, the model and probe that answered |
| why it is a level | without it, an G1–G3 reading is uninterpretable: you cannot tell the session from the cut |
| price | none |

The rule that follows: **any reading that depends on the composed state must carry the composition's flags**, or it
attributes the measurer's cut to the agent.

---

## The three rules

**R1 — a cut of a deep layer measures nothing in particular; a whole layer measures that layer.** A whole G0 is a
valid measurement *of the exchange*. G1 rendered down to 8,000 characters is a measurement of a cut, wearing the
clothes of a session judgement.

**R2 — prefer deterministic projections of the log over generative paraphrases of it.** G0 is a projection:
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
| the exchange's working record (G1) | **91,262** |
| of which dialogue / results / arguments | 24,589 / 24,215 / **42,458** |
| **what the judge was given** | **8,000 — 9%** |
| **G0 of that exchange — the ask + the final answer** | **10,821 — fits the 96,000 budget whole** |

Measured at that 9% cut, the reading came back **low** (`session_request_served` 0.27,
`session_outcome_reusable` 0.03) for an exchange that is, read whole, one of the more impressive in the session. The
evidence that made the conclusion credible — the save-file parsing, in the tool results — was the part dropped.

**So the constraint does not merely make the measurement shallow. It can invert it.** And G0 is not the consolation
prize: it is *whole*, which is the property the current default lacks.

---

## Question 2's answers: what to do when the purpose's evidence does not fit

These are answers to the SECOND question, and **none of them may change the first one.** They are ordered by
preference — not by size — because size is not the criterion the selection answers to.

**The first row is not the largest selection; it is the one that buys the most per character.** Size orders nothing
here, except through one rule:

> **Take the largest COMPLETE selection that the question actually reads and that fits.**

If every category is relevant, that selection is **G0 + G1 + G2** — everything, whole. If only attribution is
relevant, it is **G0 + G2**, and adding G1 is not generosity: it is the vendor's documented failure mode, a large
state full of detail the question does not use. Fitting the budget is *necessary, not sufficient*.

(G3 and G4 do not compete for this budget. G4 is metadata and should always be attached; G3 is derived numbers, not
text. The contest is between G0, G1 and G2.)

**Which selection answers which question.** The choices are combinations, not rungs — pick by what the question reads:

| the question is about | select | price here |
|---|---|---|
| the exchange and its outcome | G0 (+G4) | ~186,000 |
| the process — verification, recovery, scope | G0 + G1 (+G4) | ~1,426,000 |
| attribution, conditions, who ended it | **G0 + G2** (+G4) | ~196,000 |
| cost and pacing | any of the above + G3 | derived numbers |

**G0 + G2 breaks the ladder on purpose.** G2 is 0.7% of G1's price — 9,924 against 1,426,401, **144×** — so buying the
working record in order to obtain attribution pays 144 times for evidence those questions never read. The converse is
also true and worth stating: without G1, no question about verification or recovery can be answered at all. **The
level a measurement needs is a property of the question, not a setting on the session.**

| strategy | verdict |
|---|---|
| **whole, at a level that fits** (see the combinations above) | first choice: whole, auditable, cheap |
| **whole G1, when it fits** | fine — no cap, no cut |
| **question-directed selection** from G1 | when it does not fit: give `claim_unsupported_by_tools` the *results*, give a code question the *arguments*. Never a positional cut |
| **mechanical segmentation** | only when even the chosen level does not fit — every segment whole, the aggregate computed in code |
| **generated summaries** | only if the summary ships in the package |
| **LLM-chosen semantic boundaries** | implicit-intent risk is real; the deeper problem is **reproducibility** — an LLM boundary is not re-derivable without the same model and prompt. If used, the boundary list ships in the package |
| **regex truncation** | this is what the 4,000-character tool cap already is: −91% of the evidence, sign inverted |

**And the answer that is always available, and always better than a proxy: declare the purpose unmeasurable at this
constraint.** Measuring something smaller and reporting it under the original name is the one option that cannot be
checked by the reader — the artifact looks the same either way. A named refusal is a finding; a quiet substitution is
a defect.

---

## Capabilities this exposes

1. ~~**No "exchange" selector.**~~ **BUILT** — `groups: ["G0"]`, plus `turn: N` to pick one exchange, on
   `system1_evaluate_session`. It takes the human's messages by `data.source.kind == "user"` (not every `user/message`
   is the human: 8 of 46 were injections carrying 80% of that stream's volume), and the answer is the turn's LAST word
   rather than its first. It reports the exclusions, and it REFUSES G2/G3 rather than approximating them.
2. **Question-directed evidence** — per-question declaration of the level needed, then one call per group of
   questions that share a level, replacing the positional cap.
3. ~~**A `source.kind` filter.**~~ **BUILT into the selector above** — and while building it, `textOf` was found to
   read only `data.message.content`, so a `user/message`'s text (which lives at `data.content`) counted as ZERO
   characters in the coverage denominator, the segment sizer and the sessions reader, while the composer read both.
   Fixed; the same human+answer window now measures 44 characters where it measured 9.
4. **The original note, kept for the record:** Of the 46 `operator` messages in the freeciv session, **38 are the human (3,868 chars)
   and 8 are the harness (15,521 chars)** — four skill catalogues alone are 14,524. So the `operator` stream is 83%
   human **by count** and **20% by volume**, and `human-conduct-session@1` is asked about all of it. Any G0 selector
   must take `source.kind == "user"` for the human's ask, or it will hand the judge a skill catalogue as a question.

---

## Not depth: the other axes

Deeper than G2 you stop buying depth and start buying something else. These are **axes, not levels**:

| axis | what it buys |
|---|---|
| **breadth** | the same reading over many sessions, so a number becomes a distribution. `n=1` readings are anecdotes no matter how deep |
| **effect** | what changed in the world: `workspace/changes`, `deliverables/presented`, git state — the outcome rather than a judgement about it |
| **conditions** | the comparability keys: model route, reasoning effort, sandbox/approval, the tool list in force |
| **other parties** | a session can hold several models' work — 11 `web/deepseek-search-llm-request` and 1 `session/title-llm-request` here. A reading about "the agent" may be a reading about a route |

---

## Related

* **`docs/question-suitability.md`** — which question may be asked of which group, and at what scope. The group a
  measurement takes is only half the decision; a question whose subject is not in that group is unanswerable, and the
  tool used to answer it anyway.

## Related register rows

* **F32 / F34 / F35** — the composer cut tool evidence and the report did not say so; the origin of the `truncated`
  flag and the both-ends clipping.
* **F74** — a subject over the estimate now segments itself rather than being judged from a few thousand characters.
* **F75 / F76** — a package pooled two conversations; and the tool's own wording invited a write nobody asked for.
