# dsh-session-adapter

The **DSH session surface**, as one small plugin: what a session event *is*, which events are in the model's *surface*,
what has been *seen* per session, and the `sessionQuery`-backed reads (the subject, the list, the current surface, the
host's full-text search).

It gives the same implementation **two forms**, and that is the point:

| form | how it is reached | who needs it |
|---|---|---|
| **functions** | `import { readStoredSubject } from 'dsh-session-adapter/reader'` | the IN-BAND path. A composer inside a synchronous seam cannot await a Cordis service (`F104`), so this half must be importable |
| **service** | `ctx.sessionAdapter` (row `session-adapter`) | a consumer that injects rather than imports, and does not want to care where the reads come from |

```js
// either
import { readStoredSubject, currentSurfaceSeqs } from 'dsh-session-adapter/reader'
// or
ctx.inject(['sessionAdapter'], (child) => child.sessionAdapter.readSession(id, { kinds: ['assistant'] }))
```

## The host arrives as a PARAMETER

Every function that needs the harness takes the `sessionQuery` service as an **argument**; nothing in this package calls
`ctx`. The consumer's `lib/host/index.js` (its inventory of host dependencies) therefore still checks that these files
contain no host call of their own, and the plugin edge — the one file that *does* call `ctx` — is declared as the host
edge rather than smuggled in as a "pure module".

`getQuery` is a **function**, not a captured reference: the host service may mount after this row, so every method reads
it at call time.

## What is deliberately NOT here

* **No config.** The window (`kinds`, `lastMessages`, `offset`) is the *caller's* question, not a deployment setting, and
  the data comes from the host. A knob here would only be somewhere for a setting to hide.
* **No policy.** Which search backend answers, and whether a store is consulted at all, belongs to the consumer — this
  package offers the host's search as a *call* and returns `null` when there is no host to search.
* **No store.** A derived index over session *files* is a different thing: [`dsh-session-index`](https://github.com/johnlam1968/dsh-session-index).
  This package answers what the **harness** says; that one answers what was **built**.

## A deployment with no host is not broken

`readSession` answers with a named problem, `search` and `currentSurfaceSeqs` answer `null`, and `available()` says which
of the two a caller will get — so "no host" is never read as "no results", and a caller that has a fallback keeps it.

## Install

```json
{ "dependencies": { "dsh-session-adapter": "link:../dsh-system1-observer/packages/session-adapter" },
  "dsh": { "profile": { "bundles": ["...", "dsh-session-adapter"] } } }
```

**The bundle entry must be there when the package declares one.** Measured (`F105`): a package added to `bundles`
*before* its `package.json` declared `dsh.bundle.patch` is dropped by the next `dsh plugin … install`, silently — the
composition then simply has no row. Add the declaration first, then the entry.
