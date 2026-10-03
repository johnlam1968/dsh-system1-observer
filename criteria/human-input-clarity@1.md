# `human-input-clarity@1` -- is the operator's message clear enough to serve?

Companion to [`human-input-clarity@1.json`](human-input-clarity@1.json). Scope: **`admit`** -- the operator's own
message opening a step of the loop, and one of the seven seams whose text the state carries whole.

The inversion is deliberate. Every other set asks whether the agent was helpful; this one asks whether the **operator**
gave the loop something it could act on. A vague request is not a lesser request: it is paid for by every turn after
it, in guesses, in clarifying round-trips, and in work done to the wrong target.

| id | asks | good is |
|---|---|---|
| `human_goal_is_stated` | does it say what to DO, not only what is being looked at | yes |
| `human_done_is_checkable` | can a reader tell when the job is finished | yes |
| `human_constraints_given` | are the limits that matter stated | yes |
| `human_target_is_findable` | is the thing to act on identified specifically | yes |
| `human_clarity` | intent, target and expected result | unambiguous |
| `human_request_shape` | one request, several compatible, or conflicting | one |
| `human_loop_hazards` | buried request, unverified premise, asking for what is present | none |

**It judges the MESSAGE, never the person.** No question reads tone, sentiment, patience or satisfaction: those are
inferences about a human from their words, and a proxy that guesses at them would be measuring the guess (the same
line `lib/nudge-label.js` draws). Every question here is a property of the text that a reader can point at.

**What it does not ask:** whether the request was *wise*, whether the target exists, or whether the work was worth
doing. Those are judgements about the operator's situation, and this measures their message.
