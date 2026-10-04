# Which question may be asked of which evidence

A question is only answerable from evidence that contains its subject. This file records, for each question in the
shipped session sets, the **groups** it needs (see `docs/measurement-depth.md`) and the **scope** it needs — one
exchange, the whole session, or the end of it.

It exists because the tool used to answer all sixteen questions of whatever it was given, **confidently, with no flag
that the evidence was absent**. Measured on a single exchange of the freeciv session, where the tool had no tool
results in view at all:

```
session_claim_unsupported_by_tools: p=0.83   ← asks whether the answer claims more than the TOOLS support
```

The judge was asked to compare claims against tool output it could not see, answered anyway, and the reading is
indistinguishable from one given the tools.

---

## The matrix

`G0` the exchange · `G1` the working record · `G2` the harness's own acts.
Scope: **1×** one exchange · **all** the whole session · **end** the last exchange.

| # | question | needs | scope | why |
|---|---|---|---|---|
| 1 | `session_request_served` (score of 2) | **G0** (G1 to verify) | 1× | the ask and the answer are the subject; whether the answer is *true* needs the tool results |
| 2 | `session_operator_had_to_repeat` (noul) | **G0** | **all** | repetition is a property of the SEQUENCE of asks; one exchange cannot show it |
| 3 | `session_failed_tool_recovery` (choice) | **G1** | 1× | it is a question about tool results; with none in view the judge guessed `no_empty_result` (0.62) |
| 4 | `session_claim_unsupported_by_tools` (noul) | **G0 + G1** | 1× | the claims come from the answer, the support from the results — **the results are load-bearing** |
| 5 | `session_work_left_to_the_operator` (noul) | **G0 + G1** | all | what the answer asks of the human, and what the agent actually did instead |
| 6 | `session_scope_expanded` (noul) | **G0 + G1** | 1× | the ask is in G0, but what was actually done is 28 tool calls in G1 |
| 7 | `session_context_dropped` (noul) | **G0 + G2** | all | whether context was lost needs the history, and whether it was ever *given* needs the injections |
| 8 | `session_outcome_reusable` (score of 2) | **G0** (G1 to verify) | 1× | the artifact is the answer; whether it is reusable *in fact* needs the work behind it |
| 9 | `operator_request_clear` (score of 2) | **G0** | 1× | the ask alone. Measured 0.75 of 2 for a one-sentence request |
| 10 | `operator_supplied_context` (choice) | **G0 + G1** | all | what the human gave, against what the agent had to work out for itself |
| 11 | `operator_corrections_timely` (noul) | **G0 + G1** | all | a correction is timely *relative to* work already done |
| 12 | `operator_kept_one_goal` (choice) | **G0** | **all** | goal drift is a property of the sequence of asks |
| 13 | `operator_did_their_part` (noul) | **G0** | all | the agent's questions and the human's answers are both in the exchange |
| 14 | `operator_feedback_specific` (choice) | **G0** | all | the human's messages. `none_given` is correct *only* if the selection really holds no feedback |
| 15 | `operator_recognised_errors` (noul) | **G0 + G1** | all | the operator can only be judged on errors the evidence shows |
| 16 | `operator_left_agent_blocked` (noul) | **G0** | **end** | it is a question about the end of the session |

## What fell out of it

**Six questions cannot be asked of a single exchange at all** — 2, 7, 10, 11, 12, 15 — because their subject is the
sequence. Asked anyway, at one exchange, they returned: `operator_had_to_repeat` p=0.21, `corrections_timely` p=0.24,
`kept_one_goal` `one_goal` (0.68), `recognised_errors` p=0.05. Those are not readings of the session; they are readings
of a single turn's worth of it, and nothing in the output said so.

**Two questions needed G1 and were answered without it** — 3 and 4 — one of them at `p=0.83` confidence.

**One question needs the END and was asked of the middle** — 16, at `p=0.78`, about a session that continued.

**And one whole family has no question at all:** nothing asks *who ended the work*. That is `turn/end.reason` — G2
alone, ~10 KB in the freeciv session — and there is no harness-conduct set to ask it. See the gap noted in
`docs/measurement-depth.md`.

## What to build from this

An `evidence` declaration on each question spec:

```json
{ "id": "session_failed_tool_recovery", "type": "choice",
  "evidence": { "groups": ["G1"], "scope": "exchange" }, "instructions": "..." }
```

and then the rule the tool follows:

* a question whose declared groups are **not** in the selection is **refused**, or reported as `unanswerable` with the
  missing group named — never answered;
* a question whose scope is `session` is refused for a one-exchange selection, and one whose scope is `end` is refused
  unless the selection includes the last exchange;
* a set whose questions declare nothing behaves as it does today, so existing sets keep working.

Until that lands, **a G0 reading is only trustworthy for questions 1, 8, 9, 13 and 14** — and 12 and 16 only when the
selection covers the whole session and its end respectively.
