// THE INPUT SHAPE'S CONTRACT, AND THE BUILDER IS CHECKED AGAINST IT.
//
// WHY THIS TEST EXISTS. `ROADMAP.md` §14.8 step 1: the input shape is the thing TWO hosts build -- this repository's
// dsh builder and, one day, a pi builder -- and the plan is explicit that a shape two hosts build needs the same
// treatment the ROWS contract got, because the two producers of rows drifted (`F173`-`F180`: who spoke, the digest,
// the text, the NUL) and nothing caught them. A fixture is the answer, and the fixture is `contract.mjs`, vendored and
// digest-pinned.
//
// THE DIGEST IS OVER THE FILE NAME AS WELL AS ITS BYTES, so a renamed fixture is a different contract rather than the
// same one under another name.
//
// THE COMPARISON IS `deepStrictEqual` AND THAT IS THE POINT. The shape distinguishes a key that is ABSENT from a key
// that is PRESENT AND HOLDS NOTHING, and only a strict comparison tells the two apart -- a loose one would accept a
// builder that dropped every undefined-valued key, which is a shape that reads as a measurement and is not one.
//
// THE TWO HOST-OWNED VALUES ARE PROJECTED OUT, AND THE PROJECTION IS THE WHOLE OF THE HOST-SPECIFIC PART. The
// harness event a point attaches to is the harness's own fact, and the session-scope predicate is a FUNCTION; the
// fixture holds a placeholder for each and pins the predicate's ANSWERS case by case. Everything else -- every key,
// every group, every absence -- is compared exactly.
//
// AND THE TEETH ARE PROVEN ELSEWHERE, BY A GATE RATHER THAN BY A PARAGRAPH: `scripts/check-contract-teeth.mjs` mutates
// the shape AND the bridge, in a copy of the tree, and fails if any mutation leaves this contract green. That script
// is the other half of this file: the fixture says what the rules are, and the script says the fixture can see them
// break. **An independent review of the first version of this contract found SIX mutations that left it green**
// (`F193`), which is why the fixture has ten cases and not five, and why the script carries fourteen.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { instrumentInput } from '../core/instrument-input.js'
import { declaredAxes, instrumentShape, questionGroup, redactionGroup } from 'system1-measure/core/instrument-shape.js'
import { hostPoint } from '../dsh/host-events.js'
import { sessionObserved } from '../core/sessions.js'
import { isRecord } from 'system1-measure/core/is-record.js'
import { cases } from './fixtures/instrument-shape/contract.mjs'
import { FIXTURE_DIGEST as PACKAGED_DIGEST } from 'system1-measure/contract'

/** The vendored fixture, and the digest the contract computes for it. */
const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/instrument-shape')

/**
 * THE PINNED DIGEST, and it is over the file NAME as well as its bytes: a fixture that was renamed is a different
 * contract, and a digest over the content alone would not notice.
 */
const PINNED_DIGEST = 'a1a45d16ca9f645677fd07315d3af95f9499c20b32c1d7b2765087225c30299a'

const FIXTURE_FILES = ['fixture/contract.mjs']

/** The digest of a fixture held here, computed the way the contract computes it. */
const digestOf = (root) => {
    const hash = createHash('sha256')
    for (const file of FIXTURE_FILES) {
        hash.update(file)
        hash.update(readFileSync(join(root, file.split('/').pop())))
    }
    return hash.digest('hex')
}

/** The two placeholders the fixture uses for the values a HOST owns. */
const HOST_EVENT = '<host-event>'
const PREDICATE = '<predicate>'

/**
 * The built shape, with the two host-owned values replaced by the placeholders.
 *
 * NOTHING ELSE IS TOUCHED. Every key, every group and every absence survives, because the absence is the rule.
 */
const project = (built) => ({
    ...built,
    point: { ...built.point, hostEvent: HOST_EVENT },
    subjects: { observed: PREDICATE },
})

/** The two bindings a host supplies, and they are the dsh's. */
const DSH_BINDINGS = { describePoint: hostPoint, observed: sessionObserved }

/**
 * The options a case is read with. A case that names no transport is read with none, because the BRIDGE's default is
 * one of the rules the contract holds -- a caller that names nothing gets the service transport.
 */
const optionsOf = (one) => (one.transport === undefined
    ? { point: one.point }
    : { point: one.point, transport: one.transport })

test('THE VENDORED FIXTURE IS THE CONTRACT, and the digest says so', () => {
    assert.equal(digestOf(FIXTURE), PINNED_DIGEST,
        'the vendored fixture is not the one the contract pins; update it and the digest together')
    // AND THE PACKAGE PUBLISHES THE SAME NUMBER, because a second host reads THAT and not this file. The contract
    // now TRAVELS with the package -- it is published as `system1-measure/contract` -- and this copy is the vendor's,
    // so the two digests are the proof that one contract is being read from two places.
    assert.equal(PACKAGED_DIGEST, PINNED_DIGEST,
        'the digest the package publishes is not the one this repository vendored; a second host would be told a wrong number')
})

test('THE DSH BUILDER PRODUCES THE CONTRACT\'S SHAPE, case by case', () => {
    for (const one of cases) {
        const built = instrumentInput(one.config, optionsOf(one))
        assert.deepStrictEqual(project(built), one.expected, `the shape is wrong: ${one.name}`)
    }
})

test('THE PURE SHAPE REACHES THE SAME ANSWER WITH THE SAME BINDINGS', () => {
    // THE EXTRACTION CHANGED NOTHING. The shape was moved out of the bridge and the bridge now supplies the two
    // bindings, so the object the instrument reads is the same object -- and this is what says so.
    for (const one of cases) {
        const built = instrumentShape(one.config, { ...optionsOf(one), ...DSH_BINDINGS })
        assert.deepStrictEqual(project(built), one.expected, `the shape is wrong: ${one.name}`)
    }
})

test('AND A FOREIGN HOST BINDING CHANGES THE ONE VALUE IT OWNS, AND NOTHING ELSE', () => {
    // THE CLAIM THE EXTRACTION MAKES. A second host -- a pi extension -- binds the same two functions and gets the
    // same shape, with its OWN harness event where the dsh's would be. If the shape carried anything else host-
    // specific, this is where it would show.
    const foreign = { describePoint: (seam, enabled) => ({ id: seam, hostEvent: 'pi/turn', enabled }), observed: sessionObserved }
    for (const one of cases) {
        const built = instrumentShape(one.config, { ...optionsOf(one), ...foreign })
        assert.equal(built.point.hostEvent, 'pi/turn', 'the host owns the event name')
        assert.deepStrictEqual(project(built), one.expected, `the shape is wrong: ${one.name}`)
    }
})

test('THE SCOPE PREDICATE ANSWERS WHAT THE CONTRACT SAYS, case by case', () => {
    for (const one of cases) {
        const built = instrumentInput(one.config, optionsOf(one))
        assert.equal(typeof built.subjects.observed, 'function', `the scope is a predicate: ${one.name}`)
        for (const probe of one.scope) {
            assert.equal(built.subjects.observed(probe.agentId), probe.observed,
                `${one.name}: the scope answered wrongly for ${JSON.stringify(probe.agentId)}`)
        }
    }
})

test('THE HOST EVENT IS A NON-EMPTY STRING, because the trace writes it down', () => {
    // THE TYPE OF THE ONE HOST-SPECIFIC VALUE, which the fixture cannot hold: a placeholder says "a string is here",
    // not "a string is here and it says something".
    for (const one of cases) {
        const built = instrumentInput(one.config, optionsOf(one))
        assert.equal(typeof built.point.hostEvent, 'string', `the host event is a string: ${one.name}`)
        assert.notEqual(built.point.hostEvent, '', `the host event says something: ${one.name}`)
    }
})

/**
 * THE BINDING CONTRACT, said out loud, because the fixture can only show it through one binding's answers.
 *
 * THE TWO THINGS A SECOND HOST BINDS TO. `describePoint` is asked "which harness event does this point attach to, and
 * is this point switched on" and answers `{ id, hostEvent, enabled }` -- the id is the INSTRUMENT's vocabulary, the
 * event is the HOST's, and the switch is the row's. `observed` is asked "is this session in scope" and answers a
 * boolean. **AND THE CONFIG IT IS ASKED ABOUT IS THE NORMALISED ONE** -- a record, always, whatever the caller
 * passed -- because a host that received a non-record where the contract promises a record has been handed something
 * it cannot read.
 */
test('THE BINDINGS ARE CALLED WITH THE NORMALISED CONFIG AND THE CALLER\'S POINT', () => {
    const described = []
    const scoped = []
    const built = instrumentShape({ sessions: ['session-a'], seamEnabled: { request: false } }, {
        point: 'request',
        transport: 'wire',
        describePoint: (seam, enabled) => { described.push([seam, enabled]); return { id: seam, hostEvent: 'x/y', enabled } },
        observed: (config, agentId) => { scoped.push([config, agentId]); return true },
    })
    assert.equal(typeof built.subjects.observed, 'function')
    // THE PREDICATE IS CALLED TO ASK, so the binding is reached through it -- the shape hands the host a closure and
    // the host asks it later.
    assert.equal(built.subjects.observed('session-x'), true)

    // THE POINT, AND THE SWITCH FOR THAT POINT.
    assert.deepEqual(described, [['request', false]], 'the binding is asked about the point being built, and its switch')
    // AND THE CONFIG IS A RECORD, AND THE AGENT ID IS THE ONE ASKED ABOUT.
    assert.equal(scoped.length, 1)
    assert.equal(isRecord(scoped[0][0]), true, 'the scope binding is handed a record')
    assert.deepEqual(scoped[0][0].sessions, ['session-a'], 'and it is the config the caller passed')
    assert.equal(scoped[0][1], 'session-x', 'and the agent id it was asked about')
})

test('AND A CONFIG THAT IS NOT A RECORD IS NORMALISED BEFORE THE BINDING SEES IT', () => {
    // THE RULE THE FIXTURE CANNOT SHOW ALONE. A shape that handed the binding the RAW value would hand it something
    // that is not a record -- and a host that reads `config.sessions` off it would read a list the shape never
    // accepted.
    const scoped = []
    const built = instrumentShape('not a record', {
        point: 'draft',
        describePoint: (seam, enabled) => ({ id: seam, hostEvent: 'x/y', enabled }),
        observed: (config, agentId) => { scoped.push(config); return true },
    })
    built.subjects.observed('session-x')
    assert.equal(scoped.length, 1)
    assert.equal(isRecord(scoped[0]), true, 'the scope binding is handed a record even when the caller passed a string')
    assert.deepEqual(Object.keys(scoped[0]), [], 'and that record is empty, not the raw value')
})

test('A MISSING BINDING IS REFUSED BY NAME, and refused before anything is built', () => {
    // A SHAPE BUILT AGAINST A DEFAULT PREDICATE would answer "every session is in scope" for a host that meant to
    // scope it -- and a measurement that observes a conversation nobody scoped is not a measurement anybody can trust.
    assert.throws(() => instrumentShape({}, { point: 'draft', observed: sessionObserved }),
        /describePoint is required/)
    assert.throws(() => instrumentShape({}, { point: 'draft', describePoint: hostPoint }),
        /observed is required/)
})

/**
 * THE GROUPS NORMALISE THEIR OWN INPUT, because they are called with a RAW config as well as through the shape.
 *
 * `core/battery-tool.js`, `core/decide-tool.js` and `core/turn-trigger.js` call `questionGroup` with the row's own
 * config, which is NOT normalised by the shape -- so the guard inside it is load-bearing for them and not dead code.
 */
test('THE GROUPS ANSWER FOR A CONFIG THAT IS NOT A RECORD, because they are called with a raw one', () => {
    for (const group of [questionGroup, redactionGroup, declaredAxes]) {
        assert.deepEqual(group('not a record'), group({}), 'a group answers the same for a non-record as for an empty one')
    }
})

/**
 * THE FIXTURE PINS THE RULES, ONE CASE EACH, or it is decoration.
 *
 * A FIXTURE THAT DOES NOT COVER A RULE CANNOT CATCH ITS VIOLATION, and a fixture that agrees with the code is the
 * defect this repository has already paid for twice (`F187`, `F188`). **Each rule below names the case that pins
 * it**, so a rule the shape gains and the fixture does not is a rule this test cannot see -- which is why
 * `scripts/check-contract-teeth.mjs` is the other half: it enumerates the rules by MUTATING the code, and this test
 * enumerates them by SAYING them.
 */
test('THE FIXTURE PINS THE RULES, ONE CASE EACH, or it is decoration', () => {
    const find = (fragment) => {
        const found = cases.filter((one) => one.name.includes(fragment))
        assert.equal(found.length, 1, `exactly one case is named for "${fragment}": ${found.length} were`)
        return found[0]
    }

    // ABSENCE MEANS ON, and only an EXACT `false` means off. The value that discriminates a strict comparison from a
    // loose one is a ZERO -- `null` reads the same under both, because `null == false` is false in JavaScript.
    assert.equal(find('an empty row').expected.callsEnabled, true, 'absence means ON')
    assert.equal(find('the calls switch is OFF only').expected.callsEnabled, true, 'and a zero is ON')
    assert.equal(find('the calls off').expected.callsEnabled, false, 'and an explicit false is OFF')

    // THE PER-SEAM SWITCH IS CONSULTED FOR THE POINT BEING BUILT, AND IT IS OFF ONLY FOR AN EXACT `false`.
    assert.equal(find('one seam off').expected.point.enabled, false, 'the seam that is off is off')
    assert.equal(find('THE POINT BEING BUILT').expected.point.enabled, true, 'and another seam is not')
    assert.equal(find('the per-seam switch is OFF only').expected.point.enabled, true, 'and a zero switch is on')

    // AN UNDECLARED AXIS IS ABSENT, AND A DECLARED ONE IS TWELVE HEX CHARACTERS.
    assert.deepEqual(find('an empty row').expected.axes, {}, 'no axis is declared')
    assert.equal(Object.keys(find('hashes to nothing').expected.axes).length, 1, 'exactly one axis is declared')
    assert.equal(Object.keys(find('both axes declared').expected.axes).length, 2, 'both axes are declared')
    for (const one of cases) {
        for (const [axis, hash] of Object.entries(one.expected.axes)) {
            assert.match(hash, /^[0-9a-f]{12}$/, `${axis} is a twelve-character digest: ${one.name}`)
        }
    }

    // THE PROVIDER AND THE MODEL: `null` WHEN NOBODY SET THEM, AND THE VALUE WHEN SOMEONE DID.
    assert.equal(find('an empty row').expected.transport.provider, null, 'a provider nobody set is null')
    assert.equal(find('EMPTY STRING').expected.transport.provider, '', 'and an empty one stays an empty one')
    assert.equal(find('every group filled').expected.transport.provider, 'typesafe',
        'and a configured one is what was configured')

    // A CONFIG THAT IS NOT A RECORD IS ANSWERED, AND IT IS NORMALISED BEFORE THE BINDING SEES IT.
    assert.ok(find('NOT A RECORD'), 'a case whose config is not a record')
    const normalised = find('NORMALISED')
    assert.equal(normalised.scope.filter((probe) => probe.observed === true).length, normalised.scope.length,
        'and the binding sees the normalisation, so every session is in scope')

    // THE SCOPE ANSWERS FALSE SOMEWHERE, OR THE GATE IS NEVER EXERCISED.
    assert.ok(cases.some((one) => one.scope.some((probe) => probe.observed === false)),
        'a case where the scope refuses a session')
    assert.ok(cases.some((one) => one.scope.some((probe) => probe.observed === true)),
        'a case where the scope allows a session')

    // THE TWO GROUPS THAT CARRY THE SET LOCATION, because a set decides which questions exist at all.
    assert.ok(cases.some((one) => one.expected.questions.sets.dir !== undefined), 'a case with a set directory')
    assert.ok(cases.some((one) => one.expected.questions.sets.name !== undefined), 'a case with a set name')

    // AND THE BRIDGE SUPPLIES THE TRANSPORT DEFAULT.
    assert.equal(find('transport default').expected.transport.kind, 'service', 'the default is the service transport')
    assert.equal(find('transport default').transport, undefined, 'and the case names no transport of its own')
})
