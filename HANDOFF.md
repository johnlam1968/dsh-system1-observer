# Handoff — where this work stands, and what to pick up next

Written **2026-10-19**, after the folder reorganisation and the measurement-chain extraction. It replaces the
2026-10-05 handoff, which described a `lib/` layout that no longer exists. **Read this with `ROADMAP.md` §14**,
which is the plan itself; this page is the state of it, plus the traps that cost something to learn.

**You are reading this cold.** Nothing from the conversation that produced it transfers. Everything below is either
in the repository or was measured on the machine it was written on.

## 0. What changed after this page was first written

**The two producers disagreed about who spoke, and the observer was the one that was wrong.** `dsh/normalize.js`
counted an ask by EVENT TYPE — every `user/message` opened an ask-group — while `dsh/exchange.js` counted it by
`data.source.kind`, which is the only thing that separates a person from the harness. The harness speaks on the user
channel: a goal, a skill catalogue, a runtime context. Measured on one real session of 39,098 events: **753
`user/message` events, 403 of them the human and 350 the harness** — so the ask count was inflated by **86.8%**, every
injection opened a group of its own, and the judge was handed skill catalogues as though the operator had typed them.

`isHumanMessage` now lives in **one** place (`dsh/session-adapter/lib/session-format.js`, beside the vocabulary it
reads), the producer and the live composer both use it, and `dsh-session-index` was aligned to match. **The
consequence for every measurement taken before this is that the ask count was too high by roughly half.** Recorded as
**`F173`**.

The store's `source_sha256` was the first **16** hex characters of a digest, so the rows contract refused the receipt
of **every** session in the index and the reader could not repair it. The store writes the whole digest now
(**`F174`**), and the live index has been rebuilt to `SCHEMA_VERSION` 5.

**The standalone's two routes disagreed about where the instrument posts.** The `--state` route named an endpoint and
the `session` route named none, so the wire built its URL from `undefined` and every question came back
`Failed to parse URL from undefined/v1/systemone` — which reads as *the model declined*, not as *you named no
endpoint*. The run then wrote a package anyway, whose `readings.json` said `n: 0` and `failed: 1` for every
question. The endpoint is now bound in **one** place (`core/system1.js`'s `wireTransport`, over a default declared
beside the row's own in `core/model/wire.js`), the script builds its transport in **one** place, and a measurement
with no reading is **refused** instead of written. Recorded as **`F176`**.

**The `web` profile has been restarted** (new process, new token) and the store's fix is live there. The `docdrift`
profile is still down and needs the same restart before its row serves the rebuilt index — see §5.

## 1. State

| | |
|---|---|
| this repo `dsh-system1-observer` | branch **`composing-tools`**, **pushed** (`1f9adb5`); **906 tests**, 899 pass, 0 fail, 7 skipped |
| store `dsh-session-index` (`~/CodingProjects/dsh-session-index`, GitHub `johnlam1968/dsh-session-index`) | **`f89f075`**, **pushed**; 42 tests; **`SCHEMA_VERSION` 5** |
| coverage | **97.55 / 82.41 / 91.81** against a 90 / 75 / 75 gate |
| gates | `test`, `coverage`, `check:citations`, `check:compat`, `check:composition` (composes **201 rows**), `check:deploy` |
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

**THE MEASUREMENT ROUTE NOW WORKS, AND IT NEVER DID** (**`F175`**). It was broken in six separate ways, and the suite
was green throughout because `test/measure.test.js` only ever drove the dsh cut and the script's own test only drove
the free routes. The worst of the six was silent: the judge was called with the arguments in the wrong places, so
every segment failed, the failure was written into the package as a refusal, and **a measurement with no answers
looked like a measurement that was complete** — `n: 0` and `failed: 1` for every question.

**THE ROUTE IS NOW TESTED, not just described.** `test/ask-script.test.js` drives it against a **local fake
endpoint**: no model, no harness, no money, and it is proven to have teeth (with the source fixes stashed it goes
red). If you change anything on this path, that test is the one that will tell you.

**THE ROUTE REACHES AN ENDPOINT BY ITSELF.** `--wire-url` is optional: the endpoint is resolved in one place, and the
route prints the endpoint it used. An endpoint that cannot be reached is **refused by name**, and **no package is
written** — a package of failures is not a measurement (**`F176`**).

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
* **A missing configuration value that reads as a model verdict is worse than a crash.** The session route passed no
  endpoint, the wire built `undefined/v1/systemone`, and the answer came back as a per-question refusal — so a
  measurement that never reached the model looked like one the model declined, and it was written to a package. Name
  the fault, refuse before spending anything, and let a run that measured nothing say so.
* **A fixture that omits a field the harness requires agrees with an implementation that ignores it.** Every
  `user/message` fixture in this suite omitted `data.source.kind`, and the producer never read it — so the two were
  wrong in the same shape, and **32 tests went red** when the field was finally honoured. The harness REQUIRES a
  producer-owned source kind (a v4 log is refused without one), and across 120 real session files and 1,501
  `user/message` events, **zero** lacked a source. A fixture is a claim about what the harness emits; when it is
  simpler than the truth, it cannot fail for the truth's reasons.

## 5. Open, and known not to be yours

* **`check:deploy` against the `web` profile is RED**, and was red before this work. The live profile has drifted from
  `deploy/profile/` (`superpowers-dsh`, `dsh-chat-import`, `dsh-quota` live-only; `@local/dshso-mcp`,
  `dsh-speech-funasr-http`, `system1-bridge` recorded-only). **Against `docdrift`, which the repository specifies, it
  is green** — so run `DSH_PROFILE=docdrift npm run check:deploy`, and note that `DSH_PROFILE` is set to `web` in
  some shells, which is how this gets misread.
* **The `web` profile has been restarted; the `docdrift` profile has not.** The `dsh-web.service` (profile `web`,
  port 3080) was restarted, so the **store's fix is live there** and a `session_index_refresh` cannot rewrite the
  index at `SCHEMA_VERSION` 4 with the truncated digest. The `dsh@docdrift.service` unit (port 3090) is **dead**, and
  the `dsh-session-adapter` row was removed from its manifest, lockfile and `node_modules` — that change takes effect
  on the next harness restart. The index on disk is correct; a `docdrift` PROCESS that was started before the store
  fix is behind it. **Start it before you trust a docdrift row's session tools.**
* **`ask.mjs session --from-sqlite` used to refuse an index built before `exchange` existed, and said so. Rebuild it
  — and know that a rebuild alone was not enough.** The digest was truncated too (**`F174`**), and the producer and
  the store disagreed about who spoke (**`F173`**). All three are fixed and the index is rebuilt.
* **pi and web producers.** Both importers end in a dsh log, so `--log` measures them. If a substrate arrives that
  does NOT write a dsh log, it needs its own producer writing the same rows — not its own copy of the concept.
* **The store is a second producer, so it needs the same rules said twice.** It imports no dsh code by design, so
  "the ask-group opens on a human message" and "a message with no declared source is not the human" now live in it as
  a restatement. They are aligned today; a change to one is a change to the other, and nothing enforces it.

## 6. Where to start

1. `AGENTS.md` — what the standing reminders mean here.
2. `core/README.md` — the map, **enforced**: a test fails if a file is not named or a name does not exist.
3. `docs/findings.md` — every defect with its cause and consequence. Append-only; add, do not rewrite.
4. `npm run ci` — the whole gate. If it is green, the tree is honest.
5. `npm test 2>&1 | grep '^✖'` when something fails; the failure message names the file and the field.
