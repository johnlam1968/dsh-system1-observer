# `lib/`, in one page

The map of this directory, grouped by what a reader is trying to do rather than by topic. **It is enforced**: a test
scans `lib/` recursively and fails if a file is not named here, or if a name here does not exist — so a new file must
be declared, exactly as a new host call must be declared in `host/index.js`.

Two things this map deliberately does **not** carry, because something else already owns them:

* **which files touch the harness** — `test/host-inventory.test.js` derives that from `host/index.js` by scanning for
  real host calls with comments stripped. A hand-written "coupled" column would be a second, drifting answer.
* **line counts and percentages** — those move with every edit; a number here would be wrong within a week.

Paths are relative to `lib/`.

## Nominated for retirement

A file may be kept, but not silently: if its own header says it should go, the condition that retires it lives here.
`test/growth.test.js` checks this both ways — a nominating file that is missing, or a row whose file no longer
nominates itself, fails. (Size budgets, the other half of that test, are machine facts and live beside it.)

| file | retired by | what says so |
|---|---|---|
| `packages/session-adapter/lib/feed.js` | **MOVING to the session adapter (§14.6 (d)), not deleting**: its condition cannot be met where it is needed. Measured 2026-10-05 (`F104`) -- the authority is ASYNC and OPTIONAL, and the in-band path cannot await, so a deployment without `sessionQuery` would lose the answer entirely | its header: *"`readSession` for the log, `readSurface` for the surface; when the plugin is wired to that, these two modules are the ones to delete"* |
| `packages/session-adapter/lib/surface.js` | **WIRED, and NOT deleted, because deleting it is wrong** (`F104`): `sessionQuery.filterEvents(sessionId, [{kind:'surface', values:['current']}])` is now asked wherever a caller can await (`lib/surface-authority.js`), and this fold is the fallback for a deployment with no `sessionQuery` -- without which the shadowed-answer defect it was written for comes back. It MOVES to the session adapter with `feed.js` | its header: *"when the plugin is wired to it this fold is redundant and should be deleted"* |

## The subject: what gets measured


**THE SESSION-SHAPED THREE ARE NO LONGER IN `lib/host/`.** The harness's event vocabulary (`session-format`), the surface
fold (`surface`) and the event feed (`feed`) are the pure half of the session adapter and live in the package
[`dsh-session-adapter`](packages/session-adapter/), imported by name. The reason is measured (`F104`): they must be
**importable**, because the composer runs inside a synchronous path that cannot await a Cordis service. `fs-journal.js`
and this map stay, because the filesystem journal is not session-shaped.
* `subject-settings.js` — the row's own subject settings (`source`, `sessionId`, `kinds`, `lastMessages`), read
  live. It is the ONE part of the old `session-subject.js` that read OUR config; the rest was the harness's shapes
  and is now `dsh-session-adapter/reader`, with `surface-authority` beside it. Both take the `sessionQuery`
  service as a PARAMETER, so they still contain no host call for the inventory to find.
* `sessions-search.js` — the search action and its two backends: the harness index first, the hand-rolled store second, and which one answered always stated

**THE STORE IS NO LONGER IN THIS REPOSITORY.** It is its own plugin and repo, [`dsh-session-index`](https://github.com/johnlam1968/dsh-session-index), which imports no dsh code: FTS5 search, listing, reading, and an incremental rebuild behind a `localSessionIndex` service, plus four agent-facing tools of its own. `lib/sessions-search.js` and the tool consume it through that package, and the map above no longer lists its files because they are not this plugin's files any more.
* `sessions-tool-output.js` — the tool's output schema and its rendering, split out of `sessions-tool.js` when the fourth action arrived
* `exchange.js` — G0: the human's asks and the turn's last word, and the turn is the unit the harness numbers
* `sessions.js` — which sessions the observer watches at all
* `subject.js` — which model produced the text being judged

## Composition: what the judge is given

* `turn-state.js` — the state a judgement is made from, and what it keeps at both ends
* `segment.js` — segmenting a subject that does not fit one request, and the arithmetic over the parts
* `tool-blocks.js` — the `TOOL CALLS` section, and what was clipped out of it
* `redact.js` — redaction, and the rule that it applies to the trace's copy only
* `stream.js` — the one seam that is not a decision

## The instrument: asking the decision model

* `questions.js` — what the observer asks, in one place
* `question-sets.js` — question sets as files: read them, hash them, list them
* `seams.js` — a real decision-model call available at every seam
* `observe.js` — the call and the line: everything that can go wrong, covered
* `model/limits.js` — what the backend will actually take, from the vendor's published numbers
* `model/wire.js` — one POST, and every way it can go wrong turned into a result
* `model/client.js` — the client of that wire
* `model/service.js` — the host service as the preferred route, with the wire as fallback
* `model/service-answers.js` — the service's answer shape, which is not the wire's
* `model/narrow.js` — narrowing a reply to the answer type that was asked for
* `model/questions.js` — building the questions the wire carries
* `model/envelope.js` — one home for what crosses the transport boundary
* `model/result-envelope.js` — where a transport puts its envelope
* `model/escalation.js` — when a cheap model's answer is escalated

## The record: what was written down

* `evidence.js` — the evidence record: what was observed, what was decided, and what is missing
* `trace-read.js` — one reader for the trace, so the views of it cannot disagree
* `trace-report.js` — `system1_trace`: the agent-facing trace reader
* `trace-data.js` — the same trace in a shape a renderer can draw
* `config-event.js` — the config event, and the reader that makes it worth writing
* `turn-record.js` — the `turn` trace line, and the acceptance check that proves it

## Judgements about the instrument itself

* `probe-score.js` — does the question actually separate
* `calibrate.js` — is the confidence worth anything
* `battery.js` — the labelled battery: the only thing that can tell a better question from a different one
* `compare.js` — are two runs the same experiment
* `cost.js` — what the judgement cost, and what it is not
* `honesty.js` — what this record claims about itself, and what nobody has checked
* `label-hash.js` — a declared label, as a hash on the line
* `nudge-label.js` — the independent label for `operator_had_to_nudge`

## Measurements made portable

* `report.js` — the measurement report package: a measurement made portable, and what in it is reproducible

## The agent-facing tools

* `tool.js` — the agent's way in
* `tool-args.js` — checking a model's arguments against the tool's own declaration
* `decide-tool.js` — `system1_decide`
* `evaluate-tool.js` — `system1_evaluate_session`
* `results-tool.js` — `system1_measurements`
* `sessions-tool.js` — `system1_sessions`
* `questions-tool.js` — `system1_question_sets`
* `battery-tool.js` — `system1_battery`
* `config-tool.js` — `system1_settings`

## The turn path: the harness seam

* `register.js` — which seams are subscribed, and the shape each one needs
* `turn-listener.js` — the turn listener, as a decision rather than an effect
* `turn-observer.js` — the turn observation, from the listener to the line
* `turn-trigger.js` — the trigger's decision: whether to fire, and which question set

## The host adapter

* `host/index.js` — the host surface this plugin depends on, in one place, and how it is checked
* `host/fs-journal.js` — what the filesystem actually did, recorded from the harness

## Our own footprint

* `egress.js` — what leaves the process, and where it goes
* `telemetry.js` — the harness's own outbound telemetry, which is unredacted
* `config-value.js` — reading a config field, when the field may be an accessor
* `config-writer.js` — the write, as a module, so the dangerous part is tested
* `service.js` — the observer as a service, so another row can read what this one measured

## Gates and shared

* `citations.js` — does every `docs/...` path a comment names actually exist
* `compat.js` — what this package was tested against, and what it merely supports
* `is-record.js` — narrowing helpers for data that crosses a runtime boundary
