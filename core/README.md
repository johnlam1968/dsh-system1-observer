# The map: `core/` and `dsh/`

The map of this package, grouped by what a reader is trying to do rather than by topic. A name carrying a
`dsh/` prefix lives in the ADAPTATION to one harness; everything else is the instrument. **It is enforced**: a test
scans both folders recursively and fails if a file is not named here, or if a name here does not exist -- so a new file
must be declared, exactly as a new host call must be declared in `dsh/host/index.js`.

Two things this map deliberately does **not** carry, because something else already owns them:

* **which files touch the harness** — `test/host-inventory.test.js` derives that from `dsh/host/index.js` by scanning for
  real host calls with comments stripped. A hand-written "coupled" column would be a second, drifting answer.
* **line counts and percentages** — those move with every edit; a number here would be wrong within a week.

Paths are relative to their own folder: an instrument module is named bare (`register.js`), and an adaptation module
carries its `dsh/` prefix (`dsh/evaluate-tool.js`), which is the same name the code and the gates use.

**AND THE MEASUREMENT IS NOT IN THIS MAP, BECAUSE IT IS NOT IN THIS REPOSITORY.** The question sets, the composition,
the chain that judges a subject in parts, the session-log format, the producer, the reader and the rules are the
package [`system1-measure`](https://github.com/johnlam1968/system1-measure), and this repository DEPENDS on it. What is
left here is the row's GLUE: the tools this plugin offers an agent, the settings it reads, the seam it subscribes to,
the adaptation that binds the measurement to one harness, and the gates that hold this repository to its own rules.
The boundary between the two halves is measured, not declared: `test/instrument-boundary.test.js` walks the import graph
and fails a file that claims to be portable and reaches the harness.

## Nominated for retirement

A file may be kept, but not silently: if its own header says it should go, the condition that retires it lives here.
`test/growth.test.js` checks this both ways — a nominating file that is missing, or a row whose file no longer
nominates itself, fails. (Size budgets, the other half of that test, are machine facts and live beside it.)

| file | retired by | what says so |
|---|---|---|
| `dsh/session-adapter/lib/feed.js` | **MOVING to the session adapter (§14.6 (d)), not deleting**: its condition cannot be met where it is needed. Measured 2026-10-05 (`F104`) -- the authority is ASYNC and OPTIONAL, and the in-band path cannot await, so a deployment without `sessionQuery` would lose the answer entirely | its header: *"`readSession` for the log, `readSurface` for the surface; when the plugin is wired to that, these two modules are the ones to delete"* |

## The subject: what gets measured

**THE MEASUREMENT ITSELF IS IN THE PACKAGE.** The chain that judges a subject (`system1-measure/instrument/measure.js`),
the producer that turns a dsh log into normalized rows (`instrument/normalize.js`), the row reader and the rules it
obeys (`core/session-rows.js` and `rules/index.js`), the format's vocabulary (`instrument/session-format.js`) and the
question machinery (`core/questions.js`, `core/question-sets.js`, `core/system1.js`) are all `system1-measure`'s. This
repository asks it questions and shows what it says.

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
  and is now `dsh/session-adapter/lib/reader.js`, with `surface-authority` beside it. Both take the `sessionQuery`
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
* `sessions.js` — which sessions the observer watches at all, and the row's own config for that scope

## The agent-facing tools

Every tool this plugin offers an agent is HERE, and every tool that measures the INSTRUMENT is the package's
(`ROADMAP.md` §14.6 (2)): `system1_battery` and `system1_question_sets` moved to `system1-measure` with the
question machinery they exist to expose. The rule is the subject, not the folder -- a tool that measures the
instrument belongs with the instrument, and a tool that serves an agent inside a deployment belongs with the deployment.

* `dsh/tool-definition.js` — OUR TOOL DECLARATIONS -> THE AUTHORED FORM (`defineTool`, `F107`): the one place the
  parameter map is unwrapped, which is also what retires the raw-root `additionalProperties` deviation, plus the
  recorded fact that the OUTPUT (value) schema DSL has no `required`
* `decide-tool.js` — `system1_decide`: the agent's way to ask a question and get an answer, and it asks the package's
  facade rather than the question machinery
* `dsh/evaluate-tool.js` — `system1_evaluate_session`: the whole chain, delegated to `system1-measure`'s
  `instrument/measure.js`, because a measurement is only comparable with a measurement and the part that would be
  wrong to have twice is the judging
* `results-tool.js` — `system1_measurements`: four actions over one trace, each with its own selection and render
* `explain-tool.js` — `system1_explain`: the brief an agent reads instead of the README — what is writable LIVE (derived
  from the schema's own `volatile` metadata, so it cannot drift), the two mount-bound fields and why, what the row is
  set to right now, how to choose/write/validate a question set, and the cautions that make a reading trustworthy
* `config-tool.js` — `system1_settings`: the settings tool, and it reads this row's own config to render it

## The turn path: the harness seam

* `register.js` — which seams are subscribed, and the shape each one needs. It reaches `ctx` and the dsh payload
  shapes, and it is one of the FIVE files in this repository that are allowed to
* `turn-listener.js` — the turn listener, as a decision rather than an effect
* `turn-observer.js` — the turn observation, from the listener to the line; the live state it composes is read
  through the package's `instrument/turn-state.js`, so it no longer reaches the dsh side itself
* `dsh/host-events.js` — which dsh event each point attaches to: the APPLICATION's half of the point descriptor, split out
  of the instrument's `seams.js` so the instrument names no harness event. The nine names are LITERALS here, and the
  ninth (`agent/turn-stopping`) is one of them: it is the host's event, and a host's event is the host's to name
* `dsh/host-payload.js` — which ARGUMENT of a harness seam carries the text, per seam: the other half of that descriptor,
  moved out of `seams.js` with its own measured notes on why `args[0]` was wrong at three of nine seams

## The host adapter

* `dsh/host/index.js` — the host surface this plugin depends on, in one place, and how it is checked
* `dsh/host/fs-journal.js` — what the filesystem actually did, recorded from the harness

## The session adapter — four pure modules, under `dsh/`

These answer what a session's events ARE, which of them are in the model's surface, what has been seen, and what the
host will read back. They were a **published npm package** (`dsh/session-adapter/`) because a composer inside a
synchronous path cannot await a Cordis service (`F104`), so the in-band half had to be IMPORTABLE — and being
importable was taken to mean being reachable by name. Measured, that boundary had no one on the far side of it: no
module outside this repository imported them, no consumer injected the `ctx.sessionAdapter` service they also
provided, and the only other installation on this host was a stale entry in a package that stopped referencing it.

The service form went first — a row mounted in every profile to hand an object to nobody, and the one impure file in
a set the inventory otherwise holds to containing no host call at all. The package went second, because **importable
was never the same as packaged**: a relative import is equally importable, and the constraint was `await`.

**AND THE FIFTH IS GONE, BECAUSE THE FORMAT IS NOT OURS.** The surface fold (`lib/surface.js`) reads a session's events
and folds them into the exchange -- that is the FORMAT's half, and it moved to `system1-measure/instrument/surface.js`
with the rule it implements. The fold's fallback role remains, and the host authority still has to replace it, but the
rule itself is stated once, in the package.

* `dsh/session-adapter/lib/session-format.js` — **A PURE RE-EXPORT LAYER**: the session event vocabulary is
  `system1-measure`'s (`instrument/session-format.js`), and this file is the one line that says so, so the plugin's
  import paths do not change when the vocabulary's address does. It names no event and declares no rule, and
  `test/session-format.test.js` refuses to let a second spelling of an event grow anywhere else in this repository
* `dsh/session-adapter/lib/surface-authority.js` — the ASYNC authority over the fold (`sessionQuery.filterEvents`),
  with NAMED ABSENCES (`null`, a problem sentence) rather than a throw, for a deployment with no host
* `dsh/session-adapter/lib/feed.js` — the per-session event feed, with its window limits
* `dsh/session-adapter/lib/reader.js` — the HOST-BACKED reads: the subject read, the session list, the window
  slicing, the coverage, and the host's full-text search

## Our own footprint

* `telemetry.js` — the harness's own outbound telemetry, which is unredacted
* `instrument-input.js` — THE BRIDGE: the row's settings -> the instrument's one input object (`point`, `callsEnabled`,
  `subjects`, `axes`, `questions`, `limits`, `redaction`, `transport`). The only place a plain read of a setting is
  allowed besides `readConfigValue`, because it is where every `Volatile` is unwrapped before the instrument sees it.
  **The bridge is this file and ONE in the package** (`system1-measure/core/instrument-shape.js`), and it is two files
  because the second one holds no harness: the shape's two host bindings -- which harness event a point attaches to, and
  which sessions are in scope -- are PASSED IN rather than imported, and the contract fixture
  (`test/fixtures/instrument-shape/contract.mjs`) pins what the shape must be
* `config-event.js` — the config event, and the reader that makes it worth writing
* `config-writer.js` — the write, as a module, so the dangerous part is tested
* `service.js` — the observer as a service, so another row can read what this one measured
* `dsh/config-value.js` — reading a config field, when the field may be an accessor

## Gates and shared

* `citations.js` — does every `docs/...` path a comment names actually exist
* `deploy-drift.js` — the deployment's recorded decisions, and the comparison that says whether `deploy/profile/` still
  describes the machine (a check's logic, like `citations.js`, not runtime code)
* `compat.js` — what this package was tested against, and what it merely supports
* `publish-tag.js` — the rule that refuses to publish a PRERELEASE to `latest`, because npm ignores
  `publishConfig.tag` (measured on npm 11.8.0) and a bare `npm publish` would make the beta what `npm i` installs;
  `scripts/check-publish-tag.mjs` is the `prepublishOnly` wrapper, tested through its exit codes

* `dsh/index.js` — the ADAPTATION itself: the Cordis plugin. Every row, schema, service and tool registration this package does inside one harness, and nothing it does anywhere else
* `dsh/client.js` — the Web UI half: the settings cards and the conversation projection the harness renders
