# news-claim-check@1

Judges one factual claim against the excerpts cited beside it. It is a **port**, not an invention: the
relation question is the one `fake-real.live` runs in production
([DansiDanutz/fake-real-jev](https://github.com/DansiDanutz/fake-real-jev), `lib/claim-check.js`),
reshaped into this repository's spec schema. That project's `criteria` map becomes an `options` list,
and its third relation `unknown` becomes the abstain option -- which is the honest reading of it: the
production site shows it as a relation and never counts it as evidence, and an abstain option is
exactly a label the model may pick that the caller must not act on.

## The scope is `admit`, and why that is not a category error

The rule in `SET-AUTHORING.md` is that a question may only name state the composer actually emits for
its scope. An article does not arrive as a seam's text, so this set would be unanswerable at
`assemble` or `post_execute` and is written for **`admit`**, which emits the operator's own message:
that is the seam at which a pasted claim and its excerpts actually enter the loop. Every question
below names **nothing** -- each says "in the state" -- so the set is valid for whatever text `admit`
carries, and it does not pretend to a `SESSION TRANSCRIPT` it was not given.

## The three questions, and their polarity

| id | type | detects | true / high means |
|---|---|---|---|
| `admit_claim_relation` | choice | the relation between claim and evidence | `supported` is the answer that advances; `contradicted` and `unknown` are the refusals |
| `admit_excerpts_address_the_claim` | noul | whether the evidence is even about this claim | `true` = the excerpts can bear on it; `false` = adjacent subject |
| `admit_evidence_directness` | score | how squarely the excerpt states the figure or date | `directly` = it states it in so many words |

**Why each is narrow.** The relation question asks one question about one claim: the project's design
already puts code, not the model, in charge of the verdict -- `fake-real-jev` calls Jev once per
claim and folds the answers in deterministic code, and this set keeps that separation. The second
question exists because the production pipeline uses a separate Noul batch to decide which retrieved
pages are worth reading at all; folding that into the relation question would make one id carry two
judgements, which cannot be calibrated. The ladder is three levels because the levels are what make
it calibratable at all.

**What this set deliberately does not do.** It does not judge whether the article as a whole is
"fake". The one project that asks that way
([Vaskoor/fake-news-jev](https://github.com/Vaskoor/fake-news-jev)) asks 19 style questions and folds
them with a trained LightGBM meta-classifier, and its own README reports that a real but
sensational article accumulates "fake-looking signals". That is a classifier over signals, not a
question; the claim-vs-evidence question is the one that can be asked and checked.

## Verification

`criteria/news-claim-check@1.battery.json` holds six constructed cases whose labels are true by
construction: an exact match, a figure mismatch, no excerpts at all, an off-topic excerpt, a
right-subject excerpt that never states the figure, and a date mismatch with the figure intact. Run
it with `system1_battery { action: 'run' }`. **A first run is not a result until it has been read for
inversion** -- the shape of the question set is borrowed from a production system that used a
different provider, so its polarity here is an assumption until the battery says otherwise.
