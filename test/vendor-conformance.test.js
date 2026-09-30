// CONFORMANCE WITH THE VENDOR'S OWN BUILDERS.
//
// The provider tests use stubs, which proves our side of the contract but not that the vendor would accept it. The
// sibling implementation pins this at the TYPE level, which needs a compiler we do not have -- but the SDK also
// exports its builders as RUNTIME functions, so the same claim can be made with `deepEqual`.
//
// THIS FILE CAUGHT A REAL DEFECT UPSTREAM, and that is why it is worth its weight: a `score` question was being
// sent as a keyed map where the API requires an ordered array, and the stubbed unit tests had passed over it
// throughout. A paraphrase of the vendor's error message in a comment is a claim; a comparison against the
// vendor's own builder is a check.
//
// The SDK is a DEV dependency: it is not shipped, it is not imported by any runtime path, and when it is absent
// these tests SKIP LOUDLY rather than failing, so `npm test` keeps passing with runtime dependencies only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { choice, noul, score } from '../lib/model/questions.js'

let sdk
let sdkError
try {
    sdk = await import('@typesafe-ai/sdk')
}
catch (error) {
    sdkError = error
}

// LOUDLY: a silent skip is indistinguishable from a pass, and this is the one test that checks our shapes against
// the thing that will actually receive them.
if (sdkError !== undefined) {
    console.log(`SKIPPED: the vendor conformance checks need @typesafe-ai/sdk (${sdkError.message}).`)
    console.log('         Run `npm install` -- it is a dev dependency and is never shipped.')
}
const needsSdk = sdkError === undefined
    ? {}
    : { skip: `@typesafe-ai/sdk is not installed: ${sdkError.message}` }

test('our `noul` is the vendor’s on the wire, and cleaner off it', needsSdk, () => {
    const ours = noul('Is this urgent?')
    const theirs = sdk.noul('Is this urgent?')
    // WHAT ACTUALLY CROSSES THE WIRE is JSON, and there the two are identical.
    assert.deepEqual(JSON.parse(JSON.stringify(ours)), JSON.parse(JSON.stringify(theirs)))
    // OFF THE WIRE THEY DIFFER, and the difference is worth naming rather than smoothing over: the vendor leaves
    // an `undefined`-valued `criteria` key behind, and we omit the key. A field that exists and is `undefined` is
    // the shape this repository already calls out elsewhere -- it reads as a measurement and is not one -- and it
    // does not survive JSON anyway.
    assert.equal(Object.hasOwn(theirs, 'criteria'), true)
    assert.equal(theirs.criteria, undefined)
    assert.equal(Object.hasOwn(ours, 'criteria'), false, 'no key rather than a key with nothing in it')
})

test('a `noul` that carries criteria sends them as the vendor does', needsSdk, () => {
    // Both accept a criteria map, and both put it in the same place. The KEYS are the caller's -- ours validates
    // `true`/`false` when it builds one from config, and the vendor passes through whatever it is handed.
    assert.deepEqual(
        JSON.parse(JSON.stringify(noul('x', { true: 'yes', false: 'no' }))),
        JSON.parse(JSON.stringify(sdk.noul('x', { true: 'yes', false: 'no' }))),
    )
})

test('our `score` is an ordered array, and byte-for-byte the vendor’s', needsSdk, () => {
    const levels = ['none', 'some', 'severe']
    assert.deepEqual(score('How risky?', levels), sdk.score('How risky?', levels))
    assert.equal(Array.isArray(score('How risky?', levels).criteria), true, 'the API requires a list, not a map')
})

test('our `choice` criteria are the keyed descriptions the vendor expects', needsSdk, () => {
    const ours = choice('Which team?', [
        { label: 'billing', criterion: 'Payments' },
        { label: 'technical', criterion: 'Bugs' },
        { label: 'unclear', criterion: 'it cannot be told', abstain: true },
    ])
    const theirs = sdk.choice('Which team?', { billing: 'Payments', technical: 'Bugs', unclear: 'it cannot be told' })
    assert.equal(ours.type, theirs.type)
    assert.equal(ours.instructions, theirs.instructions)
    assert.deepEqual(ours.criteria, theirs.criteria)
    // THE ABSTAIN FLAG IS CONSUMED AT BUILD TIME AND MUST NOT BE RECORDED. `criteria` IS the wire map: an extra
    // key would arrive as another OPTION whose description is an object, which is a bigger defect than the one it
    // was trying to record. Our rule is enforced in the builder instead -- assert it below.
    for (const [label, description] of Object.entries(ours.criteria)) {
        assert.equal(typeof description, 'string', `${label}'s description must be a string on the wire`)
    }
})

// --- WHAT A VENDOR PIN CANNOT CATCH, asserted here so nobody mistakes the SDK for a guard ---------------------
test('the vendor’s RUNTIME builder accepts a degenerate scale, so our arity rule is ours', needsSdk, () => {
    // Measured: the vendor's runtime enforces no arity. Only its TypeScript tuple type does, and we have no
    // compiler -- so a conformance test pins the SHAPE and the arity has to be asserted separately.
    assert.deepEqual(sdk.score('q', ['only']).criteria, ['only'])
    assert.throws(() => score('q', ['only']), /at least two ordered levels/)
})

test('both implementations refuse a keyed map for a score, in their own words', needsSdk, () => {
    // The vendor's own message, quoted because our builder carries a paraphrase of it as its justification.
    assert.throws(() => sdk.score('x', { low: 'none' }), /must be a list of descriptions indexed by score from zero, not a map/)
    assert.throws(() => score('x', { low: 'none' }), /at least two ordered levels/)
})

test('the two rules this repository is proudest of have no vendor equivalent at all', needsSdk, () => {
    // The vendor's `ChoiceCriteria` is `{ [label: string]: Description }`: no arity, and no abstain concept. These
    // are OURS, and the conformance test asserts them as ours.
    assert.throws(() => choice('q', [{ label: 'a', criterion: 'A' }]), /at least two options/)
    assert.throws(() => choice('q', [{ label: 'a', criterion: 'A' }, { label: 'b', criterion: 'B' }]), /exactly one option must be the abstain option, found 0/)
    assert.throws(() => choice('q', [{ label: 'a', criterion: 'A', abstain: true }, { label: 'b', criterion: 'B', abstain: true }]), /found 2/)
    // And the vendor happily builds the same degenerate question, which is the point.
    assert.equal(sdk.choice('q', { a: 'A' }).criteria.a, 'A')
})
