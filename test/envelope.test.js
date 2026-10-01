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
