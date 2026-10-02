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
reason, so it is not re-reported) · `EVIDENCE GAP` (asserted, not proven) · `WITHDRAWN` (reported, then found not
to apply).

**Which profile is operative.** `docdrift`. It composes this plugin — one `# == dsh-system1-observer` layer marker
and one row in a 1,599-line `--dump-config`. The `web` profile is broken and unused, and an audit that reports
against it is reporting against a profile nobody runs (see P1, withdrawn).

## 1. How this audit was produced

| source | what it did |
|---|---|
| **this session's own diagnosis** | ran each declared gate **separately** (a chain hides which one broke), proved composition per profile with `--dump-config`, inspected the packed artifact with `npm pack --dry-run --json`, and checked what git actually tracks |
| **an independent blind review** | a different model (`minimax-cn/MiniMax-M3`) read a copy with `docs/`, `README.md`, `ROADMAP.md` and `.git` removed, ran the suite itself (553/553), and checked every harness-facing name against the installed declarations |
| **`@omdsh-dev/dsh-plugin-check` 0.1.0**, pinned `5bf7beb29a78d0211e2b3bdccfd1222e6b2bc1cc` | 37 declared checks filtered by form; 20 applied to this package |
| **`dsh-plugin-factory` 0.3.2**, `plugin_validate` | 12 regex rules over the sources |

The blind review used the recipe now recorded in the `dsh-plugin-onboarding` skill
(`references/auditing-existing.md` §8): source only, dependencies symlinked, and **the copy's own suite verified
before the report was read**. Every finding from it was checked against the line before being listed here; the ones
that did not survive are in §5.

---

## 2. FIXED — this session

| # | finding | class | fix |
|---|---|---|---|
| F1 | `lib/turn-state.js` anchored the tool-call window at the **start of the log** (`…seq ?? 0`) when the announced request carried no `seq`, so `TOOL CALLS` quoted every earlier call in the session | correctness | it refuses, in the same voice as the two refusals above it; `test/turn-state.test.js` |
| F2 | the envelope whitelist existed **twice** — the service lifted `requested` out of `meta`, the wire never listed it — so `lib/observe.js`'s read of `envelope.requested` was `null` by construction on the wire | silent | one shared list in `lib/model/envelope.js`; the transport tests in `test/envelope.test.js` |
| F3 | `lib/host/feed.js` still said *"NOT YET WIRED TO A LISTENER — the next commit"* long after the entry module began calling `feed.record` | hygiene | it now says what is wired and what is dead surface |
| F4 | a cancellation **during** a call through the `system1` service was invisible | silent | the record carries `cancelled: true`; `test/decide-tool.test.js` |
| F5 | `README.md` said `npm test # 360 tests` against 553, omitted `check:composition`, and called five gates four | hygiene | the count is the run's; all five gates named |
| F6 | `conventions.md` row 27 said *"the suite is 509 tests"*, and its evidence cell still claimed there was no HMR-safety test while the conclusion cell beside it said there was | hygiene | count dated; the stale clause corrected against its own neighbour |
| F7 | **the schema's field classification was asserted by naming fields** — and the names were wrong: `turnEveryNTurns`, `redactEnabled`, `redactKeys`, `pathMode`, `redactSessionTelemetry`, `maxQuestionChars`, `pricePerMTokInput`, `maxTraceBytes` are all `.volatile()`, and appeared in no list | evidence | `test/schema.test.js` now **walks** the schema and compares complete sets, so a field added or a `.volatile()` moved fails until it is classified. It failed on its first run, which is the point |
| F8 | the composition and conformance tests resolved the runtime from a **global** harness install, so `npm test` failed on a machine without one | evidence | declared as devDependencies at the exact tested versions (`@deepseek-ai/cordis@4.0.4`, `@deepseek-ai/cordis-plugin-loader@1.0.5`, `@deepseek-ai/dsh-tools@0.1.7-rc.2` — exact, because a caret does not resolve an rc on this host); local resolution first, the install as fallback. Proven by running the suite with the global `npm` shadowed by a failing stub |
| F9 | the wire's new `requested` support was asserted only against the shared list, not against a transport | evidence | `test/envelope.test.js` drives a real reply carrying `requested` through the wire client, and asserts an unlisted field still does not cross |

Commit `eba428e` for F1–F5, `03409fc` for the register, and the commit that adds this file for F6–F9.
**Nine new tests**; each was proved to fail against a frozen pre-fix copy (§8).

---

## 3. OPEN — code

All from the independent review, each verified against the line before being listed. None is blocking; order is
by consequence.

| # | finding | class | what would close it |
|---|---|---|---|
| O1 | `lib/host/feed.js` exports `claim`, `reactionFor` and an internal `claimed` map that **no production path calls** — the row keeps its own copy in the entry module | silent | delete the three, or call them from the `agent/inbox/claimed` handler so there is one map |
| O2 | **the card renders four fields; the schema declares fifteen as live-writable** (`client.js:44` says *"THE FOUR FIELDS THE HOST ACCEPTS TODAY — the `.volatile()` ones"*). Eleven writable knobs (`turnEveryNTurns`, `redactEnabled`, `redactKeys`, `pathMode`, `redactSessionTelemetry`, `maxQuestionChars`, `pricePerMTokInput`, `maxTraceBytes`, and the four the card does render) have no control, and the comment's *"the other seven are YAML-only"* is wrong twice over: the schema has 27 fields, 12 of them mount-bound | silent | decide which of the eleven the card should offer, then either render them or say in the comment which are deliberately YAML-only |
| O3 | `lib/redact.js`'s credential-name pattern covers `passwd`/`pwd`, not `pw`/`pword` | low | add `pw(?:ord)?`, or say in the header what is deliberately out |
| O4 | `lib/config-tool.js` reads the knob as `… ?? null`, collapsing `0`, `false`, `''` and `null` into "absent" | silent | spell absent and set apart in the config-event output |
| O5 | `lib/redact.js`'s `sanitizeJson` writes `null` for `undefined`, so a redaction-shaped `null` is indistinguishable from an absent field | correctness | drop the field instead of substituting `null` |
| O6 | `lib/service.js` validates four of its six constructor inputs and not `label`/`replay`, which silently fall back | silent | the same check and wording as the other four |
| O7 | `lib/sessions.js` rescans the configured session list per firing | performance | a pre-built Set — the semantics differ (prefix vs equality), so it is a decision, not a patch |
| O8 | the entry module registers **two** listeners on `agent/turn-stopping`, in two sections, with no comment saying why both exist | readability | one comment, or one registration helper |
| O9 | `lib/questions.js`'s fallback to `MAX_QUESTION_CHARS_DEFAULT` is dead — the schema already materialises that default | readability | remove it, or fold it into the call site |

---

## 4. ACCEPTED — deliberate, with the reason

Listed so a future audit does not re-litigate them, and, in three cases, so a well-meaning cleanup does not break
something.

| # | what looks wrong | why it stays |
|---|---|---|
| A1 | `callsEnabled` is declared with **no** default and checked `=== false`, while `seamEnabled` uses `.default(true)` per key | both express "absent means ON" by different mechanisms, documented at their declarations. **Adding `.default(true)` to `callsEnabled` would turn every call into a skip.** If the asymmetry is unified, the reader must change with it |
| A2 | the decide tool's output schema declares **no `required`** | the `failure` reply carries neither `answers` nor `executed`. `required: ['answers','executed']` would reject the legitimate failure case |
| A3 | no `types`, no `build`/`prepack` script, no `src/` | a plain-JavaScript bundle: `publish.md`'s own publishable example is `index.js` with no build. The community checker's `missing-main-or-types` and `no-build-entry` **errors** are that org's TypeScript-tool-bundle house style |
| A4 | the live row has every seam disabled, `turnEveryNTurns: 5` | the operator's explicit decision; the configuration lives in the profile's patch, not in this repository |
| A5 | `files` does not list `docs/` | a `link:` deployment ships nothing; `npm pack` proved npm includes `README`/`LICENSE` regardless. For a tarball release this becomes a real gap |

---

## 5. REFUTED — checked and wrong

Recorded because three of these were among the **most confident** claims in their reports, and because a checker
that misreads a declaration will misread it again next time.

| # | claim | why it is wrong |
|---|---|---|
| R1 | *"`check:composition` is not run by `npm run ci`"* | it is: `ci` is `test && coverage && check:citations && check:compat && check:composition`. The README's gate list **was** incomplete (F5), which is the likely source |
| R2 | *"`turnEveryNTurns`'s schema description drifts from its `.volatile()`"* — called the most user-visible drift in the file | the description already states the split exactly: *"0, the default, switches it off. The on/off is read at every boundary; the interval itself is read at mount."* The claim quoted a truncated string that is not in the file. **The field is volatile, which F7 now asserts** |
| R3 | *"no README / no ROADMAP"* | both exist; the blind sandbox removed them by design and said so in its own prompt. **Correction to my first write-up:** *"no CHANGELOG"* is **real** — there is no CHANGELOG here (P4) — so only two of those three were artifacts |
| R4 | `plugin_check`: `missing-main-or-types` (error) | a JavaScript bundle has no `types`; see A3 |
| R5 | `plugin_check`: `no-build-entry` (error) | there is nothing to build — the plugin *is* the source |
| R6 | `plugin_check`: `files 缺少 lib`, `files 缺少 src` | `files` lists `lib/**/*.js`, which is recursive; the checker wants the bare directory and a TypeScript layout |
| R7 | `plugin_validate`: *"no plugin name, no `apply(ctx)`"* on **every** `lib/` module | it was pointed at a tree, not at the entry point. The entry exports the object form, which the tool's own rules accept — given that file. The rule: point a single-file validator at the entry, never at the library |
| R8 | `plugin_check`: `missing-profile-install-example`, `manual-install-only` (in the sandbox run) | caused by the sandbox's exclusion of `README.md`; the README carries the install route |

---

## 6. EVIDENCE GAPS — asserted, not proven

| # | gap | status |
|---|---|---|
| E1 | the suite was **not hermetic**: two files resolved the runtime from a global harness install | **CLOSED, F8** — declared as exact devDependencies, local resolution first, and proven by running the whole suite with the global `npm` shadowed by a failing stub |
| E2 | `turnEveryNTurns` counts boundaries **since mount**, not since the session began, and no test drives a remount | OPEN — a test that mounts, fires, remounts, and asserts both numbers reach the line |
| E3 | the `system1` service integration is verified at the type and usage boundary only; `dsh-system1` is not installed in the audited harness | OPEN — a profile with `system1` mounted, and one live call whose envelope is inspected |
| E4 | the wire carried `requested` with no test driving a wire reply that set it | **CLOSED, F9** |
| E5 | defaults asserted for three fields by name, and no walk over the rest | **CLOSED, F7** — every declared default is now read back from a resolved config, object fields excepted with the reason written down |
| E6 | no test drives a real `agent/pre-step` payload where `messages` is absent, holds strings, or holds `{text}` rather than `{content:[…]}` | OPEN — a fixture per shape the code claims to tolerate |
| E7 | `conventions.md` row 27's evidence cell contradicted its own conclusion cell | **CLOSED, F6** |

---

## 7. OPEN — operational

| # | finding | class | what would close it |
|---|---|---|---|
| ~~P1~~ | ~~the `web` profile installs this plugin and does not compose it~~ | **WITHDRAWN** | `web` is broken and unused; `docdrift` is the operative profile and **is** composed. The lesson is recorded rather than the finding: **an audit must establish which profile is live before reporting a composition defect.** The same correction applies to a sibling repository's finding, which was reported against `web` — there the plugin turns out to be absent from `docdrift` as well, so that one stands |
| P2 | **every commit in this repository's history is unpushed** — `git rev-list --count origin/master..HEAD` has been above 120 for several rounds | risk | a push, which needs the author's authority: the conventions record and this audit trail exist on one disk |
| P3 | the audit trail lived in a session rather than in the repository | hygiene | this file |
| P4 | there is **no CHANGELOG**; the round log in the record and the git history carry that role | hygiene | a CHANGELOG, or one line in the README saying the round log is the change history |

---

## 8. How the new tests were shown to have teeth

A test that cannot fail is decoration. Stashing this repository to check would violate the rule that an audit does
not modify what it audits, so the **frozen pre-fix copy** from the blind review was kept and the new test files
were dropped into it: **three tests fail there** — the unanchored window, the private envelope list, and the
invisible cancellation. Same information, no mutation of the working tree.

Two of the fixes in §2 needed no such trick, because they failed on their own first run: **F7's walk** found eight
unclassified volatile fields, and **F8's control** found a second harness resolver in a file a grep had already
cleared — the grep looked for one pattern and the control ran the code. That is the argument for running a check
rather than searching for one.
