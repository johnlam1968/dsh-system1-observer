# Settings: the inventory, and the plan for what is left

Built on two principles taken as premises, not aspirations: **everything is a plugin**, therefore **everything can
change at runtime**, therefore **anything a deployment might reasonably decide should be a setting** — and if it can
be changed while the row runs, it should be *volatile* so it changes without a restart and without losing state.

Current state, counted from the schema rather than remembered: **27 fields, 26 volatile, 1 mount-bound.**

## 1. The one field that is not volatile, and why

`tracePath` — the trace writer holds an **open file handle** and a rotation ledger. A live change would move where
evidence lands in the middle of a run, so it needs a reopen-and-rotate story *and* a decision about whether one run
may span two files. That is a design change, not a flag. **Plan: §5.**

## 2. What the two principles changed, and what checking found

| field | was | now | what it took |
|---|---|---|---|
| `hooks`, `provider`, `model`, `timeoutMs` | mount-bound | volatile | the wire and service clients are built per call; `readConfig` stopped overriding `provider`/`model` with the mount snapshot; every seam is subscribed and gated per firing |
| `wireUrl`, `question`, `composeMaxChars`, `toolBlockMaxChars` | mount-bound | volatile | the two composed-state sizes are passed to the turn observer as **functions** and resolved per turn |
| `feedMaxPerSession` | mount-bound | volatile | the cap is resolved on every **record** |
| `fsJournalMaxPaths`, `fsJournalMaxPerPath` | mount-bound | volatile | both caps resolved per **observation** |

**Two corrections worth keeping.** First, the note that stood above the caps said a volatile flag "would not be
enough" and a re-creation path would be needed. That was wrong, and checking proved it: each cap is consulted per
record, so the flag plus a function was the whole change. Second, writing the test for the live journal cap found a
**real defect**: the path trim deleted one path per record (`if`, not `while`), so the journal could sit at cap+1 and
a lowered cap converged only as fast as new paths were touched. The bound is exact now.

## 3. Constants that are already settings

The convention record's row 7 marked "no hardcoded tunables" as a DELTA on the strength of five constants. All five
are schema fields whose default happens to live in the module — the constant is what a caller bypassing Cordis gets,
not a value a deployment cannot change. Re-graded to **CONFORMS**.

`DEFAULT_MAX_PER_SESSION` → `feedMaxPerSession` · `DEFAULT_MAX_PATHS`/`DEFAULT_MAX_PER_PATH` → the two journal caps ·
`maxChars = 8000`/`4000` in the composer and tool-block renderer → `composeMaxChars`/`toolBlockMaxChars` ·
`MAX_QUESTION_CHARS_DEFAULT` → `maxQuestionChars` · `PRICE_USD_PER_MTOK_INPUT` → `pricePerMTokInput` ·
`DEFAULT_HOOKS` → `hooks`.

`pricePerMTokInput` is the model case: read at the call site, and when the configured price differs from the
transcribed constant the cost line records a `priceSource` saying so — a setting that carries its own provenance.

## 4. The plan: every remaining gap, as a code change

**WHERE THIS STANDS.** Items 1-7 are built and pushed, item 8 and 9 remain designs, and item 10 is a feature rather
than a setting. Three of the plan's own sizes were wrong, and the corrections are worth more than the schedule:

| item | state | what changed on contact |
|---|---|---|
| 1 `idleGapMs` | **done** `98e2b05` | as planned, small |
| 2 `tailChars` | **done** `dfac61e` | writing its test found a zero-tail bug: `slice(-0)` is the whole string |
| 3 `calibrationBins` | **done** `bcdb4e4` | **medium, not small** -- four sites through `probeScore`, and its first test fixture proved nothing |
| 4 `maxCompareLanes` | **done** `fd9f007` | as planned, small |
| 5 nudge vocabulary | **done** `f2b6b0b` | three settings, not one: markers, stopwords, and the recurrence threshold. Every one changes a MEASUREMENT |
| 6 extra redaction patterns | **done** `821c271` | addition-only, and the card needed a new `lines` kind because a regex can contain a comma |
| 7 probe question | **done** `51e8cf7` | **not a runtime setting at all**: its hash is the instrument's identity and goes on the MOUNT line, so a live value would mix two instruments under one key. Mount-bound, with the answer set fixed |
| 8 question sets as artifacts | design | unchanged |
| 9 `tracePath` reopen-and-rotate | design | unchanged; the route is closed by the mount-bound refusal (`test/sink-record.test.js`) |
| 10 the act layer | not built | designed in §8, with one duplication refused |

**AND EVERY ITEM IS CARD-REACHABLE OR HONESTLY EXCLUDED.** The card carries all 34 writable settings across the six
panels of §6, and the two mount-bound ones are readable and refused rather than hidden. The UI ratchet in
`test/client-card.test.js` fails when a writable field has no control; the read-ratchet in `test/schema.test.js`
fails when a field is read by nothing.


Ordered by how much each changes what a number in the trace **means**. "Small" = one module plus its call site and
a test; "medium" = a new field shape; "design" = a decision before code.

| # | gap | the code change | size |
|---|---|---|---|
| 1 | `idleGapMs` (`IDLE_GAP_MS = 60_000`) | `costOf(events, { idleGapMs })` → `mergeIntervalsTotal(…, idleGapMs ?? IDLE_GAP_MS)`; thread it exactly where `pricePerMTokInput` already goes: `index.js`'s tool/service wiring, `lib/tool.js`, `lib/trace-report.js`, `lib/trace-data.js` | small |
| 2 | `tailChars` (`TAIL_CHARS = 1000`) | the truncation helper in `lib/redact.js` takes the tail size; its call site passes the live value | small |
| 3 | `calibrationBins` (`BINS = 10`) | `ece(samples, bins)` already accepts it; the calibration tool's call site passes the live value | small |
| 4 | `maxCompareLanes` (`MAX_LANES = 5`) | `compareRuns` already takes `limit`; the report/trace-data call sites pass the live value | small |
| 5 | the nudge vocabulary (`STOPWORDS`, `CORRECTION_MARKERS`) | `lib/nudge-label.js` reads a policy instead of module constants; schema gains two **volatile string arrays** — the same shape as `redactKeys`, which the card already knows how to edit | medium |
| 6 | extra redaction **shapes** (`SHAPE_PATTERNS`, `ADDED_PATTERNS`) | `redactPolicy` gains `patterns: []`, **addition-only**; each compiled in a try/catch so one bad pattern cannot disable redaction; a `patternProblem` field on the mount line names any that failed | medium |
| 7 | the probe question itself (`PROBE_QUESTION`) | a schema field holding a question object, validated by `lib/questions.js`'s existing spec reader — the fallback the `question` field already promises is configurable but is not | medium |
| 8 | **question sets as loadable artifacts** | the organizer/editor you described: a `questionSets` source (a path or an inline set), read and validated on change, with the set's **identity** written on every call line so a measurement is attributable to the set that produced it. This is ROADMAP P1–P2, and it is the largest item here | design |
| 9 | `tracePath` | reopen-and-rotate on change, plus a decision: does one run's evidence span two files, and does the old one get a `rotate`-style line naming the move? | design |
| 10 | the **act layer** | not built: `Roadmap §9 / P3`. The `system1Observer` service is the seam it will read from, but no act row exists in the code — its settings are a whole surface (what `X` to compose, which sets to run, what to do with the answer) | feature |

**Correctly hardcoded, and staying so:** `MIN_CAP_BYTES` (a floor — below it a `rotate` line cannot fit in the file
it describes), `MAX_DEPTH` (a recursion bound), `HOOK_CHARS` (padding), `PRICE_TRANSCRIBED_AT`/`PRICE_SOURCE`
(provenance, which must travel with the price), the structural sets (`PROBE_SEAMS`, `TEXTLESS_SEAMS`, `SEAM_HOOKS`,
`EGRESS_SEAMS`, `KEY_PARTS` — these *are* the design), and the browser half's unavoidable duplicates.

## 5. Grouping: what the first attempt got wrong

The first grouping was checked mechanically before it was judged: **27 fields, 27 assigned, none unassigned, none
duplicated** — so it *covers* the settings. It is still not logically clean, and the check itself produced the
evidence for two of the three faults.

**1. `redactSessionTelemetry` was in the wrong group.** Its own description says it scrubs *"the harness's own
outbound session-telemetry records"* and is *"Unrelated to this plugin's own JSONL trace"* — it is the only setting
that changes what **another component sends**. It belongs with egress, not with the record.

**2. The three caps were in the wrong group.** They bound what the **composer can see** (the event feed) and what
the **filesystem journal holds** — inputs to `X` — not what the record keeps.

**3. The turn measurement was smeared across a shared field.** `questions.dict` has **ten** keys: the nine seams
plus `turn`. So `questions` is one field with two intents, and `turnEveryNTurns` sat in "how it is called" while its
question set lived inside another field in the same group. The check also showed the asymmetry: `seamEnabled.dict`
has nine keys and no `turn`, because the turn measurement is switched off by `0`, not by `false`.

**The axis the first attempt did not name** is the one the plugin's contract is built on — *it decides nothing and
records everything*. That is **what leaves the process** versus **what is kept**, and it is why an operator turning
the record off must not believe they turned the sending off. `redactEnabled`'s own description makes that point;
the grouping did not.

### The corrected grouping

| group | fields | what a person is deciding |
|---|---|---|
| **A. What this row observes** | `callsEnabled`, `hooks`, `seamEnabled`, `sessions`, `observeSubagents`, `includeNonOperatorFacing` | which seams, in which sessions, for which agents |
| **B. What is sent** | `provider`, `model`, `timeoutMs`, `wireUrl`, `question`, `questions` (the nine seam sets), `maxQuestionChars`, `redactSessionTelemetry` | the route, the ask, and every switch that changes what leaves the process |
| **C. What the judge sees** | `maxFieldChars`, `composeMaxChars`, `toolBlockMaxChars`, `feedMaxPerSession`, `fsJournalMaxPaths`, `fsJournalMaxPerPath` | how much of `X` reaches the model, and how much material `X` can be built from |
| **D. The scheduled turn measurement** | `turnEveryNTurns`, `questions.turn` | a *second mechanism*: boundary-triggered evaluation, not a seam probe — and the seed of the act layer |
| **E. What the record keeps** | `tracePath`, `maxTraceBytes`, `redactEnabled`, `redactKeys`, `pathMode` | evidence, privacy, bounds |
| **F. What the numbers mean** | `pricePerMTokInput` (+ plan items 1–5) | the analysis the trace supports |
| **G. The act layer** | plan item 10 | what to do with an answer — not built |

6 + 8 + 6 + 1 + 5 + 1 = 27, with `questions` counted once in B and once in D **because it is one field with two
intents**.

**THE GROUPING IS A UI PROPERTY, NOT A SCHEMA ONE.** `questions` stays one object in the schema: splitting it into
`seamQuestions`/`turnQuestions` would be a breaking configuration change for every profile that has one, and the
card can present the same field under two headings without the schema moving at all. The same holds for
`seamEnabled`, whose nine switches belong inside A. What the card cannot do is invent a distinction the schema
contradicts — which is why the three misplacements above matter before any control is drawn.

## 6. The card layout: seven artifacts, each opening onto its knobs

The logical groups are **UI-addressable** without any schema change. The card settles that on its own evidence:
its per-seam editors are already `h('details', { id: 'system1-observer-seam-…' }, h('summary', …))` — *"plain
`details` so nine seams do not fill the page at once"* — and its ids already follow `system1-observer-<thing>`,
which is exactly what `test/client-card.test.js` walks by. So the seven groups become seven panels, reusing the
styles (`styles.seam`, `styles.summary`) and the convention that already exist.

### The seven, with their headers

The header is not a label — it is **the state**, in the vocabulary the card already uses for its effective note
and its chips. A person scanning seven closed rows should be able to see what the plugin is doing without opening
anything.

| # | panel (`id`) | header shows | knobs inside | control kind |
|---|---|---|---|---|
| 1 | **Observe** `panel-observe` | `calls ON · 7 seams · 1 session · subagents off` | `callsEnabled`, `hooks`, `seamEnabled` (nine switches), `sessions` (list), `observeSubagents`, `includeNonOperatorFacing` | checkbox · multi-select · switches · list · checkbox · checkbox |
| 2 | **Send** `panel-send` | `service · typesafe/jev-latest · timeout 8000 ms` | `provider`, `model`, `timeoutMs`, `wireUrl`, `question`, `questions.<nine seams>`, `maxQuestionChars`, `redactSessionTelemetry` | text · text · numeric+reset · text · text · question editor · numeric+reset · checkbox |
| 3 | **See** `panel-see` | `state ≤8000c · tool ≤4000c · field ≤20000c · feed 500/session` | `maxFieldChars`, `composeMaxChars`, `toolBlockMaxChars`, `feedMaxPerSession`, `fsJournalMaxPaths`, `fsJournalMaxPerPath` | six numeric+reset |
| 4 | **Turn** `panel-turn` | `every 5 boundaries · 1 set · last fired at 15` | `turnEveryNTurns`, `questions.turn` | numeric+reset · question editor |
| 5 | **Keep** `panel-keep` | `12.2 MB · redact ON · pathMode full · 0600` | `tracePath` (read-only, with its YAML-only reason), `maxTraceBytes`, `redactEnabled`, `redactKeys`, `pathMode` | text-disabled · numeric+reset · checkbox · list · select |
| 6 | **Numbers** `panel-numbers` | `$0.042/MTok input · transcribed 2026-09-28` | `pricePerMTokInput` (+ plan items 1–5 as they land) | numeric+reset |
| 7 | **Act** `panel-act` | `not built` | — (ROADMAP §9/P3) | disabled panel, present so the shape is visible |

`questions` and `seamEnabled` each appear **once** in the schema and are rendered where they belong: the nine seam
sets under Send, `questions.turn` under Turn — one draft object, two render sites, and a `set` op carrying the path
the host accepts either way.

### Three decisions I would make, and why

1. **Accordion, not a tab strip.** Multiple panels may be open. A tab strip would hide the one signal an operator
   needs mid-edit — *which panel has unsaved changes* — and would need its own keyboard handling; `details` is
   already in this card and already tested.
2. **A panel with unsaved changes opens itself.** The card holds drafts in `useState` and the Save lives in the
   host's chrome, at the bottom. If a change could sit in a closed panel, the UNSAVED-changes warning would be the
   only sign, and a person who closed the panel would reasonably believe the edit was gone. Opening the panels that
   are dirty is the cheap version of a sticky save bar, and it is testable.
3. **The open/closed state is UI state, never a setting.** It is `useState` in the card. Persisting "which panel
   was open" would be a knob with no meaning to the trace, and the card's own rule is that only what changes a
   measurement is a setting.

### What this makes "A"

The eight knobs nobody can reach today land **inside their panels** — `turnEveryNTurns` plus the two sizes in Turn
and See, `redactEnabled`/`redactKeys`/`pathMode`/`redactSessionTelemetry`/`maxQuestionChars`/`pricePerMTokInput`/
`maxTraceBytes` across Keep, Send and Numbers — so the panels and the missing knobs are **one change**, not two: a
panel that opens onto nothing is not worth shipping.

Tests follow the panel: open by `id`, assert the knobs a panel must contain, flip one, and assert the `set` op's
**path** — plus one test for decision 2, that a dirty panel opens itself.

## 7. The act layer, designed by an independent model -- and what it corrected

**Who, and how.** `minimax-cn/MiniMax-M3`, given a read-only sandbox copy of this repository and told to read only
`docs/settings.md`, the schema in `index.js` and `ROADMAP.md` §9/P3, was asked for two things: a hard critique of the
ten gaps in §4, and a design for the act layer's settings surface. **The middle of its reply was truncated in
transit, and that middle is where the settings table was.** The table was re-requested under a narrower brief; it
lands in §8 when it arrives. What follows is the rest, and every load-bearing claim in it was checked against the
code rather than relayed.

### What it corroborated, independently of this register

| register row | its words | what checking found |
|---|---|---|
| **O12**, the mount-time provider/model | "the service `config()` reads mount-time `provider`/`model`" | **the problem is wider than O12 records**: `mount.provider`/`mount.model` appear at SEVEN sites -- `index.js:280, 320-321, 345, 414-415, 469-470` -- not only in the service's `config()` |
| **O13**, no per-call egress summary | "no honest per-call egress summary in either row" | the same defect the mount-line summary has, reached from the other direction |
| **O14**, three numbers for one timeout | "`timeoutMs = 5000` ... the schema declares no default and the call site uses `?? 8000`" | matches O14 exactly, including the three-way split |

An independent reader arriving at three of this register's open rows, with no access to the register, is the
strongest evidence those rows are real rather than my own framing.

### What it added, and one citation it got wrong

- **Item 7 is not an ordinary setting, because it changes RUN IDENTITY.** Making the probe question configurable
  changes `instrument`, one of `KEY_PARTS = ['questions', 'hooks', 'switches', 'instrument']` (`lib/compare.js:30`),
  so runs before and after the change are different instruments and comparison between them is refused *by design*.
  **Correction to its citation:** it named `probeHash` as a `KEY_PARTS` member; it is not one. `probeHash` is an input
  to `instrument` -- see the fixture `taskKeyOf(mount({ provider, model, probeHash }))` in `test/compare.test.js`.
  The conclusion is right and the citation is one level off, and the difference decides *where* the change must be
  documented: in `instrument`, not in the key parts.
- **Item 3 matters most after item 8.** Per-set calibration wants a bin count per experiment, so one global value
  will be too coarse once question sets are loadable (`calibrationBins` landed in `bcdb4e4` as a single value; this
  is the argument for revisiting it with item 8).
- **`criteria` are inline, not resolvable by name** -- `lib/questions.js:87` passes them straight into `noul(...)`.
  That is the P2 work `ROADMAP.md` §4.2 names, and it is the part of the act layer's evidence that cannot be
  reconstructed from a name.
- **Two act-layer settings survived the truncation**: `actMinConfidence` and `actInjectionBudget`, with the
  observation that both are "mechanically the same change" as `composeMaxChars` because the wire client is built per
  call (`index.js:266-269`). That is true of every volatile field in this row, and it is why the plan's remaining
  items are wiring rather than architecture.

### One correction that became a fix, and one that stayed a correction

MiniMax described the redaction setting as carrying a `patternProblem` field "on the mount line". **That name existed
nowhere in the code** -- the grep came back empty -- so the citation was wrong. But the *idea* was right and is now
implemented, under almost that name: `redactPolicy` returns `patternProblems`, compiled once per policy, so a pattern
that does not compile is dropped with its reason rather than thrown from the path of every line. A citation can be
wrong about the code and right about the design, and the difference is worth keeping rather than flattening.

Its other correction stands exactly as recorded above: `probeHash` is not a `KEY_PARTS` member.

### From its list of what the code cannot do yet

Of nine numbered items, only the ninth survived the truncation: **no criterion dictionary resolution by name**
(`lib/questions.js` validates question shapes but does not resolve `criteria` by reference). It also noted, in the
part that survived, that the *already possible* pieces are the schema fields, the Act panel from §6, the live
`system1Observer` reads, and the `config` event on the trace -- all of which exist today.

## 8. The act layer's settings, as designed by MiniMax-M3 (table-only re-request)

Recorded as received, because a design from an independent reader is evidence about the plan rather than about the
code. It read `ROADMAP.md` §9-§11 closely enough to cite §9.1-§9.7, §10.2-§10.3 and §11.1 by number.

| setting | decides | control | live? | why a setting |
|---|---|---|---|---|
| `actEnabled` | whether the act row is on at all -- distinct from the observer's `callsEnabled` | row-level toggle | yes | §9.1/§9.4: ships off; record off must not imply injection off |
| `actInjectEnabled` | whether the row writes into the prompt context, or stays in shadow mode | checkbox, default off | yes | §9.4: first release injects nothing; shadow mode is the acceptance gate |
| `actForbiddenCapabilities` | which side effects the row may take -- a subset of `prompt-section` | multi-select | **no, mount-bound** | §9.2: "informs, does not decide" is a contract, not a preference |
| `actTriggerHooks` | at which seam firings the row composes `X` and runs `S` | multi-select of seams, default `admit` | yes | §9.2 reads `admit`; §10.2 adds the turn boundary |
| `xSpec` | the assembly of `X`: source, roles, window | structured editor | yes | §9.6 promotes `X` from a constant to a value |
| `xBudgetMaxChars` | the hard ceiling on `X` before it is sent | numeric, default 8000 | yes | §9.6/§9.7: `X` is paid per call, and its truncation must be recorded |
| `sSetSelector` | which question-set artifact `S` is used | picker over the sets, version-pinned | yes | §9.5/§10.3: sets are content-hashed artifacts |
| `sSubjectMatch` | how a set's `appliesTo` is matched against the trace's `subject` | rule editor | yes | §11.1: a 3B and a frontier model need different sets |
| `actInjectThreshold` | the band on the reading at which injection happens | two numerics, default 0.7 / 0.10 | yes | §9.4/§10.2: bands, not bars; the middle band is a real state |
| `actOnUnsure` | what happens in the middle band or on no answer | choice: `record-only` / `inject-nudge-template` / `skip` | yes | §9.4/§10.2: an operator asks this first |
| `xRedactPolicy` | which redaction applies to `X` | keys + patterns | yes | §9.6: `X` leaves the machine, so a constant here is a constant leak |
| `actCallBudgetPerSession` | the ceiling on judge calls per session | numeric with reset | yes | §9.6: a per-session cap is what stops the row compounding |

**Skipped as constants, correctly:** the `turn` hook label, the `xId`/`xHash` field shape (provenance travels with
the line), the shadow default at first release (release policy), the deny-list defaults, and the model client path.

**What I would change, and why.** `xRedactPolicy` duplicates `redactKeys` and `pathMode`. The rule this repository
runs on is one home per fact, and `X` is composed from the same trace the observer already redacts -- so unless a
deployment genuinely needs a *different* posture for outbound `X`, the act row should read the existing redaction
settings and the design should say so, rather than shipping a second place to configure the same decision. If it
does need its own, that is an argument to record, not a field to add quietly.

## 9. Design: question sets as loadable artifacts (plan item 8)

**The constraint, from the code rather than from taste.** A question spec is already a value: `lib/questions.js`
reads `config.questions`, refuses a malformed spec into a `problem` string instead of throwing (`"NOTHING HERE
THROWS"`, because this runs in the critical path of every turn), and builds `noul`/`choice`/`score` questions from
it. What is missing is not expressiveness but **addressability**: a set cannot be named, reused across rows, or
identified in the trace, so two runs under different sets are compared as though one instrument produced both -- the
same failure `probeHash` exists to prevent for the probe.

**The settings it adds.**

| setting | decides | control | live? |
|---|---|---|---|
| `questionSets` | which set files this row may load, as paths | a list of paths (one per line) | yes |
| `questionSet` | which of them this row uses, by name | a picker over the sets the host resolved | yes |

`questionSet` empty means the inline `questions` object, exactly as today, so nothing existing changes.

**The identity rule, borrowed from the probe because it already works.** A set's **content hash** belongs in
`instrument`, beside `probeHash` (`lib/compare.js:65`). Editing a set file then makes the runs before and after
honestly incomparable, by the same mechanism rather than by a warning in a README.

**The failure mode that must not exist.** A set file that is missing, unreadable or malformed becomes a **named
`problem`** on every line it affects and the row falls back to the built-in probe -- never a throw, and never
silence. A row measuring something other than what it says it measures is the defect this register keeps recording;
the mitigation is that the trace says so on the line.

**What the card can and cannot do, which decides the shape.** The browser half cannot read the filesystem, so the
**host** resolves the set list and projects `{name, hash, problems}`; the card picks a name and shows the hash and
any problem. That is also why `questionSets` is a list of paths rather than inline JSON: the file is what can be
hashed, versioned and shared.

**Not settled.** Whether a set file holds one set or a map of them; whether a set may override a single seam or must
carry all ten; and `criteria` by name (`ROADMAP.md` §4.2, P2), which is the part of a set that would let two
questions be compared by construction rather than by inspection.

**What makes it testable.** Parse a fixture set and assert the questions it builds; change one character of the file
and assert the hash moves and `instrument` differs; hand it a malformed file and assert a named problem and a
working fallback -- three tests, none needing a browser.

## 10. Design: `tracePath` reopen-and-rotate (plan item 9)

**Why it is mount-bound today, in the code's own words.** The writer takes the path at mount
(`process.env[envVar] ?? defaultPath`), and rotation deliberately keeps the same name *because* "every reader --
the trace tool, both report modules, the card -- captured `path` once, so a rotation that moved the name would leave
all of them watching a file nobody writes to any more". The capture is the obstacle, and it is in the READERS, not
in the writer.

**What a live move must do, in order.** Write the `config` line **to the sink being left** -- the record of the move
is the whole point of the plan's section 4 constraint; **rotate the old file aside** through the existing rotation
path, so nothing is left half-written and the archive is named in a line; **reopen** at the new path; and write a
**first line at the new path** naming the archive it came from, so a reader arriving there can find what preceded it.
Those four sentences are one operation, and every one of them is observable in the file.

**The settings it adds.**

| setting | decides | control | live? |
|---|---|---|---|
| `tracePath` | where the trace is written | text | **becomes yes** -- this item's whole point |

**No new policy knobs.** Rotation-on-move is not a preference: a move that left the old file open and unlabelled
would lose the record of its own move. A setting nobody would change costs attention, which is why there is one
setting here and not three.

**The failure mode that must not exist.** A move to an unwritable path must not lose a single line: the writer keeps
writing to the sink it still owns, records the failure as a `problem` on the line, and does **not** claim the move.
The current code's `append` is already best-effort for the same reason ("a disk that fills at 3am must not fail a
turn"), and that property has to survive the move.

**What makes it testable.** The test that currently pins the refusal
(`test/sink-record.test.js`, "a mount-bound setting is refused BEFORE the record") is rewritten to assert the
opposite: the `config` line lands in the **old** file, the archive exists and is named, the new file's first line
says where the record came from, and a reader asking for the trace afterwards reads the new path without a restart.
The mount-bound ratchet in `test/config-tool.test.js` then stops listing `tracePath`, which is the check that the
change is complete rather than partial.

**Not settled.** Whether `system1_trace` should *follow* a move it did not make, or report that the configured path
holds only the lines since the move -- and whether the archive should be discoverable from the new file by name
alone (proposed) or by a hash (which would make it verifiable).

## 11. Design: a STORED SESSION as subject state (the second subject source)

**What the plugin judges today, and what that leaves out.** Two call modes exist, and they share one subject source:
the LIVE session. The **seams** fire per conversational loop (`admit`, `draft`, `result`, ...) and judge the text at
that moment; the **scheduled turn measurement** judges an aggregate -- an implicit turn (a run of turn boundaries) or
a slice of a live session. Both read the window the plugin holds, and both are gone when the session ends.

**(B) adds the third thing: a session that is already over.** The subject is a stored session -- the whole of it, or a
slice of it -- and the use case is the one the live modes cannot serve: *evaluate an existing human/LLM conversation
to improve it*, at the scale of a whole session rather than a loop or a turn.

**What makes this cheap, and it is the same composer.** `lib/turn-state.js`'s `composeTurnState({ events, nextMessage,
maxChars, toolMaxChars, ... })` already turns a list of session events into the text a judge is shown, and it is
already the ONE place that decides what the judge sees. (B) does not need a second composer: it needs a second
**source of events** for the same one. That is why the coding is small, and it is also why the two modes cannot drift
apart in what they show.

**THE HARNESS ALREADY ANSWERS THIS, AND IT IS A SERVICE.** `@deepseek-ai/dsh-session-query` exports
`SessionQueryEngine extends Service` with the calls this design needs, in its own vocabulary:

| its method | what (B) uses it for |
|---|---|
| `listSessions()` | the picker's list of stored sessions |
| `readSession(id)` / `listEvents(id)` | the stored session's events, to feed the one composer |
| **`filterEvents(id, filters)`** | **the slices** -- "slices of it, with certain filters" is a method the harness already has, not something to invent |
| `readSurface(id)` | the surface, if a slice should be defined by it |
| `readTitle(id)` | the session's headline, which the card otherwise cannot obtain |

So (B) does **not** read the archive itself. It injects that service, exactly as it already reads the live session
through `agent.session.snapshotEvents(0)`. The measurement that settles it: this machine's largest stored archive is
23 MB holding **10,939 concatenated zstd frames**, and Node's one-shot `zstdDecompressSync` AND its streaming decoder
both stop after the FIRST frame -- the harness carries a `PublicZstdFrameDecoder` for precisely that reason ("an
adapter built exclusively from Node's supported one-shot API"). A plugin walking those frames by hand would be
reimplementing an internal package whose format is not a plugin's contract, which is the opposite of what this
project is for.

**What this leaves, and why it is small.** Three candidates existed, and the code rules out one of them regardless:

| source | verdict |
|---|---|
| a LIVE agent's `agent.session.snapshotEvents(0)` | already used by the observation path (`index.js:278`) -- the live case, unchanged |
| the `SessionQueryEngine` service | **the stored case**: the harness's own reader, filtered slices included |
| `~/.dsh/storages/session_projcache/sessions/<uuid>.json` | **not** a source: `lib/nudge-label.js:29` records that "the projcache is a UI cache and truncates", so a measurement over it would agree with you about nothing |

**The genuinely new plumbing is therefore smaller than planned**: one module that turns the service's
`SessionEventRecord`s into the event shape `composeTurnState` already consumes
(`{ seq, time, type, data: { message: { role, content } } }`), plus a mapping from the four settings onto the
service's own filter vocabulary -- which is to be pinned by reading its `filters.d.ts` rather than guessed.

**The settings it adds.** Four, each a thing a person would actually change, and nothing else -- no policy knob for
"how to slice" beyond the slice itself:

| setting | decides | control | live? |
|---|---|---|---|
| `subjectSource` | whether the subject is the live session or a stored one | select: `live` / `stored` | yes |
| `subjectSession` | WHICH stored session: an id, or `newest` | picker over the sessions the host can see | yes |
| `subjectKinds` | which message kinds are in the slice (operator, assistant, tool results) | multi-select | yes |
| `subjectLastMessages` | how many of the session's messages to include; `0` is the whole session | numeric with reset | yes |

**The result does not belong on the live path, and that decides where it surfaces.** A stored-session evaluation is
not an observation of what is happening; it is a question asked on demand. So it becomes a **call of its own kind** --
recorded as a call line whose hook distinguishes it from a seam firing -- and it surfaces as (a) a TOOL, so an agent
can ask for it, and (b) that tool's card through the existing `tool.call.toolview` seat, so a person reads the
judgement where they read every other tool result. The card's six settings panels gain an **Evaluate** panel for the
four inputs above; the RESULT is not a setting and does not go in a panel.

**What must not happen.** A stored evaluation must never be scored into the probe calibration: the calibration is
about the probe question asked at a seam, and a whole-session judgement is a different kind of answer. The call-kind
field is what keeps them apart, and a test should assert a stored evaluation adds no probe rows.

**SETTLED BY READING THE COMPOSER, and it changes (B).** `composeTurnState` composes **an exchange**: it takes the
newest operator message carrying text as the REACTION and builds "OPERATOR REQUEST / AGENT RESPONSE / TOOL CALLS /
OPERATOR NEXT MESSAGE" from what led to it. That is exactly right at a live seam -- every caller before this one was
judging a turn in progress -- and it is wrong for "judge this conversation as a whole", because the newest turns fall
outside the exchange. So the one composer needs a **scope**: `exchange` (the default, so the live path is untouched
byte for byte) and `session` for a stored subject. Recorded as register row O16 and asserted in
`test/session-subject.test.js` meanwhile.

**Not settled.** Whether a stored evaluation is a single call over the whole composed state or one call per slice;
whether a stored session may be evaluated on a schedule (which would make it a fourth call mode rather than an
on-demand question); and whether the composed state's fingerprint belongs on the line so two evaluations of the same
session can be recognised as the same input.

## 12. Design: managing question sets, and surfacing them

**The gap, stated as the user experience.** Today a question set is a nested object in the profile's `questions`
key, edited through the card's per-seam editor. It cannot be named, reused across rows, shared, or identified in a
trace -- so two runs under different sets are compared as though one instrument produced both. §9 designs the
loadable set; this section designs the **management and surfacing** around it, which is the part a person actually
meets.

**Where sets live, and why not in the profile.** A **directory of set files**, named by the setting
`questionSetsDir`; a row selects one with `questionSet`. Files rather than inline JSON because a file is what can be
hashed, versioned, reviewed as a diff, and shared between deployments -- and the content hash is what makes a run
attributable (`instrument`, beside `probeHash`). The inline `questions` object keeps working exactly as it does
today: `questionSet` empty means "the inline set", so nothing existing changes.

**Who resolves them, and why it must be the host.** The browser half cannot read the filesystem. So the HOST
resolves the directory once per read into `{ name, path, hash, problems }` for each file, and projects that list to
the card and to the agent. The card picks a name and shows the hash and any problem; it never reads a file.

**How a set is validated.** Through the reader that already exists (`lib/questions.js`), which never throws and
turns a malformed spec into a named `problem` -- the property that keeps this plugin from failing a turn. A set that
does not parse, or whose specs are not specs, is reported by name and by reason, and the row falls back to the built-in
probe with that problem recorded on the line.

**Surface one: the agent.** The config tool's `list` gains a `sets` key beside `knobs` and `schema`, carrying the
resolved list -- declared in the tool's output schema, because that schema is enforced against the returned value.
This is how a model finds out which sets exist without guessing a filename.

**Surface two: the card.** The Send panel gains a set picker, the resolved hash, and the problems list, next to the
inline question editor it already has. A person should be able to see at a glance whether the row is asking the inline
set or a file, and which file.

**Surface three: the service.** `system1Observer` gains a read-only `questionSets()` so another plugin can list them
without re-implementing the resolver -- consistent with the rest of that service, which is frozen and has no mutator
by construction.

**Settings it adds.**

| setting | decides | control | live? |
|---|---|---|---|
| `questionSetsDir` | where the set files are | text (a path) | yes |
| `questionSet` | which set this row uses, by name; empty is the inline set | picker | yes |

**Not settled.** Whether a set file holds one set or a map of them; whether a set must carry all ten seams or may
override one; whether the directory is watched or read per call; and `criteria` by name (`ROADMAP.md` §4.2), which is
what would let two questions be compared by construction rather than by inspection.

### The implementation contradicted this design, and the operator caught it

**Recorded 2026-10-03.** The table above says both settings are live, because a set is a *choice about what to ask* and a
row should be able to swap one without a restart. The FIRST implementation made them mount-bound instead, on the
argument that a set's content hash goes on the mount line and enters `instrument` -- so a mid-run change would leave
calls asked under one set and keyed under another.

That argument is real but it proves too much, and the code already says so: **`hooks` and `seamEnabled` are volatile,
and both are read into the comparability key from the MOUNT snapshot** (`lib/compare.js` takes them from the mount
line). A live `hooks` change has exactly the property I objected to, and this repository has lived with it. The honest
reading is that a mount line records what the run **started** with, not that the run never changed -- so making the set
settings an exception was my error, not a stricter standard.

Both are now volatile and read at the point of use. What remains true, and is stated in each field's description: the
mount line's `questionSetHash` is a snapshot of the set in force **at mount**, so a row that swaps sets mid-run has
calls under two sets inside one instrument key. The fix, if it is wanted, is a `questionSetHash` on each CALL line --
the same shape as `instrument`'s other parts, one level finer -- and it is not built.

**And the profile stores a default set rather than the questions.** `~/.dsh/profiles/docdrift/cordis.patch.yml` held a
ten-seam set of 19 questions inline (203 lines; one question each at assemble, admit, draft, pre_execute, execute,
post_execute and result, none at the two textless seams, and 12 at `turn`). That is now frozen verbatim as
`criteria/helpfulness-set-merged@1.json` (hash `124f6059e769`) and the profile carries two lines instead:

```yaml
questionSetsDir: /home/CodingProjects/dsh-system1-observer/criteria
questionSet: helpfulness-set-merged@1
```

The freeze is behaviour-preserving by construction -- the same questions, in the same order, under the same seam keys --
and the backup of the original block is `cordis.patch.yml.bak-20261003-122941` beside the patch.

**Still missing, and named rather than faked:** a PICKER. The browser half cannot read a filesystem, so a picker needs
the host to project the set list to the card, exactly as the stored-session picker does. Until then both are text
fields, and the two callers that can read the list -- the agent's config tool and the `system1Observer` service --
already expose it.

## 13. Three state scopes, and why a set is the unit of cost

The plugin asks a model about a STATE, and a state comes in exactly three sizes. Recorded 2026-10-03 as the operator's
framing, because it is what the sets are organised by:

| scope | the state | asked when | key in the `questions` map |
|---|---|---|---|
| **seam** | one loop point's text | a seam fires (`assemble`, `admit`, `draft`, ...) | `questions[<seam>]` |
| **multi-turn** | an aggregate of an exchange | the scheduled turn measurement | `questions.turn` |
| **session** | a whole conversation, live or stored | on demand, by a person or an agent | `questions.session` |

**Every judgement is ONE narrow question.** The sets obey a rule their own rationale files state: *"It is a predicate or
an ordinal ladder, never a wide question"* -- no question asks the model to summarise, infer intent, or characterise in
prose. A wide question is several questions wearing one id, and it cannot be calibrated.

**And a SET is the unit that saves the cost**, which is the reason to group questions rather than ask one at a time:
the state is composed once per call and several questions ride on it. `lib/observe.js` builds a seam's questions and
sends them in ONE call (`decide({ state, questions })`), and `system1_evaluate_session` does the same for a session. Asking
five questions separately would compose -- and pay for -- the same state five times.

**What this changed in the code**, because the taxonomy found a real gap rather than only naming a pattern:

- `SESSION_HOOK = 'session'` and `QUESTION_SCOPES` (the nine seams, the aggregate, and the session scope) in
  `lib/questions.js`. The session scope is deliberately NOT in `FIREABLE_HOOKS`: nothing fires at it.
- The schema declares all three scopes, because an undeclared key is dropped by `projectForm` -- the failure the
  schema's own comment records for `turn`.
- **`system1_evaluate_session` asked the TURN questions for a session judgement** before this. It now asks the session scope,
  falling back to the aggregate when no session questions are configured -- which is every row today, since no set in
  `criteria/` carries a `session` key yet. The fallback is what keeps the change behaviour-preserving.

**Still missing, named rather than faked.** (1) No session questions have been AUTHORED: `questions.session` works and
falls back, but writing them is a judgement about which qualities of a whole conversation matter, and that is the
operator's, exactly as the seam sets were. (2) A row names ONE set file, so a set carrying every scope is how one row
covers all three -- `helpfulness-set-merged@1.json` does for the ten seams and `turn`. Naming a set per scope would
need `questionSet` to become a map, and that is not built.

## 14. It takes two: the pair (user, model)

Recorded 2026-10-03 as the operator's framing. A conversation has two participants, so the object worth measuring is
not the agent alone and not the person alone but **the pair** -- and some operators get more out of the same model than
others. That is a claim the plugin can be made to answer, and the first thing to get right is that it contains **two
different questions**:

1. **How good is this person's input?** The `admit` scope, judged by the `human-input-clarity` compositions. A set can
   be written FOR one operator (`appliesTo.user`), tailored to that person's characteristic failure -- the operator who
   buries the request, the one who states an unverified premise.
2. **Does this pair fit?** A `session`-scope set asking whether this operator's style elicited this model's weak
   behaviour -- a person who asks for whole-feature changes against a model that does best in small steps. Answerable,
   because `SESSION TRANSCRIPT` labels both sides.

### What exists, and what the pair still needs

**The model is already in the comparability key** (`lib/compare.js`: transport, provider, model, probeHash,
questionSetHash), so LLM A and LLM B are already distinguishable and their runs already refused comparison. What is
missing is the person:

- **An operator identity on the line, as a HASH.** `userHash`, of a label the operator configures, recorded the way
  `stateHash` is -- so lines are linkable to a pair without the trace storing who. A raw user id is a fact about a
  person and the trace is durable; the repository already keeps the raw copy for the model and redacts the record, and
  the same line holds here. **Not built.**
- **A label to hash.** A volatile setting plus a card field plus a walk entry. **Not built.**
- **Slicing, not refusing.** The user must NOT go into `instrument`. That would refuse comparison across users -- which
  is exactly the interesting question, whether operator A does better than operator B with one model. The pair is a
  **grouping for reading results**, not a reason to refuse them.

### And the honest caveat: n

One operator's handful of conversations is not a measurement of an operator, and a pair reading without its n is the
same error as any other single-observation claim. The plugin records n; a pair figure must carry it.

**Why the manifest is the right home for this rather than a filename.** `_manifest.json` inside a composition is
metadata: it is not a scope, it does not enter the composition hash, and its `appliesTo` map is open-ended (`model`,
`useCase`, `user`, and whatever axis is worth naming next) so adding one needs no code change. Model-specific and
use-case-specific sets are the same mechanism: more compositions, differing by manifest and by which scopes they carry.

**Today this corpus has one operator**, so per-user sets are written but unverifiable -- the mechanism is small and the
evidence does not exist yet. `criteria/helpfulness-set-merged@1/_manifest.json` is the first one: it names the operator
and says the model is unspecified.

## 15. Where benchmark knowledge enters, and the axis the pair still lacks

**Measured 2026-10-03, not assumed.** `GET https://openrouter.ai/api/v1/models` returns **466 models, 255 of them
carrying a `benchmarks` field**, shaped:

```json
{"design_arena": [{"arena": "models", "category": "codecategories", "elo": 1059, "win_rate": 42.9, "rank": 103}, ...],
 "artificial_analysis": {"intelligence_index": 51.8, "coding_index": null, "agentic_index": null}}
```

All four Ministral entries carry it (`ministral-8b-2512` is elo 1059 / win_rate 42.9 / rank 103 in `codecategories`),
while their `artificial_analysis` indices are `null` -- **coverage is partial and per-category**, so anything keyed to
it must tolerate a missing value. On HuggingFace the field exists (`model-index`, top-level) but for the model in use
here, `mistralai/Ministral-3-3B-Instruct-2512`, it is **null**: what that card offers instead is the paper
(`arxiv:2601.08584`). So the structured source is OpenRouter; HuggingFace gives prose.

### A benchmark result is a hypothesis, not a question

Benchmarks already say what a MODEL is like. Our questions judge **outputs inside a harness**, so a model-specific set
earns its keep only when it asks something the benchmark cannot: *given this known weakness, did the
prompting/steering/loop prevent the failure?* That is falsifiable, which is the property this repository asks of every
question, and it is a different object from "is this 3B model good at coding" -- which the elo already answered.

The home for it needs no new mechanism: a manifest is free-form beyond `appliesTo`, so a composition can carry

```json
{"appliesTo": {"model": "ministral-3-3b", "useCase": "coding"},
 "hypotheses": [{"weakness": "long-context recall", "testedBy": "draft_restates_the_goal"}]}
```

and each question exists to try to FALSIFY one hypothesis. **The expectation to record plainly:** most of what a
question returns about a model's output will be what the benchmarks already predicted. The measurement is worth making
when it is about the harness, and the harness is what the next section is missing.

### Refusal axes and grouping axes

The pair cannot be measured until it is clear which facts about a run change what its numbers MEAN, and which only say
who or what they are about:

| axis | kind | where it goes | why |
|---|---|---|---|
| model | **refusal** | `instrument` (already there) | a score from LLM A and one from LLM B are answers to different questions |
| the question set | **refusal** | `instrument` (already there) | a different set asks something else |
| user | grouping | a hash on the line | comparing operators is the question, so refusing it would delete the answer |
| **harness technique** | grouping | a hash on the line | the whole point of measuring -- and **missing today** |
| use case | grouping | the manifest | same questions, a different setting |

**The harness is the gap.** Prompting, steering, loop and harness techniques are the practical levers on a specific
model, and **none of them is in `instrument`**: two runs under different system prompts or different loop policies are
currently treated as the same instrument while being different treatments. That is a confound, and it sits under every
pair-level claim.

It must be **declared, never inferred**. The plugin sees the assembled prompt, but that text contains the operator's
request as well as the harness, so hashing it would confound the subject with the treatment -- and the repository's
rule for the record is already the strict one. So: an operator-declared label hashed onto the line
(`harnessHash`), beside `userHash`, exactly as `stateHash` is recorded per session-review line today. Both are
grouping, so **neither goes into `instrument`**.

**What is not built:** the two labels and their two hashes, and the reader that groups lines by pair and prints its n.
One operator exists today, so a pair figure would be an anecdote with a decimal point.
