# Handoff — where this work stands, and what to pick up next

Written **2026-10-19**, after the folder reorganisation and the measurement-chain extraction. It replaces the
2026-10-05 handoff, which described a `lib/` layout that no longer exists. **Read this with `ROADMAP.md` §14**,
which is the plan itself; this page is the state of it, plus the traps that cost something to learn.

**You are reading this cold.** Nothing from the conversation that produced it transfers. Everything below is either
in the repository or was measured on the machine it was written on.

## 1. State

| | |
|---|---|
| this repo `dsh-system1-observer` | branch **`composing-tools`**, **pushed**; **894 tests**, 887 pass, 0 fail, 7 skipped |
| store `dsh-session-index` (`~/CodingProjects/dsh-session-index`, GitHub `johnlam1968/dsh-session-index`) | **`752a4bd`**, pushed; 40 tests; **`SCHEMA_VERSION` 5** |
| coverage | **97.54 / 81.99 / 91.69** against a 90 / 75 / 75 gate |
| gates | `test`, `coverage`, `check:citations`, `check:compat`, `check:composition` (composes **200 rows**), `check:deploy` |
| topology | `core/` the instrument · `dsh/` the adaptation to ONE harness · `dsh/session-adapter/` five pure modules. **`lib/` is gone** |

**ALL SIX GATES RUN HEADLESSLY.** `check:composition` shells out to `dsh --profile <p> --dump-config`, and
`check:deploy` reads profile files. You do not need the Web UI, a running harness, or a browser to verify anything
in this repository — which is what makes it workable from a machine that is not the one the harness runs on.

## 2. The folder split, and how it was decided

`lib/` held the instrument, the dsh adaptation and a published workspace package. Now:

```
core/      the instrument — asks the model, lints, composes, renders
dsh/       the adaptation to one harness: the Cordis row, the Web UI half, the session vocabulary
```

The split was **measured, not declared**: a file is `core` iff no import specifier in its whole source is a
non-relative, non-`node:` one. 58 files and 15 files, and all 15 `dsh-session-adapter` importers are in `dsh/`.

`packages/session-adapter` was a **published npm package** with a row of its own, and it is gone as a package:
the `ctx.sessionAdapter` service it provided had **zero consumers** on the machine that wrote this, and the reason
it had to be a package (`F104` — a composer inside a synchronous seam cannot await a Cordis service) is a reason it
had to be **importable**, which a relative import already is. `core/` is what a port to another harness reads.

## 3. The measuring chain exists once

```
dsh log ──► dsh/normalize.js ──► rows ──┬──► ask.mjs session      (measure one)
                                         └──► dsh-session-index    (find them all)
```

`system1_evaluate_session` and `scripts/ask.mjs` judge with **the same chain**, `dsh/measure.js`. A tool that
spawned that as a subprocess would have to re-read its own configuration from disk to reach it, which is the
coupling `F110` spent a pass removing — so both call the module.

The **normalized row** is one shape for every harness, and its unit is the ask-group (`exchange`), **never a native
`turn`**. pi has no turn at all — all 44 pi messages in the surveyed corpus carried a null turn — so a per-turn
query silently becomes a dsh-only query while looking cross-harness. Four rules are enforced by
`test/session-rows.test.js`: `exchange` required and non-null, `shadowed` required, a malformed line counted rather
than dropped, absence is `null` and never `0`.

Standalone routes, all of which work with no harness running:

```
ask.mjs session --log <dsh.jsonl> … --describe      # what a session holds, asking nothing
ask.mjs session --log <dsh.jsonl> --set … --package # measure AND write a shareable package
ask.mjs session --from-sqlite <db> --session-id <id> # read one out of the index
ask.mjs measurements interpret --package <id> --text '…' --by '<you>'
```

`trace.jsonl` is written **empty** by the script route — no harness, no trace — and the manifest says so. `report.md`
is the **skeleton**, numbers filled and the reading column blank, because prose cannot be derived from numbers.

## 4. Traps that cost something, so you do not pay again

* **A bulk rename is not a migration.** The script that moved `lib/` matched `lib/` wherever it found it, including
  `dsh-web-app/lib/startup.js` and `node/v25.3.0/lib/node_modules`, which belong to other packages. Seventeen
  third-party paths became `core/`. It took a byte-diff against a live profile to see it, and I first diagnosed the
  resulting red test as the test being wrong. Recorded as **`F172`**.
* **A positional row is a row whose meaning lives in five places.** Inserting `exchange` into `dsh-session-index`'s
  `messages` moved `shadowed` from index 7 to 8, and the pass that set it still wrote 7 — so it overwrote
  `reasoning` with the integer `1`. The existing test asserting `m[7] === 1` **passed**, because it used the same
  wrong index. Read new columns out of SQLite **by name**, and ask what the table has.
* **A test that agrees with the implementation cannot catch the implementation.** The same applies to a refactor:
  dropping `subject.messages` from the trace line left all 18 evaluate-tool tests green, because none of them looks
  at a trace line — every segmented reading was recorded as being about **zero messages**. Now pinned, and proven by
  injection.
* **`export` beats `main`, and `files` is an allowlist.** The move left `exports` pointing at `./index.js` (which no
  longer existed) and `files` missing `skills/**` and most of `dsh/`, so a release would have shipped a plugin that
  cannot resolve its own vocabulary.
* **Leading narration joins the FIRST ask-group**, because a boundary with no ask in it is a group that "what did the
  operator ask here" returns empty for.

## 5. Open, and known not to be yours

* **`check:deploy` against the `web` profile is RED**, and was red before this work. The live profile has drifted from
  `deploy/profile/` (`superpowers-dsh`, `dsh-chat-import`, `dsh-quota` live-only; `@local/dshso-mcp`,
  `dsh-speech-funasr-http`, `system1-bridge` recorded-only). **Against `docdrift`, which the repository specifies, it
  is green** — so run `DSH_PROFILE=docdrift npm run check:deploy`, and note that `DSH_PROFILE` is set to `web` in
  some shells, which is how this gets misread.
* **The docdrift profile is edited but not restarted.** The `dsh-session-adapter` row was removed from its manifest,
  lockfile and `node_modules`; the change takes effect on the next harness restart.
* **`ask.mjs session --from-sqlite` refuses an index built before `exchange` existed**, and says so. Rebuild it.
* **pi and web producers.** Both importers end in a dsh log, so `--log` measures them. If a substrate arrives that
  does NOT write a dsh log, it needs its own producer writing the same rows — not its own copy of the concept.

## 6. Where to start

1. `AGENTS.md` — what the standing reminders mean here.
2. `core/README.md` — the map, **enforced**: a test fails if a file is not named or a name does not exist.
3. `docs/findings.md` — every defect with its cause and consequence. Append-only; add, do not rewrite.
4. `npm run ci` — the whole gate. If it is green, the tree is honest.
5. `npm test 2>&1 | grep '^✖'` when something fails; the failure message names the file and the field.
