# Settings: what is configurable, what is not, and what could be

The inventory behind `docs/findings.md` O2's "expose the knobs". Three questions, in order: what is a setting
today, which constants are **already** settings under another name, and which hardcoded values could become ones.

## 1. The 27 fields, and what each one costs

| kind | count | meaning |
|---|---|---|
| **volatile** | **23** | the settings host accepts a write and the change reaches a *running* row — with no re-mount, and with no in-memory state lost |
| **mount-bound** | **4** | read when the row is applied; a change needs a re-apply (a config change restarts the row) |

**The 23 volatile**, grouped as the card would:

- *Calling*: `callsEnabled`, `sessions`, `observeSubagents`, `includeNonOperatorFacing`, `maxFieldChars`
- *Seams and the judge*: `hooks`, `provider`, `model`, `timeoutMs`, `wireUrl`, `question`
- *Questions*: `questions`, `seamEnabled`, `maxQuestionChars`
- *The scheduled turn measurement*: `turnEveryNTurns`, `composeMaxChars`, `toolBlockMaxChars`
- *Redaction and paths*: `redactEnabled`, `redactKeys`, `pathMode`, `redactSessionTelemetry`
- *Cost and trace size*: `pricePerMTokInput`, `maxTraceBytes`

**The 4 mount-bound**, each because it owns something opened once:

| field | why it cannot be a live write |
|---|---|
| `tracePath` | the writer holds an **open file handle** and a rotation ledger; a live change would move where evidence lands mid-run |
| `feedMaxPerSession` | bounds the events **already held** in memory; a live shrink silently drops them |
| `fsJournalMaxPaths` | the same, for the filesystem journal |
| `fsJournalMaxPerPath` | the same, per path |

The note above `feedMaxPerSession` in `index.js` records the shift explicitly: making these volatile is **not a
flag**, it is a change to what the holder is — a re-creation path with a migration story for what it drops. Left
deliberately untaken.

## 2. Constants that are *already* settings

The record's row 7 marks "no hardcoded tunables" as a **DELTA: five**. Re-read against the schema, all five are
fields now, each with the module constant as its default — the constant is what a caller who bypasses Cordis gets,
not a value a deployment cannot change:

| constant | field it defaults |
|---|---|
| `lib/host/feed.js` `DEFAULT_MAX_PER_SESSION = 500` | `feedMaxPerSession` |
| `lib/host/fs-journal.js` `DEFAULT_MAX_PATHS` / `DEFAULT_MAX_PER_PATH` | `fsJournalMaxPaths` / `fsJournalMaxPerPath` |
| `lib/turn-state.js` `maxChars = 8000`, `tool-blocks.js` `maxChars = 4000` | `composeMaxChars` / `toolBlockMaxChars` |
| `lib/questions.js` `MAX_QUESTION_CHARS_DEFAULT = 4000` | `maxQuestionChars` |
| `lib/cost.js` `PRICE_USD_PER_MTok_INPUT = 0.042` | `pricePerMTokInput` |
| `lib/register.js` `DEFAULT_HOOKS` | `hooks` |

`pricePerMTokInput` is worth singling out as the *model* case: the code reads the setting at the call site
(`lib/cost.js`), and when the configured price differs from the transcribed constant the cost line records a
`priceSource` saying so — a setting that carries its own provenance rather than quietly substituting.

## 3. Hardcoded, and worth exposing

Each of these changes what a number in the trace **means**, which is the test for a setting rather than a
constant. Ordered by how much they change the meaning.

| constant | where | what it decides | proposed control |
|---|---|---|---|
| `STOPWORDS`, `CORRECTION_MARKERS` | `lib/nudge-label.js:35,43` | **what counts as a nudge** — the derived label every evaluation is scored against | an editable list, or a file |
| `IDLE_GAP_MS = 60_000` | `lib/cost.js:38` | how a run's `activeMs` is computed: two calls less than a minute apart are one active stretch | volatile number |
| `BINS = 10` | `lib/calibrate.js:29` | the bin count in the calibration (ECE) report | volatile number |
| `TAIL_CHARS = 1000` | `lib/redact.js:88` | how much tail survives a truncation | volatile number |
| `MAX_LANES = 5` | `lib/compare.js:21` | how many runs the comparison renderer shows | volatile number, low value |
| `PROBE_QUESTION` | `lib/calibrate.js` / `lib/probe-score.js` | the question asked when *nothing* is configured — `question` covers the legacy text, this covers the fallback itself | volatile text |
| `SHAPE_PATTERNS` / `ADDED_PATTERNS` | `lib/redact.js` | the credential *shapes*; `redactKeys` adds names, not shapes, so a house token format has no home | an extra-patterns list |

## 4. Correctly hardcoded

| constant | why it stays |
|---|---|
| `MIN_CAP_BYTES = 4096` (`lib/evidence.js`) | a **floor**, not a preference: below it a `rotate` line cannot fit in the file it describes, so rotation would fire on every line |
| `MAX_DEPTH = 32` (`lib/redact.js`) | a recursion **bound**; a deployment that raised it could turn a cycle guard into a stack overflow |
| `HOOK_CHARS = 12` (`lib/egress.js`) | label padding in a rendered line |
| `PRICE_TRANSCRIBED_AT`, `PRICE_SOURCE` (`lib/cost.js`) | **provenance**. A date is not a setting; it must travel with the price, which is what `priceSource` does |
| `PROBE_SEAMS`, `TEXTLESS_SEAMS`, `SEAM_HOOKS`, `EGRESS_SEAMS`, `KEY_PARTS` | these **are** the design. Making them settings would let a deployment redefine what the plugin is |
| the client's own copies (`MAX_FIELD_CHARS_DEFAULT`, `NAMESPACES`, `TRACE_TOOL_NAME`) | a browser half cannot import the host's modules, so they are duplicated by necessity — and a mismatch is silent, which is why the card names the tool it expects |

## 5. One defect the sweep found

**Three numbers for one bound.** `lib/model/wire.js` and `lib/model/client.js` default `timeoutMs = 5000`; the
row's fallback is `?? 8000`; and the schema declares **no default at all**. The effective bound therefore depends
on which layer answers, and nothing states which is intended. `timeoutMs` is volatile now, so the fix is small:
give it an explicit `.default(8000)`, and either align the module defaults or document them as library defaults
for callers outside the row.
