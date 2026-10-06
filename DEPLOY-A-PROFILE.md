# Deploy a second profile, and test the observer in it

**What this is.** The TASK, written as a prompt an agent can be handed. The *procedure* lives in one place —
`deploy/README.md`, § **Deploying a SECOND profile, step by step** — so the steps are not written twice and cannot
disagree. This file is the task, its acceptance criteria, and the traps; read that section before starting.

**Who it is for.** An agent asked to "deploy another profile and start testing the observer", or to reproduce this
stack a second time on this host. Everything below was verified by the session that wrote it, except the end-to-end
boot (see *What is not yet verified*).

## The prompt

> Deploy a second DSH profile to test the System One observer, following `deploy/README.md` § *Deploying a SECOND
> profile, step by step* in `/home/john/CodingProjects/dsh-system1-observer`.
>
> 1. Copy `deploy/profile/` to `~/.dsh/profiles/observer-test`, `pnpm install --frozen-lockfile` there (four
>    dependencies are `link:` URLs and npm rejects them — `F128`), and rename the profile package
>    (`dsh-profile-observer-test`).
> 2. In that profile's `cordis.patch.yml`, set the observer's `tracePath` to
>    `~/.dsh/logs/system1-observer-observer-test.jsonl` — **mount-bound**, so it must be edited in the file, and it
>    must not share docdrift's trace.
> 3. Boot it FROM A LOGIN SHELL — `bash -lc 'dsh web --profile observer-test'` (not port 3090). The profile's
>    provider authenticates from `OPENROUTER_API_KEY`, which lives in `~/.bash_profile`; your `bash` tool does
>    **not** carry it, so a plain `bash -c` boot measures nothing. Verify:
>    `dsh --profile observer-test --dump-config | grep 'id: system1-observer'` is present.
> 4. In that profile, call **`system1_explain` first** — it reports the live knobs, state, sets and cautions. Then
>    turn on testing with `system1_settings`: `sessions: ['*']`, `observeSubagents: true`, the seven seams on,
>    `questionSet: ""` (a selected set disables the probe at every seam it does not name).
> 5. Prove one measurement lands: trigger a turn, then `system1_trace` (every skip carries its reason) and
>    `system1_measurements`. A `call` line is NOT enough — read the answer: it must not be `unreadable`.
> 6. Report: the profile path, the port, the trace file with its line count, and the first measured reading. Do
>    **not** edit `deploy/` — it is re-recorded from the live profile afterwards, because a settings write
>    re-serializes that file.

The minimal alternative, when only the observer is wanted and the profile already exists: `./install.sh <profile>`,
then supply a decision model (the `system1` service, or the HTTP wire at `wireUrl`, default
`http://127.0.0.1:8766`) — with neither, every call is an error line in the trace by design.

## Acceptance criteria

Done means all five, each checkable without reading a log by eye:

1. `dsh --profile <new> --dump-config | grep 'id: system1-observer'` prints the row.
2. The new profile boots and serves a URL of its own (not the running profile's port).
3. `<DSH_HOME>/logs/system1-observer-<new>.jsonl` exists and grows **only while that profile runs** — the two
   profiles' readings are not pooled.
4. From an agent in that profile: `system1_explain` returns a value the harness accepts, and its `live.tracePath`
   names the new file.
5. One measured reading exists in that profile — a `call` line whose answer is **READABLE** (`unreadable` means the
   provider refused it; see the credential trap below), or a `skip` line with its reason if the seams are still off.
   A quiet trace is only acceptable if the skip says which gate stopped it. **An unreadable answer still writes a
   `call` line**, so "there are lines in the trace" is not this criterion.

   **To make a turn happen without a UI**, the profile has to be driven: a profile whose bundles include
   `@deepseek-ai/dsh-headless` answers ONE task and exits —
   `bash -lc 'dsh --profile <headless-profile> "say hello"'` (with `--json` for run events, `--session-id <id>` to
   resume). The turn is real, so the seams fire and the row writes to THAT profile's trace. That is why the first
   agent to run this task created a headless sibling beside its web profile — the sibling is the driver, not a
   duplicate. A profile carrying BOTH apps resolves per invocation, which is a good way to spend an hour on
   which-app-answered questions; prefer one app per profile.

## The traps, each one measured here

- **The model credential lives in a LOGIN SHELL (`F129`).** Two variables, two layers, and one environment: the
  observer's judge reads `OPENROUTER_API_KEY` (`dsh-system1/providers/typesafe`) and the AGENT's own model reads
  `MINIMAX_CN_API_KEY` (the `llm-pi-ai` provider), both defined in `~/.bash_profile`. An agent's `bash` does not have
  them; `bash -lc` does (measured: 73 characters vs none). The three faces of the same fault:
  | who sees it | what it says |
  |---|---|
  | a trace reader | `unreadable: the provider reported status "error"`, in about **5 ms** |
  | an agent driving a headless profile | `NO_ADAPTER: no adapter registered for provider "minimax-cn"` |
  | **a person using the web UI** | **`Provider is not configured: minimax-cn` / `PI_AI_ERROR`** (`F133`) |
- **A PROFILE ALREADY RUNNING KEEPS FAILING UNTIL IT IS RESTARTED** (`F133`). The environment is read when the
  process starts, so fixing `bash -lc` for *new* invocations does nothing for a profile that is already up: it serves
  the UI, mounts its rows, and fails every turn. Restart it from a login shell, and check with
  `tr '\0' '\n' < /proc/<pid>/environ | grep MINIMAX_CN_API_KEY` — present means the route is configured.
- **Read-only commands escalate too.** In `workspace-write`, the sandbox is applied per COMMAND, so `ls ~/.dsh/...`,
  `ps`, `curl`, `dsh --dump-config` and reading the trace file each cost the operator one approval. Two ways to cut
  it: **batch** the out-of-workspace work into a single command where you can, and **verify from inside the profile**
  with the observer's own tools (`system1_trace`, `system1_explain`, `system1_measurements`) — a tool call is not a
  file read and needs no escalation.
- **Two apps in one profile is an ambiguity, not a convenience.** MEASURED MECHANISM: the headless app installs the
  CLI's DEFAULT action (`dsh-headless/lib/startup.js:75-80`), so a profile mounting both web and headless answers a
  bare `dsh --profile <name>` with `error: a task is required, ...` and EXITS before the web app starts. The usage
  line a profile prints names whichever app it resolved to. Keep one app per profile — the first agent to run this
  task needed a sibling profile per app, and that is the right shape, not a workaround.
- **A FEW PERCENT OF CALLS COME BACK `unreadable` IN BURSTS, and that is not a configuration fault.** Measured on a
  live web turn: 6 of 64 calls, clustered in the seconds where several seams fire at once (2-5 calls/second), while the
  provider account was clean (paid tier, no cap). The observer fires every text-carrying seam of a step together, and
  the trace carries only `the provider reported status "error"` because the upstream status is discarded (`F43`), so
  these are best read as UNANSWERED rather than as evidence about the question. A per-seam accuracy figure is computed
  over the answers that arrived, which is why the scorer reports `unreadable` separately.
- **A trace file whose mtime does not move means the profile never MOUNTED.** A boot that failed on an argument (for
  example a flag placed where the CLI does not accept it) writes nothing at all, so the trace's absence is the
  cheapest proof of a failed boot — cheaper than chasing PIDs and ports.

- **The deployment writes OUTSIDE the session workspace.** Every step touches `$DSH_HOME/profiles/` and
  `$DSH_HOME/logs/`, so a session running `workspace-write` is asked to escalate — or fails closed with no answerer
  available. That is expected, not a workaround: the first agent to follow this procedure cited this file as the
  reason for its escalation (`F128`), and was allowed once per command.
- **The profile's dependencies need PNPM, not npm.** Four of them are `link:` URLs, which npm cannot resolve, and
  `pnpm-lock.yaml` is recorded here for that reason. `npm install` fails on the first of them.
- **The default `tracePath` is shared.** Two profiles on it put two deployments' readings in one file, and the mount
  lines are the only thing that would tell them apart. It is mount-bound: YAML, then a restart.
- **`settings` changes need no restart; mount-bound edits do.** Every field the card or `system1_settings` offers is
  volatile and takes effect at once *and* persists into the profile patch. `probeQuestion` and `tracePath` are not:
  edit the YAML and restart.
- **A settings write re-serializes the profile patch** (`F127`), which is why the recorded copy under `deploy/` goes
  byte-stale — re-record with `cp` and commit, and read the diff first.
- **A selected set turns the probe off at every seam it does not name** (`F123`). For probe-mode testing, `questionSet`
  must be empty.
- **A session-only set also makes the scheduled turn measurement refuse by name** (`F126`): one `questionSet` serves
  the whole row, and a set that declares no `turn` scope cannot answer the turn hook.
- **`dsh-plugin-factory` is pinned to a tarball in `~/Downloads`**, and four bundles are `link:`ed to absolute paths
  on this host. `npm run check:deploy` prints that pin on every run; a second HOST is the trigger for extracting
  `deploy/` into its own repository (`ROADMAP.md` §14.6 (e)).

## Verified end to end, 2026-10-06

The end-to-end boot was performed by a DIFFERENT agent (a different model, the `standard` preset, ~45 tools, default
effort) on this repository, and it works — with two corrections to this file that only a follower could find:

| what was proven | evidence |
|---|---|
| a second profile mounts and measures | `~/.dsh/logs/system1-observer-observer-test-headless.jsonl` held **six readable seam calls, 143-781 ms**, `assemble` twice answering `assembling_the_prompt` — the probe's expected label. THE COUNT IS HISTORICAL AND THE RIG IS DISPOSABLE: that file now holds the agent's final clean run of THREE calls (`assemble` 821 ms, `admit` 176 ms, `draft` 203 ms), because it reset the file between runs. The REPRODUCIBLE evidence is the row below and the criteria above, not this trace, which nothing retains |
| the profiles' readings do not pool | three trace files, one per profile; docdrift's untouched throughout |
| one app per profile works | the headless sibling carries `@deepseek-ai/dsh-headless` where the web profile carries `@deepseek-ai/dsh-web-app` |
| the live profile is not disturbed | `docdrift`'s bundle list and `cordis.yml` byte-identical to `deploy/profile/` after the run (`check:deploy -- ok`) |

**What that run cost, and what it fixed:** `npm install` cannot install this profile (four `link:` URLs) — use pnpm;
every step writes outside a `workspace-write` session; and a profile booted from an **agent's** environment has no
credentials at all, which shows up twice — as `unreadable: the provider reported status "error"` in 0-6 ms for the
observer, and as `NO_ADAPTER: no adapter registered for provider "..."` for the AGENT's own model. Both want
`bash -lc`, because the keys (`OPENROUTER_API_KEY`, `MINIMAX_CN_API_KEY`, ...) live in `~/.bash_profile`.

**And the WEB profile has now been exercised too** (2026-10-06, after the credential fix): a human turn in
`observer-test`'s UI is measured in `system1-observer-observer-test.jsonl` — seven seams
(`assemble`/`admit`/`draft`/`pre_execute`/`execute`/`post_execute`/`result`), all answers readable, in 149-712 ms.
Two things that turn showed, both already in the register: three `skip` lines reasoning `no text at this seam` (the
observer refusing to ask when a step carries no text — by design), and the probe's labels being RIGHT at six of the
eight seams sampled, the misses being `result` answering its `post_execute` pair-mate (`F121`'s collapse, measured
again) and one `draft` answering `admitting_a_step`. Note the cost: this profile runs `sessions ['*']` with every seam
on and `questionSet` empty, so a turn spends one judge call per seam that carries text.

**Still outside the record:** the rig itself is disposable. Nothing retains its traces, so the reproducible evidence
for everything above is the criteria, the `check:deploy` row and this file — not a trace file (`F132`).
