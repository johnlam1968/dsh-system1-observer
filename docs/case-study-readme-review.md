# Case study: two agents, one rubric, and a repository README

**What this is.** A worked example of this plugin used for something it was not built for: deciding what a public
repository's front page should say. Two agents — different models, different sessions — collected what authoritative
sources require of a README, turned those requirements into questions a judge could answer about the *text*, measured
two candidate front pages, reviewed each other's work, and ended by enforcing the result with a test.

**Everything below is traceable.** Each reading is a `hook: "tool"` line on `~/.dsh/logs/system1-observer.jsonl`
carrying the question ids and the model that answered (`typesafe/jev-1.13-20260917`). The measurements, their limits
and the mistakes are in [`readme-standards.md`](readme-standards.md), which is the working record this page summarises.

## The question

The operator, reading the npm page: *"the Readme … which is very verbose, human won't read it. Even an agent will find
it too long."* Then: *"check if such README is suitable to appear at the front page of the repo on github."*

That is a judgement call, and it was answered with a measurement instead.

## 1. What the sources require, collected by two agents independently

| source | what it settles |
|---|---|
| [Standard Readme](https://github.com/RichardLitt/standard-readme/blob/master/spec.md) | a specification with Required/Optional sections, an order, a 120-character short description, and a table of contents above 100 lines |
| [GitHub Docs — About READMEs](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes) | **"A README should only contain information necessary for developers to get started using and contributing to your project. Longer documentation is best suited for wikis."** |
| [opensource.guide](https://opensource.guide/starting-a-project/) | the four questions a README answers: what, why, how to start, where to get help |
| [Art of README](https://github.com/hackergrrl/art-of-readme) · [Make a README](https://www.makeareadme.com/) | two opposite length rules — which is a finding, not a tie |
| two university evaluation checklists | cited, **not read**: both are PDFs the environment could not fetch |

The two agents could not each fetch everything — one got GitHub's body text and opensource.guide, the other got Art of
README and Make a README — so the sources were pooled, and each verified the other's citations rather than trusting
the summary.

**Three conflicts came out of it**, each resolved rather than averaged: brevity against comprehensiveness; where the
licence goes (Art argues high, Standard Readme requires last); and the table-of-contents rule, which is itself a
judgement that a README past 100 lines has stopped being a front page.

## 2. Standards become questions a judge can answer

The judge receives **only the text** — no repository, no CI, no rendered page — so every criterion had to be decidable
from words alone. Twelve resulted, each with the source that justifies it: `install_present`, `usage_example_present`,
`licence_stated`, `help_or_contributing_path`, `getting_started_scope`, `internal_plumbing_present`,
`first_screen_sufficient`, `states_what_it_is`, `states_why_useful`, a five-option `primary_audience`, and two `score`
questions.

They cannot be stored as a question set: every set this plugin loads declares a scope, and the writable scopes are the
nine seams, `turn` and `session`. A README is none of those, so a document-evaluation instrument is passed per call —
itself a finding about the plugin's reach.

## 3. Two candidates, one instrument

The old front page (the first 68 lines of a 775-line manual) against the proposed landing page:

| question | the manual's front page | the landing page |
|---|---|---|
| `primary_audience` | **a_contributor 0.57** | **a_first_time_visitor 0.90** |
| `install_present` | **0.13** | 0.76 |
| `help_or_contributing_path` | **0.08** | 0.11 |
| `getting_started_scope` | **0.34** | 0.90 |
| `internal_plumbing_present` | **0.97** | 0.75 |
| `audience_fit` (of 4) | **1.91** | 3.10 |
| `front_page_quality` (of 4) | *unreadable — provider error, twice* | 3.11 |

**The operator's complaint came back as numbers**: a contributor document, plumbing at 0.97, no install command, no way
to ask for help. And the measurement found two defects in the *new* page that the prose review had not: no help path,
and internals still at 0.75 because the cautions used the project's own vocabulary. Both were fixed and re-measured —
**0.99** and **0.35** — rather than argued away.

## 4. The second agent reviews, and the two readings are compared

The reviewing agent built its own criteria list from its own sources and gave a structural verdict: funneling
violated, licence not last, and **a Contributing section missing from both candidates**. That last one the judge had
independently put at 0.08 and 0.11 without seeing the review. Two methods, one defect, and the fix moved it to 0.99.

They also **diverged**, and the divergence was recorded rather than smoothed: the reviewer treated Standard Readme's
120-character one-liner as a defect; the judge scored the existing opening 0.89–0.94. Neither is wrong — a strict
specification constrains form, the judge measures what a reader learns — so conformance became a choice, and the
one-liner was adopted for its own reason (the GitHub description, the npm description and the README's short
description become one string with one source of truth).

## 5. Testing the instrument, not just the page

The reviewer then ran a **blinded** trio on READMEs neither agent had written, and reported that two questions
*inverted* — a 62-line student README scoring above a 39,000-star project. A result that contradicts a measurement has
to be re-run, so it was:

- **The inversion did not reproduce.** Both questions ordered the documents as intended on the full states.
- **Then the reviewer checked its own trace and retracted two of its own claims** — that the harness rejects
  multi-question arrays (its trace shows a twelve-question array with `choice` and `score` specs arriving intact), and
  that its candidates had all been whole documents (62 lines of a several-hundred-line README is a slice).
- **My explanation was wrong too.** I had proposed its questions arrived empty (`F43`'s class). They had not. Repeating
  each cell priced the real cause: **state reduction** — within-cell swings of 0.24–0.29 on the same state, provider
  and model, for exactly the questions that had "inverted". A three-sentence README and a short excerpt of a technical
  one both look like "no plumbing, no help path".
- **So state scope is part of the instrument**, and an excerpt reading is not comparable with a document reading.

Then the two calibrated questions were repeated on the states the decision actually used:

| question | old front page, two runs | new README, two runs | gap |
|---|---|---|---|
| `install_present` | 0.13 / 0.14 | 0.90 / 0.90 | 0.77 |
| `getting_started_scope` | 0.34 / 0.36 | 0.88 / 0.88 | 0.53 |

Within-cell variance 0.01–0.02; the gaps are 25 to 50 times the noise.

## 6. The result is enforced, not promised

The reference material moved **verbatim** to [`manual.md`](manual.md); the README became the landing page; and
`test/readme.test.js` now holds it to **100 lines and 800 words** — the length at which Standard Readme starts
requiring a table of contents — plus absolute repository links, because npm renders the same file and a relative link
breaks there. The failure message names where material belongs, and forbids raising the limit without re-measuring the
audience question. **It caught its own first draft at 102 lines.**

## What this is an example OF

- **Measurement over opinion.** The operator's instinct was right; the instrument said *how* right, and on which axis.
- **Traceability.** Every figure is on the trace with the question that produced it and the model that answered.
- **Honest limits in public.** Uncalibrated questions are labelled; a missing cell is admitted as a provider error; the
  noise is priced before any gap is claimed.
- **Two agents as a check, not a chorus.** The disagreement was settled by re-running, and the reviewer improved its
  own record by checking its trace — the retractions are in the file, next to the claims they replace.
- **The instrument's own errors are in the record**, including mine.

## What it does NOT show

The rubric is not a general README grader. **Two questions are calibrated** with repeats on decision-relevant states,
two are directional only when the whole document is given, eight have never been asked of a document neither agent
wrote, and there is **no labelled truth** — star counts are reputation, not measurement. The front-page decision rests
on the two calibrated questions, whose gaps are an order of magnitude above the measured noise, and on nothing else.
