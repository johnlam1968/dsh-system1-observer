# Next session — the measurement is a package now, and everything a new instance needs to pick it up

**You are reading this because you are about to continue this work. The code is in the five repositories below;
nothing else needs to be fetched.** Clone them and read `ROADMAP.md` §14.8 in the observer — which is the plan of
record and now also the record of what was executed — then come back here for the state.

## Start here

    git clone https://github.com/johnlam1968/dsh-system1-observer.git
    cd dsh-system1-observer
    git checkout work/split-step-1
    # node 25.3.0 is the line the gates are measured on
    export NVM_DIR="$HOME/.config/nvm"; . "$NVM_DIR/nvm.sh"; nvm use 25.3.0
    DSH_PROFILE=docdrift npm run ci

    # and the package it now depends on
    git clone https://github.com/johnlam1968/system1-measure.git

**The observer depends on the package BY NAME** (`"system1-measure": "^0.1.0"`), so `npm install` before `npm run ci`.
Until the package is on npm, install it from the working tree: `npm install file:../system1-measure --no-save`.

## The five repositories

| repository | branch | what it is |
|---|---|---|
| `github.com/johnlam1968/dsh-system1-observer` | `work/split-step-1` | **the plugin**: the dsh adaptation, the tools an agent gets, the settings, the gates |
| `github.com/johnlam1968/system1-measure` | `master` | **the measurement**: the question sets, the composition, the chain, the format, the rows, the rules. No harness, no dependencies |
| `github.com/johnlam1968/dsh-session-index` | `master` | the store: a SQLite index over session logs, no dsh import at all |
| `github.com/johnlam1968/dsh-session-rows` | `master` | **the rules, still published under the old name** — it is now a deprecated shim over `system1-measure/rules` |
| `github.com/johnlam1968/pi-session-log` | `master` | a pi extension that records a pi session in the format |

The work happens on a host named `lan100` (`~/CodingProjects/<repo>`), where the harness, the pi corpus, the live
session index and the model credentials live. The repositories are the source of truth; that host is where the
measurements are taken. A cloud instance can do the reading, the writing and the review from the repositories
alone, but the measurements that need a corpus need that host.

## What this is

A measurement system that measures AI coding sessions. The operator's goal, in their words: *"the repo to be harness
free, dsh-system1-observer is just one of its implementation, next on the horizon is an adaptation to pi-coding-agent."*

**The measurement is now a separate package, and the observer is one implementation of it.** The six items of the
agreed plan are done, measured, committed and pushed; the split is done too, except for the npm publish.

## The state, measured

- **All gates green.** observer 612/612 (97.14 / 79.27 / 88.00) · package 344/344 (93.67 / 81.53 / 88.66) ·
  store 58/58 · pi 43/43.
- **The package declares NO dependency of any kind**, and the claim is checked three ways: the tarball gate reads the
  **published** manifest, the boundary test fails any module with a bare specifier, and the standalone is copied into
  a clean room with no `node_modules` and **run**.
- **The rules are ONE file.** `system1-measure/rules/index.js`, absorbed **verbatim** from `dsh-session-rows` — the
  same bytes, the same fixture, the same digest
  `27bb1c0c893adb4f6b52648fdff32cb17b39022f8dbea53451ac5f84058cdb66` that the store and the pi extension pin. The
  observer's row reader **imports** them now; it does not restate them (F195).
- **The two channels agree on the whole corpus**: 946 sessions in the index, 946 compared, **946 agree on every
  field, 0 differ, and the composed state differs in 0 sessions.** The one named difference is the one the contract
  names: tool-call arguments, where the index keeps a capped copy and declares the full length beside it.
- **The release path holds no credential.** The packages publish from a `v*` tag alone: the job proves who it is
  over OIDC and npm decides. The FIRST publish of a package is the exception and needs one one-time code, because
  the trusted-publisher binding lives on the package's own registry page and a package that does not exist has no page.

## The commands that take the measurements

    # node 25.3.0 on the host: export NVM_DIR="$HOME/.config/nvm"; . "$NVM_DIR/nvm.sh"; nvm use 25.3.0

    # the observer's whole gate (needs DSH_PROFILE=docdrift)
    cd ~/CodingProjects/dsh-system1-observer && DSH_PROFILE=docdrift npm run ci

    # the package's whole gate -- no profile, no harness, no dsh
    cd ~/CodingProjects/system1-measure && npm run ci

    # the two channels, over the whole corpus (the package's script now)
    node scripts/check-channel-agreement.mjs --index ~/.dsh/session-index.db

    # the two pi paths (needs the pi corpus and the second repository on disk)
    node scripts/check-pi-channels.mjs --pi-repo ~/CodingProjects/pi-session-log

    # the input shape's contract, and the proof that it can fail (2 seconds, and it is in `npm run ci`)
    # -- the shape's 15 mutations in the package, the bridge's 2 in the observer
    cd ~/CodingProjects/system1-measure && node scripts/check-contract-teeth.mjs
    cd ~/CodingProjects/dsh-system1-observer && node scripts/check-contract-teeth.mjs

## The split — DONE, except for the publish

The plan of record is `ROADMAP.md` §14.8, and it now carries the execution record as well. In short, and with what
actually happened rather than what the plan predicted:

1. **Extract the pure input-object shape** — **DONE, 2026-10-21.** `core/instrument-shape.js`, the bridge keeps the two
   host bindings and passes them in. The contract is a vendored, digest-pinned fixture with a `deepStrictEqual`
   comparison, and the teeth are a gate. An independent review measured that the first version of the contract missed
   six of the rules it was about (F193). Findings **F192**, **F193**.
2. **Move the chain, the producer, the format vocabulary and the row reader** into the package — **DONE, 2026-10-22.**
   **54 source files and 34 test files**, and the observer kept 18 `core/` files and 17 `dsh/` files. Every moved file
   carries its reason in the package's `docs/cut-line.json`.
3. **Absorb the rules** — **DONE, 2026-10-22.** Verbatim, so the digest does not move, and the observer's copy is
   gone (F195). The path is `system1-measure/rules`, and it is deliberately not re-exported from the main entry.
4. **Cut the repository and publish** — **the repository is cut and pushed; the publish is NOT done.** The workflow is
   written and ready; the token on this host has no `workflow` scope, so it cannot create
   `.github/workflows/publish.yml`, and neither can the API (GitHub answers 404 for a workflow path on a token without
   that scope). The local tag `v0.1.0` is ready to push **once the workflow file is in the repository**.

**And the honest boundary: the move does NOT close the 8-of-260 pi divergence.** The dsh-shaped pi path and the
pi-native path disagree on 8 of 260 sessions — every one a compaction the dsh-shaped path loses, so ~1,178 messages
the model could no longer see read as though it had seen them (F185) — and on the order of messages in 22 sessions. A
rules check cannot see a rule that was never applied: each path is internally consistent. Closing it needs a
**cross-path** check — one session, two producers, compared — and that is separate work.

## Traps that cost something, so they do not cost twice

- **A token without the `workflow` scope cannot create a workflow file — and the API does not help.** GitHub answers
  404 for `.github/workflows/*` on such a token, and the contents API answers 404 too, while a file in `.github/`
  outside `workflows/` is created happily. The error looks like "the path does not exist", which is a lie.
- **A first publish cannot use the OIDC path.** `npm publish` answers 404 on PUT and `npm stage publish` answers 404 on
  GET — and the 404 on GET is because a **package spec** makes npm resolve from the registry instead of packing the
  working directory. The spec-less form creates a package that does not exist. Three runs were spent reading the
  symptom as "npm cannot do it".
- **npm 12 is what can carry a first publish, and npm 12 cannot be installed on node 25**
  (`engines.node: ^22.22.2 || ^24.15.0 || >=26.0.0`). The publish therefore runs on node 26 and the suite on node 25.
- **The installability window is a floor in minutes, not a pinned count.** A window pinned to 13 checks reported a
  failure for a release that had actually landed, because a 1.43 MB package was not on the registry at 195 seconds and
  was at 300. The test now asserts a floor of 300 seconds.
- **AN IMPORT REWRITE CAN LAND INSIDE COMMENTS AND NOTHING FAILS (F198).** The migration found import positions in a
  comment-STRIPPED copy of the text and spliced the ORIGINAL with those offsets; stripping shortens the text, so every
  offset after the first comment was wrong. The files loaded, imported the right modules, and carried corrupted prose,
  and the whole suite was green. **Blank comments, do not delete them, and compare every file's import COUNT against
  the pristine tree** — the count is the only thing that says so.
- **A COPY OF A REPOSITORY IS NOT A SECOND SOURCE OF TRUTH.** A `package.json` edited in a local mirror and pushed
  over the host reverted a dependency; the lockfile still named it, so `npm ci` did not object — it just did not install
  it. Edit the authoritative copy.
- **A BULK RENAME IS NOT A MIGRATION.** The script that moved `lib/` matched `lib/` wherever it found it — including
  `dsh-web-app/lib/startup.js` and `node/v25.3.0/lib/node_modules`, which belong to other packages. Seventeen
  third-party paths became `core/`, and it took a byte-diff against a live profile to see it. Recorded as **F172**.
- **A TEST THAT AGREES WITH THE IMPLEMENTATION CANNOT CATCH THE IMPLEMENTATION.** Dropping `subject.messages` from
  the trace line left all 18 evaluate-tool tests green, because none of them looked at it. This is the same failure as
  the two producers of rows (F173–F180), and the same answer: a contract, not a description.
- **A POSITIONAL ROW IS A ROW WHOSE MEANING LIVES IN FIVE PLACES.** Inserting `exchange` into
  `dsh-session-index`'s `messages` moved `shadowed` from index 7 to 8, and the pass that set it still wrote 7 — so it
  overwrote `reasoning` with the integer `1`. The existing test asserting `m[7] === 1` **passed**, because it used the
  same wrong index. Read new columns out of SQLite **by name**, and ask what the table has.
- **A GATE THAT NAMES 22 OF 60 FILES CHECKS 22 OF 60 FILES.** The boundary used to name the files it checked, so the
  other 38 were outside the boundary without being outside the directory. It walks the directory now, in both
  directions.
- **A COMPARISON THAT COMPARED NOTHING MUST NOT REPORT SUCCESS.** The same shape as the gate above: an empty set of
  offenders is not a clean bill of health, and a check that cannot see the thing it is about must say so rather than
  pass quietly.

## Open, and known not to be the next thing

- **THE PUBLISH.** Add `.github/workflows/publish.yml` to `system1-measure` (the file is in the working tree at
  `system1-measure/.github/workflows/publish.yml`, and the sibling `dsh-session-rows` has the same workflow with the
  name and two gates changed), then push the `v0.1.0` tag. The FIRST publish needs one one-time code, because the
  trusted-publisher binding lives on the package's own registry page and a package that does not exist has no page.
- **THE OLD NAME IS STILL PUBLISHED.** `dsh-session-rows@0.2.1` is on npm and still resolves, and it is now a
  **deprecated shim** over `system1-measure/rules`. The three consumers' ranges must move deliberately — `npm install`
  does not follow a rename — and the shim's own release is what makes the move safe.
- The **act vocabulary** stays undecided until a measurement asks for it.
- The `docdrift` profile service is dead on the host (pre-existing, unrelated).
- The npm token on the workstation is no longer needed for publishing and could be deleted.
- **THE PI ADAPTATION** — a second host binding the same chain, the same shape and the same wire — is the next piece
  of real work, and the 8-of-260 divergence is what it has to answer.

## Read next

`ROADMAP.md` §14.8 in the observer (the plan of record and the execution record), then this file's traps, then
`docs/session-log-format.md` **in the package** (the format this whole thing is about) and `docs/findings.md` in the
observer (every defect, with its cause — F173–F191 are the ones that shaped the design, and **F195–F198** are the
ones the split found).
