# Roadmap — from a seam observer to a question-set engine

**Status:** direction agreed with the operator. **Part of it is built as of 2026-10-03** -- this line said "nothing in
P1+ is built yet" while the sets themselves came into existence, which is the kind of stale claim this repository
exists to catch:

- **Built:** question sets as versioned artifacts (`criteria/`, one directory per composition, one file per scope, a
  `_manifest.json` declaring what each is for, selected by name and identified by content hash on the mount line); the
  three state scopes (`seam`, `turn`, `session`) with all three declared in the schema; self-authored sets and their
  rationales; the stored-session subject, whole or sliced; the trace read back (§10.3's measurements layer).
- **Not built:** the loop §1 describes -- evaluate, read the result, **rewrite the set**, re-evaluate. No set here has
  been rewritten because of a measurement yet, which is the only thing that makes this a question-set *engine*. Also
  open: criteria as a named reusable dictionary, labelled-case scoring (kappa, reliability bins) as a gate before a
  set reaches a context, and the act layer (§9).

---

## 1. Where this is going

The observer today asks **one question per call** at nine seams and records what happened. The direction is
different in kind, not degree:

| | now | direction |
|---|---|---|
| unit of work | a question | **a question set** `S = {Q1…Qn}` |
| target | one seam's text (`probeText`, hard-coded) | **`X`**, an artifact assembled from a named source: a seam, a turn, the operator's messages, the agent's messages, the trace, or a file — see §9.6 |
| questions | authored in config, one per seam | `S1, S2, …SN` as **versioned artifacts**, loaded and swapped at runtime |
| criteria | prose inline in each question | **named, reusable** entries in a dictionary |
| the loop | a human reads the trace | evaluate → read the result `R` → **rewrite `S`** → re-evaluate |
| mutation | a config edit | variants of question text and choice-option sets, as **first-class, measurable** changes |

The vehicle stays a DSH plugin, because the seams, the trace, the card, the session scope and the peer bridge
already exist here and none of them exist in a bare library. That is convenience, and §6 is where it becomes a
constraint worth revisiting.

## 2. What already exists — do not build it

Researched before designing, and most of it is already done by someone else.

**Aggregators** (the thing to read first, and to keep reading):
[`ckaraca/awesome-jev`](https://github.com/ckaraca/awesome-jev) ·
[`wh000wh000/awesome-jev-live`](https://github.com/wh000wh000/awesome-jev-live) — *evidence-graded* index across
20 languages, **rebuilt every two hours**, with a section of **73** evaluation/calibration/benchmark entries and a
summary of the model's own known limits (counting unreliable, multi-level indirection weak, nine classes of
jaggedness, *"schema-valid output is not the same as a correct decision — calibrate on your own data"*).

**Question sets are already an artifact.** This is the convention to adopt rather than invent:

- `chr-kelly/jev-cookbook/recipes/_TEMPLATE` + seven recipes (`content-qa`, `context-pruning`,
  `customer-support-routing`, `llm-router`, `roleplay-state`, …)
- `nexibeo/jev-cookbook/recipes/01-support-triage` … eight numbered recipes
- `laguagu/jev-skills/examples/decisions/requests/*.json` — `{model, state, questions}`, six of them
- [`Anil-matcha/awesome-jev-by-typesafe`](https://github.com/Anil-matcha/awesome-jev-by-typesafe) (886★) —
  use cases, patterns, **prompts** and starter code

**Evaluation machinery:**

| what | where |
|---|---|
| official workflow evals | [evals.typesafe.ai](https://evals.typesafe.ai/) · [typesafe-ai/WorkflowEvals](https://github.com/typesafe-ai/WorkflowEvals) |
| a measured batching study (13 questions, std dev by repeat) | the [parallel-questions cookbook](https://docs.typesafe.ai/cookbooks/parallel_questions.md) |
| an **evaluation agent** | [`vinilana/jev-eval-agent`](https://github.com/vinilana/jev-eval-agent) (106★) — `agent/` + `eval-results/` |
| **task-success evaluation of a session** | [`Asymptote-Labs/agent-beacon`](https://github.com/Asymptote-Labs/agent-beacon) (1.6k★) — "uses Jev to evaluate task success, reusable lessons, and supporting evidence" |
| set selection by a decision model | [`EliaAlberti/jev-rules`](https://github.com/EliaAlberti/jev-rules) — Jev picks which rules apply to a prompt |
| a harness shaped like ours | [`PromtEngineer/jev-harness`](https://github.com/PromtEngineer/jev-harness) — router, context picker, gate, verifier |
| SDK-level typed evaluation | [`vercel/ai`](https://github.com/vercel/ai) (27k★) · [`agentjido/req_llm`](https://github.com/agentjido/req_llm) · [`ash-project/ash_ai`](https://github.com/ash-project/ash_ai) · [`donvito/ai-backends`](https://github.com/donvito/ai-backends) · `ai-cli`'s `ai evaluate` |

**What does *not* appear to exist**, and is therefore our actual gap: a per-type **builder library with a
criteria dictionary**, and a **set-level mutation/versioning primitive**. Both are small. Everything else —
loading, evaluating, comparing, even the evaluation agent — exists.

## 3. What our code already has, so the gap is smaller than it looks

- `lib/model/questions.js` **already exports `choice`, `noul`, `score`** as separate builders, each validating its
  own shape (a choice needs ≥2 options and **exactly one** abstain; a score needs ≥2 ordered levels; a noul's
  criteria are optional). The per-type separation asked for in the brief is largely already there — as functions
  rather than classes, which is the right call for a package with two runtime dependencies.
- `lib/questions.js` **already builds a set** per seam (`buildQuestions` → a map keyed by question id) with a
  character cap that **refuses rather than truncates** (`capQuestions`).
- The trace already records `questionIds` per run, and the comparability key already treats a changed question
  set as a **different experiment**.
- `probeScore` is already the thing the cookbook repos also ship: an accuracy/κ/calibration harness with
  known-answer cases.

**Missing:** the set as a *loadable, versioned artifact*; criteria as *data*; the recursive loop.

## 4. The design

1. **`S` is a file.** Adopt the ecosystem's shape verbatim — `{ id, version, state, questions }` — so a set is
   portable between this plugin and anyone else's harness. No bespoke format.
2. **A criteria dictionary.** `criteria/*.json` holding named choice-option sets and score-level ladders, so a
   question references criteria by name instead of restating prose. This is the piece that makes sets
   *comparable*: two questions sharing a criteria name are measuring the same thing by construction.
3. **Builders, extended not replaced.** Keep `choice`/`noul`/`score`; add criteria resolution by name, and a
   `buildSet` that validates a whole `S` (unique ids, one abstain per choice, ordered levels, the char cap).
4. **A registry and loader.** `S1…SN` addressed by `id@version`, selected at runtime, and **recorded on the
   trace** so a judgement is attributable to the set version that produced it.
5. **Mutation stays measurable.** Because `questions` is part of the comparability key, a mutated set is a
   different experiment by construction and cannot silently pool its results with the original. The mutation
   loop gets its scoreboard for free.
6. **The recursive loop needs a frozen reference.** `R` → rewrite `S` is only meaningful if acceptance is
   judged against cases whose answers cannot move. The probe already is one: 3,370 labelled calls with a
   published κ. **A rewrite is accepted only if it improves on the frozen reference** — otherwise the loop is
   unfalsifiable, and §7 explains why that is the whole risk.

## 5. Phases

| phase | deliverable | why here |
|---|---|---|
| **P0 — done** | the seam instrument, the trace, one question per call, probe accuracy 88.99% / κ 0.8374, calibration (ECE, bins, bias, Brier) | the measuring apparatus exists and is verified |
| **P1** | **at least two questions per call**, and `S` as a file | smallest change with the largest measured gain: batching cost us *no* latency (190 vs 204 ms median) and +55% tokens for 5× the questions |
| **P2** | criteria dictionary, set registry, `id@version` provenance on the trace | makes sets comparable and mutations attributable |
| **P3** | session/turn targets `T` (§1) and a helpfulness gauge set | the operator's stated use: judging whether a model, or a review, actually helped. Constraint in §7 |
| **P4** | the recursive rewrite loop, gated on the frozen reference | last, because it is the only phase that can degrade the thing measuring it |
| **P5** | decide the vehicle: stay a plugin, or extract sets + criteria + eval into a package other harnesses can consume | the ecosystem is in libraries (`vercel/ai`, the cookbooks, the eval agent); a DSH-only engine reaches DSH only |

## 6. Why the vehicle question is real

A DSH plugin buys seams, tracing, a card, session scope, and the peer bridge — none of which a library gets. What
it costs: the question-set engine is then only usable by DSH, while every comparable project in §2 is a library,
an SDK integration, or a cookbook anyone can run. **P5 is a genuine fork, not a formality**, and the cheap hedge
is to keep `S`, the criteria dictionary and the evaluator free of any DSH import from P1 onward.

## 7. Risks, stated from this project's own record

- **The ruler that grades the ruler.** This session produced a catalogue of *the check passes while the property
  is false* — nine shapes, five found in this repository. A self-modifying question set **industrialises that
  failure mode**. §4.6 is the mitigation and it is not optional.
- **Our review history argues for measuring, not asserting.** Two independent reviewers produced five real
  defects and also **five confident claims that a single command refuted**. A rewrite loop built on claims
  rather than measurements will accept its own mistakes.
- **Context shape.** Many questions × **one** document is the recommended and measured-good case. Many
  *documents or rows* in one state is the case that breaks (a documented ranking collapse at 40 rows). So
  "gauge five sessions" must be **five calls with many questions each**, never one call with five transcripts.
- **Egress.** Every judged draft leaves this machine (documented in the profile comment: the judge is a hosted
  third party). An open-weight Jev-compatible model is listed in the aggregator and would remove the constraint;
  it interacts with a question-set engine that may process far more text than today's seams.
- **Provenance is thin on this deployment.** The server returned **no `routing` field in 4,369 calls**, so the
  language-detection guard the vendor guidance depends on **cannot be applied here**. A set whose questions are
  written in English and answered against non-English targets would fail silently.

## 8. What the local research report settles — and one thing it contradicts

`system1-runtime/docs/DECISION_MODEL_RESEARCH.md` (671 lines, read after the roadmap was first written). It changes
four decisions and opens one conflict.

**Settles:**

1. **Temperature fitting belongs in P2.** Laya ships over-confident and *"refitting one temperature per
   (question type, option count) moves mean ECE 0.466 → 0.081"*. We measure ECE and bias but fit nothing. A
   per-(type, option-count) temperature, reported alongside the raw figures, is the cheapest calibration win
   available and it is one function in `lib/calibrate.js`.
2. **The criteria dictionary is not cosmetic.** The largest measured lever in the independent audit corpus is
   *criteria rewrites: paired accuracy 70% → 96%, 83% → 100%*. §4.2 is therefore the highest-value part of P2,
   not bookkeeping.
3. **Our abstain rule is validated from the outside.** *"Removing the abstain option took KoBBQ accuracy from
   0.950 to 0.000 and ECE from 0.023 to 0.793"*, and without a `none` option *"0 of 30 out-of-scope inputs were
   flagged"*. Our `choice` builder **refuses** a question that does not have exactly one abstain. Keep that.
4. **Context rot is sharper than §7 states.** The rule is not "documents bad, questions good". It is:
   **rot bites when the question must LOCALISE a specific item inside a large state.** 40 Korean sentences judged
   one-per-call: 40/40. The same 40 in one call: 62%. Forty rows broke a ranking gate that one row per call
   passed. Whereas a 54,000-character document answered 13 whole-document questions identically batched or not.
   So P3's session target must ask **whole-session** questions ("did this model help?") and must **not** ask
   localising ones ("which step failed?") over a whole transcript — that one needs a per-segment call.
5. **`confidence` is a spread statistic, not P(correct)** — the vendor states it, Kev repeats it, an independent
   pre-registered test found it, and it is why "don't carry a threshold tuned on a Noul over to a Choice" exists.
   Our calibration figures must say which scalar they are over; they now say it for the right reason.

**Contradicts, and this one is open:**

> Independent audits report **"Noul under-confident, Choice and Score over-confident on the same inputs"** —
> while our 10-option seam probe measures `bias = −0.1242`, i.e. **Choice under-confident**, on 3,370 calls.

Both cannot be general. Candidate explanations, none verified: our "truth" is the seam an event came from, not a
human label, so our accuracy is *agreement with our own seam mapping* rather than task accuracy; high-cardinality
choice is where the research says this family is strongest; and our option labels are long descriptive names,
which the audit says matters a lot. **This is the sharpest open question in the project** and it is the first
thing to put to the papers session, because if our probe is measuring something other than calibration, the
headline number in the README is measuring something other than what it says.

**Also worth carrying:** vendor benchmarks (61.7–76.0% across four workflows) use ground truth that is *"an
average of the responses of GPT-6 Astra and Claude Fable 5.1, both at high thinking"* — not human labels; and the
model is **not** claimed to be deterministic (*"std 0.001 to 0.015, 15 distinct answer sets in 50 identical
requests"*), which is the scale our repeat-and-compare work should expect.

## 9. P3 — the act layer, as its own component

The operator's framing: this repository is **measurement only on purpose** — *"without sound measurement as basis
acting is groundless"* — and that posture is not a comment but a source scan. The fork is now agreed: build the act
layer on top, in this repository, as **its own component**.

### 9.1 What a "component" is, because the decision depends on it

The Plugins page lists **loader rows**. `plugin_manager list_plugins` returns exactly that list, one object per
row, with `entryId`, `moduleName`, `enabled`, and `fiberPhase`. So:

| observation | meaning |
|---|---|
| `dsh-system1` shows 3 components | it contributes 3 rows: `system1`, `system1-typesafe`, `system1-laya` |
| `system1-bridge` shows 2, one "not running" | its provider row and its tool row; **"not running" is `fiberPhase: null`**, which is the failed-import state |
| a component can be switched off in the UI | the row's `enabled` flag — the mechanism the operator wants |

**So the act layer becomes its own row**, and "a user can switch off act" needs no UI work at all: it is the
existing per-row toggle. That is the answer to *"shall the second package be the second component"* — the row is
the togglable unit and the package is the code boundary, and the design needs both: **one bundle, two rows, the
act row's code in its own package.**

### 9.2 What the act row is

| | observer row | act row |
|---|---|---|
| reads | the loop's seams | a question-set artifact + the operator's message |
| writes | a JSONL trace | a bounded `systemPrompt` context |
| capabilities | `prompt-section` **forbidden** | `prompt-section` **allowed** |
| still forbidden | — | `approval-answer`, `tool-argument-rewrite`, `context-prune`, `model-route` |

The last row matters: the act layer **informs**, it does not decide. It may put a reading in front of the agent;
it may not answer an approval, rewrite a tool argument, prune a context or choose a model.

**It calls through the repository's own functions** (`lib/model/*` — the same `createModel`/`postSystemone` path
the observer uses), not through `system1_decide`. `system1_decide` is the *agent-facing* tool; the act row is
plugin code and should use the plugin's own client, so both layers are measured by the same instrument and
versioned together.

### 9.3 The gate has to widen first

`test/honesty.test.js` scans **two files**:

```js
for (const file of ['index.js', 'client.js']) { assert.deepEqual(capabilitiesIn(source), [], …) }
```

The code that touches seams lives in `lib/`. A `systemPrompt.context(` call in `lib/` would not be caught — so the
guarantee is narrower than it reads, and it gets narrower still the moment a second row shares the tree.
**P3's first task is to widen the scan to every source file, per package**, before any act code exists. Otherwise
"measurement only" becomes a claim about two files.

### 9.4 The acceptance gate: shadow mode

The act row ships **off by default** and its first release **injects nothing**. It computes the reading at
`admit`, records it to the observer's trace — including that it *would* have injected — and stops. Then the
observer answers the only question that matters:

> for messages where the reading said X, did the handling differ from what the operator wanted?

Cheap behavioural ground truth already exists and costs nothing: **did the operator correct the agent in their
next message, re-ask, or accept?** And the labelled route is available too — `probeScore` already scores a
question set against known-answer cases with a floor, κ and reliability bins, so a set drawn from the operator's
own message history can be tested for separation *before* it is allowed into a context.

**If a question cannot separate on labelled data, injecting it can only add noise.** That gate is the whole point
of building act inside a measurement repository.

### 9.5 The urgent gap: criteria and question sets

Sourcing beats building here, and the search found one tool that is strikingly aligned:

- [**hermes-labs-ai/hermes-rubric**](https://github.com/hermes-labs-ai/hermes-rubric) (Apache-2.0, on PyPI,
  pushed 2026-09-29) — *"turns an artifact into cited evidence, dimension scores, honest coverage facts, and
  caller-controlled feedback. **It measures and explains; your application decides what to do next.**"* That is
  this repository's posture, in Python: it **synthesizes a rubric**, scores only against quoted evidence, and
  hedges on thin evidence. It ships a Copilot/agent **skill** as well as a package.
- The structural template for evaluating a set:
  [`chr-kelly/jev-cookbook`](https://github.com/chr-kelly/jev-cookbook) — `recipes/_TEMPLATE` (7 recipes,
  including `agent-tool-guardrail`), plus `eval/` with `benchmarks`, `data`, `lint.py`, `run_eval.py`, `results`.
- More aggregators than the two in §2: [`AbdelStark/awesome-typesafe-jev`](https://github.com/AbdelStark/awesome-typesafe-jev),
  [`Amal-David/awesome-jev`](https://github.com/Amal-David/awesome-jev).

**The three pieces already exist; the missing work is the joint between them:**

    hermes-rubric  --synthesizes-->  criteria (dimensions + level descriptions)
    our builders   --compile----->   a question set artifact (score/noul/choice over those criteria)
    the observer   --measures---->   does the set separate, on labelled cases, before it is injected

Converting a rubric dimension into a Jev question is mechanical and worth doing once: a graded dimension becomes a
`score` whose `criteria` are the level descriptions, a yes/no dimension becomes a `noul`, a categorical one a
`choice` with exactly one abstain. **That converter is the immediate deliverable**, together with a `criteria/`
dictionary the sets reference by name so two questions sharing a criterion are comparable by construction.

### 9.6 X — the target artifact, and why it is not "your message"

The act row does not read *the operator's message*. It reads **`S` against `X`**, where `X` is an artifact in its
own right:

| | what it is | where it comes from |
|---|---|---|
| `S` | a question-set artifact | §9.5 |
| **`X`** | **the target: one artifact the questions are about** | **assembled from a named source** |

The observer already has an `X` — it is hard-coded. `probeText(seam, args, decision)` is "the text at the seam that
just fired", and that is the only target it can ever have. The act layer makes that target **explicit,
configurable, and composable**, which is the whole difference.

#### The sources, and what already reads them

| source | assembly | already implemented by |
|---|---|---|
| a **seam's** text | one seam firing | `probeText(seam, …)` in `lib/seams.js` |
| a **turn** | admit-boundary segmentation | the `turns` reconstruction in `lib/cost.js` |
| **operator** messages | session events where the role is user | `agent.session.snapshotEvents(sinceSeq)`, filtered — the peer bridge does exactly this |
| **agent** messages | session events where the role is assistant | same call, other filter |
| the **trace** | the measurement view: what was asked, answered, by which model, at what cost | `readTraceWindow` + `traceData` in `lib/trace-report.js` / `lib/trace-data.js` |
| **something else** | a file, a diff, a tool result | new, last |

So `X` is not a subsystem. It is the same readers this repository and the peer bridge already use, with the
target promoted from a constant to a value:

```json
{ "id": "last-turn-exchange", "source": "session", "roles": ["assistant", "user"],
  "take": "last-turn", "budget": { "maxChars": 8000 } }
```

#### Four constraints, each from a measurement rather than from taste

1. **One `X` per call.** The audit corpus is blunt: 40 Korean sentences judged **40/40 correct one per call** and
   **62%** with the whole document in one call, and 40 rows broke a ranking gate that one row per call passed.
2. **Therefore: whole-artifact questions only.** If a question must LOCALISE something -- *which step failed?* --
   then `X` is one item and the questions run per item, as N calls. A 54,000-character document answered 13
   whole-document questions identically batched or not.
3. **`X` is paid once per call.** Five questions cost the same wall time as one and +55% tokens, so `X` should be
   as large as the questions need and no larger.
4. **`X` leaves the machine.** The judge is hosted, so `X` goes through the same `redactPolicy` and `cutHeadTail`
   the trace copy uses, and its truncation is recorded rather than silent.

#### What `X` means for the helpfulness use case, which is the reason this matters

**For helpfulness, `X` must be the EXCHANGE, not the message.** The signal is not in what the operator asked; it
is in the operator's **reaction to what the agent delivered** -- corrected, re-asked, or accepted. A set that asks
*"did this response help?"* over an `X` containing only the request cannot see the evidence it is judging: the
response and the reaction are both required.

```
X = { source: session, roles: [assistant, user], take: last-turn }   // my response, and your answer to it
```

That is also the cheapest ground truth available, and it needs no labelling.

#### And the trace as an `X` is what closes the loop

One of the sources is **the measurement itself**. Read the trace as `X` and the question set is asking *about the
judge's own record* -- which is exactly the input a recursive rewrite of `S` needs (the operator's point 13):
evaluate → read `R` → rewrite `S`. `X = trace` **is** `R`. So the same selector that serves the briefer serves the
self-modification loop, and neither needs a new reader.

#### Provenance: `X` belongs on the call line, not in the run key

`S` defines the experiment, so `questions`/`hooks`/`switches`/`instrument` belong in the run's comparability key.
`X` **varies per call** -- a different turn, a different seam -- so it belongs beside `hook` and `subject` on the
call line: an `xId`, an `xHash`, and the truncation, so a judgement is attributable to the target it was about.

### 9.7 `X` is `state`, and the abort signals belong in it

**`X` is the TypeSafe `state` field: it can be anything.** The source table in §9.6 is a set of *assembly helpers*
for the common cases, not a schema. A caller may hand `X` a literal -- a diff, a paragraph, a JSON object -- and
the selector form is only there for the targets that are tedious to assemble by hand. Keep a literal path open, or
the convenience becomes the constraint.

**And the operator's cancellations are the cheapest ground truth in the system.** Not inferred from a later
message: direct. Checked against the installed Event catalogue (`Event.listEvents`), so these are the real names:

| the signal | where it actually lives |
|---|---|
| **skipped or closed a question box** | **`user-questions/request`** -- a waterfall returning `AskUserQuestionAnswer`; the outcome carries whether it was answered, cancelled or skipped |
| **explicit feedback** | **`feedback/committed`** -- *"observe a durable cold feedback mutation"*. The strongest signal available, and it arrives already durable |
| pressed stop / interrupted | **the `AbortSignal`** carried on `agent/pre-step`, `agent/request` and `agent/turn-stopping`. There is **no dedicated "user pressed stop" event**; the abort is the signal, and the resulting state change is reported separately by `agent/status` (`idle` ⇄ `running`) and `api-session/status` |
| a message thrown away | `agent/inbox/discarded` -- *"one message was discarded from the live inbox"* |
| denied a tool | `tools/pre-execute` -- *"allow, deny, cancel, or ask before dispatch"* |
| denied an approval | `approval/request` -- the outcome, not just the request |
| a workflow stopped | `workflow/end` -- settled *"any stop reason"* |

**The split of work follows the repository's own division.** Recording these is *observation*, so it belongs in the
**observer** -- it is already an event-listening plugin, and a signal line on the trace is the same kind of fact as
a `skip` line. Consuming them is *action*, so it belongs in the **act row**, which reads them as part of `X`:

    the observer records what the operator did          (measurement)
    X = { source: trace, include: [signals, exchange] } (the act row's target)
    S asks whether the response helped                  (the question set)

Which also gives the helpfulness set its ground truth for free: **a closed question box and a corrected answer are
both labels**, and neither needs a human to annotate anything.

One caution, from this repository's own catalogue: the *absence* of a stop is not evidence that the response
helped. An operator who simply moves on is the common case and is indistinguishable from one who was satisfied
enough not to say so. These signals are strong when present and silent when absent -- so a set that treats them as
a balanced label will be wrong in the direction that flatters the agent.

## 10. The turn trigger, and where a question set lives

### 10.1 The corrected diagnosis, because it narrows the set

Looking closer at the "test session" trajectory, the tool list that 3B produced came from a **system message the
harness adds** -- it reported its tools faithfully. My earlier reading ("it answered *about* tools instead of using
them") was unfair, and the correction matters because it changes what `S` has to ask.

Two facts that follow, and both argue for an external judgement rather than a longer prompt:

- **The model exposes no thinking blocks.** We cannot see how it decided. The only observable thing is the state it
  produced: what it said, what it called, what came back. So the question is not "what did it think" but **"is the
  request satisfied, or does the search need another iteration"** -- a predicate over the observable.
- **The real gap is that it did not iterate its own queries.** One search, no result, then advice. That is one
  predicate, not a general confusion, and the whole of turn 7's nudge is that predicate.

### 10.2 The trigger: every N turns, compose `X`, ask `S`

This is **measurement**, not action -- it reads and writes only the trace -- so it belongs in the observer, beside
the seam calls.

| | |
|---|---|
| **when** | every N turn boundaries, where a turn boundary is the `admit` event the observer already receives |
| **`X`** | composed for the window: the operator's messages, the agent's messages, **and the tool calls with their results** |
| **`S`** | a question-set artifact, §9.5 |
| **where it lands** | a trace line with a **new `hook` value** -- `turn` -- so a scheduled measurement is never confused with a seam measurement |
| **default** | **off.** It sends conversation to a hosted judge on a schedule, which is a different consent from observing a seam |

Two requirements that are easy to miss and would each be a defect:

1. **The probe scorer must tolerate a non-seam hook.** `probeAnswerOf` maps `hook` through `SEAM_OF_LABEL`; `turn`
   has no seam, so `expected` is `null`. That must leave the probe's calibration *unchanged* -- excluded, not
   counted as unreadable -- and it needs a test, because silently inflating `unreadable` would corrupt a published
   figure.
2. **`X` composition must reach tool calls**, which the peer bridge's transcript reader does not: it collects text
   blocks and reports `[+N non-text block(s)]` for everything else. A turn window without the tool calls is not the
   state the agent was actually in.

### 10.3 Where the questions live, and why not PostgreSQL yet

Three layers, and the right choice differs for each.

| layer | choice | why |
|---|---|---|
| **authoring** sets and criteria | **files in git, JSON** | the ecosystem's own convention (`requests/*.json`, `recipes/`); they diff, they review, they ship with the plugin; and a set needs a **content hash as its version**, which a file gives for free |
| **measurements** | **the JSONL trace stays authoritative** | 7.3 MB / 20,450 lines today; rotation, 0600, redaction and the auditable `rotate` line already exist. A second store would be a second privacy posture for data that already has one |
| **the analytical index** | **`node:sqlite`, derived and disposable** | measured available on this runtime (`DatabaseSync`, `StatementSync`, …) and **in the standard library**, so it costs no dependency. It answers cross-run questions -- *which set separated best across 50k calls?* -- and can be deleted and rebuilt from the trace at any time |

**PostgreSQL: not yet, and the reason is distribution rather than capability.** A server is listening on 5432, so it
is there to be used. But this plugin is installed by other people with `dsh plugin add`, and requiring a running
Postgres makes it uninstallable for exactly the audience it has; it also breaks a dependency posture the README
advertises as *two dependencies, nothing else*, and adds a second surface for conversation-derived data.

**When it becomes right:** when measurements must be shared across machines, sessions or teams -- concurrent
writers, many consumers of a financial-parsing corpus, or analytical queries past what SQLite does comfortably.
**And the migration is cheap precisely because the source of truth is files plus JSONL**: it is an ETL, not a
rewrite. That is the argument for deferring -- choose the store last, and keep the source portable so the choice
stays reversible.

One caveat on the SQLite route, stated rather than buried: `node:sqlite` is **experimental** and prints a warning
on use. That is a real trade against a stable third-party driver, and it should be a deliberate decision with a
version guard rather than a convenience.

## 11. Model-conditioned nudging, and the plugin's own tools

### 11.1 A question set is per-MODEL, and the trace already knows which model

The operator's point: someone has probably published family- and size-specific weakness measurements, so nudges can
be chosen per model rather than written once. The search says yes, and per-model breakdowns exist for exactly our
subject class -- [metamorphic testing of tool-calling agents](https://cbsoft.sbc.org.br/2026/data/papers/sast/When%20the%20Trigger%20Fails%20Metamorphic%20Testing%20of%20Tool-Calling%20AI%20Agents.pdf)
distributes 600 invocations **per model** by failure mode, and
[constrained decoding in small LLMs](https://browse-export.arxiv.org/pdf/2609.23742) finds failure classes that are
**scale-dependent**. (Read from search results, not from the papers themselves -- treat as a lead, not a finding.)

**The routing key is already in our trace.** `subject` records which model wrote the text being judged -- added so
that an accuracy figure measured against one model's output would not be assumed to transfer to another's. That is
the same field that should **select the nudge set**: a 3B that stops at a null result needs
`gave_up_after_null_result`; a frontier model that over-claims needs `claims_match_evidence`. The provenance was
built for measurement and turns out to be the addressing scheme for action.

So a set carries an applicability clause, and `S` is chosen by matching it against `subject`:

```
{ "id": "agent-helpfulness", "version": 1,
  "appliesTo": { "subject.model": ["mistralai/ministral-3b*"] } }   // absent = applies to any model
```

And the nudge is a **template per detected failure**, not per model. The model determines *which* questions are worth
asking; the failure determines *what the agent is told*:

| detected | the nudge written back into the agent's context |
|---|---|
| `gave_up_after_null_result` | a search returning nothing means the keywords were wrong. Try at least three different phrasings before concluding. |
| `operator_had_to_nudge` | the operator has asked this once already. Do not restate it; act on it. |
| `claims_match_evidence` | state only what a tool result shows; mark anything else as unverified. |
| `citations_are_locatable` | name the exact source, not its title. Check that the address opens the thing it names. |
| `satisfied_by_action` | answer it by doing it, not by describing how it could be done. |

Both known good nudges in this repository's history are **directions, not numbers**: the operator's turn-7 message
that finally worked, and the explicit method given to the 3B that made it iterate four times where it had previously
searched once. A probability in the context does not produce that. **The threshold-to-instruction conversion is the
act layer's whole job.**

### 11.2 The plugin's own tools

The operator wants this repository to expose agent tools rather than depend on `system1-bridge`. Two, and they are
different in kind:

**(a) `system1_decide`, owned by this repository.** It is a thin tool over `lib/model/client.js` plus
`lib/questions.js` -- the same calling path the observer uses -- so the plugin's own instrument and its own tool are
versioned together. The bridge's row then becomes unnecessary here.

> **A NAME COLLISION IS THE FIRST HAZARD.** Two tools called `system1_decide` mounted in one profile is not a
> conflict the loader reports; it is a registry with two entries of the same name, and which one answers is not
> something the caller controls. Mounting this one means **disabling `system1-bridge-tool` in the same change**, and
> the trace should record which tool served a call.

**(b) A tool to adjust the plugin's own settings on the fly.** Seams on or off, which set for which seam, sampling
rate, and reading the current config.

> **AND THE SECOND HAZARD IS THE ONE THAT MATTERS: AN INSTRUMENT THE OBSERVED AGENT CAN RECONFIGURE IS A WEAKER
> INSTRUMENT.** The agent whose helpfulness is being measured is the agent holding this tool. That is not a reason
> to refuse it -- the operator asked for it, and it is genuinely useful -- but it must be built so the measurement
> cannot be quietly improved by the measured:
>
> - **reads are free; writes are recorded.** Every write emits a config event on the trace, so a run is attributable
>   to a configuration state and a discontinuity is visible rather than inferred.
> - **a write cannot be silent.** Turning a seam off is a recorded fact, not an absence of data. Our own `skip` lines
>   already work this way, which is why the 100 unjudged tool seams were findable instead of invisible.
> - **`sessions` and the trace path are operator-only.** The agent may retune what is measured; it may not change
>   *whose* behaviour is measured or where the record goes.

### 11.3 The set: self-authored, because the corpus is guardrail-shaped

`criteria/helpfulness-set@1/turn.json` -- 9 questions (7 noul, 2 score), written from observed failures rather than
adapted from a published rubric, with the rationale per question in `helpfulness-set@1.md`. It complies with the
shapes this repository already enforces, and the file validates. **It is written, not validated**: nothing has been
scored against labelled cases, which is the gate before anything reaches an agent's context.

**Build `operator_had_to_nudge` first.** It is the only question in the set with an **independent** answer -- the
observer already records the operator's next message, so the model's judgement can be checked against a label nobody
asked it for. Every other question depends on the model being right about its own call; this one does not, which makes
it the cheapest real calibration available in this project.

## 12. The pair, the harness, and what the measurement is finally for

SS9-S11 establish that the unit of work is a set and that a set can be conditioned on a model. This section is the
operator's next step, recorded 2026-10-03, and it moves the unit of attention off the model entirely.

### 12.1 It takes two

`Operator:` *"It takes two for a conversation. Human should also user specific question sets. User A is different
from User B. More broadly, the pair User A + LLM A worth attention. Some users have better interaction the others."*

That contains two questions that must not be conflated:

1. **How good is this person's input?** The `admit` scope, judged by the `human-input-clarity` compositions, with
   `appliesTo.user` letting a composition be written for one operator's characteristic failure.
2. **Does this pair fit?** A `session`-scope set asking whether this operator's style elicited this model's weak
   behaviour. Answerable, because `SESSION TRANSCRIPT` labels both sides.

**Half of the pair is already in the comparability key:** `instrument` carries the model (`lib/compare.js`), so LLM A
and LLM B are already distinguishable. The person is not, and the missing piece is a **declared** label hashed onto
the line (`userHash`), recorded exactly as `stateHash` is -- never a raw id, because a person's identity is a fact
about them on a durable record, and this repository's rule is already that the model's copy stays raw while the record
is redacted.

**The tension that decides the design, and it is the operator's to settle:** a user-specific set and a cross-user
comparison are **mutually exclusive**. If User A's messages are judged by different questions than User B's, then "A
interacts better than B" is not measurable -- two numbers from two different questions. So a comparison needs one
**common** set, and a tailored set is read alone.

### 12.2 The harness axis, which the key does not carry

`Operator:` *"A practical approach for actually task a specific LLM involve prompting/steering/loop/harness
techniques, with the knowledge from task specific benchmark results."*

Those are the levers, and **none of them is in `instrument`**: two runs under different system prompts or different
loop policies are treated as the same instrument today while being different treatments. That is a confound sitting
under every pair-level claim, and it is the largest structural gap this section records.

It must be **declared, never inferred**. The plugin sees the assembled prompt, but that text contains the operator's
request as well as the harness, so hashing it would confound the subject with the treatment. So an
operator-declared label, hashed onto the line as `harnessHash`, beside `userHash`.

### 12.3 Benchmarks predict the model; only the harness is left

`Operator:` *"Each LLM have went through a lot of benmarking, the details of those evaluation reveals
strength/weakness of a LLM. A starting point is to look up openrouter's API about model, that endpoint will return a
benchmarking field. ... Most of the result of a LLM (such as the 3B model) when we apply questions on its output are
likely expected, by the benchmarks. ... Now an interesting field (probably not explored yet in papers or github repos)
is the human+LLM pair."*

**Both endpoints were checked the same day, and one does not do what was expected.**
`GET https://openrouter.ai/api/v1/models` returns **466 models, 255 carrying `benchmarks`**: `design_arena` as
per-category elo/win_rate/rank, and `artificial_analysis` as indices that are frequently `null`
(`ministral-8b-2512` has arena data and null indices). All four Ministral entries carry the field. On HuggingFace the
equivalent exists (`model-index`, top level) but is **`null`** for the model in use here
(`mistralai/Ministral-3-3B-Instruct-2512`, whose card instead offers `arxiv:2601.08584`) -- so OpenRouter is the
structured source and HuggingFace is prose.

**The design consequence:** a benchmark result is a **hypothesis to falsify at the harness**, not a question to ask
again. A composition can carry it with no new mechanism, because a manifest is free-form beyond `appliesTo`:

```json
{"appliesTo": {"model": "ministral-3-3b", "useCase": "coding"},
 "hypotheses": [{"weakness": "long-context recall", "testedBy": "draft_restates_the_goal"}]}
```

and the plain expectation is worth writing down: **most of what a question returns about a model's output will be what
the benchmarks already predicted.** The measurement earns its keep when it is about the harness.

### 12.4 The five invariants, collected

1. **One narrow question per judgement** -- a predicate, an ordinal ladder, or a closed classification.
2. **A question may only name state the call carries** -- at a seam, that seam's text and nothing else. The most
   silently violated: a model will answer an unanswerable question.
3. **Refusal axes versus grouping axes.** What changes what a number MEANS (the model, the question set) goes in
   `instrument` and refuses comparison. What says who or what it is about (the user, the harness technique, the use
   case) is recorded and sliced, never a reason to refuse.
4. **Declared, never inferred** -- a technique, a person, a subject.
5. **Refuse rather than ask nothing** -- an unreadable set, an empty composition, a broken spec: a named reason, not
   silence that looks like a measurement.

### 12.5 Small things, in the order they unblock

- **`userHash` and `harnessHash`** on the session-review line, with the two declared labels and their card fields.
  Until these exist, 12.1 and 12.2 are prose.
- **A reader that groups lines by pair and prints its n.** With one operator today, a pair figure would be an anecdote
  with a decimal point.
- **A mechanical answerability lint.** The loader checks shape and passed all of MiniMax-M3's sets while **four of its
  seam questions were unanswerable** -- they needed the surrounding conversation. A lint forbidding `AGENT RESPONSE`,
  `OPERATOR REQUEST`, `TOOL CALLS` and `SESSION TRANSCRIPT` in a seam-scoped spec would have caught four of four. It
  will not catch the subtle ones, which is why adjudication stays a pass; four free catches is still worth twenty lines.
- **Duplicate detection.** The composition hash already found that `helpfulness-set-minimax@1` and `helpfulness-set@2`
  are byte-identical (`b0cc836a2f63`) -- the same questions under two names, which no filename reveals. Near-duplicates
  (two sets differing by one question) are not detected, and with several authorings of one seam they are likely.
- **A per-scope hash on the line.** `readSelectedSet` already returns a hash per scope; recording those would let a
  reader attribute a change to one seam instead of to the whole composition, which is what editing one does today.

## 13. The plugin's primary user is an agent

`Operator:` *"Now I see the priority is for agent to drive this plugin (so UI is mainly for human to see or tweak):*

- *Work with a session (hopefully even a new agent initiated session visible in the sidebar in this profile as human
  initiated session does) talk to another agent (run on a specific model). A working example is the one this plugin is
  observing.*
- *use the exposed config tool (I forget the name) to compose/retrieve questions sets on different points (seams,
  turns, and session).*
- *use a tool (maybe based on or improved on the trace tool) to see the measurement results.*
- *recursively iterate configurations and talking to the target agent.*
- *write report on the measurement, about the LLM, and/or about the system1 usage, etc."*

Recorded 2026-10-03. The card stops being the product: it is where a person looks and tweaks. The product is an agent
closing the loop.

### 13.1 Each capability, checked against the live runtime rather than assumed

| # | capability | what exists | what is missing |
|---|---|---|---|
| 1 | talk to another agent on a chosen model | `ctx.subagents` (`startContinuable`, `sendMessage`, `listChildren`, `prompt`) and `ctx.agents` (`create`, `resume`, `list`, `get`) and `ctx.agentTeams.spawnTeammate`, plus `ctx.agentDefaultModel.currentSelection/saveSelection` -- and the AGENT-FACING tools already built on them (`subagent`, `send_message`, `peer_send`, `workflow`) | nothing in the plugin. **Verified that a spawned session is already observed:** two distinct `agentId`s on `call` lines (13 calls and 7 calls) and three `sessionId`s |
| 2 | compose/retrieve sets per seam, turn, session | `system1_settings` with `action: list` returns the sets (names, hashes, seams, problems, `appliesTo`), and `set` selects one; `system1Observer.questionSets()` exposes them to other plugins | **COMPOSING is not exposed.** No tool writes a set: an agent composes by writing files with its own filesystem tools. A `system1_question_sets` tool (list, read, validate, write one scope file) is unbuilt |
| 3 | see the measurement results | `system1_trace` (raw, with `run`/`hook`/`tail`/`full`) over the JSONL trace | **AGGREGATION.** No view of n, of the distribution per question, or of which questions never separate. A `system1_measurements` tool is unbuilt |
| 4 | iterate configuration and conversation | the pieces in 2 and 3, plus the harness's own agent tools | the loop itself: **no set here has ever been rewritten because of a measurement** |
| 5 | write a report | the agent's own file tools | the honest numbers a report needs -- that is 3 |

### 13.2 What the trace already says about being agent-driven

Measured over the live trace, 39,707 lines: **39,400 are `skip`**, 34 are `call` (draft 20, tool 8, turn 6), 23 are
`mount`. A results view that showed only answers would hide that the plugin's bandwidth is almost entirely "asked
nothing, and said why" -- and *why* is the first honest line of any report (`no question configured for this seam` and
`no text at this seam` are different findings about a run).

Also measured: the newest `mount` line predates the set change. It carries `probeHash` and `questionIds: ["probe"]`
and **no `questionSetHash`**, so the row has not re-mounted since `questionSet` was set in the profile -- the corpus is
still not in use.

### 13.3 Build order, from what is missing rather than from what is interesting

1. **`system1_measurements`** -- aggregate the trace: per question id, n, the distribution, and a flag for a question that
   never separates; group by hook, by run, by `questionSetHash`/`stateHash`, and by `agentId`. Report the skips and
   their reasons beside the answers, because a 99%-skip trace is a finding. This is what makes 5 possible and 4 worth
   doing.
2. **`system1_question_sets`** -- list, read, validate and WRITE one scope file of a composition (the loader already
   validates; the tool would put a set in front of the same check before it is written).
3. **The harness axis (12.2)** -- a declared label and `harnessHash` on the line, without which 4's iterations cannot
   be attributed to the technique that was changed.
4. Then the loop: evaluate, read, rewrite the set, re-evaluate.

### 13.4 The set-writing tool, and what `validate` cannot see

`system1_question_sets` is built (round 2 of this objective): `list`, `read`, `validate`, `write`, with the loader's own
check running **before** anything is written, an existing scope file not overwritten without `replace: true`, an empty
list refused, and the answer's hash **read back from disk**. MiniMax-M3 reviewed the write path and named the defects a
loader structurally cannot catch. Agreed postures, recorded so the next round does not re-litigate them:

| defect | can the loader see it? | posture |
|---|---|---|
| a question the call's state cannot answer (a seam question needing the conversation) | no | **try to catch it** -- this is the most common silent defect (four of MiniMax's own seam questions were unanswerable) |
| inverted polarity on a `noul` | no | **warn**, never refuse: there are no labelled cases to test against, and refusing would block legitimate questions |
| paraphrased questions in one batch | no | **silent**: detecting it needs to know which questions are paraphrases, which the specs do not say |
| state filtering and context rot | no | **silent**: an authoring-time concern the tool cannot see |
| a `score` whose `levels` change length between revisions | no | **warn**: the index rescales, so an old reading and a new one are not the same number |

**Two of the review's proposals are REJECTED, with the reason, because the reason is architectural and would otherwise
be re-proposed:**

1. *"Refuse when the same `id` appears in two scope files of one composition."* **Not needed here.** The answer map is
   keyed by question id **within one call**, and a call is for one scope, so the same id at `draft` and at `result`
   cannot collide -- and the corpus already uses that deliberately (the frozen ten-seam set asked `would_change` and
   `outcome` at two seams each). `system1_measurements` groups by scope for the same reason. A refusal here would forbid a
   legitimate and already-used shape.
2. *"Refuse instructions shorter than N characters, or without a question verb."* **Length is not vagueness** -- "Is it
   concise?" is five words and precise, while a hundred-word question can be empty. The real check is the
   answerability lint in 13.5, which asks whether the question can be answered from the state, not how it is phrased.

**Kept from the review, and not built yet:** the *ghost composition* problem (an agent that always writes a new `@`
revision leaves `list` showing sets nothing measures). It cannot be answered inside the questions tool, because
"is this set used" is a question about the TRACE -- so it belongs in `system1_measurements`, as a count of lines per
`questionSetHash` beside the compositions `list` reports.

### 12.6 The declared axes, as built, and three proposals refused

`harnessLabel` and `operatorLabel` are volatile settings with card controls; `lib/label-hash.js` turns each into a
12-character digest; that digest rides **every** line -- call, skip and error -- read at the point of use, and is
**absent** rather than a hash of the empty string when nothing is declared. Neither label enters `instrument`.

MiniMax-M3 reviewed the design and proposed three things that are refused here, each for a reason worth keeping:

1. **A per-run random salt on the hash.** It would defeat enumeration of a short label, and it would also destroy the
   only use the axis has -- grouping the same technique ACROSS runs. A salt that varies per run makes every run its own
   group, which is the same as recording nothing. If unguessability is ever needed, the fix is an opaque id the operator
   keeps beside the label, and it is one change in `lib/label-hash.js`.
2. **Hashing the tuple (label + model + provider).** Model and provider are ALREADY refusal axes in `instrument` and are
   already fields on every line. Folding them into the technique hash would hide which axis changed: a model swap would
   read as a technique change. The tuple is reconstructed by a reader from two fields, which is strictly more
   informative than one hash over both.
3. **A `technique_revision` integer.** The label is already the revision namespace -- `v3 concise-directed` and
   `v4 concise-directed` are two groups, and this corpus's own labels carry their versions. An extra counter is another
   writable field needing a reader, which the schema walk enforces.

**And the part no field can fix, recorded rather than papered over:** keeping the same label while changing the system
prompt silently MERGES two experiments, and the trace cannot tell. A rename splits one into two, which is visible and
recoverable by a reader; a merge is not. The label is a **promise** by the operator, and the field's own description
says so.

### 13.5 The loop, and the gate that is still missing

Item 4 -- ask, read, rewrite, ask again -- is joined as of round 4: `system1_measurements` now emits a **run table** (what
each run mounted with: model, question set hash, harness hash, operator hash, and its call count), which is how a
reading is joined to the instrument that produced it, and it refuses to pool across **three** axes -- a window spanning
two question sets, two techniques, or two operators is reported per group with the reason. Separation is measured, never
self-reported.

**What the loop cannot yet do is tell BETTER from DIFFERENT, and MiniMax-M3's review named the trap precisely:**
rewriting a question *because* its answers did not separate is symptom treatment, and rewriting *until* something
separates is the garden of Eden -- the surviving number is conditioned on having searched until separation appeared. Its
minimum honest evidence, recorded here as the design for the missing gate:

- A small **labelled battery** (known-answer cases, written *before* the rewrite), run against the old and the new
  question, plus an out-of-sample slice the rewrite never touched. ROADMAP 9.5 already called this the gate before a set
  reaches an agent's context; nothing has built it.
- At rewrite time: `parent_hash`, `rewrite_reason`, `battery_path`, and the before/after battery results -- on the
  question file's own record, not in a chat log.
- A separate **experiment line** (its own event, not a reading) linking parent hash to child hash with the battery
  deltas. Without it, "better" is indistinguishable from "different".
- **One knob at a time**: exactly one of {question, scope, harness label, model} may move between two comparable runs.
  The set, technique, operator and backend refusals now enforce the parts they can see; a *paired* change of two axes is
  refused by arithmetic on the run table rather than by a rule of thumb.

**THE BATTERY IS BUILT** (round 5): `lib/battery.js` (format, refusals, scoring -- pure), `lib/battery-tool.js` + `system1_battery` (`list` / `validate` / `run`), and a shipped battery at `criteria/agent-helpfulness-session.battery.json` -- 8 CONSTRUCTED cases covering the 8 `session` questions, hash `92823d5d3268`, whose labels are true by construction rather than by one model's opinion of another's work. A run records an `experiment` line (its own event kind), never a reading. `validate` spends nothing.

**Its refusal list, triaged rather than adopted wholesale:**

| proposed refusal | status |
|---|---|
| an anonymous rewrite (no parent hash, reason, or battery) | **STILL NOT BUILT** -- `system1_battery run` records `parent` and `reason` WHEN GIVEN and refuses a `parent` that is not a hash, but `system1_question_sets write` still accepts a new version with neither. The battery half exists now (`lib/battery.js`); the half that refuses a rewrite which cannot say what it rewrote is not written |
| comparing two runs whose set hashes differ with no experiment line linking them | **built** as the set-axis refusal |
| a `choice` with no abstain option, or a duplicate id | **already built** in `system1_question_sets` |
| a rewrite that changes nothing | **STILL NOT BUILT** -- cheap, and now cheap to CHECK rather than to guess: two compositions' hashes are both recorded (`<set>@N` files carry one per scope), so a no-op rewrite is a hash comparison the writer could make |
| labelling a battery after seeing the run table | **PARTIALLY BUILT, and the limit is stated rather than papered over.** The battery's hash rides every `experiment` line, so a battery edited after a run is a DIFFERENT INSTRUMENT and the two cannot be pooled -- that is the part a hash can do. What no hash can do is prove WHEN a file was authored: a battery written after seeing the run table and then hashed is indistinguishable from one written before. That needs a timestamp or a commit, not a rule in this repository |
| aborting the whole read when any line is unattributed | **refused**: traces recorded before these fields existed are real evidence, so the view REPORTS the gap and refuses to pool across it rather than returning nothing. Aborting would delete the history that makes the gap visible |
| an operator hash changing inside one run | **not built** -- the run table now exposes it, which is the part that matters first |

## 14. The current plan: two splits, and what each waits on

P5 asked one question — stay a plugin, or extract the engine. The work since has split it in two, and both now have a
**measured** boundary rather than a preference. This section is the plan of record; `docs/adapters-and-standards.md`
holds the evidence behind every number here.

### 14.1 Split A — the measurement core, as a package with no DSH import

P5's hedge, now quantified. Measured over **66 files / 11,341 lines**:

* **NOTHING IN `lib/` IMPORTS A DSH MODULE** -- re-measured after the store was extracted and the grep is empty. Only
  **three files name a harness service** at all: `lib/model/service.js` (the instrument's host edge),
  `lib/evaluate-tool.js` and `lib/telemetry.js`. The harness-SHAPED surface is a different measure: `lib/host/`
  (**5 files, 425 lines**) plus the session-reading half (`lib/session-subject.js`, `lib/sessions-tool.js`) that
  receives `sessionQuery` by INJECTION rather than by import.
* The interface the core would speak is **five concepts**, derived from six harnesses rather than invented: an ask, an
  answer, the model's reasoning, tool traffic, and a boundary — plus the per-harness facts (`shadowed`, `interrupted`,
  attempts, the boundary label). `lib/host/session-format.js` is the DSH side of that line, and it is one file.
* Precedent, already in this workspace: **`dsh-system1-runtime`** is the pure mechanism (imported **by name**, pinned
  at a tag, fetched by plain `npm install`) and **`dsh-docdrift`** describes itself as *"the first application of"* it.

**What it waits on: a second consumer.** A pure repo extracted from one implementation bakes in that implementation's
shape. P5's own reasoning (*"the ecosystem is in libraries"*) is the trigger, and the hedge — no DSH import from P1 on
— is already satisfied, so nothing has to be undone to collect on it.

### 14.2 Split B — the session adapter, as its own plugin

The new half, and the one the operator named: a **"plugin for a plugin"** that owns session access so the measurement
core never reads a log.

* **Two channels, and the cut is in-band vs out-of-band, not live vs stored.** In-band is the harness pushing events
  (the seams); out-of-band is us pulling (`readSession`, or the index). The constraints are the harness's own:
  `agent/turn-stopping` is SERIAL, `fs/write-intent` is WATERFALL SINGLE SLOT, and a throw in `fs/observed` fails the
  tool call — a store cannot be consulted in there.
* **What moves out** (now moved, 2026-10-05): `lib/host/*`'s session-shaped three, `session-subject.js`'s host-backed
  half (as `reader.js`), the surface authority, and the host's search call; the row's own `subjectSettings` stayed,
  because the package must not read this plugin's config.
  **Moved 2026-10-05**: the session-shaped three (`session-format`, `surface`, `feed`) are the package
  `dsh-session-adapter`, imported by name; `fs-journal.js` and the inventory stayed, because a filesystem journal is not
  session-shaped. The remaining half calls the host, so it needs the service. **And the two files this section said to
  DELETE are not deletable, measured (`F104`)**: the authority is async and optional, so the fold is the fallback for a
  deployment with no `sessionQuery` -- they move, and the retirement rows say so.
  **What stays**: the selection semantics (G0/G1), composition, segmentation — and `lib/sessions.js`'s allow-list rule,
  which is ours and is not about a format.
* **The measured case**: a title search through `sessionQuery` costs **~54 s** (seven samples, median 53,951 ms) and the
  index answers the same question in **1 ms**; the warm-up is 328 s once and **2 ms** per re-run when nothing changed.
* **THE INDEX HALF IS DONE AND LIVE** (2026-10-05): the store is its own plugin and its own repository,
  [`dsh-session-index`](https://github.com/johnlam1968/dsh-session-index) -- a `localSessionIndex` service, four
  agent-facing tools (`session_index_list`/`_read`/`_search`/`_refresh`), a CLI, and **no dsh import at all**. Measured:
  499 sessions, **748.1 MB**, a living session refreshing in **15-21 s**, search in 4-13 ms. The offset-level design is
  **withdrawn** (`F103`: an instrumented refold measured decode 0.9 s / fold 0.9 s / insert 41.3 s -> 0.3 s).
  **What is left of Split B is the OBSERVER's own session access**: `lib/host/` and the session-reading half of
  `lib/session-subject.js` / `lib/sessions-tool.js`, so the measurement core never reads a log. Begin with the two
  files already on the retirement list (`lib/host/feed.js`, `lib/host/surface.js`), which are to be DELETED rather than
  moved -- `surface.js` is replaced by `filterEvents {kind: 'surface', values: ['current']}`.

### 14.3 Where the phases stand — this file is partly stale

| phase | status |
|---|---|
| **P0** | done |
| **P1** two questions per call, `S` as a file | open; the measured gain stands (+55% tokens for 5× the questions, no latency cost) |
| **P2** criteria dictionary, registry, `id@version` provenance | **partly**: question sets exist as directories with hashes, batteries and the experiment line exist; the criteria DICTIONARY and `id@version` on the trace are the gap |
| **P3** session/turn targets and a helpfulness set | **largely done and not reflected here**: session scope, `turns`, the evidence groups G0–G4, `session@1` and `agent-helpfulness-session@1` all exist; what remains is the turn AGGREGATE and block segmentation as a first-class mode |
| **P4** the rewrite loop | open, gated as written |
| **P5** the vehicle | **now two decisions** (§14.1, §14.2) |

### 14.4 Next, in dependency order

0. ~~**RESTART**~~ -- **DONE, repeatedly, and verified live**: the 4.5x count fix (`F82`), `action: 'search'` with the
   hand-rolled fallback, the `observed` marking, cwd in `search`, the trigram dispatch and its short-query guard, the
   `refresh` action, the insert fix, and the extracted `dsh-session-index` row all report themselves in the running
   process.
1. **`filterEvents` with `{kind: 'surface', values: ['current']}`** — **THE WIRING IS DONE (2026-10-05); THE DELETION IT
   PROMISED IS NOT, and this item was wrong to call it "ready"** (`F104`). Verified in the producer:
   `SessionEventResultFilter` has a `surface` kind and `SessionEventSurface = 'current' | 'shadowed' | 'log-only'`, so
   the authority is real and better than our fold (it also names the two non-current states). But it is **ASYNC** and
   **OPTIONAL**: an in-band seam handler cannot await it, and a deployment without `sessionQuery` must keep an answer --
   without the fold, the shadowed-answer defect `lib/host/surface.js` was written for comes straight back. So
   `lib/surface-authority.js` asks the host wherever a caller can await (the TOOL path: `system1_sessions` `read
   --format subject` and both `system1_evaluate_session` composers), `composeTurnState` keeps the fold as the fallback,
   and a test asserts BOTH halves -- the shadowed event is absent with the authority and present without it.
   **`host/surface.js` and `host/feed.js` therefore MOVE to (d) rather than being deleted**, and their retirement rows
   say so.
2. ~~**The offset-level refresh**~~ — **WITHDRAWN, because the phases were measured and it is not where the time is**
   (`F103`): decode **0.9 s**, fold **0.9 s**, insert **41.3 s → 0.3 s** once each session is written in one transaction,
   mirror **18.7 s**. A stored frame offset would save the decode — 1.8 s of a 43 s refold — and was recommended,
   designed and selected before anything was measured. One instrumented run retired it. **The refresh went 110 s →
   56 s → 21 s** for a living session this way.
   **The mirror step is DONE, and its proposed remedy was retired by measurement** (`F106`): `DELETE ... WHERE
   session_id = ?` costs 4,087 ms and deleting BY ROWID costs 4,129 ms -- the seconds are FTS5's trigram index work,
   not the lookup a `session_id → rowid` map would replace (which is 92 ms). So the WORK was removed instead: the
   mirror carries `seq`, `mirror_state(session_id, high_water)` says how far each session was built, and maintenance
   **APPENDS only what the log added** -- safe because a DSH log only grows. A missing receipt, a shrinking log or a
   row with no `seq` is replaced rather than guessed. `SCHEMA_VERSION` 4 costs one full rebuild once (measured: 51 s). **Measured after: the refresh is 2,680 ms** (`refold 2.2 s, mirror 0.4 s`), against 15-21 s -- the mirror step 18.7 s -> 0.4 s.
   **And the store now carries SESSION SEARCH, hand-rolled, because the native route was tried and reverted**: enabling
   `@deepseek-ai/dsh-session-query-sqlite` in this profile made `api-session-controller` fail to start, the cause was
   never reproduced, and the harness's index is left at its deployment default (`never`) — `F98`. `scripts/session-index.mjs`
   therefore gained `search`, a `meta` table recording `text_indexed` as a MODE receipt, and coverage of message text,
   reasoning, tool results and tool-call arguments.
3. **The subagent distinction** — **318 of 499 sessions are subagent runs** (319 carry a parent session; re-measured
   from the store), and the index cannot yet filter them out
   while `observeSubagents` (default OFF) already encodes that policy for the live path.
4. **The pi reader** — the second adapter, and the test of the interface: pi shares DSH's store layout and 183 of its
   sessions are on this disk.
5. ~~**The `defineTool` migration**~~ -- **DONE** (`F108`): 12 tools authored through one adapter per plugin, the
   raw-root `additionalProperties` deviation retired by construction, and six schema facts the harness's compiler
   refused now fixed -- including `required` not existing in the VALUE schema DSL, untyped nodes, and a **latent bug**
   (the battery's `got` was emitted and undeclared). **Also DONE**: the `Service` subclass form for all three plugins
   and host inventories for both packages (`F109`), with the class form's two measured costs recorded there. **What
   remains of `F107`**: the audit's UNKNOWNs -- `exec.signal` per tool, slot OPTIONS, the client build pipeline, the
   waterfall `next()` contract now being CLOSED and asserted (`F111`) -- and ONE live check that needs a restart --
   `listService { service: 'localSessionIndex' }`.
6. **The core extraction** -- when a second consumer exists, per §14.1. **The readiness test is one of two things and
   neither is true today**: a SECOND CONSUMER (another repo or application that measures with this instrument), or a
   FROZEN INTERFACE -- and P1's second question per call, P2's criteria dictionary and `id@version` provenance, P3's turn
   aggregate and block segmentation, and §13.5's gate are all open, so the interface is still moving. The hedge is
   satisfied (nothing in `lib/` imports dsh), so extraction is a PACKAGING decision whenever either trigger lands
   rather than a refactor.
   **And the hedge is now MEASURED rather than asserted** (`F110`, 2026-10-05): the instrument's **config** coupling
   -- six files reading this row, which is what made an extraction a reshaping -- is gone. Each takes one input object
   (`{ point, callsEnabled, subjects, axes, questions, limits, redaction, transport }`) built by the application, the
   dsh event map moved to `lib/host-events.js`, and `test/instrument-boundary.test.js` asserts that no instrument file
   imports anything but `node:` builtins and itself, that none calls a config reader, and that the one `ctx` edge is
   `lib/model/service.js`. **What still blocks a MOVE rather than a reshaping**: `lib/question-sets.js` READS THE FILESYSTEM (a
   directory it is given) -- named in the test's set rather than hidden. The per-seam payload shapes and the event map
   left the instrument in the same pass (`lib/host-payload.js`, `lib/host-events.js`), and the gate asserts that no
   instrument file names a harness event in code.

### 14.5 What would make us stop, or reverse

* **If the index becomes a second source of truth.** It is derived, rebuildable and receipted; a forensic question
  reads the log. Two channels must be able to disagree VISIBLY, so the channel-agreement test (compose one turn both
  ways) is a prerequisite for trusting either.
* **If the two channels drift.** `test/surface-compare.test.js` compares this plugin's fold against
  `sessionQuery.readSurface`; the same pattern is owed to the index.
* **If the core is extracted before a second consumer.** Then the "pure" package is DSH-shaped with a neutral name.

### 14.6 The topology, as five things and what each owns

Recorded 2026-10-05, after the store was extracted. The shape is the one `system1-runtime-repo` +
`dsh-docdrift` + `system1-runtime` already realise for the decision-model side, applied to measurement.

| | what it is | kind | status |
|---|---|---|---|
| **(a)** | **the instrument**: seams, question composition and validation, the model call path, probe calibration, batteries, readings | pure package, **no dsh import** | planned, but **the CONFIG coupling is gone and gate-held** (2026-10-05, `F110`): the set is **23 files / 4,274 lines** (re-measured -- the earlier candidate list was a text match), it takes ONE input object built by `lib/instrument-input.js`, it imports nothing but `node:` builtins and itself, and `test/instrument-boundary.test.js` holds all three. **What is left before extraction is not config and not the harness**: the per-seam PAYLOAD shapes moved to `lib/host-payload.js` and the event map to `lib/host-events.js`, so the instrument names no harness event at all (asserted); what remains is that `question-sets.js` reads the filesystem, and the trigger in §14.1, unchanged |
| **(b)** | **the store**: the derived index over session FILES (search, list, read, refresh) | dsh plugin, no dsh import; [own repo](https://github.com/johnlam1968/dsh-session-index) | **exists, live** |
| **(c)** | **the application**: mounts (a), binds the subject through (b)+(d), owns the rows, settings, trace and the agent-facing tools | dsh plugin (the top; nothing depends on it) | exists TODAY as the monolith; becomes only (c) after Split A |
| **(d)** | **the harness session adapter**: what (b) cannot serve -- live sessions, the current surface, titles as the harness holds them | package `dsh-session-adapter` (`packages/session-adapter/`), imported BY NAME | **BOTH halves are in the package** (2026-10-05): the in-band half (session vocabulary, surface fold, feed) and the host-backed half (`lib/reader.js` -- the subject read, the list, the window slicing, the coverage, the host's full-text search -- and `lib/surface-authority.js`). The host reaches them through a PARAMETER (`sessionQuery`), never through `ctx`, so the inventory still checks that they contain no host call. **AND THE SERVICE FORM EXISTS AND IS MOUNTED** (2026-10-05): the same functions are provided as `ctx.sessionAdapter` (row `session-adapter`, 193 composed rows, probe-verified on another port before any restart), with `getQuery` as a function so a host that mounts later is still found, and named absences (`null`, a problem sentence, `available()`) for a deployment with no host. The observer still IMPORTS rather than injects, which is what the in-band path requires -- the service exists for consumers that are not this repository's |
| **(e)** | **the composition**: the profile's load-bearing DECISIONS -- the patch (persona override and the rows we add), the mounted bundle list, the peer bridge, the pins | a `deploy/` directory in THIS repository; its own repo only when a SECOND HOST needs it | **NOT a repository today, and this plan overstated it.** Measured 2026-10-05: there is **exactly ONE deployment** carrying this stack (`docdrift`, 10 bundles; `docdrift-headless` carries only `dsh-system1`; `web` and `headless` carry none), so a composition repo would have one consumer -- the mistake §14.1's stop condition refuses for (a). What IS real: `~/.dsh/profiles/docdrift` is **not under version control** (`git rev-parse` fails) and holds **four `.bak` files from tooling rewrites**, one of which silently dropped a bundle entry (`F105`). The rationale splits three ways: the **bundle list** is genuinely at risk; the **pins** are half-done (the lock pins the git dep to a commit, the spec is `github:` = master at install time, and the profile `link:`s working trees -- right for development, wrong for a deployment someone must reproduce); and **plans and ledgers do NOT belong there**, because this register is about the design of the code it sits beside |

**The seams that must be drawn explicitly, or the shape drifts:**

1. **(b) vs (d): the store serves what was BUILT, the adapter serves what is LIVE.** Without that rule two
   plugins both read sessions and disagree, which is `F98`'s lesson at a different layer -- a divergence nobody
   can see. **And (d)'s in-band half must be IMPORTABLE (a library or a package's plain functions), not only a
   service**: the composer runs inside a synchronous seam, and the authority measured in `F104` is async -- a plugin
   whose only surface is a Cordis service cannot serve that path at all.
2. **(a) owns the instrument's artifacts and the instrument's tools.** The trace format, the reading/register
   semantics and the measurement package are (a)'s, and so are the tools that measure the INSTRUMENT rather than
   the session (`system1_questions`, `system1_battery`). Today those live in (c), which is why a second consumer
   would have to reach into the application to get them.
3. **(e) owns the VERSIONS, and only the versions, the mounted list and the profile's decisions.** The runtime
   precedent pins `#v0.1.1` in the consumer's package.json; the bundle list and those pins must live in one place or
   they drift (`F98` again: a profile edited by hand while a process held the old composition). **Its repository
   trigger is a second HOST, not a second plugin**: until someone else must reproduce this composition, a `deploy/`
   directory here carries the same files with no new repo to keep in sync, and the machine-local parts (`node_modules/`,
   `data/`, credentials, `link:` paths) stay out of it by construction.
4. **(c) must not be the only place (a)'s format is known.** An application is a leaf by design; if the trace and
   the packages can only be read through it, the instrument is not reusable whatever the package boundary says.

**What (c) offers outward today, measured**: it provides exactly ONE service (`OBSERVER_SERVICE`) and **nothing
consumes it** -- not this repository, not the profile's other plugins -- while the durable artifacts (the trace at
`~/.dsh/logs/system1-observer.jsonl`, the packages under `data/measurements`) are the surface anything can actually
read, and the eight registered tools are inward (they serve the agent inside this deployment). So (c) is a leaf in
dependency terms and an unused offer in service terms; the reuse question is answered by moving (a)'s artifacts and
instrument tools into (a), not by making (c) consumable.
