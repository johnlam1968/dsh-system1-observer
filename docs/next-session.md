# Next session — the split, and everything a new instance needs to pick it up

**You are reading this because you are about to continue this work. The code is in the four repositories below;
nothing else needs to be fetched.** Clone them and read `ROADMAP.md` §14.8 in the observer, which is the plan of
record, then come back here for the state.

## Start here

    git clone https://github.com/johnlam1968/dsh-system1-observer.git
    cd dsh-system1-observer
    git checkout composing-tools
    # node 25.3.0 is the line the gates are measured on
    export NVM_DIR="$HOME/.config/nvm"; . "$NVM_DIR/nvm.sh"; nvm use 25.3.0
    DSH_PROFILE=docdrift npm run ci

Then the four steps of the split, in order (§14.8). **Step 1 is the input-object shape and its contract test** —
it is the smallest, it is the prerequisite for everything else, and it is the one piece that must not be skipped
because the alternative is the exact failure this project already paid for twice.

## The four repositories

| repository | branch | HEAD | what it is |
|---|---|---|---|
| `github.com/johnlam1968/dsh-system1-observer` | `composing-tools` | `aa99d2f` | the instrument (`core/`) + the adaptation to ONE harness (`dsh/`) |
| `github.com/johnlam1968/dsh-session-index` | `master` | `72636ea` | the store: a SQLite index over session logs, no dsh import at all |
| `github.com/johnlam1968/dsh-session-rows` | `master` | `bc318d9` | **published npm package** owning the rows contract + the conformance fixture |
| `github.com/johnlam1968/pi-session-log` | `master` | `3669714` | **published npm package**: a pi extension that records a pi session in the format |

The work happens on a host named `lan100` (`~/CodingProjects/<repo>`), where the harness, the pi corpus, the live
session index and the model credentials live. The repositories are the source of truth; that host is where the
measurements are taken. A cloud instance can do the reading, the writing and the review from the repositories
alone, but the measurements that need a corpus need that host.

## What this is

A measurement system that measures AI coding sessions, and the work of turning one repository into a harness-free
instrument that any harness can use. The operator's goal, in their words: *"the repo to be harness free,
dsh-system1-observer is just one of its implementation, next on the horizon is an adaptation to pi-coding-agent."*

The six items of the agreed plan are **done, measured, committed and pushed**. What remains is the split itself.

## The state, measured

- **All four gates green.** observer 920/920 (97.55 / 82.54 / 91.77) · store 58/58 (96.86 / 77.69 / 89.01) ·
  package 10/10 (100 / 93.22 / 100) · pi 43/43 (99.78 / 76.61 / 100).
- **The two channels agree on the whole corpus**: 946 sessions in the index, 946 compared, **946 agree on every
  field, 0 differ, and the composed state differs in 0 sessions.** The one named difference is the one the contract
  names: tool-call arguments, where the index keeps a capped copy and declares the full length beside it.
- **Both packages are published and installable**: `dsh-session-rows@0.2.1` and `pi-session-log@0.1.1`, plus
  `dsh-system1-observer@0.2.2` (which ships its question sets — 166 files, 1.43 MB).
- **The release path holds no credential.** Both new packages publish from a `v*` tag alone: the job proves who it is
  over OIDC and npm decides. The FIRST publish of a package is the exception and needs one one-time code, because
  the trusted-publisher binding lives on the package's own registry page and a package that does not exist has no page.
- **The rules are imported, not restated.** The observer, the store and the pi extension all resolve
  `dsh-session-rows` by integrity from the registry. The observer's `core/` deliberately keeps its own copy of the
  row vocabulary, because the standalone must load with no `node_modules` at all — measured and enforced by
  `test/instrument-boundary.test.js`. **That copy is what step 3 removes.**

## The commands that take the measurements

    # node 25.3.0 on the host: export NVM_DIR="$HOME/.config/nvm"; . "$NVM_DIR/nvm.sh"; nvm use 25.3.0

    # the observer's whole gate (needs DSH_PROFILE=docdrift)
    cd ~/CodingProjects/dsh-system1-observer && DSH_PROFILE=docdrift npm run ci

    # the two channels, over the whole corpus
    node scripts/check-channel-agreement.mjs --index ~/.dsh/session-index.db

    # the two pi paths (needs the pi corpus and the second repository on disk)
    node scripts/check-pi-channels.mjs --pi-repo ~/CodingProjects/pi-session-log

## The split, in four steps

The plan of record is `ROADMAP.md` §14.8. In short:

1. **Extract the pure input-object shape** from the coupled `core/instrument-input.js` — the shape both hosts bind at
   — and give it a **contract test**, so the dsh builder and a future pi builder cannot drift the way the two
   producers of rows drifted (F173–F180: who spoke, the digest, the text, the NUL).
2. **Move the chain, the producer, the format vocabulary and the row reader** into a package-shaped folder in-repo;
   fix the `windowChars` line; delete the dead `exchangesOf` import; leave the session-format module as a re-export
   layer. The plugin imports it relatively for now — one repository, one copy, no behaviour change.
3. **Absorb the rules** into the new package and switch the store and the pi extension to import them from it.
   This is the step most likely to break, and the reason is measured: the observer's core still carries its own copy of
   `withoutNuls`, so the store would have two import sources for one rule until that copy goes.
4. **Cut the repository and publish** `system1-measure` — deliberately **not** `dsh-`prefixed, because a harness-free
   package should not carry the harness's name. Both hosts then depend on it **by name**, never one by relative path
   and the other by package.

**And the honest boundary: the move does NOT close the 8-of-260 pi divergence.** The dsh-shaped pi path and the
pi-native path disagree on 8 of 260 sessions — every one a compaction the dsh-shaped path loses, so ~1,178 messages
the model could no longer see read as though it had seen them (F185) — and on the order of messages in 22 sessions. A
rules check cannot see a rule that was never applied: each path is internally consistent. Closing it needs a
**cross-path** check — one session, two producers, compared — and that is separate work.

## Traps that cost something, so they do not cost twice

- **A first publish cannot use the OIDC path.** `npm publish` answers 404 on PUT and `npm stage publish` answers 404 on
  GET — and the 404 on GET is because a **package spec** makes npm resolve from the registry instead of packing the
  working directory. The spec-less form creates a package that does not exist. Three runs were spent reading the
  symptom as "npm cannot do it".
- **npm 12 is what can carry a first publish, and npm 12 cannot be installed on node 25**
  (`engines.node: ^22.22.2 || ^24.15.0 || >=26.0.0`). The publish therefore runs on node 26 and the suite on node 25.
- **The installability window is a floor in minutes, not a pinned count.** A window pinned to 13 checks reported a
  failure for a release that had actually landed, because a 1.43 MB package was not on the registry at 195 seconds and
  was at 300. The test now asserts a floor of 300 seconds.
- **`core/session-rows.js` still carries a copy of the rules** the package owns, byte-for-byte. Deliberate for now
  (the standalone must have no dependencies) and it is what step 3 removes.
- **A copy of a repository is not a second source of truth.** A `package.json` edited in a local mirror and pushed
  over the host reverted a dependency; the lockfile still named it, so `npm ci` did not object — it just did not install
  it. Edit the authoritative copy.

## Open, and known not to be the next thing

- The **act vocabulary** stays undecided until a measurement asks for it.
- The `docdrift` profile service is dead on the host (pre-existing, unrelated).
- The npm token on the workstation is no longer needed for publishing and could be deleted.

## Read next

`ROADMAP.md` §14.8 in the observer (the plan of record), then `HANDOFF.md` §4 (the traps) and §5 (what is open),
then `docs/session-log-format.md` (the format this whole thing is about) and `docs/findings.md` (every defect, with
its cause — F173–F191 are the ones that shaped the design).
