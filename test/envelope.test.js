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
import { readFileSync, existsSync } from 'node:fs'
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

test('the transport projects through the shared list and keeps no private copy', () => {
  // The regression this file exists for: a second copy of the list. Asserted against the source because the defect
  // was structural -- the halves were each correct and disagreed with each other.
  //
  // THERE IS ONE HALF NOW. The assertion used to walk two files, and "BOTH" in its name was doing real work: a
  // private whitelist in either transport silently drops a field the other records. With the service gone there is
  // nothing to disagree WITH, so the guard that matters is that the remaining module imports the shared list rather
  // than declaring one -- which is what a second transport would have to fight, whenever it comes.
  const wire = readFileSync(new URL('../lib/model/client.js', import.meta.url), 'utf8')
  assert.match(wire, /from '\.\/envelope\.js'/, 'the transport must take the list from the shared module')
  assert.equal(/const ENVELOPE = \[/.test(wire), false, 'it must not keep its own copy of the list')
  assert.equal(existsSync(new URL('../lib/model/service.js', import.meta.url)), false, 'and there is no second transport left to keep a private copy of anything')
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

// MEASURED ON THE LIVE WIRE, 2026-10-18, after the service route was cut: `https://openrouter.ai/api/v1/systemone`
// answers `{model, answers, usage, id, provider}` -- no `executed`, no `routing`, no `requested`. The first call over
// the wire therefore recorded ANSWERS WITH NO PROVENANCE, because every consumer reads `envelope.executed` and the
// gateway never sends one. A trace that says a question was answered but not by what is the failure this repository
// treats as unrecordable, so the normalisation is pinned here against the shape the gateway really returns.
test('a gateway that names the revision at the top level still yields an `executed` to record', () => {
  const gateway = projectEnvelope({ model: 'typesafe/jev-1.14-20261014', answers: {}, usage: { total_tokens: 1 }, id: 'gen-1', provider: 'openrouter' })
  assert.deepEqual(gateway.executed, { model: 'typesafe/jev-1.14-20261014', provider: 'openrouter' })

  // AND A REPLY THAT ALREADY CARRIES ONE IS PASSED THROUGH UNTOUCHED -- the vendor's shape is not the one being
  // normalised into, and a synthesis that overwrote a real `executed` would be a worse lie than a missing one.
  const vendor = projectEnvelope({ executed: { provider: 'typesafe', model: 'jev-1.13' }, usage: {} })
  assert.deepEqual(vendor.executed, { provider: 'typesafe', model: 'jev-1.13' })

  // AND A GATEWAY THAT NAMES NO MODEL STILL INVENTS NOBODY. The envelope keeps the `provider` it was given --
  // recording what the reply said is the point -- but `executed` stays absent, because a revision cannot be read out
  // of a provider name. Inventing one would be worse than leaving it out.
  const bare = projectEnvelope({ answers: {}, provider: 'openrouter' })
  assert.equal(bare.provider, 'openrouter', 'what the reply said is still recorded')
  assert.equal(bare.executed, undefined, 'and no revision is invented from it')
  assert.equal(projectEnvelope({ answers: {} }), undefined)
})
