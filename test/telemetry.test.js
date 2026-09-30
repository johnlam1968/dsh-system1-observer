// THE HARNESS'S OWN OUTBOUND TELEMETRY.
//
// This is not this plugin's trace. The harness exports session telemetry remotely and, measured against the
// installed service definition, ships NO redaction rules: "with no listener mounted records reach the backend as
// captured". A rule costs one `ctx.on` -- and it ships OFF, because a plugin whose contract is "it decides
// nothing" must not silently rewrite a user's telemetry the moment it mounts.
//
// BOTH NAMES ARE PINNED, because both were wrong in shipped documentation: three READMEs spell the event
// `sessionTelemetry/record`, which never fires, and the service's own doc comment claims the key is `telemetry`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { REDACT_EVENT, TELEMETRY_SERVICE, attachRedactionRule } from '../lib/telemetry.js'
import { redactPolicy, sanitizeJson } from '../lib/redact.js'

/** A context with the telemetry service present, recording what was registered. */
function fakeCtx({ present = true } = {}) {
  const listeners = new Map()
  const injected = []
  return {
    listeners,
    injected,
    inject(deps, callback) {
      injected.push(deps)
      if (!deps.includes(TELEMETRY_SERVICE)) return
      callback({ get: (key) => (key === TELEMETRY_SERVICE && present ? { emit() {} } : undefined) })
    },
    on(event, handler) {
      listeners.set(event, handler)
      return () => listeners.delete(event)
    },
  }
}

const RECORD = {
  channel: 'ops', time: 1, severity: 'info',
  attributes: { cwd: '/home/someone/private', api_key: 'sk-abcdefghijklmnop1234' },
  body: { note: 'the password is sk-abcdefghijklmnop1234' },
}

test('the event and service names are the installed ones, not the documented ones', () => {
  assert.equal(REDACT_EVENT, 'session-telemetry/record', 'kebab-case; the camelCase spelling never fires')
  assert.equal(TELEMETRY_SERVICE, 'sessionTelemetry', 'not the `telemetry` key the service doc comment claims')
})

// OPTIONAL INJECTION, not a hard dependency: under DSH_TELEMETRY_DISABLED there is no service, and a hard inject
// would leave the whole row PENDING -- running nothing, listeners included.
test('with no service there is no listener, and nothing throws', () => {
  const ctx = fakeCtx({ present: false })
  const dispose = attachRedactionRule(ctx, { scrub: () => RECORD, readEnabled: () => true })
  assert.equal(ctx.listeners.size, 0)
  assert.equal(typeof dispose, 'function')
  assert.doesNotThrow(() => dispose())
})

// THE WATERFALL STACKS. Calling next() first transforms every listener beneath; RETURNING WITHOUT IT REPLACES
// them, which is not ours to do on a seam we do not own.
test('the pass-through is called first, so every listener beneath stays intact', () => {
  const ctx = fakeCtx()
  let passed = 0
  attachRedactionRule(ctx, { scrub: () => RECORD, readEnabled: () => false })
  const handler = ctx.listeners.get(REDACT_EVENT)
  const carried = { ...RECORD, body: 'untouched' }
  const result = handler(RECORD, () => { passed += 1; return carried })
  assert.equal(passed, 1, 'next() was called')
  assert.equal(result, carried, 'and with the switch off the record is returned exactly as it came')
})

test('with the switch on the record is scrubbed, and the one handed over is NOT mutated', () => {
  const ctx = fakeCtx()
  attachRedactionRule(ctx, {
    readEnabled: () => true,
    scrub: (record) => sanitizeJson(record, redactPolicy({})),
  })
  const handler = ctx.listeners.get(REDACT_EVENT)
  const original = JSON.parse(JSON.stringify(RECORD))
  const result = handler(RECORD, () => RECORD)

  assert.doesNotMatch(JSON.stringify(result.body), /sk-abcdefghijklmnop1234/, 'a credential shape in the body')
  assert.equal(result.attributes.api_key, '[REDACTED]', 'and by KEY in the attributes')
  assert.equal(result.channel, 'ops', 'the record keeps its shape')
  assert.equal(result.severity, 'info')
  assert.deepEqual(RECORD, original, 'the coordinator deep-copies, and the contract forbids mutating it')
})

// FAIL-CLOSED IS THE SEAM'S CONTRACT, NOT OURS. A throw withholds that record and BLINDS the user's official
// telemetry -- so a scrubber that fails returns the record unchanged, and this plugin does not get to decide what
// a user's telemetry may contain.
test('a scrubber that throws returns the carried record unchanged', () => {
  const ctx = fakeCtx()
  attachRedactionRule(ctx, { readEnabled: () => true, scrub: () => { throw new Error('boom') } })
  const handler = ctx.listeners.get(REDACT_EVENT)
  const carried = { ...RECORD }
  assert.equal(handler(RECORD, () => carried), carried)
})

test('the switch is read PER RECORD, so a saved setting reaches a running row', () => {
  const ctx = fakeCtx()
  let enabled = false
  attachRedactionRule(ctx, { readEnabled: () => enabled, scrub: () => ({ ...RECORD, body: 'scrubbed' }) })
  const handler = ctx.listeners.get(REDACT_EVENT)
  assert.equal(handler(RECORD, () => RECORD).body.note, RECORD.body.note, 'off: untouched')
  enabled = true
  assert.equal(handler(RECORD, () => RECORD).body, 'scrubbed', 'on: the very next record')
})

test('the disposer takes the rule with it', () => {
  const ctx = fakeCtx()
  const dispose = attachRedactionRule(ctx, { scrub: () => RECORD, readEnabled: () => true })
  assert.equal(ctx.listeners.size, 1)
  dispose()
  assert.equal(ctx.listeners.size, 0)
})
