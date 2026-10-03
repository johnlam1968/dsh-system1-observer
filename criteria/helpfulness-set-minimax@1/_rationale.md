# `helpfulness-set-minimax@1` — rationale, per question

Companion to [`helpfulness-set-minimax@1.json`](helpfulness-set-minimax@1.json). The JSON is what the loader
compiles; this file records **what each question detects, which state sections it needs, its polarity, and why it
is not too wide** — the four things the loader has no field for.

Authored by MiniMax-M3, at the operator's request, for the seam named `turn`.

## The state these questions were written against

```
OPERATOR REQUEST:      <what the operator asked, verbatim>
AGENT RESPONSE:        <what the agent answered or did>
TOOL CALLS:            <in order: tool name, arguments, and the result each returned, or "none">
OPERATOR NEXT MESSAGE: <the operator's next message, or "none yet">
```

`OPERATOR REQUEST` and `AGENT RESPONSE` are always present. `TOOL CALLS` may be literally `none`. `OPERATOR NEXT
MESSAGE` may be `none yet` when the turn is still open. **A `noul` has no abstain option**, so every noul here is
phrased to be answerable in all four cases, and every question that is not is a `choice` carrying exactly one
`abstain: true` option that covers the absent case. That is the design rule, applied without exception.

## One global statement about polarity

**Every `noul` in this set has `yes` = the failure.** All six, deliberately — there is no noul whose `yes` is the
good case, so a consumer can read a raw noul as a failure probability without carrying a per-question direction.
The `score` questions are **high = good**. Direction is encoded in the `choice` option labels themselves.

## The questions

| # | id | type | detects | needs | polarity |
|---|---|---|---|---|---|
| 1 | `empty_search_retry_behaviour` | choice | **the observed failure**: one search returns nothing and the agent answers instead of mutating keywords | TOOL CALLS, AGENT RESPONSE | options; `answered_without_retry` / `retried_same_query` are failure, `retried_new_keywords` good, `no_empty_result` abstain |
| 2 | `absence_claimed_from_one_search` | noul | the **conclusion** half of the same failure: "it does not exist" drawn from a single empty search | AGENT RESPONSE, TOOL CALLS | **yes = failure** |
| 3 | `advice_instead_of_result` | noul | the **response** half of the same failure: general advice where a result was owed | AGENT RESPONSE, OPERATOR REQUEST | **yes = failure** |
| 4 | `url_present_in_tool_results` | choice | the **observed** unresolvable URL | AGENT RESPONSE, TOOL CALLS | options; `url_not_in_tool_calls` failure, `no_url_given` abstain |
| 5 | `named_source_is_locatable` | choice | the **observed** source cited in a form that does not exist | AGENT RESPONSE, TOOL CALLS | options; `source_not_locatable` failure, `no_source_named` abstain |
| 6 | `operator_next_message_kind` | choice | whether the operator had to nudge — the cost this feature exists to remove | OPERATOR NEXT MESSAGE | options; `nudges_to_continue` / `corrects_or_repeats` failure, `no_next_message` abstain |
| 7 | `done_claim_without_tool_evidence` | noul | claiming done/fixed/checked/passed without a result that shows it | AGENT RESPONSE, TOOL CALLS | **yes = failure** |
| 8 | `specific_detail_absent_from_state` | noul | a fabricated version, date, path, identifier or number | AGENT RESPONSE, OPERATOR REQUEST, TOOL CALLS | **yes = failure** |
| 9 | `explicit_constraint_violated` | noul | dropping a constraint the request stated in words | OPERATOR REQUEST, AGENT RESPONSE | **yes = failure** |
| 10 | `acted_beyond_request` | noul | scope creep: touching something the request did not name | TOOL CALLS, OPERATOR REQUEST | **yes = failure** |
| 11 | `evidence_strength` | score | the answer resting on the agent's own knowledge rather than its actions | TOOL CALLS, AGENT RESPONSE | **high = good** |
| 12 | `answer_concreteness` | score | a generic answer that forces the operator to do the work | OPERATOR REQUEST, AGENT RESPONSE | **high = good** |

## Why each one is narrow, and how the absent cases are handled

**1. `empty_search_retry_behaviour`.** Asks one factual thing: after a search returned nothing, did a later
search's keywords differ? A human validates it by diffing two queries in `TOOL CALLS`. It is a `choice`, not a
noul, because the whole exchange may contain no failed search; `no_empty_result` is the single abstain option and
absorbs "no tool calls" too. This is the direct detector of the nudge the operator actually wrote — "mutate and
iterate the keywords".

**2. `absence_claimed_from_one_search`.** Scoped by its own wording to the case "TOOL CALLS shows only one search
that returned nothing", so when that condition does not hold the predicate is false by construction — no abstain
needed, and no confident answer about nothing. A human validates it by pointing at the sentence and counting the
searches before it. It is not the inverse of #1: #1 grades what the agent *did next*, #2 grades the *claim it
published*; an agent can retry twice and still overclaim, or answer without retrying but without claiming
absence.

**3. `advice_instead_of_result`.** A binary between "suggestions about what the operator could do" and "a result
the agent itself obtained". No intensity, no quality adjective, no "how good". Both sections are always present.

**4. `url_present_in_tool_results`.** A literal string-presence test — every URL in the response appears in `TOOL
CALLS`, or it does not — so it is checkable by a human and even in code. `no_url_given` is the abstain option,
so a response with no link cannot produce a confident arbitrary verdict.

**5. `named_source_is_locatable`.** One locatability test per named source against a standard that is fully
inside the state: the source appears under that exact name in `TOOL CALLS`, or it carries an exact title,
identifier or URL. It needs no world knowledge to answer, only to compare names. `no_source_named` abstains.

**6. `operator_next_message_kind`.** Classifies a single message into three concrete speech acts — moves on /
tells the agent to keep trying or change approach / says the result is wrong or repeats the request. This is the
one question with an **independent label**: the trace already records the operator's next message, so the model's
answer can be checked against a human reading of the same text. `no_next_message` is the abstain option, and it
is exactly how this set closes the `"none yet"` hole that `helpfulness-set@1.md` recorded as unclosed: a `choice`
can abstain where a `score` cannot.

**7. `done_claim_without_tool_evidence`.** Lists the claim verbs (done, fixed, checked, passed) and asks whether
a tool result backs them. When `TOOL CALLS` is `none`, any such claim is unbacked and the answer is yes; when the
response makes no such claim, the answer is no. Both directions are determinate, so the missing section cannot
produce an arbitrary answer.

**8. `specific_detail_absent_from_state`.** A closed list of detail kinds (title, version, date, path, identifier,
number) checked for presence in the other two sections. It is a string-presence question, not arithmetic and not
counting. `TOOL CALLS: none` simply means the set to match against is empty, which is determinate.

**9. `explicit_constraint_violated`.** Scoped to constraints "stated" in words, with examples, so it does not
ask the model to infer an unstated intent. When the request states no constraint, the answer is no.

**10. `acted_beyond_request`.** The evidence is in the tool arguments: did a call change, create or delete
something the request did not name? `TOOL CALLS: none` means no, which is determinate.

**11. `evidence_strength`.** Three levels, each a concrete place the answer can live: the agent's own knowledge /
inferred from results / contained in a result. `TOOL CALLS: none` maps to level 0 by construction, so the score
is answerable on a toolless turn instead of being arbitrary. It is a degree along one dimension, not a quality
adjective.

**12. `answer_concreteness`.** Three levels about whether the response names and delivers the request's own
items. It is deliberately the only "quality-ish" score and is anchored to observable text (does a name, value or
artifact from the request appear), not to an overall impression.

## What I deliberately left out and why

- **No outcome score** (the `response_helped` shape in `helpfulness-set@1.json`). A `score` has no abstain
  option, and `OPERATOR NEXT MESSAGE` can be `none yet`, so a score over an open turn returns a confident
  number about nothing. The outcome judgement is carried instead by question 6, a `choice` whose abstain option
  handles exactly that case.
- **No `claims_match_evidence`/`citations_are_locatable` noul pair** in the `set@1` form. Both become choices
  here (#4, #5) so they cannot fire on a state with no URL or no named source, which is what the noul forms did.
- **No `response_contradicts_tool_result`.** Considered and dropped: detecting a contradiction is an inferential
  read, which this model family is measurably worst at, and it overlaps #7 and #8 while adding a third question
  on the same claims-versus-evidence axis.
- **No question and its negation.** The set contains no pair of logical complements. The two correlated pairs
  that survive are named in the next section rather than removed, because their disagreement is information.
- **No `retry` score.** Retry depth is conditional on an empty result, and a score cannot abstain; the ladder
  would be unanswerable on exactly the turns where nothing failed. Question 1 carries the ordered distinction
  instead, as options.
- **No wide question.** Nothing asks to summarise, characterise, infer intent, or rate "how good" the response
  was. Every noul is a predicate a human can check by reading the state; every score is a three-rung ladder over
  a concrete property.
- **No counting or arithmetic question.** Exact counts and date comparisons are left to code, per the guidance
  that this family is not a calculator.
- **No question about the system prompt or the harness.** The agent cannot influence those, so they are not
  helpfulness questions.
- **Nothing over the loader's cap.** The whole set serializes to **3897 characters** against the plugin's
  default `maxQuestionChars` of **4000**. This is not cosmetic: `capQuestions` REFUSES the entire seam (built 0,
  `problems` non-empty) rather than truncating, so an over-cap set is a set that asks nothing. The first draft of
  this file hit that at 4257 characters and was trimmed to fit; any edit must be re-measured against the cap.

## Questions I am unsure about

1. **#3 and #12 are correlated, not inverses.** A response can be concrete advice — high on
   `answer_concreteness`, and yes on `advice_instead_of_result`. They separate on the axis that matters (who
   does the work), but if the trace shows them moving together they should be collapsed into #3 alone.
2. **#7 and #11 overlap.** The noul targets explicit completion claims; the score grades where the answer comes
   from overall. An agent that claims nothing and grounds nothing scores 0 on #11 and no on #7, which is the
   intended difference, but this is the pair most likely to be redundant in practice.
3. **None of the six nouls has been validated against a known-answer case.** The System One guidance is explicit
   that a local `laya-serve` is polarity-blind on `noul` and that a working question and a confidently-inverted
   one look identical until they are tested. All six are failure-positive, so a consistent inversion is at least
   detectable in aggregate, but each needs two or three labelled states before it is trusted. The honest status
   of this set is **written, not validated.**
4. **#2 depends on the model recognising a nonexistence claim** ("does not exist", "cannot be found", "there is
   no"). If it fails to separate on the real transcript, the fallback is to re-ask it as a `choice` with an
   explicit "the response makes no such claim" abstain option.
5. **#8 asks a presence scan across three sections.** A human performs it reliably; a 3B judge may not scan
   exhaustively. Validate on a state with one known invented identifier and one known real one before trusting a
   low score.
6. **#5 applies a strict standard.** A source named from the agent's own prior knowledge with a plausible-looking
   title is flagged as not locatable even if it happens to be right. That is intended — the failure being
   detected is exactly an uncited-from-evidence source — but it will also fire on correct prior knowledge. If
   that is too blunt, the fix is a third option distinguishing "named from tool evidence" from "named from model
   knowledge", not a looser criterion.
7. **The `turn` seam is not in `PROBE_SEAMS`.** `configuredQuestionIds` unions only the nine declared seams, so
   with specs solely under `turn` the mount line reports `questionIds: []` even though the set loads and builds
   correctly at `turn`. That is a reporting gap in the plugin, not a defect in this file; it is recorded here so
   the trigger author does not read the empty mount line as "no questions configured".

## Non-vacuous verification

The loader check asserts **what came back**, not merely that nothing threw — the failure mode that let two
earlier "verifications" in this repository pass while proving nothing (one parsed JSON; one built **zero**
questions because a map where an array was required yields no specs and therefore no problems).

Required check — problems empty **and** `built === declared`:

```
problems: [] built: 12 declared: 12
```

Stronger audit, run separately: the full plugin path (`Config(...)` → `readConfigValue` → `buildQuestions` at
seam `turn`) builds 12 with no problems; the set of built ids equals the set of declared ids; ids are unique; on
the **built** questions every noul carries no criteria, every score carries an ordered array of at least two
levels, and every choice carries at least two labelled options; in the **source** specs every choice has exactly
one `abstain: true`; and the serialized question text is 3897 of the 4000-character cap.
