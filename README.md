# dsh-system1-observer

**Human's words:** This is vibe-coded. Agents could take initiative to, and are mostly free to gather rubric and evaluate using system1 call on parts or whole of sessions.
Almost all is volatile. Agent can change configurations which will be hot-loaded.
Measurement being important, the actions to make use of the evaluation are interesting and useful. 
The "seams" are there to feedback to the human or agent, and the current state of this project provides a flexible basis.

Following is written by agents, self-evaluated and compared notes, with README writing standards they researched and formulated.
These words are results of two LLM in DeepSeek Harness and a TypeSafe jev model in dsh-system1-observer plugin.

--------

**A seam observer for the DeepSeek Harness.** It asks a System One model what the agent loop is doing — at the points
you choose — and writes every call, every skip and every answer to a JSONL trace.

**It decides nothing.** Each listener returns the loop's own decision *by reference*; every trace line says
`enforcement: "declarative", verified: false`. Its product is evidence about the decision model's replies at each point
of the loop, not judgements about the session it is observing.

**This page is short on purpose**: it is capped at 100 lines by `test/readme.test.js`, and the reference material —
every setting, the seams, the trace, and the measured claims **with the ones that are not verified** — is in the
[manual](https://github.com/johnlam1968/dsh-system1-observer/blob/master/docs/manual.md).

## Install

```bash
dsh plugin --profile web add dsh-system1-observer
```

`web` is the profile to install into — substitute the name of yours. Or from a clone, which needs no npm account:

```bash
git clone https://github.com/johnlam1968/dsh-system1-observer.git
cd dsh-system1-observer && ./install.sh web
```

It needs the profile's harness for `@deepseek-ai/cordis` and `@deepseek-ai/dsh-tools` (they are **peerDependencies**,
not bundled), and a model to call: the profile's `system1` service, or the HTTP wire at `wireUrl` (default
`http://127.0.0.1:8766`).

## Sixty seconds

```
system1_explain                                    what it can do, what it is set to now, what a reading covers
system1_sessions  { action: 'list', search: 'XYZ' }                 find the session
system1_evaluate_session { sessionId: '…', segmentChars: 57600, package: true }   judge it, and package the run
system1_measurements { action: 'interpret', package: '…', text: '…', by: 'you' }  attach your reading
```

`system1_evaluate_session` does the mechanical work in one call: it reads the session, segments it if it is large, asks
every question of every segment, aggregates in code and writes a report package. The last step is a separate call, and
deliberately yours — prose cannot be derived from numbers.

Nine tools in all: `system1_explain`, `system1_settings`, `system1_decide`, `system1_evaluate_session`,
`system1_measurements`, `system1_sessions`, `system1_question_sets`, `system1_battery`, `system1_trace`.

## What you get

- **The trace**: `~/.dsh/logs/system1-observer.jsonl` — one line per call, per skip and per start-up, read by the
  `system1_trace` tool, the trace card, or `scripts/trace.mjs`.
- **The settings card** on the Plugins page: every live-writable setting, and "…" → **Observe this session**.
- **A written record**: the [register](https://github.com/johnlam1968/dsh-system1-observer/blob/master/docs/findings.md)
  notes every problem this instrument has had and the measurement that found it.

## Before you trust a reading

1. **Long conversations are summarised** unless you pass `segmentChars` — a large session needs segments.
2. **Where it has no question of its own, it records that it did not ask** rather than guessing.
3. **Its built-in question is measurably weaker at the tool-call points**, so a tool-heavy run reads differently.
4. **Readings either side of a configuration change are not comparable** — every change is written to the trace first.

`system1_explain` prints these in full, derived from the running row.

## Working on it

```bash
npm run ci    # the six gates in order: test, coverage, citations, compat, composition, deploy
```

The rules this repository holds itself to, each with the measurement that produced it, are in the [conventions](https://github.com/johnlam1968/dsh-system1-observer/blob/master/docs/conventions.md).

## Questions, and contributing

Ask in [GitHub issues](https://github.com/johnlam1968/dsh-system1-observer/issues); pull requests are welcome. How a release
happens, and what it does not ship, is the maintainer's runbook, kept off-repository with the other notes.

## Documentation

| | |
|---|---|
| [manual](https://github.com/johnlam1968/dsh-system1-observer/blob/master/docs/manual.md) | the reference: hooks, every setting, the trace, mounting, the measured claims and the unverified ones |
| [docs/settings.md](https://github.com/johnlam1968/dsh-system1-observer/blob/master/docs/settings.md) | every setting: what it does, what it costs, why it exists |
| [docs/measurement-depth.md](https://github.com/johnlam1968/dsh-system1-observer/blob/master/docs/measurement-depth.md) | what evidence a judgement gets (G0–G4) |
| [docs/question-suitability.md](https://github.com/johnlam1968/dsh-system1-observer/blob/master/docs/question-suitability.md) | which question type fits which evidence |
| [case study](https://github.com/johnlam1968/dsh-system1-observer/blob/master/docs/case-study-readme-review.md) | two agents, one rubric and this page's own redesign, measured — the method, the numbers and the mistakes |

## Licence

MIT — see [LICENSE](https://github.com/johnlam1968/dsh-system1-observer/blob/master/LICENSE).
