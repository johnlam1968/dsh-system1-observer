# `docs/` — what each file is for, and which are working notes

**The user manual is the repository `README.md`.** It covers installing, configuring, reading a trace, mounting the
row and the skills. Start there; come back here only if you want the reasoning behind a decision.

**None of this directory is published to npm.** The package ships the README and the code, and
`test/package-contents.test.js` asserts that by reading the tarball npm would actually produce. So the files below are
the project's record, kept because a measurement without its reasoning is a number somebody has to re-derive.

## Useful if you are USING the observer

| file | what it answers |
|---|---|
| `settings.md` | every setting: what it does, what it costs, and why it exists (the table the settings card is built from) |
| `measurement-depth.md` | what evidence a judgement is given — the groups G0–G4 — and what each one can and cannot support |
| `question-suitability.md` | which question type fits which evidence, and the selection methods |
| `adapters-and-standards.md` | the session formats this reads and the adapter boundary |

## Working notes: the DEVELOPMENT record, not documentation

| file | what it is |
|---|---|
| `findings.md` | **the register**: every defect, its cause, its consequence, and its status (`F1`–`F133`). The reason the code is shaped the way it is |
| `conventions.md` | the rules this repository holds itself to, each with the measurement that produced it |
| `handoff.md` | what the last working session left for the next one |
| `ECOSYSTEM_STUDY.md` | the survey of the surrounding ecosystem that informed the design — background reading, long |
| `plans/` | dated plan notes, kept as written rather than rewritten to match what happened |
| `port/` | porting notes for moving this capability to another host; `port/README.md` is their index |
| `assistant-contract-small-model.md` | a draft contract for small-model assistants — an idea under discussion, not a shipped behaviour |

If a file here contradicts the code, **the code wins** and the file is a defect: the register is where that is recorded.
