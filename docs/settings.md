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
