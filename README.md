# dsh-system1-observer

A Host-only Cordis bundle for the DeepSeek Harness that attaches at points of the agent loop, calls a
**System One** decision model at each configured one, and writes every call — request *and* response — to a
JSONL trace.

**It decides nothing.** No ladder level, no withheld reply, no injected context, no changed value. Every
waterfall listener returns the decision it was handed, the same reference; the `draft` listener relays the
stream unchanged; the `result` emit listener swallows its own rejection. Its product is evidence about the
decision model's replies at each point of the loop.

## What it depends on

```json
"dsh-system1-runtime": "git+https://github.com/johnlam1968/system1-runtime-repo.git#v0.1.1"
```

The runtime is fetched from GitHub at the tag above, so a **plain `npm install` is enough** and no sibling checkout
is required. It owns the seam names, the seam-to-event map, the per-seam text extractor, the evidence record and
the two decision-model transports; this bundle supplies the row, the config and the listener wiring. The
interface is checked at mount against `INTERFACE_VERSION`, and a mismatch refuses the mount rather than
running against a shape this build was not written for.

## Hooks

The nine seams are the runtime's `PROBE_SEAMS`, in loop order:

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

The two seams that carry no text produce a `skip` line and never reach the model. A text-classification answer
produced from no text is not a measurement.

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
| `includeNonOperatorFacing` | `false` | live |
| `observeSubagents` | `false` | live |
| `maxFieldChars` | `20000` | live |

`includeNonOperatorFacing` off keeps the `draft` seam to what an operator would read: the Harness's own
**purpose-tagged** streaming calls (session titles, compaction) are relayed without a model call. It does not
touch subagents: a subagent's stream either carries a purpose tag or does not, and this flag reads only the tag.

`observeSubagents` off — the default — records a subagent session's streams and tool calls as `skip` lines with
reason `subagent session`, and their text never reaches the model or the trace. On, a subagent is observed like
any other agent. A suppressed `draft` is still relayed chunk for chunk, untouched; a suppressed waterfall seam
still returns the decision it was handed, the same reference. The discriminator is the session header:
`agent.session.header.origin === 'subagent'`.

`maxFieldChars` caps each recorded state and marks the line `truncated: true` when anything was cut.

Where the trace is written: `SYSTEM1_OBSERVER_TRACE` overrides everything; otherwise `tracePath` if set;
otherwise `<DSH_HOME>/logs/system1-observer.jsonl`, so a trace is discoverable beside the harness's own logs.
Only with no `DSH_HOME` — a bare `node` run — does it fall back to the bundle's `data/system1-observer.jsonl`.

`question` replaces the runtime's probe question with a `noul` built from the text; left empty, the probe
question is used, and its answer is checkable because the seam is known.

## The trace

One JSON object per line, plus a `run` id on every line so several runs in one file can still be told apart:

- `mount` — the hooks, the transport actually chosen, the provider, the model and the trace path;
- `call` — the seam, the host event, the agent, the excerpt, the questions as sent and the whole answer;
- `skip` — a seam that carried no text, or a subagent session that was deliberately not observed, and why;
- `error` — a `decide` that threw.

Recording is best-effort throughout: a throwing trace cannot fail a turn, and neither can a model outage, a
timeout or a malformed body.

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

`install.sh` checks the prerequisites, runs `npm install` (which fetches `dsh-system1-runtime` from
GitHub), **verifies the runtime actually resolved** rather than trusting npm's exit code, adds the
bundle, and prints the composed row and the surviving bundle list. It is idempotent.

The equivalent by hand:

```bash
npm install
dsh plugin --profile web add "$PWD"
```

`dsh plugin add` REWRITES the profile's bundle list and drops bundles it did not write — re-read
`dsh.profile.bundles` afterwards. A newly added bundle needs no restart; a bundle whose package was
*replaced* does.


## Reading the trace

```bash
node scripts/trace.mjs                    # the newest run, aligned and collapsed
node scripts/trace.mjs --list             # every run in the file
node scripts/trace.mjs --hook draft --calls --tail 5
node scripts/trace.mjs --full             # the question and the envelope under each call
```

The file is append-only across restarts, so it holds several **runs** and the reader takes the newest
unless told otherwise. It collapses consecutive identical skips into one line with a count — a
subagent produces hundreds in a row, and a line each buries every call in the run — and it prints the
verdict a person reads (`before_a_tool_call p=0.88`) rather than the JSON that carries it:

```
run 2026-09-29T19-13-15-523Z-c69f82ad   1544 events · 19:13:15.888 → 21:06:58.970
  mounted   hooks admit,draft,pre_execute,post_execute · transport service · typesafe/jev-latest
  events    566 calls · 977 skips · 0 errors
  latency   min 181ms · median 273ms · max 15005ms
  model     typesafe/jev-latest → typesafe/jev-1.13-20260917 ×565

21:06:58  CALL  draft         session-17326d  833ms   Much more readable. Two flaws to fix: the execut…
                                             → model_output p=0.83
```

`--file` takes a path; without it the reader picks the most recently written trace among
`$SYSTEM1_OBSERVER_TRACE`, `<DSH_HOME>/logs/`, and the package's `data/` directory — most recent, not
first found, so a stale one-line trace cannot shadow the live one.
