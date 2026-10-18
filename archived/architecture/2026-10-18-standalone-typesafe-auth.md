# The service route, cut — and what replaced it

**Date:** 2026-10-18. **Status:** cut from `lib/` and `index.js`; archived here with its two tests.

## What was removed

| file | what it was |
|---|---|
| `lib/model/service.js` | `createServiceModel({service, provider, model})` — the decision model reached as a Cordis service, and the instrument's **only** host edge |
| `lib/model/service-answers.js` | the service's own answer shape (`{status:'ok', answer:{type, probabilityTrue}}`) flattened into the wire's |
| `ctx.inject(['system1'], …)` in `index.js` | the swap: when a service arrived, every call went through it and `transport.kind` became `service` |
| `test/turn-service-path.test.js`, `test/service-answers.test.js` | the tests of that path, archived beside this note rather than deleted |

## Why it was cut, in the order the reasons actually arrived

**1. The wire could not authenticate.** `postSystemone` sent `content-type` and nothing else — no `Authorization`, no apiKey parameter, and `grep -rn 'Authorization\|Bearer\|apiKey' lib/model/` returned nothing. So the TypeSafe path could only ever reach an *unauthenticated* endpoint, and every authenticated call in a deployment had to be made by whatever else owned the key. That is the whole reason the host edge existed: **the instrument borrowed another plugin's credential.**

**2. That made the core unportable.** A standalone copy had no way to authenticate. `ROADMAP.md` §14.6 describes the instrument as "a pure package, no dsh import", and it could not leave the repository without a second plugin installed beside it.

**3. Then the model was not sent either.** `postSystemone` posted `{state, questions}` — the `model` block belonged to the service. So `model: jev-latest` in the row's config was **recorded on the mount line and never asked for**, and the endpoint chose for itself. Invisible while a service was mounted (the service sent its own block and reported the revision that answered); exactly the kind of thing a cut exposes.

## What replaced it

`apiKey` and `model` are now ordinary parameters on `createModel` / `postSystemone`, and the row resolves the key from an environment variable **named by config** (`apiKeyEnv`), never stored. The convention is the one the deployment already used for its own provider row.

**Measured standalone, before any of it was written** — nothing from the harness loaded, no SDK, no plugin:

```
fetch('https://openrouter.ai/api/v1/systemone', {
  headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + key },
  body: JSON.stringify({ model: 'jev-latest', state: …, questions: {…} }),
})
→ HTTP 200
→ answer: unknown | p= {"supported":0.33,"contradicted":0.01,"unknown":0.66}
```

So the answer to "will it still work in dsh" is yes, and it was measured rather than argued: the host process is Node with a global `fetch`, the variable it names is in that process's environment, and the endpoint and contract are the ones the provider was posting to anyway (`dsh-system1/lib/providers/systemone.js:77` appends `/v1/systemone` to the same base).

## What it cost, stated plainly

- **`fallbackModels` and the DSH credential store.** `dsh-system1` resolved keys from the harness credential service and could try a chain of models. This row reads one environment variable and tries one model. A deployment that wants either needs to build it here.
- **Provider indirection.** `provider` is now recorded and reported, not used to select a route. Other decision models are reachable by pointing `wireUrl` at them, but only models that serve `/v1/systemone` — which is the actual compatibility boundary, and it is now visible instead of hidden behind a service name.
- **The trace's mount line** says `transport: wire` from the first mount, and is never rewritten. Previously it could be rewritten when a service arrived, which meant a reader comparing a mount line with a later call had to work out which transport was live at which moment.

## Two things the cut made visible that are worth keeping

- **The wire's answer shapes are not the service's**, and the difference is subtle enough to cost four wrong guesses in `test/evaluate-live.test.js` once the adapter was gone: a noul carries `noul`, a score carries `score` as an index, and `probabilities` is a **record keyed by level text**, not an array. Every wrong guess came back `unreadable`, which is the correct answer — the shape really was wrong.
- **A test that names a dependency is a description of the present, not a floor.** `test/instrument-boundary.test.js` asserted the instrument's host edge was *the one* edge there was; and `test/host-inventory.test.js` asserted a live service named `system1` was discovered — both as guards against something regressing. When the dependency went, both would have quietly deleted the guard along with it. They now assert `[]`, and the digit-matching extractor has a synthetic probe, because the guard is about the extractor rather than about that one name.

## How to restore

```
git show 31ac076:lib/model/service.js          # the module
git show 31ac076:lib/model/service-answers.js
git show 31ac076:archived/architecture/service-answers.test.js.archived
```

Restoring is a `git revert` of the cut commit, but it should not be done by reflex: it would put back a route whose only purpose was to borrow a credential this package can now hold itself.
