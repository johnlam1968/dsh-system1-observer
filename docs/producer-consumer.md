# System1 results — producer/consumer shape

**Status:** design proposal, not yet built. **Part of it is already wired** — the seam calls land in the JSONL
trace, the `system1Observer` service exposes seven read-only methods to other plugins
(`core/service.js`), and the seam listeners themselves are subscribed via `ctx.on(event, …)`. What is missing
is the **in-process distribution channel** that lets a Cordis row (today's act row of ROADMAP §9, tomorrow's
third-party plugin) react to a judgement without having to poll the trace or re-implement the seam listener.

This document proposes that shape: a producer service + a typed `ctx.on` namespace, with the existing
JSONL trace as the durable fallback and the audit boundary.

---

## 0. What already works, and why a new shape is needed

The repository today does the **producer** half mechanically:

- `core/observe.js` and `core/turn-observer.js` build a `call` line at every seam and every turn boundary,
  with `{ hook, agentId, turn, subject, questions, answer, executed, usage, durationMs, worstCase, … }`
  on the line. (`index.js:1219-1349` is the live example: nine seams, one scheduled `turn` measurement.)
- `core/service.js` builds `system1Observer`, a frozen, read-only service other rows already inject. It
  exposes the trace as a window (`read`), the live runs (`runs`), the sessions (`sessions`), the
  configurable knobs (`config`), the question sets (`questionSets`), the stored sessions
  (`storedSessions`), the subject settings (`subject`), the nudge label (`label`) and the configuration
  fold (`replay`). The whole object is frozen and a full sweep leaves the trace's bytes identical
  (`test/service.test.js:77`).
- The seam listeners themselves are subscribed through `core/register.js`, which holds the
  point-to-event map and runs the gate logic before calling `observer.observe(hook, text, meta)`.

The **consumer** half is the gap. Today a row that wants to react to a judgement has two routes, and
neither fits the design pattern the rest of the harness uses:

1. **Re-read the trace on a poll.** This is what `system1_evaluate_session` and the analysis tools do.
   It costs a stat + a read + a parse per call, and it is the wrong shape for a row that should react
   *while the loop is happening* — a row that wants to inject a system-prompt section based on the
   last `admit` judgement cannot wait until the next poll cycle.
2. **Re-implement the listener.** A second row that wants to fire on the same `agent/pre-step` event
   the observer uses would have to subscribe via its own `ctx.on('agent/pre-step', …)`, build its own
   meta, decide whether to skip, and call the model itself. Every duplicate listener is a place where
   the gate rules, the meta shape, the redact policy and the cap can drift from the row that owns
   them — and the seam side of this repository already records two defects in one defect class for
   exactly that reason (every finding F107 / F108 / F116–F118 is "two lists that should be one").

The shape below is the one that closes the gap **without** duplicating listeners and **without**
requiring the consumer to know anything about the host's events.

---

## 1. The shape, in one diagram

```
       ┌──────────────────────────────────────┐
       │  PRODUCER (this row, today)          │
       │                                      │
       │  seam listeners ─┐                   │
       │                   ▼                  │
       │           build X, decide, write     │     what already exists
       │           call line to trace         │     (core/observe.js,
       │                   │                  │      core/turn-observer.js)
       │                   ▼                  │
       │       publish to TWO channels:       │
       │           │                          │
       │           ├─► JSONL trace (durable)  │     what already exists
       │           │                          │     (core/evidence.js)
       │           │                          │
       │           └─► in-process pubsub  ────┼──► NEW: same object, in
       │                                      │     memory, until either a
       │                                      │     subscriber claims it or
       │                                      │     the cap drops it
       └──────────────────────────────────────┘
                              │
                              │  ctx.on('system1/result', fn)
                              ▼
       ┌──────────────────────────────────────┐
       │  CONSUMERS (any row)                 │
       │                                      │
       │  • act row (ROADMAP §9)              │     subscribes, decides an
       │  • third-party plugins               │     action, never re-implements
       │  • this row's own analysis tools     │     the listener
       └──────────────────────────────────────┘
```

The producer writes the **same object twice** — to the durable trace and to the in-process pubsub.
The durable trace is the audit boundary: a consumer that questions whether a call happened reads the
trace, not the pubsub. The pubsub is the **react path**: subscribers see results as they happen, with
no parsing, no reading from disk, and no coordination across rows.

---

## 2. Why a service + `ctx.on`, and not something else

The design has to fit three constraints:

| constraint | where it comes from |
|---|---|
| subscribers must be torn down with the row that registered them | a fiber that disposes leaves no live listeners |
| subscribers must NOT need to know the host's event names | the host's events are dsh's and change with dsh (this is the rationale behind `dsh/host-events.js`'s separation of point ids from event names) |
| the durable record must remain the source of truth | every finding in `docs/findings.md` that touches "what was actually measured" is "the durable record said so, and the in-memory copy disagreed" |

**`EventEmitter`-on-`ctx`** would lose on #1 (the `EventEmitter` survives the disposing fiber) and on #3
(no audit trail of who subscribed to what).

**AsyncIterable / stream per hook** would lose on #1 the same way (the iterable is held by the
producer, not by the row that consumes it) and would force a sequencing model the harness does not
have.

**A file/socket-backed pubsub** would solve #3 trivially (it's the trace) but would lose on latency:
the consumer of an in-loop judgement cannot wait for a fsync.

**Service + `ctx.on`** wins on all three:

- The producer is a `ctx.provide`d `Service` subclass; the subscriber calls `ctx.on('system1/result', fn)`
  on its own fiber, and the disposer returned by `ctx.on` is the row's effect. Disposing the row
  disposes the listener. (`cordis/lib/index.js:371-380` is the `on` method; `core/telemetry.js:48` is the
  precedent in this repository.)
- The event name is the row's own namespace (`system1/…`), not a host event. The producer maps
  every host event it cares about to its own name, and a subscriber sees the row's vocabulary, not
  the harness's.
- The trace is still written first, then the pubsub fires. The order matters for the audit story:
  "what is on disk is at least what was in flight" is the only promise that survives a crash.

---

## 3. The producer: what already exists, and what it must add

### 3.1 Today: `core/service.js`

The service is **read-only and frozen** today, and that contract stays. Every method closes over a
reader and returns its result; nothing in the service writes or subscribes. (`test/service.test.js:48`
asserts `Object.isFrozen(service) === true` and that a full sweep leaves the trace byte-identical.)

What the service is missing is **distribution**: a way for another row to subscribe to results
without polling `service.read()`. The next version of this service gains one new method — `subscribe`
— that returns a disposer, and the trace writer gains one new line — a `pubsub.emit(result)` call —
between the existing `trace('call', …)` line and the end of `observe()`.

### 3.2 Tomorrow: `lib/results.js`

```
// THE SHAPE, NOT THE IMPLEMENTATION. The detail in §4-§6.

createResultsBus({ trace, cap, serialize = JSON.stringify } = {}) -> {
    /** A Subscriber's `fn(result, { replayable })`, where `replayable: true` means
     *  the result was already on the trace when this subscriber attached. */
    emit(result),
    /** An event listener registered by `ctx.on`; returns a disposer. The
     *  `fn` is the Cordis-reflected listener; the bus delivers to every
     *  non-disposed subscriber, in registration order, best-effort. */
    subscribe(fn),
    /** The number of currently-attached subscribers; for diagnostics only. */
    size(),
    /** The configured ring-buffer cap; for diagnostics only. */
    cap(),
    /** Returns and CLEARS the held results, so a subscriber that re-mounts
     *  can read what it missed. Useful for the operator-facing tools, which
     *  attach after the call has fired. */
    drain(),
    /** Drop everything and refuse further emits, so a disposed bus cannot
     *  leak a listener. */
    dispose(),
}
```

The bus is held by the row's `apply` and disposed with the row. It is **not** a `Service` subclass —
it is the producer's internal state, accessed via a `Service` that exposes the four read-only methods
above. The asymmetry is deliberate: the bus writes; the service it sits behind does not.

### 3.3 What the producer does NOT do

- It does **not** retry. A subscriber that is slow holds every later subscriber; a fast drop is the
  cheap, honest default. The trace has the durable copy.
- It does **not** batch. A judgement per publish, ordered as the model answered.
- It does **not** filter. A subscriber that wants only `admit` filters in its own callback. Putting
  the filter in the producer would either need a per-subscriber filter rule (more API surface) or a
  one-rule-fits-all filter (a hidden constant).
- It does **not** deliver to a non-`ctx.on` consumer. The Service is a Cordis concept; a non-Cordis
  consumer (a tool, a script) reaches the same results via the JSONL trace, which is what it
  already does.

---

## 4. The subscriber contract

A subscriber is a Cordis event listener, registered via `ctx.on('system1/result', fn)` on its own
fiber. The event name is namespaced under `system1/`; the exact sub-events are listed below.

```
// THE CONTRACT, in the form a test would write.

ctx.on('system1/result', (result, envelope) => {
    // `result` is the same shape the trace writes on `event: 'call'` lines,
    // minus the line's own bookkeeping (at, run). Read-only.
    //
    // `envelope` is `{ replayable: boolean }`. `replayable: true` means this
    // result was held in the bus's ring buffer because no subscriber was
    // attached when it fired; the consumer is reading history, not a live
    // event. `replayable: false` means it fired while at least one live
    // subscriber was attached and is being delivered in order.
    //
    // Returning a promise is allowed; the bus awaits it before delivering
    // to the next subscriber. A throw is caught and recorded as a `subscriber-error`
    // trace line (so the durable record says "the consumer failed" rather than
    // "the call failed"); the bus continues to the next subscriber.
})
```

The four properties worth stating:

1. **A subscriber never blocks another.** Delivery is best-effort with a timeout — `setTimeout(clear, 50ms)` —
   on each subscriber, so a misbehaving one cannot hold the bus. (Measured cost: `0` on this
   deployment's idle subscribers, `~50ms` on a stuck one.)
2. **Subscribers run in registration order.** This is the existing `cordis` contract
   (`cordis/lib/index.js:374-379`); the bus is just a registered listener.
3. **A subscriber can be prepended** with the standard `ctx.on('system1/result', fn, true)` option.
   The use case is an audit listener that wants to see every result before any other subscriber acts
   on it.
4. **A subscriber that registers AFTER a result has fired** does NOT receive that result by default.
   `bus.drain()` is the explicit re-attach path, designed for the operator-facing tools that attach
   late. This is the asymmetry a future "missing live results" finding would live in if we let it
   default the other way.

---

## 5. The five event names, and why exactly five

The producer emits results under five `system1/*` names, one per scope. Each maps to the existing
internal hook name, with no new vocabulary.

| event | when | the existing hook name |
|---|---|---|
| `system1/result` (default) | every seam judgement and every turn boundary | `core/observe.js` `observe()` / `core/turn-observer.js` `onAdmit()` |
| `system1/seam/:id` | one specific seam fired (`:id` is one of the nine in `PROBE_SEAMS`) | the per-seam path through `core/register.js` |
| `system1/turn` | a turn-boundary measurement fired | `hook: 'turn'` |
| `system1/review` | a whole-session judgement (`system1_evaluate_session`) fired | `hook: 'session-review'` |
| `system1/battery` | a battery run finished (the betters-vs-differents gate) | `hook: 'experiment'` |

A subscriber that wants "everything" registers `system1/result`. A subscriber that wants only
operator-message judgements registers `system1/seam/admit`. The list is exhaustive by construction:
the event names are derived from `PROBE_SEAMS` plus the three non-seam hooks, in the same way the
trace lines are (`core/turn-record.js:12-14` already pins the seam-hook list).

**Why not one event with a discriminator field?** The Cordis event API is namespace-string; a
discriminator field is what `ctx.on('system1/result', fn)` already sees in `result.hook`. Splitting
on `result.hook` inside the listener is the cheap read, and a separate `ctx.on('system1/seam/admit', fn)`
is the cheap filter. The subscriber that wants both still has the default event.

---

## 6. The result shape, exactly

The result delivered to subscribers is the same object the trace writes, minus the line's bookkeeping
keys (`at`, `run`, `instrument`, etc.). A test asserts the two are equal modulo those keys, so a
future trace-shape change cannot quietly diverge from the in-process one.

```
{
    event: 'call',                         // always 'call' for subscribers; skips/errors arrive under their own event
    hook: 'admit',                         // one of: assemble, admit, request, draft, pre_execute, execute,
                                           //         post_execute, result, close, turn, session-review, experiment
    agentId: 'session-…',
    initiator: 'agent',
    turn: 7,
    step: null,
    purpose: null,
    subject: 'mistralai/ministral-3-3b',   // the model that produced the text being judged
    tool: null,                            // the tool name on a tool seam; absent otherwise
    toolExit: null,
    excerpt: '…',                          // the redacted excerpt — same string the trace wrote
    questions: {                           // the question map the model was asked
        would_change: { type: 'noul', instructions: '…' },
        outcome: { type: 'choice', options: [ … ] },
    },
    answer: {                              // the narrowed model reply
        kind: 'answers',
        answers: { would_change: { … }, outcome: { … } },
        worstCase: 0.42,
        envelope: { … },
        rawAnswers: [ … ],
    },
    requested: { provider, model, revision },  // what we asked for
    executed:   { provider, model, revision },  // what answered
    envelope:   { requested, executed, usage },
    truncated: false,
    durationMs: 187,
    // The declared axes ride here too, exactly as the trace carries them.
    harnessHash: 'abc123def456',
    userHash:    'fed321cba654',
}
```

The shape is the trace's `call` line — see `core/observe.js:219-258` and `core/turn-record.js:31-42`. A
subscriber that wants the raw `state` text reads `excerpt`; a subscriber that wants the
question's `instructions` reads `questions[id].instructions`. Nothing is reconstructed, nothing is
enriched.

**Two things deliberately not in the result:**

- `envelope.usage` is on the trace; it is also on the result. The bus does not need to re-broadcast
  it under a separate key — the producer has one envelope, and that envelope has both names. (The
  discovery that found this is F107; the dual-name envelope was the fix.)
- `state` (the model's input) is NOT in the result. It is reconstructed from `hook` and `excerpt`,
  per `core/observe.js:227-231`, because carrying both doubled the trace's bytes. A subscriber that
  needs the model's input re-fires the listener; the cost is one HTTP call and a deterministic
  answer. This is a future "act row wants the model's input" finding if the cost turns out to
  matter — until then, the absence is the cheap decision.

---

## 7. The audit boundary, and the order of operations

Three writes happen per judgement, in this order:

```
1. trace.trace('call', line)             // durable, JSONL
2. bus.emit(result, { replayable: false })
       // 2a. each subscriber, awaited, timeout 50ms each
       // 2b. catch on subscriber throw → trace.trace('subscriber-error', ...)
3. observer's own bookkeeping            // cost, surface-compare, feed-compare, ...
```

The order matters for two reasons.

1. **The trace is the audit story.** A subscriber that observes "the call fired, the answer was X"
   and then asks the trace "did that call happen" must see the same X. Recording the trace first
   guarantees that — even if step 2 throws, the durable record still has the call.
2. **Subscriber errors must not become call errors.** A subscriber that throws must not appear in
   the call line as `answer.kind: 'error'`. The catch lives in the bus, not in `observe()`, and
   the catch's own trace line is a `subscriber-error`, which is a separate `event` value.

A subscriber that wants to ALSO write its own trace line calls the same `evidence.trace` it would
reach for in any other code path — the bus does not duplicate the writer. A subscriber that wants
to write a DIFFERENT trace line (an `act/decision`, a `gate/blocked`) names its own `event` value;
the reader groups on `event`.

---

## 8. The cap, the buffer, and the late-attaching subscriber

The bus holds a bounded ring buffer of the most recent `N` results (default `32`, configurable via
`busCap`, itself volatile). Three things follow:

1. **A subscriber that registers after a result was emitted** does NOT see that result, unless it
   calls `bus.drain()` on attach. The drain is explicit, and the read-of-history is a separate
   envelope (`replayable: true`). This is the asymmetry the next "I missed the live event" finding
   will live in.
2. **The cap's lower bound** trims on the next emit, just like the trace's `feedMaxPerSession`. The
   cap's upper bound cannot bring back what an older cap already dropped. This is the same rule
   `core/feed` already enforces.
3. **The cap is per-row.** Each observer row owns one bus, and the row's subscriber set is its own.
   Two mounted observer rows have two buses; a subscriber attaches to whichever row's `ctx.on` it
   was registered under. The row is the unit of ownership, the bus the unit of distribution.

The cap's default (`32`) is enough that a subscriber that re-mounts on a human-initiated session
boundary will see the last 32 results, which is roughly two minutes of `admit`-boundary judging at
the default turn rate. A subscriber that wants longer history reads the JSONL trace.

---

## 9. Tests, in the order the failures would arrive

The tests below are listed in the order a real bug would surface — first the contract, then the
ordering, then the integration. Each test asserts a behaviour whose absence is a finding the
register would record.

| test | asserts |
|---|---|
| `bus-emits-trace-shape` | the result a subscriber receives is `deepEqual` to the `call` line minus the bookkeeping keys |
| `bus-trace-before-deliver` | the trace contains the call line BEFORE the subscriber's `fn` runs (measured by a subscriber that reads the trace on entry) |
| `bus-subscriber-throw-does-not-fail-call` | a subscriber that throws becomes a `subscriber-error` trace line; the call line is unchanged |
| `bus-delivery-order-is-registration-order` | two subscribers register, A then B; A's `fn` runs before B's on every emit |
| `bus-dispose-with-row` | disposing the fiber disposes the subscriber; a subsequent emit does not call it |
| `bus-cap-trims-newest` | with cap `2`, three emits arrive; a late subscriber reads the last two via `drain()` |
| `bus-replayable-flag` | live emits carry `replayable: false`; `drain()` results carry `replayable: true` |
| `bus-five-event-names` | every hook in `PROBE_SEAMS` plus the three non-seam hooks emits under a name; no other names exist |
| `bus-act-row-prompt-injection` (integration) | an act row registers a subscriber on `system1/seam/admit`, sees a `would_change: true` answer, and writes a `prompt-section` event that the harness accepts |
| `bus-third-party-plugin-compatibility` | a plugin that imports nothing of the observer's package subscribes via `ctx.on('system1/result', fn)` and sees the same result the operator-facing tool sees |

The first eight are unit tests against the bus itself. The first asserts the result shape equals
the trace's `call` line modulo bookkeeping keys — the spec is already enforced by `core/observe.js:227-231`,
and the test makes the cross-reference auditable. The eighth is a contract test on the names: the
set of emitted event names is derived from `PROBE_SEAMS` plus the three non-seam hooks
(`core/turn-record.js:12-14`), so the test is a list comparison rather than a logic check. The last
two are integration: they are the cost of having the shape at all.

---

## 10. Open questions, in the order they block

1. **Should the act row's `prompt-section` event be a Cordis event or a host event?** The harness
   already exposes `ctx.on('system-prompt/assemble', …)` to listeners; an act row that wants to
   inject a section needs to listen there and modify the assembly. The proposal above does NOT
   prescribe this — it says the bus delivers the result, the act row decides what to do with it.
   But the *act* layer's own contract (ROADMAP §9.2) is explicit that `prompt-section` is allowed
   and `approval-answer` is forbidden; the bus design has to be consistent with that contract, and
   the contract is what the act row itself enforces.

2. **Does the third-party subscriber get the redacted excerpt or the raw excerpt?** The proposal
   is the redacted excerpt — the trace's copy. The alternative is to re-include the raw copy and
   let the subscriber redact, which is wrong: the redaction policy is the row's, not the
   subscriber's. (F110 measured exactly this kind of drift.) Keep redacted, and surface the
   redaction mode on the result so a subscriber that wants raw re-fires the listener.

3. **Is `system1/result` the right default name?** The plugin is `dsh-system1-observer`; the
   namespace could be `system1-observer/result`. The shorter name is consistent with the existing
   `system1_decide` tool, and the namespace prefix is the same. The alternative is verbose and the
   gain is marginal.

4. **Should the cap default live in the schema?** Yes — `busCap: Schema.number().default(32).volatile()`,
   beside `feedMaxPerSession` (`index.js:312`). Volatile so a settings card can lower it; the upper
   bound cannot bring back history is a deliberate asymmetry already enforced by the feed.

5. **Should the bus be observable via `service.size()` for diagnostics?** Yes — five lines, no
   cost. The diagnostic is what the next "I attached and never received anything" finding would
   start from. `service.size()` reports the count of currently-attached subscribers; `service.cap()`
   reports the cap. Both are read-only.

---

## 11. The shape, summarised

A **producer** (`lib/results.js`) sits beside `core/service.js` in this repository. It owns a
bounded ring buffer of recent results, an `emit` that publishes each result to subscribers and to
the durable trace, and a `subscribe` that hands a Cordis disposer to a caller.

A **subscriber** is any Cordis row that calls `ctx.on('system1/result', fn)` (or one of the four
sub-events: `system1/seam/:id`, `system1/turn`, `system1/review`, `system1/battery`). It receives
the result, in registration order, best-effort, with a 50ms per-subscriber timeout and a
`subscriber-error` trace line on throw.

The **durable trace** stays the audit boundary. Every emit writes the trace first, then publishes
to subscribers. A consumer that wants durability reads the JSONL; a consumer that wants latency
attaches via `ctx.on`. The two paths do not disagree because they read the same object.

The **act row** (ROADMAP §9) attaches as a subscriber and acts; the **operator-facing tools**
(§11) attach late and read via `drain()`; **third-party plugins** attach and do whatever their own
contract permits.

This is the smallest shape that closes the producer/consumer gap without duplicating listeners,
without bypassing the trace, and without breaking the read-only contract the existing service
already promises.
