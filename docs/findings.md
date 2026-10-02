# Audit findings, and what was done with each

**What this file is.** The register of every finding raised against this plugin by an audit — this session's own
diagnosis, an independent model's blind review, two community checkers, and a **live trace** from the operator's
own daily profile — with the evidence, the adjudication and the status. It exists because those findings were
scattered across four working sessions and two review reports, and a finding nobody can find is a finding nobody
fixes.

**What it is not** — one home per fact, this repository's own rule:

- **Harness-convention deltas** stay in [`conventions.md`](conventions.md), where seven rows are already marked
  `DELTA` with citations. This file cites them; it does not restate them.
- **Forward direction** stays in [`ROADMAP.md`](../ROADMAP.md); **plans** stay in [`plans/`](plans/).

**Status values, used strictly:** `FIXED` (with the commit) · `OPEN` (with what would close it) ·
`ACCEPTED` (deliberate, with the reason) · `REFUTED` (checked and wrong, with the reason) ·
`EVIDENCE GAP` (asserted, not proven) · `WITHDRAWN` (reported, then found not to apply).

**Which profile is operative.** `docdrift`. It composes this plugin — one `# == dsh-system1-observer` layer marker
and one row — and it is where the live trace below comes from. The `web` profile is broken and unused (P1,
withdrawn).

## 1. How this audit was produced

| source | what it did |
|---|---|
| **this session's own diagnosis** | ran each declared gate **separately**, proved composition per profile with `--dump-config`, inspected the packed artifact with `npm pack --dry-run --json`, checked what git actually tracks |
| **an independent blind review** | a different model (`minimax-cn/MiniMax-M3`) read a copy with `docs/`, `README.md`, `ROADMAP.md` and `.git` removed, ran the suite itself, and checked every harness-facing name against the installed declarations |
| **`@omdsh-dev/dsh-plugin-check` 0.1.0**, pinned `5bf7beb29a78d0211e2b3bdccfd1222e6b2bc1cc` | 37 declared checks filtered by form; 20 applied |
| **`dsh-plugin-factory` 0.3.2**, `plugin_validate` | 12 regex rules over the sources |
| **the live trace** — `~/.dsh/logs/system1-observer.jsonl` | **33,176 lines, 12.2 MB, mode 0600**, written while the operator used `docdrift`: 21 mounts, 33 calls, 32,958 skips under five distinct reasons, 22 turn boundaries, 33 subject-cost lines, 4 feed and 4 surface comparisons |

The blind review used the recipe recorded in the `dsh-plugin-onboarding` skill
(`references/auditing-existing.md` §8): source only, dependencies symlinked, and **the copy's own suite verified
before the report was read**. Every finding from it was checked against the line before being listed; the ones that
did not survive are in §5.

---

## 2. FIXED — this session

| # | finding | class | fix |
|---|---|---|---|
| F1 | `lib/turn-state.js` anchored the tool-call window at the **start of the log** (`…seq ?? 0`) when the announced request carried no `seq` | correctness | it refuses, in the same voice as the two refusals above it; `test/turn-state.test.js` |
| F2 | the envelope whitelist existed **twice** — the service lifted `requested` out of `meta`, the wire never listed it — so `lib/observe.js`'s read was `null` by construction on the wire | silent | one shared list, `lib/model/envelope.js`; transport tests in `test/envelope.test.js` |
| F3 | `lib/host/feed.js` still said *"NOT YET WIRED TO A LISTENER — the next commit"* long after the entry module called `feed.record` | hygiene | it says what is wired and what is dead surface |
| F4 | a cancellation **during** a call through the `system1` service was invisible | silent | the record carries `cancelled: true`; `test/decide-tool.test.js` |
| F5 | `README.md` said `npm test # 360 tests` against 553, omitted `check:composition`, called five gates four | hygiene | the count is the run's; all five gates named |
| F6 | `conventions.md` row 27 said *"the suite is 509 tests"* and its evidence cell claimed no HMR-safety test while the conclusion cell beside it said there was one | hygiene | count dated; stale clause corrected against its neighbour |
| F7 | the schema's field classification was asserted **by naming fields**, and eight `.volatile()` fields appeared in no list (`turnEveryNTurns`, `redactEnabled`, `redactKeys`, `pathMode`, `redactSessionTelemetry`, `maxQuestionChars`, `pricePerMTokInput`, `maxTraceBytes`) | evidence | `test/schema.test.js` walks the schema and compares complete sets — it failed on its first run, which is the point |
| F8 | the composition and conformance tests resolved the runtime from a **global** harness install | evidence | declared as exact devDependencies (`cordis@4.0.4`, `cordis-plugin-loader@1.0.5`, `dsh-tools@0.1.7-rc.2`), local first, install as fallback; proven by running the whole suite with the global `npm` shadowed by a failing stub — 562/562 |
| F9 | the wire's `requested` support was asserted only against the shared list | evidence | `test/envelope.test.js` drives a real reply carrying `requested` through the wire client |

Commits `eba428e` (F1–F5), `03409fc` (the register), `674f51f` (F6–F9 and the register update). **Nine new tests**;
three were proved to fail against a frozen pre-fix copy (§8), and two failed on their own first run.

---

## 3. OPEN — code

| # | finding | class | what would close it |
|---|---|---|---|
| O1 | `lib/host/feed.js` exports `claim`, `reactionFor` and an internal `claimed` map that **no production path calls** — the row keeps its own copy | silent | delete the three, or call them from the `agent/inbox/claimed` handler so there is one map |
| O2 | **the card renders four fields; the schema declares fifteen live-writable** (`client.js:44` says *"THE FOUR FIELDS THE HOST ACCEPTS TODAY — the `.volatile()` ones"*). Eleven writable knobs have no control, and the comment's *"the other seven are YAML-only"* is wrong twice over (27 fields, 12 mount-bound) | silent | **decided: the eleven should appear on the card** — after the remaining tests and a live test of the card itself |
| O3 | `lib/redact.js`'s credential-name pattern covers `passwd`/`pwd`, not `pw`/`pword` | low | add `pw(?:ord)?`, or say in the header what is deliberately out |
| O4 | `lib/config-tool.js` reads the knob as `… ?? null`, collapsing `0`, `false`, `''` and `null` into "absent" | silent | spell absent and set apart in the config-event output |
| O5 | `lib/redact.js`'s `sanitizeJson` writes `null` for `undefined` | correctness | drop the field instead of substituting `null` |
| O6 | `lib/service.js` validates four of its six constructor inputs and not `label`/`replay` | silent | the same check and wording as the other four |
| O7 | `lib/sessions.js` rescans the configured session list per firing | performance | a pre-built Set — the semantics differ (prefix vs equality), so it is a decision |
| O8 | the entry module registers **two** listeners on `agent/turn-stopping`, in two sections, with no comment saying why both exist | readability | one comment, or one registration helper |
| O9 | `lib/questions.js`'s fallback to `MAX_QUESTION_CAP` is dead — the schema already materialises the default | readability | remove it, or fold it into the call site |
| O10 | **`egress` is declared on 13 of the 21 mount lines, and not on the first.** The README's table says *"what leaves the process is declared — the `egress` block on every mount line, rendered by both readers"*, and the live trace disproves the word *every*: the first mount line carries `at, event, hooks, model, provider, questionIds, run, tracePath, transport` and nothing else | evidence | find out why the early mounts lack it — if the block is written once the row is configured, say that in the README; if every mount should carry it, fix the emitter. **Found only by reading the live trace, not by any test** |

---

## 4. ACCEPTED — deliberate, with the reason

| # | what looks wrong | why it stays |
|---|---|---|
| A1 | `callsEnabled` is declared with **no** default and checked `=== false`, while `seamEnabled` uses `.default(true)` per key | both express "absent means ON" by different mechanisms. **Adding `.default(true)` to `callsEnabled` would turn every call into a skip** — the reader must change with the schema |
| A2 | the decide tool's output schema declares **no `required`** | the `failure` reply carries neither `answers` nor `executed`; `required: ['answers','executed']` would reject the legitimate failure case |
| A3 | no `types`, no `build`/`prepack` script, no `src/` | a plain-JavaScript bundle: `publish.md`'s own publishable example is `index.js` with no build. The community checker's errors are that org's TypeScript house style |
| A4 | the live row has most seams disabled, `turnEveryNTurns: 5` | the operator's decision. The live trace shows only the **draft** seam firing (20 calls), plus the tool (13) and the turn (3 firings at boundaries 5, 10 and 15) |
| A5 | `files` does not list `docs/` | a `link:` deployment ships nothing; `npm pack` proved npm includes `README`/`LICENSE` regardless |

---

## 5. REFUTED — checked and wrong

| # | claim | why it is wrong |
|---|---|---|
| R1 | *"`check:composition` is not run by `npm run ci`"* | it is. The README's gate list **was** incomplete (F5), the likely source |
| R2 | *"`turnEveryNTurns`'s schema description drifts from its `.volatile()`"* — called the most user-visible drift in the file | **Half right, and I refuted the whole of it — corrected here.** The *drift* claim is wrong: the description states the split exactly (*"the on/off is read at every boundary; the interval itself is read at mount"*), and the field **is** volatile (F7 asserts it). But the claim it was wrapped around — that the counter is in memory and **restarts at every mount** — is **right**, and the live trace now measures it: `harnessTurn=21 boundary=19` with **21 mounts**, and only 3 firings at boundaries 5, 10 and 15. That is E2, not a documentation drift |
| R3 | *"no README / no ROADMAP"* | both exist; the blind sandbox removed them by design. *"No CHANGELOG"* **is** real (P4) |
| R4 | `plugin_check`: `missing-main-or-types` (error) | a JavaScript bundle has no `types`; see A3 |
| R5 | `plugin_check`: `no-build-entry` (error) | there is nothing to build |
| R6 | `plugin_check`: `files 缺少 lib`, `缺少 src` | `files` lists `lib/**/*.js`, which is recursive |
| R7 | `plugin_validate`: *"no plugin name, no `apply(ctx)`"* on **every** `lib/` module | pointed at a tree, not at the entry point |
| R8 | `plugin_check`: `missing-profile-install-example`, `manual-install-only` (sandbox run) | caused by the sandbox's exclusion of `README.md` |

---

## 6. EVIDENCE GAPS — asserted, not proven

| # | gap | status |
|---|---|---|
| E1 | the suite was **not hermetic** | **CLOSED, F8** — proven with the global `npm` shadowed by a failing stub: 562/562 |
| E2 | `turnEveryNTurns` counts boundaries **since mount**, not since the session began | **OPEN, and now measured live**: `harnessTurn=21 boundary=19` across 21 mounts, with 3 firings at 5/10/15 — the every-N arithmetic is right, the *origin* of the count is not stated anywhere a reader would find it. Closing it needs a mount→fire→remount test and one line of user-facing text |
| E3 | the `system1` service integration was verified at the type boundary only | **CLOSED BY LIVE EVIDENCE** — all 20 seam calls in the live trace went through the service transport, and every one carries `envelope.requested`, `executed`, `usage`, `durationMs` and `requestId`. The **wire** transport has served no live call yet, which is why F9 drives one |
| E4 | the wire carried `requested` with no test driving a wire reply | **CLOSED, F9** |
| E5 | defaults asserted for three fields by name, no walk | **CLOSED, F7** |
| E6 | no test drives an `agent/pre-step` payload where `messages` is absent, holds strings, or holds `{text}` rather than `{content:[…]}` | OPEN — a fixture per shape the code claims to tolerate |
| E7 | `conventions.md` row 27's evidence cell contradicted its own conclusion cell | **CLOSED, F6** |

---

## 7. OPERATIONAL

| # | finding | status |
|---|---|---|
| ~~P1~~ | ~~the `web` profile installs this plugin and does not compose it~~ | **WITHDRAWN** — `web` is broken and unused; `docdrift` is composed. The lesson stands: **an audit must establish which profile is live before reporting a composition defect.** The same correction applied to a sibling repository, where the plugin turns out to be absent from `docdrift` as well, so that finding stands |
| ~~P2~~ | ~~every commit was unpushed~~ | **CLOSED** — pushed on the operator's authorization: `1dd9c39..674f51f` (131 commits) and the agents repository `5146471..12a8d91` (9) |
| ~~P3~~ | ~~the audit trail lived in a session~~ | **CLOSED** — this file |
| P4 | there is **no CHANGELOG**; the round log and the git history carry that role | OPEN — a CHANGELOG, or one line in the README saying the round log is the change history |

---

## 8. How the new tests were shown to have teeth

Stashing this repository to check would violate the rule that an audit does not modify what it audits, so the
**frozen pre-fix copy** from the blind review was kept and the new test files were dropped into it: **three tests
fail there** — the unanchored window, the private envelope list, the invisible cancellation.

Two fixes needed no trick, because they failed on their own first run: **F7's walk** found eight unclassified
volatile fields, and **F8's control** found a second harness resolver in a file a grep had already cleared — the
grep looked for one pattern; the control ran the code.

And **the live trace found what no test could**: O10. A documented invariant — *"the `egress` block on every mount
line"* — is false on 8 of 21 real mount lines, including the first. That is the argument for reading production
data as evidence rather than as an illustration.
