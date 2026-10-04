# human-conduct-session@1 -- why these eight questions

Every other set in this directory judges the AGENT, or one operator input (`human-input-clarity@1`, which is
`admit`-scoped and asks whether a single message is clear enough to act on). Nothing judged the OPERATOR across a whole
session, which is half of what a session's outcome is made of -- so this set exists, and it is `session`-scoped so that
`system1_evaluate_session` can put it to a stored conversation.

## What it is for

An agent tuning its own behaviour needs to know which of a session's problems were its own. A reading that says "the
request was partly served" is not actionable until it is separated from "the operator's opening message did not say
what was wanted" and "the operator never answered the question the agent needed". These eight questions put the second
and third of those on the record, so a bad session is not automatically filed as an agent failure.

## The design decisions, and they are decisions

* **Polarity-sensitive questions are `choice`, not `noul`.** `operator_supplied_context`, `operator_kept_one_goal` and
  `operator_feedback_specific` each have a natural "good" direction, and a `noul` whose polarity is invertible would
  answer consistently either way round without saying which. The `choice` form names both directions as options and
  carries an abstain.
* **`not_needed` and `none_given` are real options.** A session that needed no context, or in which the operator gave no
  feedback because none was called for, is not a failure -- and without those options the model has to choose between
  saying something false and abstaining, which pushes the aggregate toward the abstain for the wrong reason.
* **Two `noul`s ask about the operator's FAILINGS, with `true` meaning the failing happened**
  (`operator_corrections_timely` is the exception and is phrased positively). Naming the failing as `true` is
  deliberate: it is the reading a reader acts on, and it keeps the criteria short.
* **`operator_recognised_errors` has an unavoidable ambiguity, stated in its criteria:** `false` covers both "there were
  no errors" and "errors went unnoticed". The two are different facts about the operator and one question cannot
  separate them; splitting it would need a second question that only fires when the first is `false`, which a single
  request cannot express. It is here anyway because "did the operator catch the mistake" is worth having at all, and
  its criteria say what `false` means.
* **No question asks whether the operator was pleasant, patient or polite.** Those are not measurements, and a model
  asked about tone answers about tone rather than about the session.

## Provenance

Written 2026-10-03, before any run of it, against the same session (`session-bba92d44-...`, "Assisted freeciv play",
611 messages) that `agent-helpfulness-session@1` was measured on -- so the two sets can be read side by side on one
conversation. **It has NOT been labelled against a battery**, unlike `agent-helpfulness-session`, whose first battery
run is what caught six wrong expectations in it. Until a battery exists for these questions, their readings are
unvalidated: `system1_battery` is the way to change that, and `criteria/agent-helpfulness-session.battery.json` is the
worked example of the format.
