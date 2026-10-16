# Is System 1 evaluation suitable for agent self-improvement?

**Status: a position, not a measurement.** Written 2026-10-15 by an agent, in response to the operator's question
*"what are your frank opinions about using system1 evaluation to let agent self-improves?"* Nothing here was measured
by this repository. Where a claim **is** measured, it names the file and the measurement; everything else is argument,
and is marked as such. This distinction is the reason the file exists in this shape: `docs/findings.md` is the
register of what happened, and a confident opinion recorded next to it without a label would be the exact failure
this project exists to catch.

**Related.** [`plans/2026-10-15-persona-as-expectation.md`](plans/2026-10-15-persona-as-expectation.md) is the
design that follows from taking the operator's proposal seriously. This document is the argument about whether that
design's *premise* is sound, and it should be read first — several of the plan's parts survive, one does not.

---

## 1. The verdict

**It is a good instrument idea and a weak learning idea.** The measurement half is genuinely valuable and mostly
cheap. The self-improvement half rests on an assumption that a single in-session evaluation of a single transcript
cannot cash, and the project's energy is likely to flow toward the half that produces impressive numbers rather than
the half that would change an agent's behaviour.

The narrower claim that survives: *a second opinion, delivered at the point a human would have intervened, improves
the session.* That is testable, cheap, and needs no belief about learning.

## 2. "Self-improves" is three claims wearing one name

Only one of them survives contact with a single session.

| claim | what it is | verdict |
|---|---|---|
| **course-correct in-session** | read a reading, behave differently for the rest of the session | **real and cheap.** This is nudging, and it works. It is also not usually what people mean when they say self-improvement |
| **improve an artifact** | rewrite the plan, the persona, the question set, its own instructions | **durable**, and the artifact then becomes the thing being measured — which is where it gets slippery (§4) |
| **get better at the class of task** | the actual RSI claim | **does not happen inside one session.** The evidence that it can is gradient descent over many episodes against a reward. What exists here is *supervised in-context correction* — a useful thing, honestly named |

The failure is to say the first, measure the third, and be disappointed by the second.

## 3. The value is concentrated exactly where System 1 is not

Measured, not asserted: of this profile's eight persona rules, **five are decidable by folding the session log**, one
of which is already built (`dsh-system1-nudge`'s `lib/signals.js` `fold()` — `assistantSinceTool`, `recurrence`,
`idleTurnsWithoutTool`). **Two are genuine judgement calls. One is unobservable** — the full classification, with the
evidence channel for each rule, is in the design plan §4.

Measured: the instrument's own built-in question is *measurably weaker at the tool-call points* than at the text ones
(`README.md`, "Before you trust a reading", item 3), and most persona rules live at tool-call points.

So the cheap and exact channel is where the rules are, and the expensive and noisy channel is asked anyway. A
probabilistic judge counting things is how a project ends with a beautiful trace and no improvement. **Use the judge
for what only a reader can do: form a judgement a human would recognise as a judgement, over evidence a fold cannot
reduce.**

## 4. Goodhart here is structural, not a discipline problem

If the agent rewrites the rubric, the loop does not become *risky*, it becomes **unfalsifiable** — there is no
external truth left to disagree with. The ledger helps, because `ledger_open` refuses a variant without `hypothesis`,
`observable`, `expected` and `revert` **before** the mutation, which makes the mutation an experiment with a pinned
way back. But a ledger is a discipline, and disciplines do not survive incentives.

**The only anchor is a signal that arrives from outside the model, after the fact** — and this repository already
has the right one. `lib/nudge-label.js` is explicit about why: it is *"the one question every other question depends
on the judge being right about its own call, except this one, because the operator's next message is in the record."*
It is also three-valued by design, because `false` on an open turn is *"the flattering reading"*.

**Everything else in the loop is the model agreeing with itself**, and a model that has just read a rule is the least
independent witness available to judge whether it followed that rule. Treat any persona-derived reading as a
hypothesis about the agent, and treat the operator's reaction as the only evidence.

## 5. The likely failure mode: the measurement becomes the product

The bet is that a year of probability readings accumulate, they look rigorous, the trace card is impressive, and at
no point does anyone run the paired A/B that would answer whether sessions got better — because that experiment is
expensive, slow, and its result might be *no*.

Meanwhile the numbers feel like progress. This is the most probable ending for a project of this shape, and it is
avoidable only by deciding in advance what result would count as success and what would count as a negative finding.
§9 is that decision, written down before any of it is built.

## 6. Attention is a real cost, and it is not the latency

Latency is the visible cost and the smaller one. The delivery lands in the model's context competing with the task,
and instructions buried in context are followed less reliably than instructions at the top of it — an effect that
does not scale with the raw context window. A 1M-token context is not a licence to spend attention.

Two consequences, both cheap to honour and expensive to learn late:

1. **one reading per turn, or none.** Two delivered at once will likely be worse than one: dilution, and the agent
   satisfies one and ignores the other.
2. **keep a channel that is purely mechanical and never send it to the agent.** Count the narration; do not teach the
   model about narration. Some rules are better *enforced* than *discussed*, and a lesson spent on counting is an
   attention budget not spent on the task.

## 7. The cost nobody prices: compliance over judgement

When an agent does something the persona does not want, the cause is often that **the persona is wrong or ambiguous
for this situation** — not that the agent disobeyed. Delivering *"you deviated from rule 3"* trains toward literal
compliance, which is precisely the brittle behaviour that makes agents exhausting to work with.

The clearest case is already in this profile's persona: *"insist on top down design **when the architecture is not
decided yet**"*. The intent is real; the literal predicate is either always-true or unobservable (§3). A lesson drawn
from it teaches the model to *perform* architectural deliberation.

Over a few hundred sessions, a persona-derived reading stream stops being a measurement and becomes a curriculum.
**The curriculum becomes the ceiling**: an agent that is very good at obeying a rulebook is measurably narrower than
one that notices when the rulebook does not apply, and the narrowing is invisible because the metric rewards it.

## 8. What to build instead

Not a self-improvement loop. **A second opinion at the point a human would have intervened** — smaller, testable, and
requiring no belief about learning.

Constrain it to what the agent structurally cannot see about itself:

- what the operator actually asked for, versus what the agent built;
- whether its closing claim is supported by the tool results it has;
- whether it stopped while the work was still finishable.

Those are the questions where a fresh reader adds information the agent's own context does not already contain, and
where the mechanical detectors cannot reach. The persona's most valuable role is not as a rubric but as a **change
detector**: the harness reports when the agent's behaviour changed shape, and a human decides whether that is a
persona edit, a model swap, or nothing at all.

## 9. What would change this opinion

Written down in advance, so that the finding cannot be re-read after the fact:

| evidence | effect |
|---|---|
| **paired sessions, same task and model, reading present vs absent, scored by whether the operator had to intervene** — a real A/B with a real *n* | a positive result at *n* in the dozens would mean §1 is too pessimistic. This is the decisive experiment and nothing else substitutes for it |
| one case where the judge caught something a fold could not, **and the operator did not have to catch it themselves** | would move the case for the `judge` channel from "cheap insurance" toward "earning its latency" |
| a session where a delivered reading visibly changed the work, with the counterfactual stated | suggestive, and *not* sufficient on its own — one good story is what a system does after it fails, not evidence that it works |

**The negative result is equally informative and much cheaper to look for**: if the A/B comes back flat, the honest
conclusion is that the instrument is a good *detector* and a poor *teacher* — which is a perfectly good product, and
the one already built.

---

## 10. One-line summary for a reader in a hurry

The measuring is worth doing and mostly will not need a model; the teaching is the part that probably does not work,
and the way to find out is one paired experiment that is cheaper than the year of readings it would replace.
