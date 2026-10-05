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
* **Why** — a measurement says what happened; a type says what can. Three findings in `docs/findings.md`
  (`F79`, `F89`, `F95`) are the same mistake in the same direction: a claim about a system generalised from one
  sample of it, where reading the producer's own source would have answered it outright.

## Why this file, and not the preset

These lines are workspace INSTRUCTIONS, so `AGENTS.md` is their home: `dsh-agent-instructions` loads the
applicable chain at the session's first request and reconciles the baseline on resume. The stricter alternative
is `dsh-persona`'s `prefix` inside the `cordis` preset, which renders on EVERY request — the route to take if a
reminder must survive compaction or a long session's distance from its first message.

**Do not put them in this plugin.** The observer must not alter the session it measures; a reminder injected by
the measuring row would change the thing being measured. A separate row (`persona`, or a small plugin on the
`system-prompt/assemble` waterfall) keeps the two jobs apart.
