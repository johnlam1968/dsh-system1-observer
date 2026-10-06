# `docs/` — what each file is for, and which are working notes

**The user manual is [`manual.md`](manual.md)** — the reference: every setting, the seams, the trace, mounting, and the
measured claims with the ones that are not verified. The repository `README.md` is the landing page, capped at 100
lines by `test/readme.test.js`, and it links here. Start at the README; come back here only if you want the reasoning
behind a decision.

**Some of these notes are not in this repository at all.** The ones marked *kept locally* live on the author's host
and are deliberately unpublished — they are the development record, and they were removed from the repository and
from its history on 2026-10-06. The paths below record where they sit, not what a clone contains.

**None of this directory is published to npm.** The package ships the README and the code, and
`test/package-contents.test.js` asserts that by reading the tarball npm would actually produce. So the files below are
the project's record, kept because a measurement without its reasoning is a number somebody has to re-derive.

## Useful if you are USING the observer

| file | what it answers |
|---|---|
| `manual.md` | the reference manual: hooks, every setting, the trace, mounting, the measured claims and the unverified ones |
| `case-study-readme-review.md` | **a worked example of using this plugin**: two agents collected what the sources require of a README, measured this repository's own front page with it, checked each other and recorded their mistakes |
| `readme-standards.md` | the standards, the twelve text-checkable questions derived from them, and every reading taken with them — including the questions that did not survive checking |
| `settings.md` | every setting: what it does, what it costs, and why it exists (the table the settings card is built from) |
| `measurement-depth.md` | what evidence a judgement is given — the groups G0–G4 — and what each one can and cannot support |
| `question-suitability.md` | which question type fits which evidence, and the selection methods |
| `adapters-and-standards.md` | the session formats this reads and the adapter boundary |

## Working notes: the DEVELOPMENT record, not documentation

| file | what it is |
|---|---|
| `findings.md` | **the register**: every defect, its cause, its consequence, and its status, numbered in the order they were found. The reason the code is shaped the way it is |
| `conventions.md` | the rules this repository holds itself to, each with the measurement that produced it |
### Kept locally, deliberately not in this repository

| file | what it is |
|---|---|
| `ECOSYSTEM_STUDY.md` | the survey of the surrounding ecosystem that informed the design — background reading, long |
| `plans/` | dated plan notes, kept as written rather than rewritten to match what happened |
| `port/` | porting notes for moving this capability to another host; `port/README.md` is their index |
| `assistant-contract-small-model.md` | a draft contract for small-model assistants — an idea under discussion, not a shipped behaviour |
| `reports/` | iteration reports: what a run of the measurement loop found, measured rather than claimed |
| `handoff.md` | what the last working session left for the next one |
| `../RELEASING.md` | the release runbook: the three-package order, the tokenless path, and what does not ship |

If a file here contradicts the code, **the code wins** and the file is a defect: the register is where that is recorded.
