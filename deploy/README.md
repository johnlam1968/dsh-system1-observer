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

**Plans and ledgers do not belong here** either: they are in this repository, beside the code they describe, which is
where a reader looks for them.
