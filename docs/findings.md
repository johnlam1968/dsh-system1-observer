# Audit findings, and what was done with each

**What this file is.** The register of every finding raised against this plugin by an audit — this session's own
diagnosis, an independent model's blind review, and two community checkers — with the evidence, the adjudication
and the status. It exists because those findings were scattered across four working sessions and two review
reports, and a finding nobody can find is a finding nobody fixes.

**What it is not** — one home per fact, this repository's own rule:

- **Harness-convention deltas** stay in [`conventions.md`](conventions.md), where seven rows are already marked
  `DELTA` with citations. This file cites them; it does not restate them.
- **Forward direction** stays in [`ROADMAP.md`](../ROADMAP.md); **plans** stay in [`plans/`](plans/).

**Status values, used strictly:** `FIXED` (with the commit) · `OPEN` (with what would close it) ·
`ACCEPTED` (deliberate, with the reason, so it is not re-litigated) · `REFUTED` (checked and wrong, with the
reason, so it is not re-reported) · `EVIDENCE GAP` (asserted, not proven).

## 1. How this audit was produced

| source | what it did |
|---|---|
| **this session's own diagnosis** | ran each declared gate **separately** (a chain hides which one broke), proved composition per profile with `--dump-config`, inspected the packed artifact with `npm pack --dry-run --json`, and checked what git actually tracks |
| **an independent blind review** | a different model (`minimax-cn/MiniMax-M3`) read a copy with `docs/`, `README.md`, `ROADMAP.md` and `.git` removed, ran the suite itself (553/553), and checked every harness-facing name against the installed declarations |
| **`@omdsh-dev/dsh-plugin-check` 0.1.0**, pinned `5bf7beb29a78d0211e2b3bdccfd1222e6b2bc1cc` | 37 declared checks filtered by form; 20 applied to this package |
| **`dsh-plugin-factory` 0.3.2**, `plugin_validate` | 12 regex rules over the sources |

The blind review was run with the recipe now recorded in the `dsh-plugin-onboarding` skill
(`references/auditing-existing.md` §8): source only, dependencies symlinked, and **the copy's own suite verified
before the report was read**. Every finding below from that review was checked against the line before it was
listed here; the ones that did not survive are in §5.

---

## 2. FIXED — this session

| # | finding | class | fix |
|---|---|---|---|
| F1 | `lib/turn-state.js` anchored the tool-call window at the **start of the log** (`…seq ?? 0`) when the announced request carried no `seq`, so `TOOL CALLS` quoted every earlier call in the session as though it belonged to this exchange | correctness | it refuses, in the same voice as the two refusals above it; `test/turn-state.test.js` |
| F2 | the envelope whitelist existed **twice** — the service lifted `requested` out of `meta`, the wire never listed it — so `lib/observe.js`'s read of `envelope.requested` was `null` by construction on the wire, beside a populated envelope | silent | one shared list in `lib/model/envelope.js`; `test/envelope.test.js` fails if either transport grows a private copy again |
| F3 | `lib/host/feed.js` still said *"NOT YET WIRED TO A LISTENER — the next commit"* long after the entry module began calling `feed.record` | hygiene | it now says what is wired and, honestly, what is dead surface |
| F4 | a cancellation **during** a call through the `system1` service was invisible: the service cannot interrupt work in flight, so the answer came back ordinary and the record said nothing | silent | the record carries `cancelled: true`; `test/decide-tool.test.js`. The answer is kept — the backend was already paid for it |
| F5 | `README.md` said `npm test # 360 tests` against a suite of 553, omitted `check:composition` from the gate list, and called five gates four | hygiene | the count is the run's now, which is the only form that cannot go stale; all five gates named |
| F6 | `conventions.md` row 27 said *"the suite is 509 tests"* | hygiene | the count is dated, which is what a record can honestly hold |

Commit `eba428e` for F1–F5; F6 and this file in the commit that adds it. **Six new tests**, each proved to fail
against a frozen pre-fix copy (§8).

---

## 3. OPEN — code

All from the independent review, each verified against the line before being listed. None is blocking; order is
by consequence.

| # | finding | class | what would close it |
|---|---|---|---|
| O1 | `lib/host/feed.js` exports `claim`, `reactionFor` and an internal `claimed` map that **no production path calls** — the row keeps its own copy in the entry module. A reader debugging the composer finds the adapter and assumes the row uses it | silent | delete the three, or call them from the `agent/inbox/claimed` handler so there is one map |
| O2 | `lib/redact.js`'s credential-name pattern covers `passwd`/`pwd`, not `pw`/`pword` | low | add `pw(?:ord)?`, or say in the header what is deliberately out |
| O3 | `lib/config-tool.js` reads the knob as `… ?? null`, collapsing `0`, `false`, `''` and `null` into "absent" — so a change that *disabled* something reads as one that unset it | silent | spell absent and set apart in the config-event output |
| O4 | `lib/redact.js`'s `sanitizeJson` writes `null` for `undefined`, so a redaction-shaped `null` is indistinguishable from an absent field | correctness | drop the field instead of substituting `null` |
| O5 | `lib/service.js` validates four of its six constructor inputs (`read`, `runs`, `sessions`, `config`) and not `label`/`replay`, which silently fall back to defaults — a consumer typo replaces their override rather than throwing | silent | the same check and wording as the other four |
| O6 | `lib/sessions.js` rescans the configured session list per firing | performance | a pre-built Set — but the semantics differ (prefix vs equality), so it is a decision, not a patch |
| O7 | the entry module registers **two** listeners on `agent/turn-stopping`, in two different sections, both correct and both `serial`, with no top-of-function comment saying why both exist | readability | one comment, or move both into the same registration helper |
| O8 | `lib/questions.js`'s fallback to `MAX_QUESTION_CHARS_DEFAULT` is dead — the schema already materialises that default | readability | remove it, or fold it into the call site |

---

## 4. ACCEPTED — deliberate, with the reason

Listed so a future audit does not re-litigate them, and, in three cases, so a well-meaning cleanup does not break
something.

| # | what looks wrong | why it stays |
|---|---|---|
| A1 | `callsEnabled` is declared with **no** default and checked `=== false`, while `seamEnabled` uses `.default(true)` per key | both express "absent means ON" by different mechanisms, and both are documented at their declarations. **Adding `.default(true)` to `callsEnabled` would turn every call into a skip**: the field would materialise as `true`, and the code reads a literal `false` as the kill switch. If the asymmetry is unified, the reader must change with it |
| A2 | the decide tool's output schema declares **no `required`** | the `failure` reply carries neither `answers` nor `executed`. `required: ['answers','executed']` — the obvious "hardening" — would reject the legitimate failure case. Absence of a constraint is the constraint |
| A3 | no `types`, no `build`/`prepack` script, no `src/` | a plain-JavaScript bundle: `publish.md`'s own publishable example is `index.js` with no build. The community checker's `missing-main-or-types` and `no-build-entry` **errors** are that org's TypeScript-tool-bundle house style, not this harness's rule |
| A4 | the live row has every seam disabled, `turnEveryNTurns: 5` | the operator's explicit decision. An audit must not "fix" it, and the configuration lives in the profile's patch, not in this repository |
| A5 | `files` does not list `docs/` | a `link:` deployment ships nothing; `npm pack` proved that npm includes `README`/`LICENSE` regardless. For a tarball release this becomes a real gap, worth revisiting then |

---

## 5. REFUTED — checked and wrong

Recorded because three of these were among the **most confident** claims in their reports, and because a checker
that misreads a declaration will misread it again next time.

| # | claim | why it is wrong |
|---|---|---|
| R1 | *"`check:composition` is not run by `npm run ci`"* | it is: `ci` is `test && coverage && check:citations && check:compat && check:composition`. The README's gate list **was** incomplete (F5), which is the likely source of the misreading |
| R2 | *"`turnEveryNTurns`'s schema description drifts from its `.volatile()`"* — called "the most user-visible schema-description drift in the file" | the description already states the split exactly: *"0, the default, switches it off. The on/off is read at every boundary; the interval itself is read at mount."* The claim quoted a truncated string that is not in the file |
| R3 | *"no README / no ROADMAP"* | both exist; the blind sandbox removed them by design and said so in its own prompt. **A correction to my first write-up of this review:** *"no CHANGELOG"* is **real** — there is no CHANGELOG in this repository (P4) — so only two of those three were artifacts |
| R4 | `plugin_check`: `missing-main-or-types` (error) | a JavaScript bundle has no `types`; see A3 |
| R5 | `plugin_check`: `no-build-entry` (error) | there is nothing to build — the plugin *is* the source |
| R6 | `plugin_check`: `files 缺少 lib`, `files 缺少 src` | `files` lists `lib/**/*.js`, which is recursive; the checker wants the bare directory and a TypeScript layout |
| R7 | `plugin_validate`: *"no plugin name, no `apply(ctx)`"* on **every** `lib/` module | it was pointed at a tree, not at the entry point. The entry exports the object form (`export default { apply, name, inject, Config }`), which the tool's own rules accept — given that file. The rule: point a single-file validator at the entry, never at the library |
| R8 | `plugin_check`: `missing-profile-install-example`, `manual-install-only` (in the sandbox run) | caused by the sandbox's own exclusion of `README.md`; the README carries the install route |

---

## 6. EVIDENCE GAPS — asserted, not proven

| # | gap | what would close it |
|---|---|---|
| E1 | **the suite is not hermetic.** The composition and conformance tests resolve `@deepseek-ai/cordis` and `dsh-tools` from a **global** harness install, so `npm test` fails on a machine without one — with a clear error, and the requirement is documented in the test comments but not where an operator would look | declare them as devDependencies pinned to the tested versions; the discovery code then goes away. On an rc host use an explicit corridor, not a caret |
| E2 | `turnEveryNTurns` counts boundaries **since mount**, not since the session began, and no test drives a remount | a test that mounts, fires, remounts, and asserts both numbers reach the line — the comparison the trace exists to make |
| E3 | the `system1` service integration is verified at the type and usage boundary only; `dsh-system1` is not installed in the audited harness | a profile with `system1` mounted, and one live call whose envelope is inspected |
| E4 | the wire now **carries** `requested`, but no test drives a wire reply that sets it — the new test asserts the shared list, not the transport | a `createModel` test whose injected fetch returns a body carrying `requested`, asserting it reaches the envelope |
| E5 | schema defaults are asserted for three fields, not for the other thirteen (`callsEnabled`, `seamEnabled`, `sessions`, `maxFieldChars`, `maxQuestionChars`, `pricePerMTokInput`, `maxTraceBytes`, `includeNonOperatorFacing`, `observeSubagents`, `redactEnabled`, `redactKeys`, `pathMode`, `turnEveryNTurns`) | extend the conformance test to walk the schema's fields rather than name them |
| E6 | no test drives a real `agent/pre-step` payload where `messages` is absent, holds strings, or holds `{text}` rather than `{content:[…]}` | a fixture per shape the code claims to tolerate |
| E7 | ~~`conventions.md` row 27 asserts "no HMR-safety test"~~ | **CLOSED in the commit that adds this file.** Row 27's *evidence* cell contradicted its own *conclusion* cell: the conclusion already said the real-composition test and the HMR-safety assertions exist (round 21). The count and the stale clause are corrected there. What remains unfinished is the **Loader/process tier** — one `YAML → row → behaviour` boot and a process-level boot — which is a known delta in the record, not an unproven claim |

---

## 7. OPEN — operational

| # | finding | class | what would close it |
|---|---|---|---|
| P1 | **the `web` profile installs this plugin and does not compose it**: the symlink is in `node_modules`, `dsh.profile.bundles` does not list it, and a 1,265-line `--dump-config` mentions it zero times. `docdrift` is composed — one layer marker, one row | blocking for that profile | `dsh plugin --profile web add <this directory>`, restart, then require the marker **and** the row |
| P2 | **129 commits ahead of `origin/master`, never pushed** | risk | a push, which needs the author's authority: the conventions record and this audit trail exist on one disk |
| P3 | the audit trail lived in a session rather than in the repository | hygiene | this file |
| P4 | there is **no CHANGELOG**; the round log in the record and the git history carry that role | hygiene | a CHANGELOG, or one line in the README saying the round log is the change history |

---

## 8. How the new tests were shown to have teeth

A test that cannot fail is decoration. Stashing this repository to check would violate the rule that an audit does
not modify what it audits, so the **frozen pre-fix copy** from the blind review was kept and the new test files
were dropped into it: **three tests fail there** — the unanchored window, the private envelope list, and the
invisible cancellation. Same information, no mutation of the working tree.
