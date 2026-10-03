# HANDOFF — read this first, then the four documents below

Written 2026-10-03 at the end of a long session, before a context compaction. Everything here is **verified in that
session**; where something is unverified it says so.

## State, in one line

`HEAD = f063680`, all pushed, **675 tests green** across five gates (`test`, `coverage`, `check:citations`,
`check:compat`, `check:composition`).

## The immediate blocker, and the one fix it needs

`system1_evaluate_session` returns `? subject, 0 of 0 message(s), state 0 chars` for a session that
`system1_sessions read` reads **611 of 2995 events** from — same id, same service, same reader
(`readStoredSubject`), same composer (`composeTurnState({scope:'session'})`).

So the logic IS shared; the **arguments** are not. `system1_sessions` passes `kinds` from the row's `subjectKinds` and
the `sessionId` from the call; the evaluate tool's `stored:` closure does
`readStoredSubject(Object.assign({ sessionQuery }, options))` and takes one or both from its own settings.

**Fix, in this order:**

1. Add ONE argument-resolving function in `lib/session-subject.js` — merges the row's `subjectKinds`/`subjectSession`
   with the caller's overrides — and point BOTH call sites at it (`index.js`'s evaluate registration, and
   `lib/sessions-tool.js`'s `read`).
2. Add the integration test that would have caught this: run the stored read against the **real** `sessionQuery`,
   because `test/evaluate-live.test.js` **stubs the store** and that is exactly why three live-path failures shipped
   this session.
3. Then the demonstration the operator asked for: `list` → `read` → `evaluate` on
   `session-bba92d44-16f5-497e-8d8b-0d620e1686cd` ("Assisted freeciv play", /home/john/freeciv, 2026-09-21).

## Settings this session CHANGED on the live row (both reversible)

| setting | was | now | why |
|---|---|---|---|
| `questionSet` | `helpfulness-set-merged@1` | `agent-helpfulness-session@1` | session questions for a session judgement |
| `subjectSource` | `live` | `stored` | so the evaluate tool reads a stored session by id |

## Three live-path failures, and the pattern

| what | status |
|---|---|
| `agents is not defined` in the live-events closure (`index.js:545`) | **fixed** |
| a thunk query read as the service (`lib/sessions-tool.js`) — first live call said "no session-query service is mounted" | **fixed** |
| the evaluate tool's stored arguments (above) | **OPEN** |

All three are code that had only ever run against **stubs**. The lesson is one line: an integration test with the real
service is worth more than three unit tests with a fake one.

## Registers and open items

- `docs/findings.md`: **O17** (the turn writer records `answers`/`questionIds` while the seams record
  `questions`/`answer`, so the scorer reads nothing there), **O18** (a failed `system1_decide` leaves no line), **O22**
  (I once reported MiniMax's files missing because I searched the path I passed, not the workspace it ran in).
- **The battery is the unbuilt gate** (`ROADMAP` 13.5): nothing yet tells a BETTER question from a DIFFERENT one. The
  loop can say "different" and must not say "better" until a labelled battery and an experiment line exist.
- **Third-party session plugins** (cloned and read): `dsh-session-workbench` and `dsh-advancesearch` are both
  **UI-first**, `client: {platform: 'web'}`, and **neither registers a host tool**. advancesearch ships an MCP, but for
  Claude Code / Codex / ZCode logs. So `system1_sessions` fills a real agent-facing gap; its `list` search/title half
  is still the part that could be dropped in favour of theirs.
- **`system1_sessions` was not committed with a real-store test** either: its tests use a fake query service.

## Where everything lives

| | |
|---|---|
| decisions, section by section, with measurements | `docs/settings.md` (esp. §12–§15) |
| the design record and the plan | `ROADMAP.md` (§12 axes, §13 agent-driven priority, §13.3 build order, §13.4/§13.5 reviews) |
| what broke and what it taught | `docs/findings.md` |
| the first live iteration and its numbers | `reports/2026-10-03-iteration-1.md` |
| the question corpus + the authoring template | `criteria/` and `criteria/_templates/SET-AUTHORING.md` |
| the seven tools | `index.js` registrations; each `lib/*-tool.js` |

## The seven tools

`system1_trace` (the chronology), `system1_measurements` (the aggregate: n, distributions, which questions never
separate, skips by reason, a run table joining each reading to its set/technique/operator), `system1_settings`,
`system1_question_sets` (list/read/validate/write, refusing an overwrite without `replace`), `system1_sessions`
(list/read, `format: subject`), `system1_evaluate_session`, `system1_decide`.

## The compaction tool

`~/.dsh/plugins/compact-context.dynamic-host.js` registers ONE model-visible tool, **`compact_context`**, which asks
the runtime to compact this session at the end of the turn. It is **not in this session's tool set**, and the tools its
README prescribes for bringing it back (`cordis_define`, `cordis_run`) are not either — so the agent cannot load it
from inside this session; it has to be mounted by the profile, or the human runs the registered `compact` command.
