# `agent-helpfulness@1` — the rationale, per question

Companion to [`helpfulness-set@1.json`](helpfulness-set@1.json). The JSON is the artifact a converter compiles and a
measurement scores; **this file is why each question is there and what its target must contain.**

## Why this set is self-authored

Two searches and one delegated collection established that the public corpus for agents is **guardrail-shaped**:
plan fidelity, reversibility, blast radius, egress, secrets. `criteria/agent-helpfulness.md` records that finding and
the one exception (UltraFeedback's rating-plus-rationale annotations). So these questions are written from
**observed failures in this repository's own traces**, not adapted from someone else's rubric. That is the sourcing
method with the best evidence behind it here: the failure names the question.

## The two rules every question obeys

1. **It is a predicate or an ordinal ladder, never a wide question.** No question asks the model to summarise,
   infer intent, or characterise in prose. The guidance is unambiguous that this family is a narrow judge, and our
   own probe's 88.99% was measured on a narrow one.
2. **It states the target it needs.** The `state` block is four labelled sections and no question is answerable
   without the sections listed for it. This is the `repeated_failure`-at-a-seam lesson: a question about a
   comparison cannot be asked of a target holding one side of it.

## The questions, and what each one is for

| question | type | detects | needs in `X` | where it comes from |
|---|---|---|---|---|
| `response_helped` | score | the anchor judgement: did this help at all | request + response + **next message** | the operator's goal; the outcome is the label |
| `operator_had_to_nudge` | noul | the cost this whole feature exists to remove | request + next message | **the "test session"**: three of seven turns were the operator doing the agent's job |
| `satisfied_by_action` | noul | answering *about* a capability instead of using it | request + response + tool calls | same session, turns 3 and 5 |
| `gave_up_after_null_result` | noul | **treating a null result as completion** | tool calls + results + response | same session, turn 6 → the turn-7 nudge, written by hand |
| `claims_match_evidence` | noul | over-claiming completion without a check | response + tool results | the guardrail recipe's `claims_done_without_verification`, independently arrived at |
| `citations_are_locatable` | noul | a source that *looks* cited and cannot be found | response | **measured today**: a Thai SFT dataset offered as MT-Bench, then a correct dataset at a 401 URL |
| `followed_the_instruction` | noul | missing a constraint the instruction named | request + response | baseline adherence |
| `scope_creep` | noul | work beyond the ask | request + response + tool calls | the guardrail recipe, lifted from call level to exchange level |
| `uncertainty_distinguished` | score | stating assumptions as fact | response | a small model that exposes no thinking blocks cannot be inspected, only read |
| `effort_wasted` | score | detours | whole exchange | the operator's own accounting |

## The one question with an independent answer, and why that matters

**`operator_had_to_nudge` can be scored twice** — once by the model, and once from the trace, because the observer
already records the operator's messages. So it is the **calibration anchor**: we can measure whether the model's
answer agrees with a label nobody asked it for. Every other question here depends on the model being right about its
own judgement; this one does not.

**Build this one first.** It is the cheapest real calibration in the project, and it costs nothing to label.

## Polarity is declared per question, not per set

Four of the nouls have **"yes" as the failure** (`operator_had_to_nudge`, `gave_up_after_null_result`, `scope_creep`,
and the inverted reading of `citations_are_locatable`) and four have **"yes" as the good case**
(`satisfied_by_action`, `claims_match_evidence`, `followed_the_instruction`). A consumer that averages a raw noul
across the set will mix a danger signal with a quality signal — the guardrail recipe mixes polarities too, so this
is a property of the genre, not a mistake in this set. **Carry the direction per question** (`lib/model/escalation.js`
exists for exactly this).

## What is deliberately absent

- **No question about the system prompt or the harness.** The operator asked about the agent's helpfulness, and a
  question the agent cannot influence is not a helpfulness question.
- **No question whose answer is a paragraph.** Free-text output is where this family is least reliable and least
  measurable.
- **No question and its negation.** `repeated_failure` was dropped in favour of `gave_up_after_null_result` because
  they are near-inverses and including both inflates the apparent size of the set without adding a distinction.

## Not yet done

This set is **written, not validated.** Nothing here has been scored against labelled cases, which is the gate
ROADMAP §9.4 sets before anything reaches an agent's context. The next step is `operator_had_to_nudge` against the
trace's own record.

---

## Corrections, and the state of this artifact (2026-09-30)

**FORMAT — fixed.** The file is now in the **plugin's own config shape**: `{ "<hook>": [ {id, type, instructions,
levels|options|criteria}, ... ] }`, one array of specs keyed by the hook the trigger uses. It **loads with no
conversion**, verified non-vacuously:

```
specs in the file: 9        problems: none
questions actually built: 9 / 9     built types: {"score":2,"noul":7}
```

The earlier version was a **map keyed by id** using `criteria` for a score's levels — which is the **SDK's/wire's**
naming (`ScoreQuestion.criteria` in `@typesafe-ai/sdk`) but NOT this plugin's loader, which reads `spec.levels` from
an **array** of specs. So it could not be loaded, and the claim that it "complies with the shapes this repository
already enforces" was **false**. It is true now, and the check that establishes it asserts what came back rather
than merely that nothing threw — the two previous "verifications" passed while proving nothing (the first parsed
JSON; the second built **zero** questions, because a map where an array was required yields no specs and therefore
no problems).

**Counts — corrected.** 9 questions: **7 noul, 2 score**. `effort_wasted` was dropped as the most redundant with
`response_helped` and `scope_creep`; the table above still lists it, and that row is superseded by this section.

**Polarity — corrected.** The paragraph above said "four ... and four" and listed only three under "yes as the good
case", while inventing an "inverted reading of `citations_are_locatable`" that does not exist — that question is a
plain yes-is-good. The real counts are **3 nouls with "yes" as the failure** (`operator_had_to_nudge`,
`gave_up_after_null_result`, `scope_creep`) and **4 with "yes" as the good case** (`satisfied_by_action`,
`claims_match_evidence`, `citations_are_locatable`, `followed_the_instruction`).

**`operator_had_to_nudge` and `response_helped` both stay, deliberately.** A review found them near-inverses —
both rest on `OPERATOR NEXT MESSAGE` — and that is correct, but **their disagreement is the measurement**:
`operator_had_to_nudge` has an **independent** label, because the trace records the operator's next message
itself, while `response_helped` is the model's holistic judgement. Calibration is precisely whether those two
agree, so the correlation is a **result to report**, not redundancy to remove.

## The `X` template, which no longer lives in the JSON

The config format has no place for a target template, so it is recorded here. It is a property of `X`, not of a
question — and every question above states which sections it needs:

```
OPERATOR REQUEST:     <what the operator asked, verbatim>
AGENT RESPONSE:       <what the agent answered or did>
TOOL CALLS:           <in order: name, arguments, and the result each returned, or "none">
OPERATOR NEXT MESSAGE: <the operator's next message, or "none yet">
```

## FIX 3 — the `"none yet"` hole, which is real and NOT closed here

`response_helped` and `operator_had_to_nudge` are unanswerable when there is no next message, and **a `noul` has no
abstain option**, so an inapplicable one invites a confident arbitrary answer — the failure the System One guidance
names. **No wording fixes this, because the fault is in the target, not the question.** The fix belongs to the
trigger: **ask these two only for COMPLETED turns**, and never for the turn currently in flight. Until that filter
exists, the set must not be asked over a window whose last turn is still open. This is a constraint on §10.2 of the
roadmap, and it is recorded rather than solved.
