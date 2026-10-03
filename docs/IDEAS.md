# IDEAS — the store

Where an idea goes when it is not yet a decision. The sibling repository keeps this file beside a
`BRAINSTORM_RECORD.md`; this repo kept neither until 2026-10-03, deliberately — nothing here was written before
something had been measured. That is no longer the right trade once the ideas outnumber the sessions, which is
where this file starts.

**Conventions, borrowed from the sibling and worth keeping:**

- The operator's words are quoted **verbatim**, and marked `Operator:`. An idea paraphrased is an idea that has
  already been edited by the agent, and the edit is invisible.
- Every entry carries a date and a **status**: `IDEA` (not built), `BUILT`, `MEASURED` (with the number),
  `REFUTED`, `OPEN` (a question, not an idea), or `PARKED` (deliberately not now).
- **One home per fact.** An entry says what the idea is and points at where it is decided or built
  ([`settings.md`](settings.md) for decisions, [`findings.md`](findings.md) for the register of defects). It does not
  restate the decision.

---

## Sets are written, then refined — by the operator's agents, not by hand

`Operator:` *"Questions sets are agent written with or without templates. We did some searching of available
questions. Eventually, I decided to let you and MiniMax-M3 write them, The 3 sets you saw in /criteria are examples.
Going forward, seam and session specific question sets should be written by you and MiniMax-M3 (or other LLMs with
large parameters). I expect question sets will be refined and templates persist, just like skills."*

**Status: BUILT (first round, 2026-10-03).** Six sets authored — three by the agent, three by MiniMax-M3 — each with
a rationale file, plus [`../criteria/_templates/SET-AUTHORING.md`](../criteria/_templates/SET-AUTHORING.md) as the
persisting template. The refinement loop itself (a set revised in response to what its answers showed) has **not**
run once yet: no set here has been rewritten because of a measurement. That is the part still untested.

`Operator:` *"The focus is helpfulness of agent. Also write a question set for human input (user prompt), aiming at
clarity (and other LLM expected good behavior from human)."*

**Status: BUILT.** `human-input-clarity@1` and `@minimax-1`, scope `admit`.

## One narrow question per state, and the set is the cost unit

`Operator:` *"We decided to use set of a single question per state, because reasonably system1 model can take
multiple questions, and use set has cost saving, too. If we use a single seam as state, we have seam specific
question sets. Similarly, we have multiple-turn specific question sets. Finally, we have session specific question
sets."*

**Status: BUILT** — the three state scopes, with the schema declaring all of them. The cost claim was checked
rather than assumed: `lib/observe.js` sends a seam's questions in ONE call, so the composed state is paid for once.

## One directory per composition; nothing encoded in a filename

`Operator:` *"We should start simple, so one directory per composition. In the future, we might consider complex data
structures. For example, question sets for a specific model. We already test with Ministral 3 3B model. We might test
other models, too. For large models, some questions are moot but more advanced questions are necessary. Also we may
have use case specific question sets: general chat, coding, researching, etc. Again, we can use flat directory and use
file name format to differentiate. But that make parsing/lookup a text/char exercise."*

**Status: BUILT** — one directory per composition, one file per scope, `_`-prefixed files as metadata, and a
`_manifest.json` carrying `appliesTo: {user, model, useCase}` that is **outside the composition hash** (declaring who
a set is for does not change what it asks). The refusal of a filename-as-lookup-rule is the operator's, and it is the
reason the manifest exists.

## It takes two: the pair (user, model), and what that costs

`Operator:` *"It takes two for a conversation. Human should also user specific question sets. User A is different
from User B. More broadly, the pair User A + LLM A worth attention. Some users have better interaction the others."*

**Status: IDEA + one OPEN question.** A composition can already declare `appliesTo.user`. What is missing is the
person on the LINE (`userHash`, recorded like `stateHash`) — and the tension recorded in
[§14](settings.md) is the part to settle first: **a user-specific set and a cross-user comparison are mutually
exclusive.** Comparing pairs needs one common set; tailoring a set to one person makes their readings readable alone
and incomparable against another's.

## Benchmarks predict the model; only the harness is left to measure

`Operator:` *"Each LLM have went through a lot of benmarking, the details of those evaluation reveals
strength/weakness of a LLM. A starting point is to look up openrouter's API about model, that endpoint will return a
benchmarking field. HuggingFace or the like also should have such API. Most of the result of a LLM (such as the 3B
model) when we apply questions on its output are likely expected, by the benchmarks. A practical approach for actually
task a specific LLM involve prompting/steering/loop/harness techniques, with the knowledge from task specific
benchmark results. Now an interesting field (probably not explored yet in papers or github repos) is the human+LLM
pair. There are ways to make the pair more productive. And the engine (plugin) we are designing/building will provide
insight to that because this engine measures."*

**Status: MEASURED, then IDEA.** Both endpoints were checked the same day: OpenRouter returns **255 of 466** models
with a `benchmarks` field (`design_arena` per-category elo/win_rate/rank, and `artificial_analysis` indices — often
`null`); HuggingFace's `model-index` is **null** for the model in use here, offering `arxiv:2601.08584` instead. The
design consequence is in [§15](settings.md): a benchmark result is a **hypothesis** to falsify at the harness, not a
question to ask again — so a model-specific composition carries `hypotheses: [{weakness, testedBy}]`, which needs no
new mechanism.

**And the gap it exposes, which is the biggest idea in this file:** the harness technique is NOT in `instrument`.
Prompting, steering, loop and harness changes are the practical levers, and today two runs under different system
prompts are treated as the same instrument while being different treatments. Until a declared `harnessHash` is
recorded on the line, "ways to make the pair more productive" cannot be attributed to a technique the record names.

## The principle that keeps the comparability key honest

**Status: BUILT as a rule, applied to two axes and one pending.** Facts about a run divide into **refusal axes**
(they change what a number MEANS: the model, the question set — both already in `instrument`) and **grouping axes**
(they say who or what it is about: the user, the harness technique, the use case — recorded, then sliced, never a
reason to refuse). Putting the user or the harness into `instrument` would refuse exactly the comparison worth making.

## A mechanical check for answerability, which no loader can do today

**Status: IDEA, unbuilt, with a known payoff.** The loader checks shape — the abstain option, the levels, the declared
scopes — and it passed all of MiniMax-M3's sets while **four of its seam questions were unanswerable**, because at a
seam the state is that seam's text alone and those questions needed the surrounding conversation. A lint could catch
much of that mechanically: a spec whose scope is a seam must not reference `AGENT RESPONSE`, `OPERATOR REQUEST`,
`TOOL CALLS` or `SESSION TRANSCRIPT`, and a phrase like "the surrounding context" is a flag. It would have caught four
of those four. It would not catch the subtle ones — which is why the adjudication stays a human-and-agent pass — but
four free catches is worth the twenty lines.

## Detecting duplicate and near-duplicate sets

**Status: MEASURED (by accident), IDEA for the rest.** The composition hash found that
`helpfulness-set-minimax@1` and `helpfulness-set@2` are **byte-identical** (`b0cc836a2f63`) — the same questions
shipped under two names, which no filename would have revealed. Exact duplicates are now free. **Near**-duplicates
(two sets differing by one question) are not detected, and with six authorings of the same seam already in the corpus
they are likely.

## Finer attribution: a hash per scope, per line

**Status: IDEA.** The composition hash changes when any scope changes, so editing `draft` makes every `result`
measurement in the same run incomparable with the ones before it. `readSelectedSet` already returns `scopes` (a hash
per scope), and the session-review line already carries `stateHash`; recording the per-scope hashes the same way would
let a reader attribute a change to one seam instead of to the whole composition.

---

## Open questions, in one place

- **The pair's identity**: is `userHash` derived from an operator-configured label (declared) — and is that enough
  for a person who is not a user account? No design says yet.
- **The common set vs the tailored set** (§14): which one is the corpus's default, and does a tailored set ever
  enter a comparison? Not settled, and it decides what per-user sets may be.
- **The turn measurement is never scored** (`O17` in [`findings.md`](findings.md)): its call lines carry `answers`
  and `questionIds` but neither `questions` nor `answer`, so the scorer reads nothing. Intended, or a defect?
- **A set that compiles may still be unanswerable** — the lint above is an idea, and until it exists the check is an
  adjudication.
- **`questionSet` per scope** (a map rather than one composition): refused for now in favour of compositions, and
  worth revisiting only if a real use needs two authors at one scope.
