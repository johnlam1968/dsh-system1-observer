// THE SERVICE'S `config()` REPORTS THE RUNNING ROW, NOT THE ONE THAT MOUNTED.
//
// This test exists because that object mixed the two: `hooks` came from `readHooks(mount)` and `provider`/`model`
// straight off the snapshot, while every sibling field in the SAME object read the live config. A consumer asking
// "what is this row doing" was told "what it mounted with", forever -- and a settings save changed the calls without
// changing the description of them. Two register rows (O12 and O13) are this one defect, seen from two directions.
//
// MEASURED, NOT REASONED: the ctx below captures the service the row provides, the config accessors are mutable, and
// the assertion is that the SECOND read differs from the first without any re-mount.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../index.js'
import { OBSERVER_SERVICE } from '../lib/service.js'

const accessor = (read) => ({ get: read })

test('the service reports a LIVE provider, model and hook set -- not the mount snapshot', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'service-config-'))
  let provider = 'typesafe'
  let model = 'jev-latest'
  let hooks = ['admit']
  let subjectSource = 'live'
  let subjectSession = ''
  let subjectKinds = ['operator', 'assistant']
  let subjectLastMessages = 0
  const providers = new Map()
  const ctx = {
    handlers: new Map(),
    on(event, handler) {
      const list = this.handlers.get(event) ?? []
      list.push(handler)
      this.handlers.set(event, list)
      return () => {}
    },
    inject(deps, callback) {
      if (Array.isArray(deps) && deps.includes('tools')) callback({ get: () => ({ register: () => () => {} }) })
    },
    provide(name, value) { providers.set(name, value); return () => {} },
    get: () => undefined,
    agents: { currentInitiator: () => ({ id: 'agent-1' }) },
  }
  await apply(ctx, {
    hooks: accessor(() => hooks),
    tracePath: accessor(join(dir, 'trace.jsonl')),
    sessions: accessor(['*']),
    turnEveryNTurns: accessor(0),
    wireUrl: accessor('http://127.0.0.1:9'),
    timeoutMs: accessor(200),
    provider: accessor(() => provider),
    model: accessor(() => model),
    subjectSource: accessor(() => subjectSource),
    subjectSession: accessor(() => subjectSession),
    subjectKinds: accessor(() => subjectKinds),
    subjectLastMessages: accessor(() => subjectLastMessages),
  })

  const service = providers.get(OBSERVER_SERVICE)
  assert.notEqual(service, undefined, 'the row provides the observer service for other plugins to read')

  const first = service.config()
  assert.equal(first.provider, 'typesafe')
  assert.equal(first.model, 'jev-latest')
  assert.deepEqual(first.hooks, ['admit'])

  // THE FLIP: no re-mount, no re-apply, the same service object. This is what "everything a plugin has is a setting
  // that can change at runtime" means for a consumer reading the row's configuration.
  provider = 'local'
  model = 'kev-1'
  hooks = ['admit', 'draft']
  const second = service.config()
  assert.equal(second.provider, 'local', 'a live provider change must be reported')
  assert.equal(second.model, 'kev-1', 'and the model with it')
  assert.deepEqual(second.hooks, ['admit', 'draft'], 'and the hook set the row is actually calling at')

  // A BAD HOOK IN THE LIVE CONFIG MUST NOT THROW FROM A DESCRIPTION READ. `readHooks` refuses an unknown seam at
  // mount, where refusing is right; a consumer reading `config()` gets the mount's hooks instead of an exception,
  // because a description that can take the row down is worse than a description that is briefly behind.
  hooks = ['admit', 'not-a-seam']
  assert.deepEqual(service.config().hooks, ['admit'], 'an unusable live hook set falls back to the mount')

  // ---- AND THE SUBJECT SETTINGS, which are the inputs to a stored-session evaluation (§11) -------------
  assert.deepEqual(service.subject(), { source: 'live', sessionId: '', kinds: ['operator', 'assistant'], lastMessages: 0 },
    'a row that configured nothing judges the live session, whole')
  subjectSource = 'stored'
  subjectSession = 'session-abc'
  subjectKinds = ['assistant']
  subjectLastMessages = 5
  assert.deepEqual(service.subject(), { source: 'stored', sessionId: 'session-abc', kinds: ['assistant'], lastMessages: 5 },
    'and a live change reaches the reader with no re-mount')
  // A JUNK SOURCE IS `live`, and a junk count is the whole session: the same fall-back-the-reader-means rule the
  // nudge threshold follows, so a value nobody can use never silently becomes a narrower measurement.
  subjectSource = 'somewhere-else'
  subjectLastMessages = -3
  assert.equal(service.subject().source, 'live')
  assert.equal(service.subject().lastMessages, 0)
  // NO SESSION STORE IN THIS MOUNT: a named problem rather than a throw, because the caller is a tool that has to
  // explain what happened.
  const listed = await service.storedSessions()
  assert.match(String(listed.problem), /no session-query service/)
  assert.deepEqual(listed.sessions, [])
})
