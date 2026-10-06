# dsh-system1-observer

**A seam observer for the DeepSeek Harness.** It asks a System One model what the agent loop is doing — at the points
you choose — and writes every call, every skip and every answer to a JSONL trace.

**It decides nothing.** Each listener returns the loop's own decision by reference; every trace line says
`enforcement: "declarative", verified: false`.

The full manual is the [repository README](https://github.com/johnlam1968/dsh-system1-observer#readme). This page is
the short version: install, one example, and the four things to know before trusting a reading.

## Install

```bash
dsh plugin --profile <profile> add dsh-system1-observer@beta
```

Or from a clone, which needs no npm account: `git clone … && cd dsh-system1-observer && ./install.sh <profile>`.

It needs a profile's harness for `@deepseek-ai/cordis` and `@deepseek-ai/dsh-tools` (they are
**peerDependencies**, not bundled), and a model to call: the profile's `system1` service, or the HTTP wire at
`wireUrl` (default `http://127.0.0.1:8766`).

## Sixty seconds

```
system1_explain                                    what it can do, what it is set to now, what a reading covers
system1_sessions  { action: 'list', search: 'XYZ' }                 find the session
system1_evaluate_session { sessionId: '…', segmentChars: 57600, package: true }   judge it, and package the run
system1_measurements { action: 'interpret', package: '…', text: '…', by: 'you' }  attach your reading
```

`system1_evaluate_session` does the mechanical work in one call: it reads the session, segments it if it is large,
asks every question of every segment, aggregates in code and writes a report package. The last step is a separate
call, and deliberately yours — prose cannot be derived from numbers.

Nine tools in all: `system1_explain`, `system1_settings`, `system1_decide`, `system1_evaluate_session`,
`system1_measurements`, `system1_sessions`, `system1_question_sets`, `system1_battery`, `system1_trace`.

## What you get

- **The trace**: `~/.dsh/logs/system1-observer.jsonl` — one line per call, per skip (with the reason it did not ask)
  and per start-up. Read it with the `system1_trace` tool, the trace card in a conversation, or `scripts/trace.mjs`.
- **The settings card** on the Plugins page: every live-writable setting, and "…" → **Observe this session**.
- **A written record**: [docs/findings.md](https://github.com/johnlam1968/dsh-system1-observer/blob/master/docs/findings.md)
  notes every problem this instrument has had and the measurement that found it.

## Before you trust a reading

1. **Long conversations are summarised** unless you ask for segments — pass `segmentChars` when the session is large.
2. **Where there is no question of its own, it records that it did not ask** rather than guessing — so a quiet trace
   says which check stopped it, not that nothing happened.
3. **Its built-in question is measurably weaker at the tool-call points than elsewhere**, so a run full of tool calls
   reads differently from a conversation.
4. **Readings either side of a configuration change are not comparable** — every change is written to the trace first.

## Questions, and contributing

Ask in [GitHub issues](https://github.com/johnlam1968/dsh-system1-observer/issues); pull requests are welcome, and
`RELEASING.md` and the repository's conventions describe how the project is run.

## Documentation

| | |
|---|---|
| [repository README](https://github.com/johnlam1968/dsh-system1-observer#readme) | the manual: hooks, config, the trace, mounting, the client card |
| [docs/settings.md](https://github.com/johnlam1968/dsh-system1-observer/blob/master/docs/settings.md) | every setting: what it does, what it costs, why it exists |
| [docs/measurement-depth.md](https://github.com/johnlam1968/dsh-system1-observer/blob/master/docs/measurement-depth.md) | what evidence a judgement gets (G0–G4) |
| [docs/question-suitability.md](https://github.com/johnlam1968/dsh-system1-observer/blob/master/docs/question-suitability.md) | which question type fits which evidence |
| [RELEASING.md](https://github.com/johnlam1968/dsh-system1-observer/blob/master/RELEASING.md) | how a release happens, and what it does not ship |

## Licence

MIT.
