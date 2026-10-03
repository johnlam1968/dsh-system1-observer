# DESIGN — what this is, and where every decision lives

**One page, and deliberately not a second copy of anything.** The facts live where they are decided:
[`settings.md`](settings.md) is the decision record, section by section, with the measurements behind each;
[`findings.md`](findings.md) is the register of what broke and what it taught; [`conventions.md`](conventions.md) is
how work is done here; [`IDEAS.md`](IDEAS.md) is the store for what is not decided yet. This file is the map.

## What the plugin is

A measurement device bolted onto a running agent loop. It asks a System One (Jev-style) decision model narrow
questions about a **state** at chosen points, records every call, every answer and every skip, and refuses to compare
two runs that were not the same instrument.

It is not a benchmark, and the distinction is the whole design: benchmarks say what a MODEL is like. This says what a
model's outputs were like **inside this harness**, under this question set, with this operator — which is the only
place the harness's own contribution is visible at all.

## The five invariants

1. **One narrow question per judgement.** A predicate, an ordinal ladder, or a closed classification. A wide question
   is several questions sharing an id, and it cannot be calibrated.
2. **A question may only name state the call carries.** At a seam that is that seam's text and nothing else; at
   `turn` the four exchange sections; at `session` the transcript and the tool calls. This is the invariant most
   easily and most silently violated — a model will answer an unanswerable question.
3. **Refusal axes versus grouping axes.** What changes what a number MEANS (the model, the question set) goes in
   `instrument`, and runs that differ are refused comparison. What says who or what it is about (the user, the
   harness technique, the use case) is recorded and sliced, never a reason to refuse.
4. **Declared, never inferred.** A technique, a person, a subject. Inference would confound the subject with the
   treatment — and the record is asserted from declared facts, not from guesses.
5. **Refuse rather than ask nothing.** An unreadable set, an empty composition, a set with a broken spec: the call is
   refused with a named reason. Silence that looks like a measurement is worse than no measurement.

## The shape

- **Subjects** come from three places: a live session's events (per seam, and the scheduled turn aggregate), a
  **stored** session (whole or sliced — `subjectSource`), and a composed state at a seam.
- **States** have three scopes — a seam's own text, the multi-turn aggregate, a whole session — and a set is written
  for one of them.
- **Sets** are files: one directory per composition, one file per scope, `_manifest.json` declaring what it is for.
  Selected by name, identified by content hash, recorded on the mount line.
- **Readings** land in a JSONL trace; `system1_trace` reads it back, `system1_observe_config` changes the settings,
  `system1_evaluate` judges a conversation on demand.

## Where to look

| question | file |
|---|---|
| what does setting X do, and why is it shaped that way | [`settings.md`](settings.md) |
| what broke, what it taught, what is still open | [`findings.md`](findings.md) |
| how is work done here (tests, gates, evidence) | [`conventions.md`](conventions.md) |
| what is not decided yet | [`IDEAS.md`](IDEAS.md) |
| what the port to the runtime would take | [`port/`](port/) |
| how to write a question set | [`../criteria/_templates/SET-AUTHORING.md`](../criteria/_templates/SET-AUTHORING.md) |

## The one thing to know before changing anything

`npm run ci` is five gates, and the ratchets inside them exist because each one has already caught a real defect in
this repository: a setting with no card control, a schema field the config tool did not describe, a card that read a
key the answer never produced. If a change makes a ratchet fail, the ratchet is usually right.
