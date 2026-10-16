# Which state may be given to the judge, and how it must be translated

Companion to `docs/question-suitability.md`. That file answers *which evidence groups a question needs*; this one
answers the layer under it: **which kinds of state the judge can be asked about at all, and what a state has to be
turned into before it is one.**

Written 2026-10-05. Every measured number below comes from a recorded experiment, and each is labelled with the
backend it was measured on — a threshold or an inversion does not transfer between servers.

---

## The law, and it is not "code is hard"

**The boundary is literal versus inferential, not code versus prose.** The same defect in the same function:

| question about the same buggy function | truth | P(true) | |
|---|---|---|---|
| the code uses the keyword `let` | TRUE | 0.95 | ✓ |
| `total` is initialised to 0 before the loop | TRUE | 0.86 | ✓ |
| **the loop condition should use `<` instead of `<=`** | TRUE | 0.85 | ✓ |
| the loop runs one more time than the array has elements | TRUE | 0.80 | ✓ |
| the loop reads an element outside the bounds of the array | TRUE | **0.17** | ✗ |
| the return statement divides a number by `values.length` | TRUE | **0.29** | ✗ |
| this code contains a bug | TRUE | **0.04** | ✗ |
| calling it with a non-empty array returns their correct arithmetic mean | **FALSE — it returns `NaN`** | **0.80** | ✗ *wrong* |

And against a **clean twin** the out-of-bounds question scored **0.25 — higher than on the broken code**. So that
question is not merely weak; it is *inverted*, and it would have made the system quietly worse while looking
reasonable in the source.

Three vendor failure modes predict it: **literal reading** ("answers the question you wrote, not the one you
meant"), **counting is unreliable** (an off-by-one *is* a counting error), **multi-hop indirection costs accuracy**
("reads out of bounds" is one hop of meaning past "the condition is `<=`"). And the corroborating absence: the
cookbook authors publish an *Automatic Code Review* recipe, and it reaches for a generative model, not this one.

Corollary that governs everything below: **the state must contain the subject of the proposition, and the
proposition must be one hop.** A confident answer from a state that lacks the subject is the failure
`docs/question-suitability.md` records — `session_claim_unsupported_by_tools: p=0.83` asked about tool output that
was not in view.

---

## The lattice

| state kind | directly feedable? | what it must be turned into | best primitive | measured / recorded evidence |
|---|---|---|---|---|
| **prose** (an operator message, an assistant reply, a markdown document) | **yes** — the native medium | nothing, but *one artifact per call* | `choice` with an abstain option, else `noul` | `noul` 0.857 / `choice` 0.733 / `score` 0.723 on `laya-typed-decisions`; the whole-document-in-one-call case measured **62%** against **40/40** one per call |
| **a localised code fact** (one token, one line, one condition) | **yes** | the exact location + the exact proposition; nothing left to infer | `noul`, or `choice` when the answer depends on the question's polarity | 0.81–0.95 above; the polarity-sensitive cases are where `choice` is required |
| **a whole file or module of code** | **no** | split into one proposition per site ("every `catch` rethrows" is N questions, or one counted in code) | — | "contains a bug" 0.04; "has a style problem" 0.001/0.000, no separation |
| **a diff / a hunk** | **only after localisation** | one hunk per call, with the claim stated as a token-level proposition ("the new condition uses `<=`") | `noul` | the same literal/inferential boundary; a diff is *not* a state until a claim is named |
| **workspace-change metrics** (files written, lines added, whether a path was touched) | **no — and it does not need to be** | counted in code from `fs/write-intent` / `fs/edit-intent` / `workspaceChanges`; the *count* is a number, the model is told the number | none | counting is a documented weakness; the observer already records the raw events |
| **tool traffic** (`tool/call` arguments, `tool/result` text) | **yes**, one call per item | the result of one tool, not a transcript of many | `choice` for a named outcome | the freeciv reading at p=0.83 from a state without them; 40 rows in one request broke a ranking gate that 1 row per call passed |
| **reasoning / thinking** | **not today** — dropped at both paths (`F79`) | nothing exists to translate; it is already text, and the only question is whether to include it | — | the drop is deliberate and pinned to one place (`session-format.js:85-90`) |
| **a session trajectory** (whole, or a run of exchanges) | **partly** — as prose, at the right scope | the trajectory, not a turn, when the question is about a sequence; `session_request_served` is answerable per exchange, `operator_kept_one_goal` is not | `choice`, judged per exchange and aggregated in code | six questions cannot be asked of one exchange at all; asked anyway they returned p=0.21–0.68 with **nothing in the output saying so** |
| **arithmetic, counts, dates** | **no** | compute in code and hand over the conclusion, or ask about the number the code produced | — | counting 33.3%, sequential state mutation 13.2%, arithmetic accuracy fell 88% → 57% purely from where the correct option was listed |

Two further gates that have nothing to do with the question:

* **language routing.** The same safety question scored 0.8997 in English, 0.6068 in French, **0.0136 in Chinese**;
  and `routing.detection.is_english` is the only field that says so. A non-English state must not be auto-cleared on
  score.
* **the server and the model revision.** `confidence` is computed differently on a local `laya-serve` (normalized
  entropy) than the vendor documents, `action.act_probability` is pinned at 1.0 there and measured AUROC 0.30, and
  `noul` is polarity-blind on a local laya while `choice` respects the option text. A threshold tuned on one backend
  is not a threshold on another — including the one this deployment routes to.

---

## Translating a workspace change (the worked case)

A change to the working tree is **not** a state. It becomes four different things, and only one of them is a
judgement:

1. **counts → code.** Files written, files edited, paths touched, lines added, turns since the last write. These are
   facts the harness already reports (`fs/write-intent`, `fs/edit-intent`, `workspaceChanges`) and the model should
   never be asked to produce them. "Six turns, no write-intent, 40k tokens" is arithmetic, and it is the whole of
   the *too-chatty / talk-without-code* feature.
2. **one localised claim → the judge.** A generative step (or a lint rule, or a checklist) names a candidate claim
   about a named place: *"the new condition uses `<=`"*, *"`parseConfig` guards against a missing `timeout`"*. Ask
   **that** proposition, of **that** hunk, one per call.
3. **structural claims → split.** "Every `catch` block logs before rethrowing" is a loop plus N questions, or a code
   count. `score` is the weakest primitive (0.723) and the wrong tool for "how good is this change".
4. **verdicts → not this instrument.** "Review this", "find the bug", "is this correct", "what is wrong here".
   The working pattern is **localise with a generative model, verify one named proposition here.**

The projection matters as much as the question: the harness itself does this for non-text attachments — request
assembly projects every image or file occurrence into deterministic handle text and keeps the structured reference
in the log. A diff should be projected the same way: **deterministic text, the claim named, the location named, the
distractors excluded.**

---

## What "with enough confidence" can and cannot mean

* **There is no global confidence ceiling, and `confidence` is not accuracy.** For a `choice`, the vendor's
  `confidence` is a closed form of the top probability, so gating on it is gating on `p_max`; on a local laya it is
  normalized entropy and lands ~0.2 away from the documented value.
* **The only currency is measured separation on labelled cases, per question, per backend, per language.**
  A question is trustworthy when a battery says so — and the test recipe is fixed:
  1. take a real case and hand-write its **counterpart** (the clean twin of a buggy snippet, the corrected reply of
     a bad one);
  2. ask the question of **both**;
  3. the case that should score higher **must** score higher, with a margin you would actually gate on — otherwise the
     question is inverted or empty, and you fix the **phrasing**, not the threshold;
  4. repeat on a second case, so you are not fitting one example;
  5. only then set a threshold, in the gap you measured.
* **A question that cannot be made to separate should move to code or to a generative model** — not be tuned. A
  threshold only moves the line; both cases are already on the wrong side of an inversion.
* **Therefore every reading should carry the facts that say whether it may be trusted**: the set's identity, the
  evidence groups actually present, the state size and truncation, the backend's `routing`, and the battery result
  behind the question. Without them, "confident" and "correct" are indistinguishable in the record.

---

## The one thing to add to the spec

`docs/question-suitability.md` already proposes that a question **declare its evidence** and that the tool **refuse**
when the selection lacks it. This file adds the sibling declaration, because the subject can be present and still be
in the wrong *form*:

```json
{ "id": "diff_uses_lte",
  "type": "noul",
  "evidence":    { "groups": ["G1"], "scope": "exchange" },
  "stateForm":   { "kind": "code", "localised": true, "oneItemPerCall": true },
  "instructions": "The new condition uses `<=` rather than `<`." }
```

and the same rule: a question whose `stateForm` the selection cannot supply is **refused, naming what was missing** —
never answered. The measured reason is in the first section: the confident answer from an absent subject is
indistinguishable, in the record, from a real reading.
