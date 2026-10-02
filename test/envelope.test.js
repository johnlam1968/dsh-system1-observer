// THE ENVELOPE BOUNDARY, AND THE DRIFT THAT PUT IT HERE.
//
// The finding this file answers was not "a field is missing" but "a field always reads null": the two
// transports kept their own copy of the whitelist, the service's copy lifted `requested` out of `meta`, and the
// wire's copy never listed it -- so `lib/observe.js`'s read of `envelope.requested` was dead by construction on
// one transport and populated on the other. A checker found it by reading the two lists side by side; the unit
// suite never could, because nothing drove a wire reply that carried `requested` to begin with.
//
// So these tests are about the shared list, and about the two transports actually using it -- which is the
// property that was violated, not the value of any one field.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ENVELOPE_KEYS, projectEnvelope } from '../lib/model/envelope.js'

test('every field the observer reads is in the shared list, `requested` included', () => {
  // The observer reads exactly these two from the envelope; `requested` is the one that was absent from the
  // wire's private copy, and it is asserted by name because its absence was silent rather than loud.
  assert.ok(ENVELOPE_KEYS.includes('executed'), 'the checkpoint that graded the subject')
  assert.ok(ENVELOPE_KEYS.includes('requested'), 'the alias that was asked for, which the wire could never carry')
  assert.ok(ENVELOPE_KEYS.includes('usage'), 'the cost, which lives nowhere else')
})

test('the projection copies listed fields and nothing else', () => {
  const projected = projectEnvelope({
    model: 'typesafe/jev-latest',
    usage: { inputTokens: 12 },
    routing: { via: 'laya' },
    executed: { provider: 'typesafe' },
    requested: { provider: 'typesafe', model: 'jev-latest' },
    // A server that grows a field must not start writing it into the trace.
    leaked: 'this must not cross',
  })
  assert.deepEqual(projected, {
    model: 'typesafe/jev-latest',
    usage: { inputTokens: 12 },
    routing: { via: 'laya' },
    executed: { provider: 'typesafe' },
    requested: { provider: 'typesafe', model: 'jev-latest' },
  })
})

test('a reply with no listed field has no envelope, rather than an empty one', () => {
  // `envelope: {}` would claim provenance was captured and empty; `undefined` says the transport said nothing,
  // which is what the reader renders as `null` and what a threshold measured against another server looks like.
  assert.equal(projectEnvelope({ answers: {} }), undefined)
  assert.equal(projectEnvelope(null), undefined)
  assert.equal(projectEnvelope([{ model: 'x' }]), undefined, 'an array is not a record')
})

test('BOTH transports project through the shared list, and neither keeps a private copy', () => {
  // The regression this file exists for: a second copy of the list. Asserted against the source because the
  // defect was structural -- the halves were each correct and disagreed with each other.
  const wire = readFileSync(new URL('../lib/model/client.js', import.meta.url), 'utf8')
  const service = readFileSync(new URL('../lib/model/service.js', import.meta.url), 'utf8')
  for (const [name, source] of [['client.js', wire], ['service.js', service]]) {
    assert.match(source, /from '\.\/envelope\.js'/, `${name} must take the list from the shared module`)
    assert.equal(/const ENVELOPE = \[/.test(source), false, `${name} must not keep its own copy of the list`)
  }
})

test('a WIRE reply that carries `requested` puts it in the envelope -- the list can be right while nothing reaches it', async () => {
  // The finding was a read that was dead on ONE transport: the wire's private whitelist omitted `requested`, so
  // `lib/observe.js` recorded `requested: null` beside a populated envelope. The tests above assert the list and
  // the source; this drives a real reply through the wire client, which is what the list is for.
  const { createModel } = await import('../lib/model/client.js')
  const model = createModel({
    baseUrl: 'http://127.0.0.1:1',
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        answers: {},
        requested: { provider: 'typesafe', model: 'jev-latest' },
        executed: { provider: 'typesafe', model: 'typesafe/jev-1.13-20260917' },
        usage: { inputTokens: 3 },
        routing: { via: 'laya' },
        leaked: 'a server that grows a field must not write it into the trace',
      }),
    }),
  })
  const result = await model.decide({ state: 'x', questions: {} })
  assert.equal(result.kind, 'answers', `expected answers, got ${JSON.stringify(result).slice(0, 120)}`)
  assert.deepEqual(result.envelope.requested, { provider: 'typesafe', model: 'jev-latest' },
    'the alias that was asked for must reach the envelope on the wire, not only through the service')
  assert.deepEqual(result.envelope.executed, { provider: 'typesafe', model: 'typesafe/jev-1.13-20260917' })
  assert.equal(result.envelope.leaked, undefined, 'and the whitelist still gates what crosses')
})
