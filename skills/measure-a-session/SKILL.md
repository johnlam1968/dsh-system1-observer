---
name: measure-a-session
description: Use when someone asks for a report, evaluation or measurement of a SESSION — "I want a report on XYZ session", "how did that session go", "evaluate this conversation", "what score would you give that session". Drives dsh-system1-observer end to end: find the session, pick or author the question set, segment a session too large for one call, measure it, package the measurement, and attach the interpretation. Also use when asked whether a question SET is any good, or whether a rewrite made questions better rather than merely different.
---

# Measuring a session

`dsh-system1-observer` turns a session into probabilities about it. This skill is the workflow: it exists because the
tools are individually documented and the ORDER is not, and because three of the steps have refusals that look like
failures if you do not know why they are there.

## The short version, and it is three calls

```
1. FIND      system1_sessions { action: 'list', search: 'XYZ' }
2. MEASURE   system1_evaluate_session { sessionId: '<id>', segmentChars: 57600, package: true }
3. INTERPRET system1_measurements { action: 'interpret', package: '<the dir from step 2>', text: '<your reading>', by: '<you>' }
```

Step 2 is the whole mechanical workflow in one call: it reads the session, segments it if it is large, asks the
question set of every segment, aggregates in code, and writes a measurement report package. Step 3 is yours, and it
cannot be done for you — see below.

## Why step 3 is a separate call, and why that is the point

Prose cannot be derived from numbers. Step 2 produces readings; a READING of them is somebody's judgement, so it is
attributed (`by`), timestamped, and **anchored**: the package records the sha256 of the exact `readings.json` your
words were written against. If the readings are ever regenerated differently, your interpretation is visibly orphaned
rather than quietly wrong.

Do not put your prose into `report.md`. The package distinguishes what is REPRODUCIBLE (`report.md`, `readings.json`,
`trace.jsonl` — each re-derivable from the trace slice it carries) from what is merely WRITTEN (`interpretation.md`).
Merging them destroys the only property that makes the package checkable.

## The budget, and why you must segment

Jev 1.13 — the frontier System One model — takes **32k tokens of `state` plus the longest question**, and 64k per
request with all questions. That is roughly **128,000 characters** of state, and a long session is far past it.

A session over the budget does NOT fail loudly. It comes back as eight answers that are all `unreadable`, with no
`executed` provenance, and nothing naming the cause. **So pass `segmentChars`** — `57600` is the shipped default, about
60% of the estimated budget, leaving room for section labels and the tool record.

```
system1_evaluate_session { sessionId, segmentChars: 57600, package: true }
```

It splits the session into contiguous, message-aligned segments, composes and judges each one WHOLE, and combines the
readings in code. The output tells you what happened:

- `seg N: messages A-B (n), C chars` — one row per segment; `TRUNCATED` or `OVER BUDGET` means that segment alone was
  too big (one message can be, and a message is never split).
- `n=5 median=... true in 60% of segments` — an ARITHMETIC aggregate, not a second model call.
- `n=4, 1 unreadable` — one segment's answer could not be read, and it is EXCLUDED from `n` rather than averaged in as
  a zero.

**A segment aggregate is not a session-level judgement.** The questions were written about a whole session; "true in 3
of 5 segments" is arithmetic over its parts. Where the readings disagree across segments, the FIRST and LAST are the
informative ones — a request lives at the start of a session and an outcome at the end. For `subjectLastMessages`, a
page that FITS the budget is better than a cut of the whole: the vendor's own guidance is *"filter first; send only
what the question needs"*, and accuracy falls as a state grows with material the question does not need.

## Which questions

The set is the row's `questionSet`, or the inline `questions`. To see what exists:

```
system1_question_sets { action: 'list' }
system1_question_sets { action: 'read', set: '<name>', scope: 'session' }
```

Two session-scoped sets ship with this repository:

| set | what it judges |
|---|---|
| `agent-helpfulness-session@1` | the AGENT: request served, corrections needed, tool recovery, unsupported claims, scope, context, work handed back, outcome reusable |
| `human-conduct-session@1` | the OPERATOR: request clarity, context supplied, timely corrections, one goal, answering questions, feedback specificity, catching errors, leaving the agent blocked |

**Read both.** Half of a session's outcome is the operator's, and a reading that says "the request was partly served"
is not actionable until it is separated from "the opening message did not say what was wanted". Switch sets with
**NAME THE SET IN THE CALL**, one call per instrument:

`system1_evaluate_session { sessionId, set: 'human-conduct-session@1', segmentChars: 57600, package: true }`

Without `set` the row's own set applies. Do NOT change the row's `questionSet` and change it back: that is a side
effect on somebody else's configuration, it puts two `config` lines inside your own window, and it costs four
operations instead of none. That is exactly what an earlier agent did, which is why this parameter exists (F65).

If no set fits, author one: `system1_question_sets { action: 'write', set, scope: 'session', specs: [...] }`. Keep
`choice` questions with an explicit abstain option, and prefer `choice` over `noul` whenever the judgement depends on
the question's POLARITY — a `noul` can be confidently inverted and the reply will not say so.

## Before you trust a set: the battery

A question that cannot separate is not a measurement, and neither is one that is confidently WRONG.

```
system1_battery { action: 'list' }
system1_battery { action: 'validate', battery: '<name>', set: '<name>' }   # spends nothing
system1_battery { action: 'run', battery: '<name>', set: '<name>', parent: '<hash>', reason: '<why>' }
```

`run` scores the set against cases whose answers were known BEFOREHAND and records an `experiment` line — a statement
about the INSTRUMENT, not about a session, and never a reading. With `parent` it becomes a comparison, which is the
only thing that distinguishes a BETTER question from a different one. Two things learned the hard way:

- **A low score may be the BATTERY's fault.** The first run of the shipped battery scored one question 1/8 and the
  fault was six wrong expectations in the battery, not the question. Inspect the misses before rewriting a question.
- **Eight cases carry about a case of run-to-run noise.** Detect large improvements; do not read a small difference.

## The report format, and getting it without asking for it

**DO NOT RETELL THE NUMBERS IN PROSE.** Retyping a median from a tool result into a sentence is a number living in two
places, and it drifts. Get the format from the tool instead:

```
system1_measurements { action: 'skeleton', run: 'current', tables: [
  { title: 'The model',    questions: ['session_request_served', 'session_operator_had_to_repeat', 'session_failed_tool_recovery', 'session_claim_unsupported_by_tools', 'session_work_left_to_the_operator', 'session_scope_expanded', 'session_context_dropped', 'session_outcome_reusable'] },
  { title: 'The operator', questions: ['operator_request_clear', 'operator_supplied_context', 'operator_corrections_timely', 'operator_kept_one_goal', 'operator_did_their_part', 'operator_feedback_specific', 'operator_recognised_errors', 'operator_left_agent_blocked'] }
] }
```

It returns the report with **every number already filled from `readings.json`** and the prose left blank, in the
shape the operator asked for:

* a **basis line** -- what was measured, when, from which run;
* one section per instrument, headed `## The model, in this session (set \`agent-helpfulness-session@1\`, hash ...)`;
* a table of **short labels** with the primitive marked (`request served (score)`), the numbers, and -- when you pass
  `against` with another package directory -- a **third column** comparing against it;
* a **`READING:` line below each table**, which is yours;
* `## What this reading does NOT establish` and `## What the package itself caught`, which are also yours;
* `## What may NOT be read from this window`, which the tool fills from the window's refusals.

`against` is what makes it a report rather than a table: give it the directory of an earlier package and the same
questions appear side by side, which is how a reader sees that a truncated measurement said something different.

**NAME ONE TABLE PER INSTRUMENT, and report BOTH.** A session's outcome is half the agent's and half the operator's:
`agent-helpfulness-session@1` and `human-conduct-session@1`. The tool cannot split them for you -- which questions
belong to which set is a fact about the sets, not about the numbers -- and a report of one instrument is a report of
half the session. Name each instrument in its own call with `set:` (see above) -- one call per instrument, no
settings change, and no configuration lines inside the window you are about to package.

**SAY WHICH SET EACH TABLE IS**, with `set` and `setHash`, because the window records ONE set hash for every call in it
(register row F59) -- and the tool refuses to copy one instrument's hash onto another's table rather than guessing.

**AND SAY WHICH PACKAGE THESE NUMBERS CAME FROM.** A `run` window is a window over a PROCESS's lifetime, not over a
measurement, so two measurements taken in one process land in one window and its run table names ONE question set for
both (register row F59). If you are reporting two instruments from one window, say so, and say that the split is yours
rather than the tool's.

## Reading the answers

- `confidence` is how peaked the distribution was, **not** the probability that the answer is right.
- A `noul` is P(true). Near 0.5 means the two outcomes are equally likely — not medium intensity.
- A `score` is an expected level on an ordered scale, and it can land between levels. Read `probabilities` beside it;
  never interpolate a magnitude from it.
- A `choice` with `answerConfidence` is showing a different number from `confidence`; do not mix thresholds between
  primitives.

## Refusals you will meet, and what they actually mean

| refusal | what it means |
|---|---|
| `the subject carries no messages` | the session has no message events — a created-but-never-appended session, not a bug |
| `the battery and the set do not cover each other` | an expectation for a question nobody asks, or a question with no cases. Fix the battery; the run was refused BEFORE spending |
| `the questions in force ask nothing at the session scope` | the selected set declares no `session` scope, so a session judgement would have nothing to answer |
| `a package is never overwritten` | the window was already packaged. Take the new one; do not delete the old — two measurements are two packages |
| `the provider reported status "error" for this answer` | the BACKEND refused, most often because the request was over the context budget. Pass `segmentChars` |

## What a report does not establish

Say these out loud when you deliver one, because the numbers will be read as stronger than they are:

- **A segment aggregate is arithmetic over parts**, not a verdict on the session.
- **One run is one run.** Where a question's reading sits near 0.5, or differs from a previous run by a case, it is
  inside the noise.
- **An unvalidated set is unvalidated.** Check whether a battery covers it; if not, say so in the interpretation.
- **`confidence` is not accuracy**, and a high-probability answer can still be about the wrong thing.

## Delivering it

Give the reader: where the package is, the per-question readings with their spread across segments, WHICH segments
disagree, and the caveats above. Point at `report.md` for the numbers and `interpretation.md` for your reading — and
if you wrote one, make sure the anchor still checks:

```
cd <package dir> && sha256sum -c manifest.sha256 && sha256sum readings.json
```
