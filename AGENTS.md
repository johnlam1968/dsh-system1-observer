# Standing reminders

Read the doc.
Optionally, read the source code (if source code is not available, git clone it).

## What those two lines mean HERE

* **The doc** — `README.md`, `ROADMAP.md` (§5 phases, §12 the current plan), and `docs/`: `docs/findings.md`
  (every defect with its cause, consequence and status), `docs/measurement-depth.md` (the evidence groups and
  scope), `docs/adapters-and-standards.md` (the session/database design and its measured costs),
  `docs/question-suitability.md`, `docs/conventions.md`.
* **The source** — the harness checkout at `~/deepseek-harness` and the installed package at
  `~/.config/nvm/versions/node/v25.3.0/lib/node_modules/@deepseek-ai/dsh/`. Other harnesses whose session
  formats this repository reads are on this host as well: pi at `~/.pi`, minimax-code at `~/.minimax`,
  zeroclaw at `~/.zeroclaw*`, Hermes at `~/hermes-agent`.
* **How to read the source so it ANSWERS** — a capability's *interface* is not its *implementation*. List the package
  GROUP (`ls packages/<group>/`) and read that group's README: it names the backend and whether the component is
  opt-in. Then check the deployment — `dsh --profile <name> --dump-config` shows which rows are mounted and what they
  are configured to do — and treat a refusal or error message from the harness as a pointer: it usually NAMES the knob
  or the package, so grep for that string instead of guessing. This habit exists because `F97`, `F96`, `F95`, `F89`
  and `F79` are one error in five shapes: stopping at the part of the system that happened to be in front of me.
* **Why** — a measurement says what happened; a type says what can. Three findings in `docs/findings.md`
  (`F79`, `F89`, `F95`) are the same mistake in the same direction: a claim about a system generalised from one
  sample of it, where reading the producer's own source would have answered it outright.

## Where these lines live, and why BOTH

* **Every request** — the two lines are in the `cordis` preset's persona `prefix`, so they are re-sent with every
  request. That row is overridden in `~/.dsh/profiles/docdrift/cordis.patch.yml`, which restates the shipped
  `plugins` list with the two lines added: a Cordis patch replaces `config` **wholesale and never deep-merges**, so
  the list is a snapshot. **After any `dsh` upgrade, diff it against**
  `@deepseek-ai/dsh-web-app/presets/cordis.patch.yml`.
* **Once per session** — this file carries what the two lines *mean* here (which doc, which source), which is the
  right shape for a baseline: identical for every session of this repository, at the cost of one injection rather
  than one per request.
* **Never in this plugin** — the observer must not alter the session it measures; a reminder injected by the
  measuring row would change the thing being measured, and `lib/config-event.js` exists to record exactly that kind
  of boundary (readings either side of a prompt change are not comparable).
