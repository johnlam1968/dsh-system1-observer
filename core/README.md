# The map: `core/` and `dsh/`

The map of this package, grouped by what a reader is trying to do rather than by topic. A name carrying a
`dsh/` prefix lives in the ADAPTATION to one harness; everything else is the instrument. **It is enforced**: a test
scans both folders recursively and fails if a file is not named here, or if a name here does not exist -- so a new file
must be declared, exactly as a new host call must be declared in `dsh/host/index.js`.

Two things this map deliberately does **not** carry, because something else already owns them:

* **which files touch the harness** — `test/host-inventory.test.js` derives that from `dsh/host/index.js` by scanning for
  real host calls with comments stripped. A hand-written "coupled" column would be a second, drifting answer.
* **line counts and percentages** — those move with every edit; a number here would be wrong within a week.

Paths are relative to their own folder: an instrument module is named bare (`report.js`), and an adaptation module
carries its `dsh/` prefix (`dsh/exchange.js`), which is the same name the code and the gates use.

## Nominated for retirement

A file may be kept, but not silently: if its own header says it should go, the condition that retires it lives here.
`test/growth.test.js` checks this both ways — a nominating file that is missing, or a row whose file no longer
nominates itself, fails. (Size budgets, the other half of that test, are machine facts and live beside it.)

| file | retired by | what says so |
|---|---|---|
| `dsh/session-adapter/lib/feed.js` | **MOVING to the session adapter (§14.6 (d)), not deleting**: its condition cannot be met where it is needed. Measured 2026-10-05 (`F104`) -- the authority is ASYNC and OPTIONAL, and the in-band path cannot await, so a deployment without `sessionQuery` would lose the answer entirely | its header: *"`readSession` for the log, `readSurface` for the surface; when the plugin is wired to that, these two modules are the ones to delete"* |
| `dsh/session-adapter/lib/surface.js` | **WIRED, and NOT deleted, because deleting it is wrong** (`F104`): `sessionQuery.filterEvents(sessionId, [{kind:'surface', values:['current']}])` is now asked wherever a caller can await (`lib/surface-authority.js`), and this fold is the fallback for a deployment with no `sessionQuery` -- without which the shadowed-answer defect it was written for comes back. It MOVES to the session adapter with `feed.js` | its header: *"when the plugin is wired to it this fold is redundant and should be deleted"* |

## The subject: what gets measured


**THE SESSION-SHAPED THREE ARE NO LONGER IN `lib/host/`.** The harness's event vocabulary (`session-format`), the surface
fold (`surface`) and the event feed (`feed`) are the pure half of the session adapter and live in the package
[`dsh-session-adapter`](dsh/session-adapter/), imported by name. The reason is measured (`F104`): they must be
**importable**, because the composer runs inside a synchronous path that cannot await a Cordis service. `fs-journal.js`
and this map stay, because the filesystem journal is not session-shaped.
* `dsh/session-subject-tool.js` — **the SUBJECT a judgement is composed from**: one stored session's operator and
  assistant messages, sliced by `kinds` and `lastMessages` exactly as `system1_evaluate_session` slices them,
  with `offset` to page backwards and `format: 'subject'` for the composed state. It was `lib/sessions-tool.js`
  (`system1_sessions`, four actions); `list`, `search` and `refresh` moved to the `dsh-session-index` plugin's
  `session_index_*` tools, which answer them from a SQLite store in milliseconds where `list` here took ~54 s,
  and the name changed so what remains says what it is. `lib/sessions-search.js` (the two-backend precedence
  policy, whose first backend this deployment leaves at `openAt: never`) and `lib/sessions-tool-output.js` (the
  schema and render for all four actions) went with them; the read's schema and render are in the tool now
* `dsh/subject-settings.js` — the row's own subject settings (`source`, `sessionId`, `kinds`, `lastMessages`), read
  live. It is the ONE part of the old `session-subject.js` that read OUR config; the rest was the harness's shapes
  and is now `dsh-session-adapter/reader`, with `surface-authority` beside it. Both take the `sessionQuery`
  service as a PARAMETER, so they still contain no host call for the inventory to find.
* `dsh/deepseek-web-export.js` — **intake for a foreign transcript**: a DeepSeek Chat web export (`conversations.json`)
  as DSH session events, because the adapter reads HARNESS sessions and has no reader for any other format. Every
  rule in it was measured by the *Paper screening* session and is carried with its reasoning — the deepest-subtree
  branch rule, the pinned `source.kind: 'user'` title, the `step/start` pairing the harness enforces at read time,
  and the losses it refuses to fabricate (`F147`, `docs/adapters-and-standards.md`). The half that needs a harness
  is the writer, `scripts/import-deepseek-web.mjs`.
* `dsh/pi-session-export.js` — **the same conversion for pi** (`pi-coding-agent`), the format `docs/adapters-and-standards.md`
  names as the cheapest second adapter: 223 sessions on this host, a flat JSONL log, the same store layout. Three
  rules make it a conversion rather than a copy, each measured on the corpus rather than read off a spec: the live
  branch is pi's **leaf path** (not file order — a session can branch, and flattening two branches would merge two
  conversations), a **turn is derived from the operator ask** because *pi has no turn at all*, and an injected
  `custom_message` is a **message inside a turn, never an ask** — 183 of them on this host would otherwise have
  become 183 invented operator turns. The writer is `scripts/import-pi-sessions.mjs`, and it is **additive** where
  the DeepSeek one wipes its root, because it writes beside a live deployment's own sessions.

**THE STORE IS NO LONGER IN THIS REPOSITORY.** It is its own plugin and repo, [`dsh-session-index`](https://github.com/johnlam1968/dsh-session-index), which imports no dsh code: FTS5 search, listing, reading, and an incremental rebuild behind a `localSessionIndex` service, plus four agent-facing tools of its own. `lib/sessions-search.js` and the tool consume it through that package, and the map above no longer lists its files because they are not this plugin's files any more.
* `zeroclaw-interchange.js` — **a third foreign store, and the first that is not a transcript**: zeroclaw keeps
  sessions in a **SQLite** database (`~/.zeroclaw-jane/data/sessions/sessions.db`, a flat message list), where
  `dsh-chat-import`'s `openclaw` parser expects **JSONL** under `~/.openclaw/agents` — so despite zeroclaw being
  an OpenClaw variant, the shipped parser cannot read it, and the plugin's sqlite family does not list it either.
  Measured rather than assumed, and the supported way in is the plugin's own escape hatch: it produces the
  `interchange v1` document the `dsh-chat-import-convert` skill documents, and nothing else. The writer half that
  needs a harness is `scripts/zeroclaw-to-interchange.mjs`.
* `dsh/exchange.js` — G0: the human's asks and the turn's last word, and the turn is the unit the harness numbers
* `sessions.js` — which sessions the observer watches at all
* `subject.js` — which model produced the text being judged

## Composition: what the judge is given

* `dsh/turn-state.js` — the state a judgement is made from, and what it keeps at both ends
* `dsh/segment.js` — segmenting a subject that does not fit one request, and the arithmetic over the parts
* `dsh/tool-blocks.js` — the `TOOL CALLS` section, and what was clipped out of it
* `redact.js` — redaction, and the rule that it applies to the trace's copy only
* `stream.js` — the one seam that is not a decision

## The instrument: asking the decision model

* `questions.js` — what the observer asks, in one place
* `question-sets.js` — question sets as files: read them, hash them, list them
* `seams.js` — the loop's vocabulary (nine points, what is true of each, the switch rule, the exit-code reader) and
  the probe's one question; it names no harness event, no payload shape and no config field
* `observe.js` — the call and the line: everything that can go wrong, covered
* `model/limits.js` — what the backend will actually take, from the vendor's published numbers
* `model/wire.js` — one POST, and every way it can go wrong turned into a result
* `model/client.js` — the client of that wire
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
* `dsh/tool-definition.js` — OUR TOOL DECLARATIONS -> THE AUTHORED FORM (`defineTool`, `F107`): the one place the
  parameter map is unwrapped, which is also what retires the raw-root `additionalProperties` deviation, plus the
  recorded fact that the OUTPUT (value) schema DSL has no `required`
* `tool-args.js` — checking a model's arguments against the tool's own declaration
* `decide-tool.js` — `system1_decide`
* `dsh/evaluate-tool.js` — `system1_evaluate_session`
* `results-tool.js` — `system1_measurements`
* `questions-tool.js` — `system1_question_sets`
* `question-dsl.js` — one question as ONE STRING (`key=value` fields separated by ` ;; `), which is the form
  that survives a tool-call argument: the nested arrays inside a JSON question spec do not, and four attempts to
  send one proved it. Its inverse is exact, because a format that cannot be written back cannot be edited
* `system1.js` — THE ONE SURFACE: `composeQuestions` (compose and lint), `listQuestionSets` (list, in
  one shape every caller renders the same way) and `askQuestions` (load a set and call the model), plus
  `wireTransport` for a caller that has no row to inherit a transport from. Five surfaces once answered those three
  questions for themselves and disagreed; the facade is what stops a sixth
* `question-request.js` — the ONE path from a question set to answers, shared by `system1_decide` and `scripts/ask.mjs`:
  which of the three routes carried the questions (a stored set by name, DSL strings, inline JSON), and how the
  answers read. They agreed by eye once and disagreed twice, which is the arrangement this module exists to end
* `question-lint.js` — the authoring rules a machine can check, behind `system1_question_sets { action: 'lint' }`:
  chiefly the rule that a question may only name state its scope actually emits, which `buildQuestions` cannot see
  because such a spec is perfectly well-formed and perfectly unanswerable
* `battery-tool.js` — `system1_battery`
* `config-tool.js` — `system1_settings`

## The turn path: the harness seam

* `register.js` — which seams are subscribed, and the shape each one needs
* `turn-listener.js` — the turn listener, as a decision rather than an effect
* `turn-observer.js` — the turn observation, from the listener to the line
* `turn-trigger.js` — the trigger's decision: whether to fire, and which question set

## The host adapter

* `dsh/host/index.js` — the host surface this plugin depends on, in one place, and how it is checked
* `dsh/host/fs-journal.js` — what the filesystem actually did, recorded from the harness

## The session adapter — its own package, under `dsh/`

`dsh/session-adapter/` is a workspace of its own (`packages/*` → `dsh/session-adapter`) and is PUBLISHED as
`dsh-session-adapter`, because these modules must be IMPORTABLE BY NAME rather than reached through a relative path:
a composer inside a synchronous path cannot await a Cordis service (`F104`). Being a package is also why it can sit
HERE, under the dsh half, rather than at the top level — a folder with its own `package.json` is still a package root,
so moving it changed no published name, no tarball contents, and no importer. Everything dsh-specific is now in one
folder; `core/` is what a port to another harness reads.

* `dsh/session-adapter/index.js` — the package entry, providing those functions both as imports and as the
  `sessionAdapter` service, so a consumer that is not this repository's does not have to be a file in it
* `dsh/session-adapter/lib/session-format.js` — the harness's SESSION EVENT VOCABULARY: the names, the message shapes,
  and the text extraction, in the one home `test/session-format.test.js` refuses to let a second spelling grow in
* `dsh/session-adapter/lib/surface.js` — the IN-BAND surface fold: what a synchronous caller can see without asking the
  host, and therefore what it may get wrong when no `sessionQuery` exists
* `dsh/session-adapter/lib/surface-authority.js` — the ASYNC authority over that fold (`sessionQuery.filterEvents`),
  with NAMED ABSENCES (`null`, a problem sentence, `available()`) rather than a throw, for a deployment with no host
* `dsh/session-adapter/lib/feed.js` — the per-session event feed, with its window limits
* `dsh/session-adapter/lib/reader.js` — the HOST-BACKED reads: the subject read, the session list, the window
  slicing, the coverage, and the host's full-text search

## Our own footprint

* `egress.js` — what leaves the process, and where it goes
* `telemetry.js` — the harness's own outbound telemetry, which is unredacted
* `explain-tool.js` — `system1_explain`: the brief an agent reads instead of the README — what is writable LIVE (derived
  from the schema's own `volatile` metadata, so it cannot drift), the two mount-bound fields and why, what the row is
  set to right now, how to choose/write/validate a question set, and the cautions that make a reading trustworthy
* `publish-tag.js` — the rule that refuses to publish a PRERELEASE to `latest`, because npm ignores
  `publishConfig.tag` (measured on npm 11.8.0) and a bare `npm publish` would make the beta what `npm i` installs;
  `scripts/check-publish-tag.mjs` is the `prepublishOnly` wrapper, tested through its exit codes
* `dsh/config-value.js` — reading a config field, when the field may be an accessor
* `instrument-input.js` — THE BRIDGE: the row's settings -> the instrument's one input object (`point`, `callsEnabled`,
  `subjects`, `axes`, `questions`, `limits`, `redaction`, `transport`). The only place a plain read of a setting is
  allowed besides `readConfigValue`, because it is where every `Volatile` is unwrapped before the instrument sees it
* `dsh/host-events.js` — which dsh event each point attaches to: the APPLICATION's half of the point descriptor, split out
  of `seams.js` so the instrument names no harness event
* `dsh/host-payload.js` — which ARGUMENT of a harness seam carries the text, per seam: the other half of that descriptor,
  moved out of `seams.js` with its own measured notes on why `args[0]` was wrong at three of nine seams
* `config-writer.js` — the write, as a module, so the dangerous part is tested
* `service.js` — the observer as a service, so another row can read what this one measured

## Gates and shared

* `citations.js` — does every `docs/...` path a comment names actually exist
* `deploy-drift.js` — the deployment's recorded decisions, and the comparison that says whether `deploy/profile/` still
  describes the machine (a check's logic, like `citations.js`, not runtime code)
* `compat.js` — what this package was tested against, and what it merely supports
* `is-record.js` — narrowing helpers for data that crosses a runtime boundary

* `dsh/index.js` — the ADAPTATION itself: the Cordis plugin. Every row, schema, service and tool registration this package does inside one harness, and nothing it does anywhere else
* `dsh/client.js` — the Web UI half: the settings cards and the conversation projection the harness renders

