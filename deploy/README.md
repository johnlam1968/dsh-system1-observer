# `deploy/` — the composition's load-bearing decisions, recorded

**What this is.** `ROADMAP.md` §14.6 (e): the profile that boots this stack (`$DSH_HOME/profiles/docdrift`) is **not
under version control**, and one tooling rewrite already dropped a mounted bundle from it silently (`F105`). Three
things in that profile exist nowhere else, so they are copied here:

| recorded | why it is load-bearing |
|---|---|
| `profile/package.json` | `dsh.profile.bundles` — the ORDERED list of what is mounted. The order decides which layer wins, and `dsh plugin … install` rewrites this file (`F105`) |
| `profile/cordis.patch.yml` | the row configs the deployment actually runs, including the persona override this project's `AGENTS.md` depends on |
| `profile/cordis.yml` | the profile tree itself |
| `profile/pnpm-lock.yaml` | the exact versions the deployment resolved |
| `profile/peer-bridge/` | a plugin whose **source lives only in the profile directory** — `index.js`, `package.json`, `smoke.mjs` |

**What is deliberately NOT here**, and why: `node_modules/` and the lockfile's effect are reproducible from
`package.json` + `pnpm-lock.yaml`; `data/` is local state; `.plugin-manager/` is a cache; and the `*.bak-*` files are
backups of the very files recorded above. Copying them would put a machine's caches into a repository.

**The drift check.** `npm run check:deploy` compares this copy with the live profile: every recorded file byte for
byte, and the bundle list by name **and order**. It exits non-zero on a difference, names the file, and — because this
is a comparison and not a mount — says `NOT CHECKED` on a machine with no such profile rather than passing quietly.
Two things it reports instead of failing on: any dependency pinned by a `file:` or absolute path, which a second host
cannot install.

**When to re-record.** In the same change that moves the profile — the check failing is the signal, not a nuisance.
`test/deploy-drift.test.js` pins the comparison itself (a dropped bundle, an edited patch, a machine-local pin),
because a check whose own logic is untested is a check that agrees with whatever it is given.

**This is not a repository, and that is a decision rather than an omission** (`ROADMAP` §14.6 (e)): there is exactly
one deployment of this stack (`docdrift`; `docdrift-headless` carries only `dsh-system1`; `web` and `headless` carry
none), so a repository would have one consumer — the mistake §14.1's stop condition refuses for the instrument. The
trigger for extracting this directory into its own repository is a **second host** that must reproduce the
composition, not a second plugin.

## Deploying a SECOND profile, step by step

**What is reusable and what is host-local.** Ten bundles in a fixed order (`profile/package.json`), four of them
`link:`ed to absolute paths on this host and one pinned to a `file:` tarball in `~/Downloads` (the check prints that
pin every run). So this directory reproduces the composition on **this** host; a second HOST needs the four local
packages published or cloned, and its own copy of the factory tarball.

**A faithful clone** (reproduces what `docdrift` actually runs, including the `system1` service and the persona):

```bash
NEW=observer-test
cp -r deploy/profile "$HOME/.dsh/profiles/$NEW"
cd "$HOME/.dsh/profiles/$NEW"
pnpm install --frozen-lockfile    # PNPM, NOT NPM. Four dependencies are `link:` URLs -- a pnpm/yarn protocol
                                  # npm REJECTS -- which is why this directory carries a pnpm lockfile.
                                  # Measured by the first agent that followed this procedure (`F128`).
# rename the profile package (cosmetic, but two profiles with one name confuse --dump-config readers)
sed -i 's/dsh-profile-docdrift/dsh-profile-'"$NEW"'/' package.json
```

Then EDIT THE NEW PATCH before booting, for the two things a second profile must not share:

```yaml
# $DSH_HOME/profiles/$NEW/cordis.patch.yml, under the system1-observer row
tracePath: /home/john/.dsh/logs/system1-observer-$NEW.jsonl   # MOUNT-BOUND: two profiles on one trace pool
                                                              # two deployments' readings in one file
```

and, to start testing rather than sit quiet, the live-writable testing set (`system1_settings`, or the card):
`sessions: ['*']`, `observeSubagents: true`, the seam switches on, and `questionSet: ''` for the probe — a selected
set disables the probe at every seam it does not name (`F123`).

**Minimal alternative** (observer only, no `system1` service): `./install.sh $NEW`, which adds the bundle and prints
the composed row; the observer then needs the HTTP wire at `wireUrl` (default `http://127.0.0.1:8766`) or every call
is an error line.

**Verify, in this order** — each step is cheap and the first failure localizes:

```bash
dsh --profile "$NEW" --dump-config | grep -c 'id: system1-observer'   # 1: the row composed
bash -lc "dsh web --profile $NEW"        # FROM A LOGIN SHELL: the provider authenticates from
                                          # OPENROUTER_API_KEY, which ~/.bash_profile defines and an
                                          # agent's `bash -c` environment does NOT carry (F129).
                                          # Boots; note its port, not 3090.
```

To make a turn happen with no UI, drive a headless profile — one whose bundles include
`@deepseek-ai/dsh-headless` — with `bash -lc 'dsh --profile <headless-profile> "say hello"'`; the turn is real, so the
seams fire into that profile's trace.

then from an agent in that profile: `system1_explain` (the live brief: knobs, state, sets, cautions),
`system1_settings { action: 'list' }`, and `system1_trace` — which prints every skip with its reason, so a quiet trace
is read through the gates rather than assumed broken.

**After any testing session, re-record**: a settings write re-serializes the profile patch, so
`npm run check:deploy` fails on a byte difference that is mostly formatting and must not be hand-merged. Copy the live
files back (`cp` each named file into `deploy/profile/`) and commit them with the change that moved them.

**Plans and ledgers do not belong here** either: they are in this repository, beside the code they describe, which is
where a reader looks for them.
