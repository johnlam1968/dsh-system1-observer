# dsh-system1-observer

A Host-only Cordis bundle for the DeepSeek Harness that attaches at points of the agent loop, calls a
**System One** decision model at each configured one, and writes every call — request *and* response — to a
JSONL trace.

**It decides nothing.** No ladder level, no withheld reply, no injected context, no changed value. Every
waterfall listener returns the decision it was handed, the same reference; the `draft` listener relays the
stream unchanged; the `result` emit listener swallows its own rejection. Its product is evidence about the
decision model's replies at each point of the loop.

## Roadmap

The direction — question sets as versioned artifacts, criteria as data, an evaluate → rewrite → re-evaluate
loop — is in [ROADMAP.md](ROADMAP.md), together with what already exists in the ecosystem so we do not rebuild it.

## Licence

MIT — see [LICENSE](LICENSE).

## Status

**There is no CHANGELOG, deliberately.** The change history is this repository's **round log**
([`docs/conventions.md`](docs/conventions.md) §"Round log") plus `git log`, which carry the same facts with the
measurement attached to each; a CHANGELOG would be a second, hand-maintained copy that drifts from both. Register row
**P4** asked for either that line or a CHANGELOG, and this is the line.

**Every trace line says `enforcement: "declarative"` and `verified: false`, and that is the literal truth.**
There is no sandbox and no runtime gate. "It decides nothing" is enforced by the *shape* of the code — the
return values are read by the record and by nothing else — and nobody has observed that holding. Flipping
`verified` to `true` means deleting an assertion in `test/honesty.test.js` deliberately. The plugin's surface is
also declared (`lib/honesty.js`): six named capabilities and five forbidden ones, with a source scan that fails
the moment someone reaches for an approval request, a tool guard, a resident prompt section, a context prune or
a model route.

### Verified, with the check that shows it

| claim | evidence |
|---|---|
| the probe separates the seams it is asked about | **88.99%** over 3,370 scored calls, against a **39.94%** majority-class floor, **κ 0.8374** — computed by `lib/probe-score.js`, reproducing the study's hand-computed figures exactly. **The figure is a function of the SEAM MIX, and a tool-heavy window measures its weakest pairs**: a live window of 62 probe calls over two agent runs scored **59.7%** (κ 0.525), with `assemble`/`pre_execute` at 1.000 and `execute`/`result` at 0.273/0.083 — the two tool-seam PAIRS are shown the same text (`name + arguments` for both call seams, one result envelope for both result seams) and asked four labels, so one member of each pair scores ~1 and the other ~0 by construction (`F121`) |
| the confidence is worth something, and it errs the unusual way | top-1 **ECE 0.1253**, **bias −0.1242 (under-confident)**, Brier 0.0915; classwise ECE 0.0284; multi-class logLoss 0.4947 · `lib/calibrate.js` |
| the trace's cost is knowable | **$0.256974** for 4,368 judged calls, `post_execute` alone **59.8%** of it, from `lib/cost.js` |
| truncation changes what is measured | full excerpts **90.16%** (n=3,212) versus truncated **65.19%** (n=158) — a 25-point gap a single blended figure hides |
| the record is redacted and the model's input is not | `test/observe.test.js`: the request handed to `decide` contains the secret, the recorded line does not |
| the trace is bounded and private | rotation with an auditable `rotate` line, mode 0600, both tested |
| what leaves the process is declared | the `egress` block on every mount line, rendered by both readers |
| a clone can resolve what its comments cite | `npm run check:citations` |
| the questions this sends are the shape the vendor's API accepts | `test/vendor-conformance.test.js`, `deepEqual` against `@typesafe-ai/sdk`'s own builders — which is what found a `score` being sent as a keyed map upstream, a defect its stubbed unit tests had passed over |

```
npm test               # the suite; the run prints the count, so this line cannot go stale
npm run coverage       # the floor: 90% lines, 75% branches, 75% functions over lib/
npm run check:citations
npm run check:compat
npm run check:composition
npm run check:deploy   # deploy/profile vs the live profile: bytes, and the bundle list by name AND order
npm run ci             # all six, in that order
```

**A machine runs them now.** `.github/workflows/ci.yml` exercises the two supported Node lines from `engines`
(22.19.0 and 24.x) for the suite, the citation check and the compatibility line, and a single line for the
coverage floor — because the `--experimental-test-coverage` flag's instrumentation differs between majors, so a
floor measured on one is not a floor on another.

The floor sits **below the baseline measured when it was set** (90.90 lines / 83.81 branches / 90.23 functions —
the suite has grown since and now measures **92.80 / 85.79 / 91.29**; re-run `npm run coverage` for the current
figures), deliberately: a
gate set at the current number fails on the next honest refactor and gets raised until it means nothing.

### The one measurement that changes how you should use this

**The model is under-confident by 12 to 15 points.** Every reliability bin from 0.3 upward shows *observed >
predicted* — the 0.6–0.7 bin is 83.8% right while claiming 64.3%, the 0.8–0.9 bin is 98.0% right while claiming
85.4%. The natural instinct to trust the high-confidence calls and discard the rest is **measurably wrong here**:
accuracy at `p ≥ 0.5` is *lower* than accuracy overall. Do not gate on `answerConfidence` without reading the bin
table on the mount line, and note that ECE alone cannot tell you this — it is sign-blind, which is why the bins
are printed beside it.

### The provenance, and a guard this deployment does not have

The report and the card name **the revision that graded**, not the alias that was asked for. Measured here:
`graded by: typesafe/jev-1.13-20260917 · requested as jev-latest` over 4,368 calls. System One guidance is
explicit that *"a threshold measured on one server does not transfer to another"*, so the revision is the fact
worth pinning — and `jev-latest` is a moving target that would hide a change.

**And one guard is missing, which the record now states rather than leaves to assumption.** The single field that
says which checkpoint read the text is `routing.detection.is_english`; language picks the checkpoint, and the same
question has been measured at **0.8912 in English and 0.0162 in Chinese**, where three of four non-English hazards
would have been auto-cleared on score alone. The guidance's rule is *"when `is_english` is false, never
auto-clear."* **This deployment's server returned `routing` in 0 of 4,369 calls**, so that rule cannot be applied
here, and a judgement made on a non-English seam is indistinguishable from an English one in this trace. The
report says so under `graded by`, in those words, whenever it finds no routing.

This is a limit of the deployment rather than of the plugin, and it is the kind of thing a reader will otherwise
get wrong: the absence of a warning is not evidence that there was nothing to warn about.

### Not verified

- **The probe question was authored by intuition.** Its accuracy is a figure about *this* question, not a claim
  that the model can classify agent-loop text in general. It has no holdout and no pass criterion; the
  instrument's hash is on the mount line precisely so an edited question is a new measurement rather than a
  comparison.
- **The figures above come from one deployment's trace** — one profile, one subject model, one seam mix. They
  are not a benchmark, and the seam mix is skewed by construction, which is why the majority-class floor and κ
  are printed beside every accuracy.
- **Redaction is best-effort.** It removes fields whose key names a secret and known credential shapes. It
  cannot recognise an unlabelled secret in free text: an AWS secret access key body, a GitLab `glpat-`, a bare
  40-hex token, a private-key body without its markers, a secret in the key position, or *"the password is
  hunter2"*. **Treat the trace file as sensitive.**
- **Nothing here remediates the past.** Thousands of call lines were written before redaction, rotation and the
  0600 mode existed, and they keep whatever they recorded. Rotating a file does not redact it.
- **The independent read of these port specs was not done by the model it was meant to use.**
  `minimax-cn` is declared in the profile with no models and no catalogue, so `minimax-M3` cannot run at all; the
  review was done by a smaller model on a different provider and treated as a cross-check, not a source.

## Who does what, and what only YAML can change

**The agent is the primary user of this plugin, and almost everything is volatile.** Every capability is a tool, and
**42 of the 44 settings are writable live** by an agent through `system1_settings` — the same fields the settings card
offers a human, through the same path: the write goes to the harness's `configEditor`, lands in this profile's
`cordis.patch.yml`, and is recorded on the trace BEFORE it takes effect. So a value in that file is the *initial* value
only until the first write; after that it is the latest one, and it survives a restart.

**The two exceptions are mount-bound**: `probeQuestion` (its text *is* the instrument identity — `probeFingerprint`
hashes it onto every MOUNT line and into the comparability key, so a reword needs a YAML edit and a re-mount, after
which the runs are honestly incomparable) and `tracePath` (the sink is opened once, and the path is on the mount line).
Both can be read live (`system1_settings { action: 'get' }`) and neither can be written live.

**Who does what:**

| | |
|---|---|
| **the agent** | generates, validates and applies question sets (`system1_question_sets`); measures a session, a turn or a whole conversation (`system1_evaluate_session`, `system1_battery`, `system1_decide`); reads the record (`system1_trace`, `system1_measurements`); finds and reads sessions (`system1_sessions`); changes any live setting; and asks `system1_explain` for this brief, derived from the running row |
| **the human** | the settings card (all 42 live fields), and **"…" → Observe this session** on a session row — convenience, not a separate mechanism: it writes the same allow-list an agent writes |
| **the profile's YAML** | the two mount-bound fields, the bundle list, and the layer order |

**What the subjects actually are**, measured on this host: **318 of 499 stored sessions are subagent (worker) runs**,
not human conversations — which is why the session list can be filtered (`subagents: 'exclude' | 'only'`) and why
`observeSubagents` is off by default.

**And the observer decides nothing.** Each listener returns the loop's own decision *by reference*, every line says
`enforcement: "declarative", verified: false`, and a seam that was not measured writes a `skip` naming the gate that
stopped it. The artifacts are the trace (`~/.dsh/logs/system1-observer.jsonl`) and optional packages under
`data/measurements/`.

**This section is the stable half.** The *current* facts — which knobs exist, what each is, what the row is set to
right now, which sets are visible, and the five cautions that decide whether a reading can be trusted — are what
`system1_explain` returns, derived from the schema and the running config so they cannot drift from the code. An agent
that reads no documentation meets it as the first tool in the list.

## What it depends on

`@deepseek-ai/schemastery` and `yaml` — nothing else. **`@typesafe-ai/sdk` is a dev dependency**, used by
`test/vendor-conformance.test.js` to compare this repository's question builders against the vendor's own runtime
builders with `deepEqual`; it is never imported by a runtime path and never shipped. When it is absent the
conformance tests **skip loudly** — printing why and what to run — rather than failing, so `npm test` keeps
passing with runtime dependencies only. The decision runtime is **source in this repository**,
under `lib/`:

| path | what it owns |
|---|---|
| `lib/seams.js` | the instrument's own vocabulary: the nine point ids, what is true of each, the switch rule, the exit-code reader and the probe question. It names **no** harness event and reads **no** config |
| `lib/host-events.js` | which dsh event each point attaches to, and the point as the input object carries it |
| `lib/host-payload.js` | which ARGUMENT of a harness seam carries the text, per seam — the two files above are the application's half of the point descriptor (`F110`, `F111`) |
| `lib/instrument-input.js` | the ONE bridge from the row's settings to the instrument's input object, and the only place a `Volatile` is unwrapped for it |
| `lib/evidence.js` | the evidence record — one JSON object per line, best-effort |
| `lib/model/` | the two decision-model transports and the answer readers behind them |
| `lib/is-record.js` | the property-check narrowing those modules share |

This bundle supplies the row, the config and the listener wiring. A plain `npm install` fetches only public
packages: no git credentials and no sibling checkout. There is deliberately no interface version to compare —
the runtime and its caller ship in the same commit, so a renamed or removed export is refused by ESM
resolution before `apply` runs, and the argument shapes are held by the tests that execute `apply`.

## Hooks

The nine seams are `PROBE_SEAMS` from `lib/seams.js`, in loop order:

| seam | host event | text at the seam |
|---|---|---|
| `assemble` | `system-prompt/assemble` | sections + contexts |
| `admit` | `agent/pre-step` | the operator's `UserMessage[]` |
| `request` | `agent/request` | **none** |
| `draft` | `llm/stream` | the stream |
| `pre_execute` | `tools/pre-execute` | tool name + arguments |
| `execute` | `tools/execute` | tool name + arguments |
| `post_execute` | `tools/post-execute` | the normalized result |
| `result` | `tools/result` | the frozen result |
| `close` | `agent/turn-stopping` | **none** |

The default is `[admit, draft, pre_execute, post_execute]` — the operator's message, the reply, one tool-call
seam and one tool-result seam. `hooks` is validated **at mount**: an unknown name refuses the mount and names
the seam, because a seam nothing listens at looks exactly like a seam that never fires.

**Two of the nine seams are not applicable.** `request` (`agent/request`) is routing parameters — provider,
model, temperature — and `close` (`agent/turn-stopping`) is `{agent, turn, signal}`. Neither carries any text,
so at neither is there a question to ask or a judgement to test: they produce a `skip` line and never reach
the model, and a text-classification answer produced from no text is not a measurement. Leave them out of
`hooks`. The settings card states this in prose and badges both seams `not applicable — no text`.

The other **seven are all applicable and can be enabled together** — the profile this was developed against
runs `[assemble, admit, draft, pre_execute, execute, post_execute, result]`. That is not free: seven seams
means a decision-model call at each of those points of every turn, and the waterfall seams are **awaited**,
so a slow or unreachable model is felt by the turn itself (`timeoutMs` bounds each one, and every failure
ends as a line in the trace rather than a failed turn). Enable the seams you intend to read.

Enabling a seam is a `hooks` change, which is **mount-bound** rather than live: the listener set is chosen in
`apply`. The harness's config watcher reconciles a profile-patch edit and re-composes the row, so a fresh
`mount` line with the new list appears in the trace; if it does not, restart the host.

## Config

| key | default | applies |
|---|---|---|
| `hooks` | the four above | at mount |
| `provider` | the service default | at mount |
| `model` | the service default | at mount |
| `timeoutMs` | `8000` | at mount |
| `wireUrl` | `http://127.0.0.1:8766` | at mount |
| `question` | the runtime probe question | at mount |
| `tracePath` | `SYSTEM1_OBSERVER_TRACE`, else `<DSH_HOME>/logs/system1-observer.jsonl` | at mount |
| `questions` | unset — every seam asks the probe question | live |
| `callsEnabled` | `true` — absent means on | live |
| `seamEnabled` | every seam `true` — absent means on | live |
| `sessions` | `['*']` — the wildcard observes every session | live |
| `includeNonOperatorFacing` | `false` | live |
| `observeSubagents` | `false` | live |
| `maxFieldChars` | `20000` | live |

**"Live" means these seven must be read through their accessor, and this is easy to get wrong.** A field
marked `.volatile()` does not arrive as its value: cordis passes a `Volatile<T>` reference and the value
comes from `.get()`. Read one as a plain value and you get the object — `=== true` is false,
`typeof x === 'string'` is false — so the plugin runs on its defaults while the settings card, the save
and the trace all look correct. A saved setting then reaches a **running** row with no restart, because
the harness deliberately does not re-apply the plugin; that is also why a value captured once in `apply`
never moves. Every read goes through `readConfigValue` (`lib/config-value.js`), which returns the value
for an accessor and passes an ordinary field through untouched.

`includeNonOperatorFacing` off keeps the `draft` seam to what an operator would read: the Harness's own
**purpose-tagged** streaming calls (session titles, compaction) are relayed without a model call. It does not
touch subagents: a subagent's stream either carries a purpose tag or does not, and this flag reads only the tag.

`observeSubagents` off — the default — records a subagent session's streams and tool calls as `skip` lines with
reason `subagent session`, and their text never reaches the model or the trace. On, a subagent is observed like
any other agent. A suppressed `draft` is still relayed chunk for chunk, untouched; a suppressed waterfall seam
still returns the decision it was handed, the same reference. The discriminator is the session header:
`agent.session.header.origin === 'subagent'`.

`maxFieldChars` caps each recorded state and marks the line `truncated: true` when anything was cut.

### Turning the calls off

**Three independent controls can each stop every call, and all three look identical from the outside: no
calls.** The settings card prints one line saying which one is actually stopping things — naming the *first*
gate in the order below, because that is the one worth acting on:

| # | control | off means | the skip reason |
|---|---|---|---|
| 1 | `callsEnabled` | a global pause; **outranks the other two** | `calls disabled` |
| 2 | `sessions` | nothing is observed (`[]`), or only what is listed | `session not observed` |
| 3 | `seamEnabled` | that seam is not called | `calls disabled at this seam` |

They are deliberately **not** coupled. A pause must not be undone by adding a session — that would silently
resume calls an operator stopped — and the session list must stay editable while paused, so a deployment can
be set up before it is switched on. Coupling them would also make "off" ambiguous: paused, or unscoped?

Two levels, both live, both with **absent meaning on**.

`callsEnabled` is the master, and it is off only for an explicit `false`
(`readConfigValue(config.callsEnabled) === false`). Off, every observed seam records a `skip` with reason
`calls disabled` and **no request is made** — the listeners stay registered, the questions and the hooks are
untouched, and turning it back on resumes where it left off. There is deliberately no `.default(true)`,
because a volatile field does not arrive as its value and the schema default is not what `.get()` answers for
a field nobody has set.

`seamEnabled` is the per-seam switch, keyed by seam name and read through `seamCallsEnabled`
(`lib/seams.js`), which is `!== false` for the same reason: a config written before the field existed has no
`seamEnabled` at all, and a switch that read `=== true` would turn the observer off everywhere on upgrade —
silently, and only for the installs that did not ask for it. Off at a seam, that seam records a `skip` with
reason `calls disabled at this seam`, and its questions are kept for when it comes back. The master wins:
while `callsEnabled` is false, every seam says `calls disabled`, because "everything is paused" and "this one
seam is off" are different facts about a run.

The settings card shows the master as the first control and the seven applicable seams as one row of
switches, ticked, because that is what an unset field means. Both take effect on the next seam firing with no
restart.

Which seams exist for this purpose is the same list as `questions`, and for the same reason: the host projects
a form onto the schema and **drops a key it does not declare**, so a seam missing from `seamEnabled` is a seam
whose switch vanishes on the next save. `test/schema.test.js` holds the schema and `PROBE_SEAMS` equal.

Where the trace is written: `SYSTEM1_OBSERVER_TRACE` overrides everything; otherwise `tracePath` if set;
otherwise `<DSH_HOME>/logs/system1-observer.jsonl`, so a trace is discoverable beside the harness's own logs.
With no `DSH_HOME` the harness's **own default home** (`~/.dsh`, the directory the profiles live under) stands
in for it; a bare run with no home at all falls back to the OS temporary directory.

**Paths are kept by default, and that is a deliberate difference from the exporter this was ported from.** That
one defaults to *omit* because its records leave the machine; this trace is local evidence whose purpose is that a
wrong judgement is diagnosable, and **2,455 of its 4,369 call lines carry an absolute path** — which is often the
diagnosis. `pathMode: basename | omit` reduces them in the **record** and never in what the model is asked, so a
deployment that shares the file can export less rather than scrub more.

**The package's own directory is never used**, which it once was. For a published plugin that path is inside
`node_modules` — read-only on a global install, replaced by the next `npm install` otherwise — and a write that
fails there is swallowed by the best-effort evidence sink, so the failure mode was a plugin that silently
produced no trace at all.

`question` replaces the runtime's probe question with a `noul` built from the text; left empty, the probe
question is used, and its answer is checkable because the seam is known. It is a **mount-time default for
every seam**, and the per-seam map below takes precedence the moment it carries anything.

### Targeting one session

The row is one host row shared by every conversation in the profile, so `sessions` is how it is pointed at
one of them. A firing in a session that is not observed records a `skip` with reason `session not observed`,
and **its text never reaches the model or the trace**.

Three states, and the wildcard exists because the first two cannot both be spelled by an empty list:

| value | meaning |
|---|---|
| unset | `['*']` **by the schema default** — every session, like an absent `callsEnabled` |
| `['*']` | the same thing, written down and visible in the card, and removable |
| `[]` | **observe nothing** — the one state that has to be explicit |
| `[{id, title}, …]` | only those sessions |

`Schema.array` materialises to `[]` for a field nobody has written, so without a default "never configured"
and "configured to observe nothing" would be the same value and one of them would have to be wrong. The
wildcard is what makes both available, and it is why this gate no longer disagrees with every other one in the
row about what an absent field means.

Entries match by **prefix**, so a full id and a short prefix both work. The three ways to write one:

- the **"⋯" menu on a session** in the sidebar, registered on the `sidebar.workspaces.session.menu.item` seat
  beside the shipped pin/rename/fork/archive rows. It writes the same one `set` op the card does, and it is
  **the only way to add a session** — a session id is 36 characters of uuid, and a control that asks a person
  to go and find one is a control that will not be used. It has three labels, one per state:

  | the session is… | label | the write |
  |---|---|---|
  | covered by the wildcard | *Observe only this session* | `[{id, title}]` — narrows, dropping `*` and the rest |
  | named by a specific entry | *Stop observing this session* | every entry the session matches is dropped |
  | neither | *Observe this session* | appended, with the headline the seat was handed |

  *Stop* cannot apply under the wildcard — "every session **except** this one" is not expressible in a list of
  inclusions — so the honest action there is to narrow;
- the **session list** on the plugin's card — the way to SEE what is observed and to prune it, with the
  wildcard rendered as a row called *every session* rather than as an asterisk;
- an agent, via **`system1_trace`**, which prints both `sessions seen here` and `sessions live now`.

**An entry carries the session's headline, and the headline is never matched on.** A bare uuid is not
something a person reads, so an entry may be either shape:

```yaml
    sessions:
      - session-01234567-89ab-4cde-8f01-23456789abcd                      # an id alone, still accepted
      - id: session-fedcba98-7654-4321-0fed-cba987654321
        title: Question flow to decision model                            # display only
```

**The title is a CACHE.** If matching ever consulted it, renaming a session would silently stop it being
observed — and this decides whether text reaches a model. The session menu is the only place a headline can
be captured, because the card has no way to look a session up: the client exposes no session list (the
sidebar's own list comes from slot-injected hooks a config card cannot reach, and `ctx.sessions` offers only
`retain`/`search`/`fork`/`scope`). An entry added before headlines existed shows the id and says
`no headline recorded`; toggling it off and on in the session menu captures the title. The schema is
`Schema.array(Schema.any())` for this reason — `Schema.string()` would **refuse** the object at resolution and
the row would fail to load the moment the menu wrote one.

**Which sessions to target** is discoverable rather than guessed: the ⋯ menu is where a session already is,
and for anything else `system1_trace` prints `sessions seen here` and `sessions live now`.

Precedence, and each step has its own reason on the line: the master `callsEnabled` first (a paused row is
paused everywhere), then the session gate, then `seamEnabled`, then whether the seam carries any text, then
whether a question is configured. An unknown agent — `draft` reads `ctx.agents.currentInitiator()`, which
answers `undefined` outside an initiator boundary — is **not** observed once a filter exists, because
observing an unattributable firing would defeat the point of pointing the row anywhere.

### Questions per seam

`questions` maps a seam name to the questions asked **at that seam**, and the settings card on the Plugins
page is the editor — one collapsible section per seam, with the seam's host event beside it. A spec is:

```yaml
questions:
  admit:
    - id: opening                                   # the key the answer is recorded under
      type: noul                                    # noul | choice | score
      instructions: Is this the operator's own message opening a step?
      criteria: { true: "the operator's message", false: 'anything else' }   # optional
  draft:
    - id: purpose
      type: choice
      instructions: Which part of an agent loop produced this text?
      options:
        - { label: model_output, criterion: 'text the model is producing' }
        - { label: unclear, criterion: 'none of these fits', abstain: true }
  close:
    - id: done
      type: score
      instructions: How complete is this turn?
      levels: ['barely started', 'partly done', 'complete']
```

**Two modes, and the content decides which.** With no spec anywhere, every observed seam asks the probe
question and nothing about an existing install changes. The moment **one** seam carries a spec, the row is
in per-seam mode: only seams with a question are asked, and a seam with none records a `skip` with reason
`no question configured for this seam` instead of asking something nobody configured. Deleting the last
question returns the row to the probe question everywhere — the card says which mode is in force.

The rules a spec must satisfy are the runtime's own (`lib/model/questions.js`): a non-empty instruction,
at least two options with distinct non-empty labels and criteria, **exactly one abstain option** on a
choice, at least two levels on a score. The card enforces them before a save and the host re-checks every
spec at call time; a spec that fails at call time becomes a `skip` naming the reason (`no usable question:
admit[0]: a choice needs at least two options`) and never throws into the loop. One invalid spec does not
spoil the others at that seam — the valid ones are still asked, and the `call` line carries a `problems`
array saying which were dropped.

**Which seams are observed is still `hooks`,** read once at mount; the editor cannot change it and cannot
read it (a `.volatile()` form exposes only volatile fields), so a seam may be configured and still never
fire. `request` and `close` carry no text at all and can never be asked. The card states both.

### What to ask, and which type

The card carries this guidance next to the controls that need it — a per-seam line saying what text that
seam actually has, and a per-type line saying what the selected type is for. The rules, and why each one
cost something to learn:

- **Prefer `choice` to `noul`.** On some decision servers a `noul` is *polarity-blind*: it returns a
  text-agreement score and reports it as whatever you asked, high for a claim and for its opposite. Swapping
  the criteria and flipping the instruction leave the number where it started, so the judgement can be
  confidently, stably inverted with nothing in the reply to say so. `choice` respects the option text.
- **Give every `choice` exactly one abstain option.** This is the most evidence-backed rule here: removing
  the no-match option took one benchmark from 0.950 to 0.000 accuracy, and another study flagged 0 of 30
  out-of-scope inputs without it. The builder requires exactly one.
- **One narrow judgement per question.** The model answers the question you wrote, not the one you meant.
- **Ask what the text says literally.** Counting, arithmetic and dates belong in code — the model is not a
  calculator. A question whose answer has to be inferred does not separate.
- **Validate before you trust.** Two or three cases whose right answer you already know. A working question
  and a confidently wrong one look identical until you run them, and no threshold repairs an inversion.
- **Ask once.** A question and its logical opposite do not sum to 1, so never add the complement as a
  cross-check.
- **Keep the subject small.** `maxFieldChars` caps what is sent: the section, not the document.

A question whose answer can be read off the seam is worth more than one that needs labels, because the
trace then yields an accuracy figure rather than an opinion. That is what the built-in probe question is
for — its answer is known, since the seam is known — and it is why an unconfigured row still asks it at
every observed seam.

## The trace

One JSON object per line, plus a `run` id on every line so several runs in one file can still be told apart.

**Two models appear in this file and they are not the same thing.** `provider`/`model` at the top level are the
observer's own config — the *judge* — and `requested`/`executed` are that judge's provenance, down to the
revision the server actually served. `subject` is the *other* one: the model whose text was judged. Every line
carries it when the seam knows it, because the same question scores differently on different models' output, so
an accuracy figure — or a threshold — without the subject model is not comparable across sessions. It is
recorded from two sources, which are different claims:

| seam | source | what it is |
|---|---|---|
| `draft` | the `GenerateOptions` handed to `llm/stream` | the request as actually sent: `provider`, `model`, `reasoningEffort`, `temperature` |
| every other | `Agent.options` | the route the session is configured for: `provider`, `model`, `reasoningEffort`, `maxTokens` — not proof of what produced that specific event, because a tool call carries no LLM request |

The field is **absent, never null**, when nothing could be read — a trace that names the wrong model is worse
than one that names none. `system1_trace` prints `sessions live now` with each live session's model, which is
also the quickest way to see whether `Agent.options` is populated in your harness build.

- `mount` — the hooks, the transport actually chosen, the provider, the model, the trace path and the
  question ids the config asked for at mount time;
- `call` — the seam, the host event, the agent, the excerpt, the questions as sent and the whole answer,
  plus `problems` when a configured spec had to be dropped;
- `skip` — a seam that carried no text, a seam with no configured question, a spec that could not be used
  (`problems` names each reason), or a subagent session that was deliberately not observed;
- `error` — a `decide` that threw.

Recording is best-effort throughout: a throwing trace cannot fail a turn, and neither can a model outage, a
timeout or a malformed body.

## Depth of measurement, and what G0–G4 mean

`docs/measurement-depth.md` is the lookup file for the shorthand this repository uses about WHICH EVIDENCE a
measurement is given. **They are groups, not levels** — disjoint categories the question selects from:

* **G0 — the exchange**: what the human asked and what came back.
* **G1 — the working record**: the narration, the tool calls, the tool results.
* **G2 — the harness's own acts**: injections, tool-list changes, stop reasons, conditions.
* **G3 — the pacing**: stream timing and token usage.
* **G4 — the measurer's own record**: `stateChars`, truncation, segments, refusals.

It states what each level can and cannot answer, what each **costs** in a real session, and the rule the pricing
forces: **a whole shallow layer measures that layer, while a cut of a deep layer measures nothing in particular.**

## The skill: measuring a session

`skills/measure-a-session/SKILL.md` is the plugin's own workflow, for an agent asked to report on a session -- "I want
a report on XYZ session". It is three calls, and the middle one does everything mechanical:

```
system1_sessions { action: 'list', search: 'XYZ' }
system1_evaluate_session { sessionId, segmentChars: 57600, package: true }   # read, segment, judge, package
system1_measurements { action: 'interpret', package: '<dir>', text: '...', by: '...' }
```

The third call is the agent's, because prose cannot be derived from numbers -- and the package keeps the two apart:
`report.md`, `readings.json` and `trace.jsonl` are REPRODUCIBLE from the trace slice the package carries, while
`interpretation.md` is merely WRITTEN, attributed and anchored to the sha256 of the readings it discusses.

The report FORMAT is not a convention in the skill: `system1_measurements { action: 'skeleton', tables: [...] }`
emits it with every number already read from `readings.json` and the reading column blank, so a report cannot mistype a
median. The agent fills the reading column and attaches it with `interpret`.

**SHIPPING IT IS NOT MOUNTING IT.** A skill is discovered from a skills ROOT, and the only thing in this harness that
mounts a bundled root is `dsh-skill-filesystem`'s `bundledSkillDir` (or `$DSH_BUNDLED_SKILL_DIR`) -- which this
plugin cannot set from inside itself. So a profile that wants the skill adds one line to its composition:

```yaml
- id: skill-filesystem
  config:
    bundledSkillDir: /path/to/dsh-system1-observer/skills
```

Note that the `docdrift` profile DISABLES `skill-filesystem` on purpose (its own comment explains: the catalogue
arrives as a user message costing about 350 tokens of instruction on a small model). On such a profile the skill is
still perfectly usable by reading the file, and nothing about this plugin's tools depends on it being discovered.

## Mounting

`cordis.patch.yml` inserts one host row, `system1-observer`, with `provider: typesafe`, `model: jev-latest`
and the default hook set. When the profile mounts a `system1` service the observer calls through it; otherwise
it falls back to the wire at `wireUrl`. Installing the bundle into a profile is a separate step.

## Installing it

```bash
git clone https://github.com/johnlam1968/dsh-system1-observer.git
cd dsh-system1-observer
./install.sh              # or: ./install.sh <profile>   ·   ./install.sh web --check-only
```

`install.sh` checks the prerequisites, runs `npm install` against the public registry, **imports the local
runtime to prove it loads** rather than trusting npm's exit code, adds the bundle, and prints the composed
row and the surviving bundle list. It is idempotent.

The equivalent by hand:

```bash
npm install
dsh plugin --profile web add "$PWD"
```

`dsh plugin add` MERGES into the profile's bundle list rather than rewriting it. Read from the installed
`reconcile()` (DSH 0.1.7-rc.2): the existing `dsh.profile.bundles` is carried forward, and a name is dropped only
when it is a dependency of this install that no longer declares `dsh.bundle`; new bundles are appended and their
patch files loaded. A package that declares no `dsh.bundle` is installed as a plain dependency, with a warning,
and never becomes a profile layer. A newly added bundle needs no restart; a bundle whose package was
*replaced* does.


## Reading the trace

Two readers, and the split is who is reading.

### From an agent: the `system1_trace` tool

The row registers a **tool**, so an agent asked to tune the questions can see what they did without being
told a path it has no reason to know. It is read-only, and its description is the hint: the tool appears in
the agent's tool list the moment the row mounts.

| argument | |
|---|---|
| `run` | omit for the current run, `all` for every run in the window, or a run id / prefix |
| `hook` | restrict to one seam |
| `tail` | how many recent events to list, 1–200 (default 30). The counts always cover the whole run |
| `full` | also print the question as sent, with its options or levels, and the answer distribution |

It reports the counts by seam and by skip reason, the latency range, which model actually graded the calls,
**the session ids the trace has seen and the sessions live right now** — and then the events themselves,
one line each, with the answer a person reads (`reply_kind=an_answer p=0.92`).

Two bounds, because a tool result is context: the listing is capped, and the file is read as a **window** of
its last 8 MB — stated in the output when it applies, since a bounded read that did not say so would look
exactly like a complete one. `scripts/trace.mjs` stays the reader for a terminal: colour, alignment, and skip
collapse.

### In the conversation: the trace card

The `system1_trace` tool call renders as a **card**, not a generic row — registered on
`tool.call.toolview` under the tool's own wire name, which the seat's catalog allows explicitly ("Any name is
allowed, including tools registered by your package").

It draws the run id, the scope recorded at mount (`calls on/off`, which seams are off, which sessions are
observed), the counts, the calls by seam, the skips by reason, **both models** — `subject model` is who wrote
the text and `graded by` is who judged it — the latency spread, the sessions live now, and then the rows.

**Each answer is a set of proportion bars, not a string of numbers**, capped at four options with the remainder
counted. A distribution's shape is what a person is judging, and `p=0.4` has to be read while a filled track is
seen. Each bar is a `progressbar` carrying its own value, so the same information survives without sight of it.
The bars use the theme's tokens — the sibling plugin on this same seat hard-codes hex, and its own comment says
why ("the host's design tokens are an internal contract that may move between releases"), but this card already
uses tokens everywhere else, and a hard-coded fill would be the one element that ignores the theme.

**And it draws the measurement**, which it previously did not: the probe's accuracy *beside its majority-class
floor* (two bars, because a bare 88.99% invites comparison with "1 in 9" and the honest comparison is the floor),
the per-tier split, and the reliability bins where **the bar is what the model said and the number is what
actually happened**. Every bar whose number is larger is a model claiming less than it delivered — which is how
you see under-confidence rather than being told about it.

The data reaches the browser through the tool contract's `output.presentationMeta`, which is *"persisted
verbatim on `tool/result` for Host presenters and Client renderers to narrow independently"* — the same channel
the shipped `read` tool uses to get line numbers to the UI without putting them in the model's context. The
card reads `block.meta`; **when a host predates that projection it falls back to rendering the model-facing
text**, so an older harness shows a plain card rather than an empty one.

#### Comparing runs, and when you are not allowed to

`system1_trace` with `run: 'all'` puts the newest five runs side by side — calls, errors, skips, seam mix — and
**prints a comparability verdict first, because two lanes of numbers look comparable and only the verdict says
whether they are.** The vocabulary is four values, ported from a reference that compares sessions by their first
user message (`dsh-maze`), with its stated principle kept: *"a missing first user message is not 'different
tasks', it is 'cannot tell' — the two reasons are kept apart."*

| verdict | meaning |
|---|---|
| `single` | fewer than two runs selected: nothing to compare |
| `no-task-key` | at least one run's record is **incomplete** — no mount line, or a part of the key unrecorded |
| `same` | same questions, same hooks, same seam switches, same instrument: directly comparable |
| `diff` | they differ, and `differIn` names which part |

The key is the mount line's own record: the question ids, the hooks, the **seam switches**, and the instrument
(transport, provider, model, `probeHash`). The seam switches are in it because they decide which seams actually
called — a key without them called five runs on this deployment "directly comparable" whose seam mixes differed by
two orders of magnitude, one running all seven seams and the others only `draft`.

**And an unrecorded part refuses rather than agrees.** Mount lines written before those fields existed record no
switches, so the verdict for them is `no-task-key` with the missing part named — which is the truth: nobody can
tell, and that is not the same fact as "they differ".

#### The harness's own telemetry, which is a different product

**Unrelated to this plugin's trace, and kept separate on purpose.** The harness exports session telemetry to a
remote endpoint and ships **no redaction rules** for it — measured against the installed service definition:
*"with no listener mounted records reach the backend as captured, so exported data is exactly as clean as the
rules a deployment mounts."* One rule costs one `ctx.on`, so `lib/telemetry.js` mounts one.

**It is OFF by default** (`redactSessionTelemetry`). A plugin whose contract is "it decides nothing" must not
silently rewrite a user's telemetry the moment it mounts. When on, it scrubs the whole record — `body` *and* the
`attributes` map, which the source's own sketch omitted and which can carry a path or a credential shape just as
easily — reads the switch per record, and **returns the record unchanged if the scrubber throws**, because
fail-closed is the seam's contract and a throw there would blind the user's telemetry rather than protect it.

Two names here were wrong in shipped documentation and are pinned by a test: the event is
**`session-telemetry/record`**, not the `sessionTelemetry/record` three READMEs spell (which never fires), and the
service key is **`sessionTelemetry`**, not the `telemetry` its own doc comment claims. Both were verified against
this harness build rather than copied.

#### Why there is no Observer tab

A tab beside **Chat** and **Trajectory** is a supported seat: `conversation.view` is a list —
*"Registered Conversation target Views, rendered one at a time"*, `replaceRisk: none` — occupied by `chat`
(order 0) and `trajectory` (order 10), and a third entry at order 20 would render. **The seat is not the
problem; the data channel is, and it cannot be built from this repository as it stands.** This is written down
because it cost a long session to establish, and the answer is not obvious from any single file.

**The browser's `ctx.remote.<namespace>` table is a BUILD ARTIFACT, not a runtime negotiation.** It is
assembled from each plugin's generated `./remote` contribution, mounted by `@deepseek-ai/dsh-api-remotes`,
which the plugin lists in `dsh.client.inject`:

```jsonc
"exports": {
  "./typert": { "default": "./lib/typert.host.js" },          // Host contribution
  "./remote": { "default": "./lib/typert.remote-client.js" }  // Browser descriptors
},
"dsh": { "client": { "inject": ["@deepseek-ai/dsh-client-runtime",
                               "@deepseek-ai/dsh-api-remotes", …] } }
```

Those two files are produced by `@deepseek-ai/dsh-typert-generator` and are ordinary data objects carrying
**zod schemas** — see the published example, [`dsh-plugin-greeting`](https://www.npmjs.com/package/dsh-plugin-greeting).
The authoritative how-to is the cookbook
[adding a Remote API](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-a-remote-api.md),
whose "Register it on the package" step is the one that matters here.

**What that rules out.** A Host-side service that extends the harness's `Service`, with the Remote marker
written by hand under the gateway's plain string descriptor key, *does* register an endpoint the gateway's
conservative SRC-marker path can claim — and an attempt at exactly that was built, guarded, and tested here.
It cannot produce a tab, because no Host-side marker can create a namespace in the browser: the browser only
knows the namespaces its plugin contributions declare, and this plugin declares none. The mechanism was
verified; the outcome was impossible. Those two are not the same thing, and the tests could only ever see the
first.

**What adopting the supported path would mean** for this repository, which today has no build step at all —
hand-written ESM, no TypeScript, no bundler: TypeScript, `tsdown`, zod, the Typert generator plus a
monkey-patch of it (the example's README documents that the generator "only recognises
`@deepseek-ai/dsh-typert-protocol` as a workspace source package", and an out-of-repo consumer must patch it,
with instructions for repairing the patch when the generator upgrades), committed generated artifacts, and
peer dependencies on a set of `@deepseek-ai/dsh-*` packages pinned to release candidates. That is a rewrite of
how this project is built, for one view.

**So the card is the answer.** It needs no dependency, no generated artifact and no build step, and it reaches
the same data through the tool contract's `presentationMeta`. The tab becomes worth revisiting if the harness
exposes a supported channel for plugin-owned data, or if this repository adopts the generator pipeline — at
which point `conversation.view` with `{ id, order: 20, label: 'Observer' }` is a small piece of work on top.

#### Why the card exists at all

A session-level tab beside **Chat** and **Trajectory** is a supported seat (`conversation.view` is a list —
`{id, order, label}`, `replaceRisk: none`, with `chat` at order 0 and `trajectory` at 10). What it needs is a
host-to-browser data channel of its own, and the only one this harness offers is
`@deepseek-ai/dsh-typert-protocol` — an internal package whose `@Remote` decorators are not part of a plugin's
contract. Depending on it would put an internal protocol in the load path of a published plugin, where a
mismatch breaks the observer itself rather than only the view.

The card needs neither a new dependency nor a new protocol, and it puts the trace where someone is already
reading it: next to the call that produced it. A tab remains possible if the harness ever exposes a public
channel for plugin-owned data.

### From a terminal: `scripts/trace.mjs`

```bash
node scripts/trace.mjs                    # the newest run, aligned and collapsed
node scripts/trace.mjs --list             # every run in the file
node scripts/trace.mjs --hook draft --calls --tail 5
node scripts/trace.mjs --full             # the question and the envelope under each call
```

An unknown flag is ignored rather than refused, so `--call 20` is not `--calls --tail 20`.

The file is append-only across restarts, so it holds several **runs** and the reader takes the newest
unless told otherwise. It collapses consecutive identical skips into one line with a count — a
subagent produces hundreds in a row, and a line each buries every call in the run — and it prints the
verdict a person reads (`before_a_tool_call p=0.88`) rather than the JSON that carries it:

```
run 2026-01-02T10-04-15-523Z-a1b2c3d4   1544 events · 10:04:15.888 → 10:31:02.970
  mounted   hooks admit,draft,pre_execute,post_execute · transport service · typesafe/jev-latest
  events    566 calls · 977 skips · 0 errors
  latency   min 181ms · median 273ms · max 15005ms
  model     typesafe/jev-latest → typesafe/jev-1.13-20260917 ×565

10:31:02  CALL  draft         session-0123abcd  833ms   Refactored the parser and added two boundary tests…
                                             → model_output p=0.83
```

`--file` takes a path; without it the reader picks the most recently written trace among
`$SYSTEM1_OBSERVER_TRACE`, `<DSH_HOME>/logs/`, and the package's `data/` directory — most recent, not
first found, so a stale one-line trace cannot shadow the live one.

**Where things live:** [`ROADMAP.md`](ROADMAP.md) is the design record and the ideas -- what the plugin is for, the
phases, and what is not decided yet. [`docs/settings.md`](docs/settings.md) is the decision record, section by
section, with the measurement behind each; [`docs/findings.md`](docs/findings.md) is the register of what broke and
what it taught; [`docs/conventions.md`](docs/conventions.md) is how work is done here.
