# The session adapter

What a session event **is**, which events are in the model's **surface**, what has been **seen** per session, and the
`sessionQuery`-backed **reads**. Five modules, and the question each answers:

| module | the question |
|---|---|
| `lib/session-format.js` | what a session event IS — the harness's vocabulary in one home, so no reader invents its own |
| `lib/surface.js` | which events are in the model's surface, folded from the `surfaceOp: replace` spans **in hand** |
| `lib/surface-authority.js` | the same question asked of the **host**, which is authoritative and can only be asked by awaiting |
| `lib/feed.js` | what has been SEEN per session, bounded — an in-band record, not a fold |
| `lib/reader.js` | the host-backed reads: the subject, the list, the window slicing, the coverage, full-text search |

## Why the split between `surface.js` and `surface-authority.js`

The authority is **async and optional** (`F104`). A composer running inside a synchronous seam cannot await a Cordis
service, so if the answer only existed behind `sessionQuery` a deployment without it would lose the answer entirely.
The fold is what that path gets instead, and `surface-authority.js` is what a caller that *can* await asks first.
Neither is redundant: deleting the fold brings back a shadowed-answer defect, and deleting the authority leaves a
guess where the harness would have answered.

## What this used to be, and why it stopped

It was a **published npm package**, `dsh-session-adapter@0.1.0`, with a row of its own and a second form of the same
implementation: the functions above, reachable by name, plus a `ctx.sessionAdapter` service for a consumer that
injects rather than imports.

Measured before removing it, the boundary had nobody on the far side:

- **no module outside this repository imported it** — the only other installation on this host was a stale entry in a
  package that had stopped referencing it
- **nothing injected `ctx.sessionAdapter`** — not this repository, not any other on the machine, while the row was
  mounted in the profile
- and the reason it had to be *importable* was `await`, not module resolution — a **relative import is equally
  importable**, so the package boundary was paying for something the constraint did not require

So the service form went first: a row in every profile handing an object to nobody, and the one impure file in a set
the host inventory otherwise holds to containing no host call at all. Then the package, and with it the workspace
entry, the publish step and the second published artifact.

## The host arrives as a PARAMETER

Every function that needs the harness takes `sessionQuery` as an **argument**; nothing here calls `ctx`. That is why
`dsh/host/index.js` can still hold these five to containing no host service, no event subscription and no injection —
and why the purity check has nothing to except.

A deployment with no host is **not broken**: the reader answers with a named problem and the authority answers
`null`, so "no host" is never read as "no results", and a caller with a fallback keeps it.

## What is deliberately NOT here

* **No config.** The window (`kinds`, `lastMessages`, `offset`) is the *caller's* question, not a deployment setting.
  A knob here would only be somewhere for a setting to hide.
* **No policy.** Which search backend answers, and whether a store is consulted at all, belongs to the consumer.
* **No store.** A derived index over session *files* is a different thing: [`dsh-session-index`](https://github.com/johnlam1968/dsh-session-index).
  This answers what the **harness** says; that one answers what was **built**.
