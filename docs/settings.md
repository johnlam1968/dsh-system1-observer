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

## 5. Grouping, for the UI discussion

The grouping the settings *already* want is the business logic, and it matches the mental model:

| group | settings | what a person is deciding |
|---|---|---|
| **1. Where the model is called** | `callsEnabled`, `hooks`, `seamEnabled`, `sessions`, `observeSubagents`, `includeNonOperatorFacing` | which seams, in which sessions, for which agents |
| **2. How it is called** | `provider`, `model`, `timeoutMs`, `wireUrl`, `question`, `questions`, `maxQuestionChars`, `composeMaxChars`, `toolBlockMaxChars`, `maxFieldChars`, `turnEveryNTurns` | the route, the target, and how much of `X` the judge sees |
| **3. What the record keeps** | `tracePath`, `maxTraceBytes`, `redactEnabled`, `redactKeys`, `pathMode`, `redactSessionTelemetry`, `feedMaxPerSession`, `fsJournalMaxPaths`, `fsJournalMaxPerPath` | evidence, privacy, and bounds |
| **4. What the numbers mean** | `pricePerMTokInput`, + plan 1–5 | the analysis the trace supports |
| **5. The act layer** | plan 10 | what to do with an answer — not built |

Groups 1–2 answer "what does this plugin observe and ask"; group 3 answers "what does it keep"; group 4 answers
"what do those numbers mean". That is the axis I would build the card on, and the first thing to settle in the next
conversation, before any control is drawn.
