// THE RECORD'S OWN HONESTY POSTURE.
//
// The plugin's central claim is "it decides nothing", and before this it lived only in prose -- so a reader of a
// trace could not tell "structurally cannot act" from "acts, but this run happened not to". Flipping `verified`
// now requires deleting an assertion here, deliberately, which is the entire point.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  CAPABILITIES, ENFORCEMENT, FORBIDDEN_CAPABILITIES, FORBIDDEN_SURFACES, VERIFIED,
  assertCapabilities, capabilitiesIn, readDigest,
} from '../lib/honesty.js'

test('the posture is asserted, not described', () => {
  assert.equal(ENFORCEMENT, 'declarative', 'the code shape, not a sandbox and not a runtime gate')
  assert.equal(VERIFIED, false, 'nobody has observed the enforcement holding; this is the assertion that says so')
})

test('the declaration is internally consistent', () => {
  assert.deepEqual(assertCapabilities(), CAPABILITIES)
  assert.equal(CAPABILITIES.length, 6)
  for (const name of CAPABILITIES) assert.equal(FORBIDDEN_CAPABILITIES.includes(name), false, `${name} cannot be both`)
})

test('a capability outside the declaration, or inside the forbidden set, is refused by name', () => {
  assert.throws(() => assertCapabilities([...CAPABILITIES, 'context-prune']), /capability_forbidden: context-prune/)
  assert.throws(() => assertCapabilities([...CAPABILITIES, 'sell-the-user-s-short']), /capability_not_declared/)
  // THE CONTRADICTION IS IN THE CONSTANTS THEMSELVES: a name on the allow-list that is also forbidden cannot be
  // satisfied by any declaration, and picking a winner silently is how a declaration stops meaning anything.
  assert.throws(
    () => assertCapabilities(['read-seam-text'], ['register-tool'], CAPABILITIES),
    /capability_contradictory: register-tool/)
})

// THE DRIFT GUARD. "It decides nothing" is a claim about DECISIONS: it never answers an approval, never rewrites
// what a tool receives, never injects resident context, never prunes, never routes a model. The moment somebody
// adds one of those because it seemed useful, this fails on the line they added.
test('the plugin’s own source touches none of the forbidden surfaces', () => {
  for (const file of ['index.js', 'client.js']) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
    assert.deepEqual(capabilitiesIn(source), [], `${file} must not reach for a forbidden surface`)
  }
})

test('the surface scanner recognises each forbidden call it claims to', () => {
  assert.deepEqual(capabilitiesIn('ctx.systemPrompt.section({ name: "observer" })'), ['prompt-section'])
  assert.deepEqual(capabilitiesIn('ctx.tools.guard(rewrite)'), ['tool-argument-rewrite'])
  assert.deepEqual(capabilitiesIn('await child.approval.request(req)'), ['approval-answer'])
  assert.deepEqual(capabilitiesIn('ctx.compaction.compactNow(agent, signal)'), ['context-prune'])
  assert.deepEqual(capabilitiesIn('ctx.agentDefaultModel.saveSelection(next)'), ['model-route'])
  assert.deepEqual(capabilitiesIn('ctx.tools.register(definition)'), [], 'the tool it DOES register is allowed')
  assert.equal(FORBIDDEN_SURFACES.length, FORBIDDEN_CAPABILITIES.length, 'every forbidden name has a surface')
})

// A READ THAT COULD NOT SEE SOMETHING MUST NOT HASH LIKE ONE THAT SAW EVERYTHING AND FOUND NOTHING.
test('the read digest mixes in the skips, the tiers and the window', () => {
  const base = { scored: 10, full: 10, truncated: 0, unreadable: 0, skipped: { 'no text at this seam': 3 } }
  assert.equal(readDigest(base), readDigest({ ...base }), 'the same read, the same digest')
  assert.notEqual(readDigest(base), readDigest({ ...base, skipped: {} }), 'a skip appearing changes it')
  assert.notEqual(readDigest(base), readDigest({ ...base, scored: 0 }), 'so does losing every scored call')
  assert.notEqual(readDigest(base), readDigest({ ...base, full: 5, truncated: 5 }), 'and so does a tier shift')
  assert.notEqual(readDigest(base), readDigest({ ...base, windowTruncated: true }), 'and a partial window')
  assert.match(readDigest(base), /^[0-9a-f]{12}$/)
})
