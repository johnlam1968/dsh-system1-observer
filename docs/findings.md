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
| F18 | `wireUrl`, `question`, `composeMaxChars` and `toolBlockMaxChars` were mount-bound — the same shape as F17, four fields later | silent | all four are `.volatile()` with their read sites moved: the wire URL was already read live, `question` is read per firing through the live config, and the two composed-state sizes are now passed to the turn observer as **functions** and resolved once per turn (the observer still accepts a plain number, which is what its own tests pass) |
| F19 | the record's row 7 called "no hardcoded tunables" a DELTA on the strength of five constants | hygiene | re-graded to CONFORMS after checking each: every one is a schema field whose default happens to live in the module. `docs/settings.md` is the inventory, and it is what found the next row |
| F17 | `hooks`, `provider`, `model` and `timeoutMs` were **not** volatile, so the settings host refused a write and the card could not reach them — and the code read all four from an apply-time snapshot (`const mount = plainConfig(config)`), which meant marking them volatile alone would have changed nothing | silent | all four are `.volatile()` **and their read sites moved**: the wire client and the service client are built per call from the live config; `readConfig` no longer overrides `provider`/`model` with the mount snapshot, because that override is what would have frozen them; and every seam is now subscribed and gated at its own firing by a tolerant live `hooks` read. **A seam switched off still returns the loop's own decision untouched** — `next()` in `draft`, `decision` in a waterfall — because a listener that skipped it would swallow a stream or short-circuit the loop |
| F16 | the environment-name rule was **case-sensitive** — `ENV_ASSIGNMENT`'s alternation had no `i` flag while the character class around it accepted any case — so `my_api_key=…` and `pword=…` in a lower-case dump matched **no rule at all**: the header rule needs a word boundary before the name, and `_` is a word character | silent | the flag is added **and `&` leaves the value class**: with the flag alone the rule ate the separator in `&access_token=abc123&page=2`, which the existing *"keep the NAME and lose the value"* test caught. Found by writing F13's test the lower-case way first — and my own first assertion used `api_key=…`, which the HEADER rule already caught, so it passed with the bug in place: a test that proves nothing while looking right |
| F12 | `lib/host/feed.js` exported `claim`, `reactionFor` and a `claimed` map that **no production path called** — the only callers were their own test | silent | deleted, with the module header saying what it holds and what it does not. Verifying this one first mattered: my opening grep reported "105 call sites", which was the pattern matching `claimedRequest` |
| F13 | `lib/redact.js`'s credential-name lists covered `passwd`/`pwd` but not `pw`/`pword` | low | widened in the **two SHAPE lists** — header/bare names and the environment alternation. The JSON-KEY list is deliberately left at upstream's six, because `test/redact.test.js` counts them *precisely* to keep the port faithful; there `pw` is reachable the way any deployment-specific name is, through `redactKeys`. My first attempt widened all three and that count assertion caught it — a rounded fix caught by a test written for the opposite reason |
| F14 | `sanitizeJson` wrote an `undefined` member as `null`, so "absent" and "explicitly null" were one fact in the record | correctness | an undefined member is dropped rather than spelled, leaving the redaction marker as the only string in that position |
| F15 | `createObserverService` validated four of its six inputs and silently replaced a non-function `label`/`replay` with the default, so a consumer's typo became a behaviour change | silent | optional stays optional, but provided-and-wrong throws, matching the four that were already checked |
| F1 | `lib/turn-state.js` anchored the tool-call window at the **start of the log** (`…seq ?? 0`) when the announced request carried no `seq` | correctness | it refuses, in the same voice as the two refusals above it; `test/turn-state.test.js` |
| F2 | the envelope whitelist existed **twice** — the service lifted `requested` out of `meta`, the wire never listed it — so `lib/observe.js`'s read was `null` by construction on the wire | silent | one shared list, `lib/model/envelope.js`; transport tests in `test/envelope.test.js` |
| F3 | `lib/host/feed.js` still said *"NOT YET WIRED TO A LISTENER — the next commit"* long after the entry module called `feed.record` | hygiene | it says what is wired and what is dead surface |
| F4 | a cancellation **during** a call through the `system1` service was invisible | silent | the record carries `cancelled: true`; `test/decide-tool.test.js` |
| F5 | `README.md` said `npm test # 360 tests` against 553, omitted `check:composition`, called five gates four | hygiene | the count is the run's; all five gates named |
| F6 | `conventions.md` row 27 said *"the suite is 509 tests"* and its evidence cell claimed no HMR-safety test while the conclusion cell beside it said there was one | hygiene | count dated; stale clause corrected against its neighbour |
| F7 | the schema's field classification was asserted **by naming fields**, and eight `.volatile()` fields appeared in no list (`turnEveryNTurns`, `redactEnabled`, `redactKeys`, `pathMode`, `redactSessionTelemetry`, `maxQuestionChars`, `pricePerMTokInput`, `maxTraceBytes`) | evidence | `test/schema.test.js` walks the schema and compares complete sets — it failed on its first run, which is the point |
| F8 | the composition and conformance tests resolved the runtime from a **global** harness install | evidence | declared as exact devDependencies (`cordis@4.0.4`, `cordis-plugin-loader@1.0.5`, `dsh-tools@0.1.7-rc.2`), local first, install as fallback; proven by running the whole suite with the global `npm` shadowed by a failing stub — 562/562 |
| F9 | the wire's `requested` support was asserted only against the shared list | evidence | `test/envelope.test.js` drives a real reply carrying `requested` through the wire client |
| F10 | nothing tested that a **re-apply** cannot restart the turn cadence, though the fix's commit claims it and a settings save re-applies the row | evidence | a two-mount test on one trace: the fourth boundary must continue the session, not restart at 1. Plus the field description now says the count is the session's |
| F11 | the composer's FLAT `user/message` shape (`data` IS the message) was never driven | evidence | two fixtures in `test/turn-state.test.js`: the flat shape reads, and a tool result on the user channel is not the operator reaction |

Commits `eba428e` (F1–F5), `03409fc` (the register), `674f51f` (F6–F9 and the register update). **Nine new tests**;
three were proved to fail against a frozen pre-fix copy (§8), and two failed on their own first run.

---

## 3. OPEN — code

| # | finding | class | what would close it |
|---|---|---|---|
| O2 | **the card renders seven of the fifteen live-writable fields, and its own comment says four.** `client.js:44` reads *"THE FOUR FIELDS THE HOST ACCEPTS TODAY — the `.volatile()` ones"*; the card actually renders `callsEnabled`, `seamEnabled` (per seam), `sessions`, `questions` (per seam), `observeSubagents`, `includeNonOperatorFacing` and `maxFieldChars`. The eight with no control are exactly the eight **F7**'s walk found unlisted: `turnEveryNTurns`, `redactEnabled`, `redactKeys`, `pathMode`, `redactSessionTelemetry`, `maxQuestionChars`, `pricePerMTokInput`, `maxTraceBytes` | silent | **decided: they should appear on the card** — design under review before implementation. My earlier "eleven" was the stale comment's number, not the code's: counting the rendered controls is what corrected it |

## 3b. OPEN — opened by making the four volatile

| # | finding | class | what would close it |
|---|---|---|---|
| O12 | the `system1Observer` service's `config()` still reports the **mount-time** `provider`/`model`, while the calls now use the live ones | correctness | read them live in that accessor too: it is the row's own answer to "what am I configured with", and it is now the one place that answers with a stale value |
| O14 | **three numbers for one bound**: `lib/model/wire.js` and `lib/model/client.js` default `timeoutMs = 5000`, the row's fallback is `?? 8000`, and the schema declares **no default**, so the effective bound depends on which layer answers | correctness | give `timeoutMs` an explicit `.default(8000)` and align or document the module defaults. Found by the settings sweep, not by a test |
| O13 | the mount line's per-seam egress summary is built from the mount-time `hooks`, so a seam switched off live still reads as "configured to send" | evidence | the mount line is a snapshot by design; a `config` line on change, or a note in the README, closes it. Not a leak — nothing is sent that the code does not read |

## 4. ACCEPTED — deliberate, with the reason

| # | what looks wrong | why it stays |
|---|---|---|
| A6 | `lib/sessions.js` scans the configured session list with `startsWith` on every firing | the prefix match is the **documented** semantics — the function's own doc says *"true for the wildcard or a matching prefix"*, and it is what lets a session-scoped agent id match at all. An equality Set would be faster and wrong, and the list is configuration, so it is small |
| A1 | `callsEnabled` is declared with **no** default and checked `=== false`, while `seamEnabled` uses `.default(true)` per key | both express "absent means ON" by different mechanisms. **Adding `.default(true)` to `callsEnabled` would turn every call into a skip** — the reader must change with the schema |
| A2 | the decide tool's output schema declares **no `required`** | the `failure` reply carries neither `answers` nor `executed`; `required: ['answers','executed']` would reject the legitimate failure case |
| A3 | no `types`, no `build`/`prepack` script, no `src/` | a plain-JavaScript bundle: `publish.md`'s own publishable example is `index.js` with no build. The community checker's errors are that org's TypeScript house style |
| A4 | the live row has most seams disabled, `turnEveryNTurns: 5` | the operator's decision. The live trace shows only the **draft** seam firing (20 calls), plus the tool (13) and the turn (3 firings at boundaries 5, 10 and 15) |
| A5 | `files` does not list `docs/` | a `link:` deployment ships nothing; `npm pack` proved npm includes `README`/`LICENSE` regardless |

---

## 5. REFUTED — checked and wrong

| # | claim | why it is wrong |
|---|---|---|
| R9 | *"`?? null` collapses `0`, `false`, `''` and `null` into absent"* | **`??` is not `||`.** Nullish coalescing collapses `null` and `undefined` only, and `false` is a legitimate knob value here — `test/config-tool.test.js` has asserted `from: false` since it was written. A finding that misreads an operator's semantics reads as a code defect and is not one |
| R10 | *"`lib/questions.js`'s fallback to the default question cap is dead — the schema already materialises the default"* | the fallback **fires in production**: `lib/decide-tool.js` and `lib/turn-trigger.js` both call `buildQuestions` with a synthetic config (`{ seamEnabled: …, questions: … }`) carrying no `maxQuestionChars`. Removing it would take the tool and the scheduler down a path the schema never touched |
| R11 | *"the two `agent/turn-stopping` listeners have no comment saying why both exist"* | the comment is at `index.js:683-690`, immediately above the first: *"THIS IS THE SHADOW … beside the trigger that now runs on this SAME event. Both listeners are subscribed … which is the comparison that was once the reason for not switching."* |
| R12 | *"`egress` is on 13 of 21 mount lines, so the README's 'every mount line' is false"* | the **chronological pattern is `--------EEEEEEEEEEEEE`**: all eight lines without it precede all thirteen with it, because the field was added partway through that trace's life. `index.js:305` writes it unconditionally today, so the README is true of the code and false only of history — and the reader was already built for the gap, reading `newestMount?.egress` |
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
| E2 | `turnEveryNTurns` counts boundaries **since mount**, not since the session began | **CLOSED — and the finding's own premise was stale.** The basis had already been moved to the harness turn (`42b4d3a`, wired by `6520011`); what was missing was the **re-apply** test, which is the case that fix exists for: a settings save re-applies the row, every existing case mounted once, and the commit message claimed a behaviour nothing tested. Added, plus one line of user-facing text on the field. The diverging live numbers (`harnessTurn=21 boundary=19`) are a process running pre-fix code: the trace's last write is after those commits, but the process is older |
| E3 | the `system1` service integration was verified at the type boundary only | **CLOSED BY LIVE EVIDENCE** — all 20 seam calls in the live trace went through the service transport, and every one carries `envelope.requested`, `executed`, `usage`, `durationMs` and `requestId`. The **wire** transport has served no live call yet, which is why F9 drives one |
| E4 | the wire carried `requested` with no test driving a wire reply | **CLOSED, F9** |
| E5 | defaults asserted for three fields by name, no walk | **CLOSED, F7** |
| E6 | no test drove an `agent/pre-step` payload where `messages` is absent, holds strings, or holds `{text}` rather than `{content:[…]}` | **CLOSED for the event shapes.** The composer now has a fixture for the FLAT `user/message` shape — `data` IS the message, which `SessionEventMap` declares for that channel while every fixture in the file used the nested one — and for a tool result on the user channel not being read as the operator reaction. The supplied-message shapes (string, `{text}`, `{content}`) were already covered; the payload-level variants ride the same reader |
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
