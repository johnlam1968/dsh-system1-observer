# Handoff — where this work stands, and what to pick up next

Written **2026-10-19**, after the folder reorganisation and the measurement-chain extraction. It replaces the
2026-10-05 handoff, which described a `lib/` layout that no longer exists. **Read this with `ROADMAP.md` §14**,
which is the plan itself; this page is the state of it, plus the traps that cost something to learn.

**You are reading this cold.** Nothing from the conversation that produced it transfers. Everything below is either
in the repository or was measured on the machine it was written on.

## 0. What changed after this page was first written

**TWO CHANNELS MEASURE THE SAME SESSION, AND THEY DID NOT AGREE.** A measurement can come from the LOG (this
repository's own producer) or from the INDEX (`dsh-session-index`'s producer, read back through
`core/rows-sqlite.js`). They are two producers of one contract, and **nothing enforced that they agree** — which is
how the observer and the store came to disagree about who spoke (**`F173`**), about the digest (**`F174`**), and
about the TEXT of a message (**`F177`**).

**There is now a command that measures the agreement**, over the whole corpus rather than over a fixture:

```
node scripts/check-channel-agreement.mjs --index ~/.dsh/session-index.db
```

It composes every session both ways and compares **per message and per tool call** — not the counts, because a
field that differs can cancel out in an aggregate — plus the receipt. It prints **shapes and lengths, never values**,
because a tool call's arguments in this corpus contain a **live Telegram bot token** in plain text. It exits 0 when
the channels agree, 1 when they do not, and **2 when it could not read something** — a run that compared nothing is
not a run that found agreement.

**The corpus run found four more defects, and three of them were invisible to a count.** 53 sessions differed by a
trailing space (**`F177`**). The store read a block's `thinking` field as visible text (**`F179`**). **SQLite keeps
only the bytes before the first NUL**, so 67 messages in one session were 11 characters in the index and 100 in the
log, and two tool-call names became empty strings (**`F180`**). And the producer answered `false` for `interrupted`
on 278 of 282 messages that never said it (**`F181`**, found by an independent review).

**THE STATE OF THE CORPUS, after the fixes: 946 of 946 sessions agree on EVERY FIELD, and the composed state — the
number that decides whether two channels are ONE measurement — differs in ZERO.** The last two differences were the
store's schema, and `SCHEMA_VERSION` 6 closed them: the decoded length beside the on-disk size, the full length of the
tool arguments beside the cap, and the interruption fact (**`F182`**, **`F184`**). **The only thing the two channels
still hold differently is how much of a tool call's arguments the INDEX stores** — the first 4,000 characters, with the
full length declared beside it — and the agreement tool reports that as what it is rather than as a disagreement.

**The rows contract now states SEVEN rules, not four**, and each one is enforced rather than described. The two
newest are the ones a producer cannot guess: a message's text is **trimmed** (RULE 5) and a row carries **no NUL
byte** (RULE 7). Both were found by the corpus run and neither was in anyone's head.

**The instrument gate now declares the whole directory.** It named 22 of the 60 files in `core/`, so 38 files were
outside the boundary without being outside the directory, and the coupling it declared was not the coupling that
existed — **four files reached `dsh/` through `core/instrument-input.js` and were declared portable** (**`F178`**).
The gate now walks the import graph, declares **50 portable and 10 host-coupled**, and fails in both directions.

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

## 0b. The format, the shared half, and the SECOND implementation (2026-10-20)

**THREE DECISIONS WERE ASKED AND ANSWERED ON 2026-10-19, AND ALL THREE ARE NOW BUILT.** (1) This repository owns
the session-log **format**: **`docs/session-log-format.md`**. (2) **One index over all corpora**, with a `corpus`
column: **`SCHEMA_VERSION` 6** in the store. (3) The shared half becomes a **published package** with a conformance
fixture: **[`dsh-session-rows`](https://github.com/johnlam1968/dsh-session-rows)**, whose rules are the vocabulary,
the text rules, the source rule, **the ask-group** and **the surface**.

**AND THE PI EXTENSION EXISTS, WHICH IS THE SECOND IMPLEMENTATION OF THE FORMAT:**
**[`pi-session-log`](https://github.com/johnlam1968/pi-session-log)** — a pi extension that records a pi session in
the format **from inside pi**, writes it into the **dsh corpus's own layout** (`<root>/<cwd-slug>/<session-id>/session.v4.jsonl`,
with pi's own slug convention) so the **same store** indexes it with no change, and produces the rows from it. It
imports no dsh code and must not be able to: its rules come from the package, and its mapping from pi's entries to
the format's records is its own.

**THE MEASUREMENT, and it is the reason the work was worth doing.** Composing every pi session both ways — the
**dsh-shaped** path (pi → a dsh v4 log with an invented turn and step) against the **pi-native** path (pi → the
format, with no turn invented) — over the live corpus:

```
node scripts/check-pi-channels.mjs --pi-repo ../pi-session-log
sessions: 260 compared, 252 agreed on the composed state, 8 diverged, 14 differed in order only, 0 unreadable
```

**THE 8 ARE COMPACTIONS, AND THE dsh-SHAPED PATH IS THE WRONG ONE** (**`F185`**): it writes no `surfaceOp`, so in
one session **1,178 messages the model could no longer see read as though it had seen them**, and the summary that
replaced them is absent from its rows entirely. **22 sessions differ in the ORDER** of an injected message, because
the dsh-shaped path places one at the head of its exchange — that is where a dsh log can put it — while the native
path keeps the order things happened in.

**AND THE FIXTURE WAS NOT FIT FOR THE JOB, WHICH AN INDEPENDENT REVIEW MEASURED** (**`F188`**): eleven producer
mutations — including the **reasoning join**, the very defect class the whole design exists to prevent — left the
suite green. The fixture now exercises every rule it claims to, the package derives the rows from its own log
(**`F191`**), and both producers resolve a message's content **by type** rather than by searching for it
(**`F186`**) — which exposed **eight test fixtures** that had been built in the wrong shape and agreeing with the
code (**`F187`**). **`F189`**: the store's conformance test named the one difference it accounted for and never
asserted the column where it lived. **`F190`**: the package's reasoning rule returned `''` for the absence, which
is the one value the contract forbids.

**WHAT IS STILL BLOCKED, and it is the same block as before: the package is not PUBLISHED.** lan100 has no npm
credentials (`npm whoami` → ENEEDAUTH), so neither repository can import it, and the two producers still carry their
own copies of the rules — kept honest by the fixture, and by nothing else. **A pi extension that restated the rules
would be the third copy**, which is the thing the extraction exists to prevent.

## 0c. The split's FIRST STEP, and the number it moved (2026-10-21)

**`ROADMAP.md` §14.8 STEP 1 IS DONE: the input shape is pure, and it has a contract.** The shape — `point`,
`callsEnabled`, `subjects`, `axes`, `questions`, `limits`, `redaction`, `transport` — was built in
`core/instrument-input.js` and read in the instrument, and the file was COUPLED for two reasons: the point descriptor
is the harness's event names, and the session scope reads this row's own config. **Both are the HOST's to supply, so
both are supplied as BINDINGS** and the pure shape moved to `core/instrument-shape.js`. A second host — a pi
extension — now binds at those two functions and reaches no harness event at all.

**AND THE NUMBER THE MOVE WAS SUPPOSED TO MOVE, MOVED: the `core/` dsh surface is 6 files, not 10.** Four files —
`core/battery-tool.js`, `core/decide-tool.js`, `core/turn-trigger.js`, `core/turn-listener.js` — were coupled for
ONE reason, which was that they imported `core/instrument-input.js` for `questionGroup` and that file reached
`dsh/host-events.js`. They reach no harness event now, so they are **PROMOTED** to the instrument list (50 → 55) and
the coupled list shrank (10 → 6). **The gate said so itself:** *"core/battery-tool.js is declared coupled but breaks
no rule: promote it to the instrument list instead of leaving the excuse."* A list that keeps an excuse that no
longer holds has stopped being a measurement.

**AND THE CONTRACT EXISTS, AND IT HAS TEETH (F192).** `test/fixtures/instrument-shape/contract.mjs` is a vendored,
digest-pinned fixture — digest `a1a45d16ca9f645677fd07315d3af95f9499c20b32c1d7b2765087225c30299a`, over the file NAME
as well as its bytes — and **it is a `.mjs` and not JSON, because the shape distinguishes a key that is ABSENT from a
key that is PRESENT AND HOLDS NOTHING, and JSON has no `undefined`.** The comparison is `deepStrictEqual`, which is
the only comparison that tells the two apart. **AND THE TEETH ARE A GATE, NOT A PARAGRAPH:**
`scripts/check-contract-teeth.mjs` mutates the shape **and the bridge**, seventeen ways, **in a copy of the tree**, and
fails if any mutation leaves the contract green — **17 of 17 caught** — and it is in `npm run ci`.

**AND AN INDEPENDENT REVIEW MEASURED THAT THE FIRST VERSION OF THAT CONTRACT MISSED SIX OF THE RULES IT WAS ABOUT
(F193),** which is the more useful half of the review: a contract that has never been shown to fail is a description
of a test, and the first version of this one would have been. The six were the scope binding receiving the raw
config, `||` for `??` on the provider, `!=` for `!==` on the calls switch, the per-seam switch read for a hardcoded
point, the `isRecord` guard dropped, and the bridge's transport default dropped. **The fixture has eleven cases now
and the script seventeen mutations, and the script REFUSES a mutation whose target text is not unique** — because the
first version of the script changed the WRONG function and reported a false alarm, which is the **F183** shape one
level down. It also separates a BROKEN copy from a catch, because a tree that cannot load scores red for the wrong
reason.

**AND ONE THING THE STEP DOES NOT DO: the shape is bindable IN THIS REPOSITORY, not from another one.** A second
repository can only import a package, and the shape is not published under a name a pi extension could name — that is
`ROADMAP.md` §14.8 step 4, and **do not add a subpath export to get around it**: publishing a harness-free API under
the harness's name is the naming problem the plan names.

## 1. State

| | |
|---|---|
| this repo `dsh-system1-observer` | branch **`composing-tools`**, **pushed** (`bc8ecda`); **931 tests**, 930 pass, 0 fail, 1 skipped; **the rules are the package's, imported by integrity**; **the input shape has a contract** |
| store `dsh-session-index` (`~/CodingProjects/dsh-session-index`, GitHub `johnlam1968/dsh-session-index`) | **`72636ea`**, **pushed**; 58 tests; **`SCHEMA_VERSION` 6**; **the rules are the package's**; **946 of 946 sessions agree on every field** |
| package `dsh-session-rows` (`~/CodingProjects/dsh-session-rows`, GitHub `johnlam1968/dsh-session-rows`) | **`bc318d9`**, **pushed**; 10 tests; **PUBLISHED — `dsh-session-rows@0.2.0`**, tarball sha1 `875854e6107a7dec5e3f9940684847d53dd4500a`, the same digest the CI build produced from the tagged commit |
| pi extension `pi-session-log` (`~/CodingProjects/pi-session-log`, GitHub `johnlam1968/pi-session-log`) | **`3669714`**, **pushed**; 43 tests; **PUBLISHED — `pi-session-log@0.1.0`**, tarball sha1 `98affa86a762190b19575ee0fa96e4faa2f97360`; the second implementation of the format |
| coverage | observer **97.55 / 82.4-82.7 / 91.77** (measured on Node 22.19.0; the line this repository measures on is **25.3.0**), store **96.86 / 77.69 / 89.01**, package **100 / 93.22 / 100**, pi **99.78 / 76.61 / 100**. **THE BRANCH FIGURE IS A RANGE, NOT A VALUE** — the coverage report is not reproducible (**`F194`**), so a coverage number quoted anywhere in this repository is a run and not a measurement |
| gates | `test`, `coverage`, `check:citations`, `check:compat`, `check:contract-teeth` (**17 of 17** mutations caught), `check:composition` (composes **201 rows**), `check:deploy` |
| topology | `core/` the instrument · `dsh/` the adaptation to ONE harness · `dsh/session-adapter/` five pure modules. **`lib/` is gone** |

**ALL SEVEN GATES RUN HEADLESSLY.** `check:composition` shells out to `dsh --profile <p> --dump-config`, and
`check:deploy` reads profile files. `check:contract-teeth` copies the tree and mutates the shape in the copy. You do not
need the Web UI, a running harness, or a browser to verify anything in this repository — which is what makes it
workable from a machine that is not the one the harness runs on.

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
query silently becomes a dsh-only query while looking cross-harness. **SEVEN rules** are enforced by
`test/session-rows.test.js`: `exchange` required and non-null, `shadowed` required, a malformed line counted rather
than dropped, absence is `null` and never `0`, the text and the reasoning are **trimmed** (RULE 5), `interrupted` is
**present and `null` means nobody said** (RULE 6), and a row carries **no NUL byte** (RULE 7).

**THE CONTRACT IS THE ONLY PLACE A RULE LIVES, and the store keeps a copy of it.** The store imports no dsh code by
design, so "the text is trimmed", "only `reasoning` is reasoning" and "no NUL byte" are now restated there. They
are aligned today; **a change to one is a change to the other, and nothing enforces it** — which is the case for
extracting the shared half, and the reason to extract it before the next rule is added.

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

* **THE LOCAL MIRROR IS A COPY AND IT DRIFTS, AND `push.sh` OVERWRITES WHOLE FILES.** Editing a mirrored
  `package.json` and pushing it back can silently revert a change that was made on the host -- and the revert is
  invisible until an install fails somewhere else. **Measured, and it cost a release**: the edit that added the
  question sets to the `files` list was made in the mirror, the mirror had not been told about the dependency on
  `dsh-session-rows` that had been added on the host by script, and pushing the mirror dropped the dependency. The
  lockfile still named it, so `npm ci` did not object -- it simply did not install it, and eleven test files went
  red with `Cannot find package 'dsh-session-rows' imported from .../session-format.js`. **The rule: edit the
  authoritative copy (on the host), or sync the mirror from the host FIRST and check the diff.** The mirror is
  useful for reading and for pushing whole files that nobody else is editing; it is not a second source of truth.
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
* **SQLITE KEEPS ONLY THE BYTES BEFORE THE FIRST NUL.** `node:sqlite` binds a JavaScript string with
  NUL-terminated semantics, so a message whose text held one NUL was stored as the characters before it and
  **nothing after it** — the other 89 characters were not shortened, they were GONE, and the row read as though the
  model had said less (**`F180`**). The same rule emptied a tool call's name, so a call read as a call that named
  no tool. **The tell is a text that is a PREFIX of the one it should be**, and the reason it stayed invisible for so
  long is that the count of messages was right throughout.
* **A GATE THAT NAMES 22 OF 60 FILES CHECKS 22 OF 60 FILES.** The instrument gate was not wrong in what it checked;
  it was wrong in what it covered (**`F178`**). And the coupling it declared was not the coupling that existed,
  because coupling is **transitive** — four files reached `dsh/` through `core/instrument-input.js` and were
  declared portable, in as many words. Declare the DIRECTORY, walk the GRAPH, and fail in both directions.
* **A COMPARISON THAT COMPARED NOTHING MUST NOT REPORT SUCCESS.** The agreement tool exited 0 on a run that read no
  logs, because its exit code was `divergent.length === 0` and the unreadable sessions were not in that count
  (**`F183`**). A signal that is always on is a signal nobody reads, and a signal that is always OFF is a signal
  nobody trusts. **A tool that measures nothing has to say it measured nothing.**
* **AN ERROR MESSAGE CAN CARRY THE CONTENT IT WAS ABOUT.** V8's `JSON.parse` message quotes a fragment of the
  offending line — and in this corpus, a malformed tool-call line is where a live Telegram bot token sits (**`F183`**).
  The tool prints shapes and lengths for every value it compares; the leak was in the one path that printed an
  error's message verbatim. A tool that reads a corpus knows things; say what it knows in a shape, never in a value.

## 5. Open, and known not to be yours

* **THE COVERAGE REPORT IS NOT REPRODUCIBLE, and it is not this change's doing.** The branch figure moves on every
  run of the same tree — measured on the unchanged baseline at 82.18 / 82.50 / 82.32 / 82.54 / 82.62 — while line and
  function coverage are stable. **`F194`**: `node --experimental-test-coverage` sets `NODE_V8_COVERAGE` to a
  directory and **child processes inherit it**, and this suite spawns children; a child whose coverage file has not
  landed by the time the parent collects is simply not counted. Removing the child-spawning test files makes
  `core/model/narrow.js` stable, which is the measurement that names the mechanism. **The fix is its own commit** —
  the spawning tests have to set `NODE_V8_COVERAGE` for their children deliberately. Until then, **every coverage
  number in this repository is a range and not a value.**
* **A SECOND HOST CAN BIND AT THE SHAPE IN-REPOSITORY, AND CANNOT YET FROM ANOTHER REPOSITORY.** The shape is pure and
  the two host bindings are passed in, so a pi extension binds at two functions — but a separate repository can only
  import a PACKAGE, and the shape is not published under a name a pi extension could name. `ROADMAP.md` §14.8 step 4
  is what fixes that (`system1-measure`, deliberately not `dsh-`prefixed). **Do not add a subpath export to
  `package.json` to get around it**: publishing a harness-free API under the harness's name is the naming problem the
  plan names, and it is what the migration in step 4 then has to undo.
* **THE CONTRACT FIXTURE HAS TO TRAVEL WITH THE PACKAGE, and it does not yet.** It is at
  `test/fixtures/instrument-shape/contract.mjs`, and the `files` allowlist does not carry `test/` — correctly, because
  a test fixture is not a runtime file. But a consumer that vendors the contract needs the fixture itself, exactly as
  `dsh-session-rows` ships its own. **Decide where it lives when the package is cut, and move the digest and the
  allowlist in the same commit** — a fixture that travels without its digest protects nothing.
* **TEN COMMENTS STILL NAME `lib/instrument-input.js`, WHICH HAS NOT EXISTED SINCE THE FOLDER SPLIT.** They are in
  `core/observe.js` (3), `core/questions.js` (2), `core/redact.js`, `core/seams.js` (2), `core/system1.js` and
  `dsh/index.js`. The one in `core/turn-trigger.js` was fixed by this change, because that file was already being
  touched — and **a bulk rename is not a migration** (`F172`), so the rest is a decision somebody makes on purpose
  rather than a `sed` somebody runs.
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
* **The store WAS a second producer, and it no longer is: the rules are said ONCE, in `dsh-session-rows`, and ALL
  THREE PRODUCERS IMPORT THEM.** The package is **PUBLISHED** — `dsh-session-rows@0.2.0` is on the registry, and
  the artifact there is byte-for-byte the one the GitHub Actions build produced from the tagged commit (sha1
  `875854e6107a7dec5e3f9940684847d53dd4500a`, verified by downloading it back and hashing it). The observer, the
  store and the pi extension now resolve it **by integrity** from the registry, not from a sibling checkout.
  **What each one stopped carrying:**
  - the observer: the surface fold (45 duplicated lines), the source rule, the ask-group, the reasoning and the NUL
    rule on the producer side;
  - the store: the NUL rule, the visible-text rule, the reasoning rule, the "who spoke" predicate, and the surface
    fold that decided the `shadowed` flag;
  - the pi extension: it already imported the rules, but it had been tested against a **symlink** to a working copy
    rather than against what a consumer installs.
  **AND THE CONFORMANCE FIXTURE IS STILL VENDORED AND DIGEST-PINNED** by all three, because a published rule and an
  imported rule are only the same rule if the fixture says so (**`F191`**).
  **AND THE INSTRUMENT'S OWN `core/` IS DELIBERATELY NOT DEPENDENT.** `test/instrument-boundary.test.js` walks the
  closure of `scripts/ask.mjs` and asserts that every file it reaches loads with **no `node_modules` at all** — no
  bare specifier anywhere — so the standalone cannot take a dependency on a published package. That property is
  measured and enforced, and it is why the split is where it is: the **package is the shared half for PRODUCERS**,
  and the **standalone keeps its own copy** because it has to run with nothing installed. The package imports no dsh
  code, so the boundary check is unaffected — it follows relative specifiers only, and a bare specifier is outside
  the repository.
  **AND THE MEASUREMENT IS THE WHOLE CORPUS.** After the store's refactor the index was rebuilt from scratch — every
  session refolded, because a fold that changes has to be re-folded to be compared — and: **946 in the index, 946
  compared, 946 agree on every field, 0 differ, and the COMPOSED STATE differs in 0 sessions.**
* **THE PUBLISH NEEDS A CREDENTIAL ONCE, AND THREE RUNS MEASURED WHY.** This page said the publication was
  "one `npm login` away". It is not, and the difference cost three runs. lan100 has no npm credentials at all
  (`npm whoami` → ENEEDAUTH), and the Mac's token is one of the 2FA-**BYPASSING** tokens npm is deprecating: the
  registry answers a publish with `HttpErrorAuthOTP: OTP required for authentication`, because that token cannot
  publish without a one-time password. **The repository's own release path is npm's TRUSTED PUBLISHING** — the OIDC
  exchange the other three repositories already use, with no stored secret — and it is the right one, because npm
  restricts **DIRECT PUBLISHING with bypass tokens in January 2027**. But trusted publishing cannot carry a **FIRST**
  publish, and that is measured rather than assumed: `npm publish` answers **404 on PUT** and `npm stage publish`
  answers **404 on GET**, because the trusted-publisher configuration lives **ON THE PACKAGE'S REGISTRY PAGE** and a
  package that does not exist has no page to carry it. The two sister repositories published their 0.1.0 with a token
  FIRST and only then could the OIDC path take over; nobody had met this before because they never needed a first
  publish through it. **So the remaining action was ONE publish with any credential — a token, or the npm web UI — and
  after that the workflow takes over forever, with no secret anywhere. BOTH PACKAGES ARE NOW PUBLISHED:**
  `dsh-session-rows@0.2.0` and `pi-session-log@0.1.0`, each with the tarball's sha1 verified against the one built
  from the committed tree.**
  **The workflows are BUILT, VALIDATED AND GREEN**: `dsh-session-rows/.github/workflows/publish.yml` and
  `pi-session-log/.github/workflows/publish.yml` run the suite, then check the fixture digest the three consumers
  pinned, then check the tarball's contents, then publish with provenance, then prove the version is INSTALLABLE
  (a green publish is not evidence of a release — npm's trusted flow can STAGE one), then check the dist-tag, then
  cut the GitHub Release. Two measurements shaped them: **npm 12 is what can carry a first publish**, and **npm 12
  cannot be installed on node 25** (`engines.node: ^22.22.2 || ^24.15.0 || >=26.0.0`), so the publish runs on node 26
  while the suite runs on node 25, where this repository measures its coverage floor.
* **THE RELEASE PATH NEEDS NO CREDENTIAL, AND THAT IS MEASURED RATHER THAN INTENDED.** npm is deprecating the tokens
  that bypass 2FA — account changes in August 2026 and **DIRECT PUBLISHING in January 2027** — so a release path
  that holds a long-lived token is a release path with an expiry date on it. The path that has no expiry is npm's
  **TRUSTED PUBLISHING**: the job proves who it is over OIDC, npm decides whether that is allowed, and there is no
  secret to store, leak, or rotate. **BOTH PACKAGES ARE BOUND AND BOTH HAVE PUBLISHED CREDENTIAL-FREE**:
  `dsh-session-rows@0.2.1` and `pi-session-log@0.1.1` were published by the workflow **from the tag alone, with no
  token anywhere**, each with a signed provenance statement and the version installable afterwards.
  **AND THE FIRST PUBLISH IS THE ONE THAT NEEDS A CREDENTIAL**, because the trusted-publisher binding lives on the
  package's page and a package that does not exist has no page to carry it — so `dsh-session-rows@0.2.0` and
  `pi-session-log@0.1.0` were published with a one-time code, and every release after them needs none. **AND npm
  creates the `0.0.0-stage` placeholder ITSELF** when a publish creates a package, which is why all four
  repositories in this account carry one and why nobody had to bootstrap it by hand.
  **AND TWO THINGS THE FIRST CREDENTIAL-FREE RUNS TAUGHT, both of which are now fixed in the workflows:**
  - **THE INSTALLABILITY WINDOW WAS TOO SHORT, AND THE CHECK THAT EXISTS TO CATCH A STAGED PUBLISH CAUGHT THE
    TIMING INSTEAD.** npm says "your package is being processed and may take a few minutes", and "a few minutes"
    was more than three: the version was not installable at 195 seconds and WAS at 250. The window is now 20 checks
    over ~5 minutes.
  - **`npm stage list "<pkg>@<ver>"` IS REJECTED BY npm 12** — "Version specifiers are not supported for listing
    staged packages" — so the list takes the package spec and not the version, and the filter on the version is done
    by the workflow. An independent review had called that line "fine"; running it was what proved otherwise.
  **AND A RE-RUN DURING npm's PIPELINE FAILS WITH E409** — "Cannot publish over previously staged version" — which
  is npm saying the version is still in flight, not that the release is wrong. A re-run AFTER the version is
  installable is green.

* **THE RECEIPT'S `sourceBytes` MEANT TWO DIFFERENT THINGS, AND IT IS FIXED** (**`F182`**). The log route reported
  the DECODED length of the conversation and the index reported the ON-DISK size of a COMPRESSED log, because the
  store's `bytes` column was doing two jobs — change detection and the receipt's evidence. `SCHEMA_VERSION` 6 gives
  the store a `decoded_bytes` column beside it, and the reader prefers it; the on-disk size is the fallback for an
  index built before the column, and that fallback is NAMED in the receipt's `missing` list rather than used quietly.
* **THE INDEX CHANNEL LOST EVIDENCE THE LOG CHANNEL CARRIES, AND THAT IS FIXED TOO** (**`F184`**). 4,758 tool-call
  arguments were cut at the store's 4,000-character cap with no length stored beside them, and 120 interruption facts
  had no column at all. `SCHEMA_VERSION` 6 adds `tool_calls.args_chars` (the full length beside the cap, which the
  store already did for tool RESULTS) and `messages.interrupted` (1, 0, or NULL — the log's own value, and NULL where
  the log said nothing). **The reading was always the same; now the evidence is too.**
* **THREE DECISIONS WERE ASKED AND ANSWERED, and they set the shape of the next work.** (1) **This repository owns
  the session-log FORMAT**: a neutral spec, implemented by dsh, by pi and by any future substrate, rather than a dsh
  log every other substrate has to be converted into. (2) **ONE index over all corpora**, with a `corpus` column —
  which is now `SCHEMA_VERSION` 6's first column, and `session_index_list` filters on it. (3) **The shared half becomes
  a new small published package** that owns the contract, plus a conformance fixture both repositories test against,
  so the store stops restating the rules and starts depending on them. **The next work, in this order: the format
  spec, the package, the pi extension.** -- **AND THE FIRST THREE ARE DONE (2026-10-20)**: the spec is
  `docs/session-log-format.md`, the package is `dsh-session-rows`, and the pi extension is `pi-session-log`. What
  remains is the act vocabulary (undecided until a measurement asks for it), the extraction of the instrument into
  the package the shared half established, and **the publication** — DONE: `dsh-session-rows@0.2.0` and
  `pi-session-log@0.1.0` are on the registry, and the two producers import the rules rather than restate them; see
  §5. **What is left is BINDING the trusted publisher for the two new packages on npmjs.com** — the binding lives
  on the package's page, and a package's page does not exist until the package does.

## 6. Where to start

0. **`docs/next-session.md` — THE BRIEFING FOR WHOEVER PICKS THIS UP NEXT.** It names the four repositories, the
   measured state, the commands that take each measurement, the split's four steps, and the traps. It is committed and
   published, so a fresh instance can clone and read it, and it is the one document to read before the rest of this
   page: this page is the state, that one is the starting line.
1. `AGENTS.md` — what the standing reminders mean here.
2. `core/README.md` — the map, **enforced**: a test fails if a file is not named or a name does not exist.
3. `docs/session-log-format.md` — **the format this repository owns**, with the content kinds and the acts measured
   over the live corpus. Read this before writing a producer for a new substrate.
4. `docs/findings.md` — every defect with its cause and consequence. Append-only; add, do not rewrite.
5. `npm run ci` — the whole gate. If it is green, the tree is honest.
6. `npm test 2>&1 | grep '^✖'` when something fails; the failure message names the file and the field.
7. `ROADMAP.md` §14.7 — **the three decisions the operator made on 2026-10-19 and what they change**, and the work
   that follows from them in dependency order.
8. **`pi-session-log`'s `docs/measurement.md`** — the corpus, the two channels composed both ways, the 8
   compactions the dsh-shaped path loses, and the live pi run that produced the receipt. Read it before changing the
   pi mapping, and before writing a producer for a THIRD substrate: it says what the format costs and what it buys.
9. **`docs/session-log-format.md` §6** — the checklist a new substrate must satisfy. It is seven points long, and
   every one of them was bought by a measurement.

