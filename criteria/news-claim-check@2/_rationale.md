# news-claim-check@2

`@1` with ONE question reworded, and nothing else touched. It exists because two batteries found the same defect
three times, and the repetition is the evidence.

## What the batteries showed

| battery | `admit_excerpts_address_the_claim` |
|---|---|
| `news-claim-check@2` (6 cases) | 4/6 — misses `right_subject_no_figure` |
| `news-claim-check@3` (6 new cases) | 4/6 — misses `scope_narrowed`, `fragment_too_short` |

All three misses are one shape: **an excerpt on the right subject that never states the figure.** Every other
case the same question answered correctly, including the ones where it had to say `false` (`no_excerpts`,
`off_topic_excerpt`, `date_mismatch`), so it was not a question that always said one thing -- it was a question
that changed meaning when the figure was absent.

## The wording that caused it

`@1` asked: *"Do the cited excerpts address the EXACT CLAIM...?"* The word `exact` carries the figure, the date
and the scope, so "address the exact claim" reads as *does the excerpt state it* -- which is `admit_evidence_
directness`'s job, already asked by the score question three lines away. One id was doing two judgements, which
is the exact thing `SET-AUTHORING.md` calls uncalibratable, and it showed up as an accuracy that would have
improved by luck rather than by a fix.

## What changed

`@2` asks about the SUBJECT and says so: *"Is each cited excerpt about the SAME SUBJECT as the claim... whatever
it does or does not say about the claim's figure, date or wording? ... Whether the excerpt STATES the claim is a
separate question, and an excerpt on the right subject that is silent about the figure still answers true here."*

The last clause is the load-bearing one: it names the case that used to fail and settles it in the text.

| | `@1` | `@2` |
|---|---|---|
| relation | 6/6 | 6/6 |
| directness | 6/6 | 6/6 |
| subject | 4/6 | **6/6** |

Same battery (`news-claim-check@3`, hash `d110b41ca06b`), same labels, same backend, recorded as a comparison
against parent set `49564c8cb0a8`.

## What is still NOT established

- **n=6 per question, one run, one backend.** `jev-latest` resolves to `typesafe/jev-1.14-20261014` today; a
  threshold or an accuracy is not a property of the model name.
- **Two cases are known-weak by construction** and are in the battery on purpose: `self_citing` (an article
  cited as its own evidence is labelled `supported`, and no question in this set can see that it is not
  independent corroboration) and `scope_narrowed` (an excerpt covering part of a population cannot settle a
  claim about all of it). Both are recorded at 6/6, which is NOT a claim that the instrument handles either --
  they are claims that the instrument cannot see them.
- **A 100% on six constructed cases is a floor, not a ceiling.** The cases were written by the same person who
  wrote the questions, which is the weakest link this battery has, and it is the reason `self_citing` is in here.
