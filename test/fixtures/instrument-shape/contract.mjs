// THE INPUT SHAPE'S CONTRACT, AS A FIXTURE.
//
// WHY A FIXTURE AND NOT A DOCUMENT. `ROADMAP.md` §14.8 step 1 says the input shape needs the same treatment the rows
// contract got, and the rows contract's treatment was a FIXTURE: vendored, digest-pinned, and stating what the
// producers must produce. The reason is measured rather than stylistic -- the two producers of rows drifted (`F173`-
// `F180`: who spoke, the digest, the text, the NUL) and nothing caught them, because a shape that two hosts build
// drifts the same way unless something SAYS what it must be. This repository's dsh builder and a future pi builder
// are exactly two producers of one shape.
//
// WHY IT IS A `.mjs` AND NOT JSON. The shape distinguishes a key that is ABSENT from a key that is PRESENT AND HOLDS
// NOTHING, and JSON cannot say the second: `JSON.parse` has no `undefined`, so a JSON fixture would need a sentinel
// string -- and a sentinel is a value the contract cannot rule out, which is how a contract starts lying. Here
// `undefined` is written out, and `assert.deepStrictEqual` tells absent from present-and-empty, which is the whole
// point of the rule the rows contract states as "absence is `null` and never `0`".
//
// AND THE FILE IS DATA, NOT A PROGRAM. Every value below is a literal, so the digest over this file's bytes pins the
// contract AND the values the test reads are the values the contract says. A fixture that computed its own expectation
// would agree with any implementation at all, which is the one thing a fixture must not do.
//
// TWO PLACEHOLDERS, AND BOTH ARE THE HOST'S TO FILL:
//   '<host-event>'  the harness event a point attaches to -- the host's own fact, and the only host-specific VALUE
//                    in the whole shape
//   '<predicate>'    the session-scope predicate -- a FUNCTION, and its answers are pinned case by case below
//
// A NOTE ON THE ELEVEN CASES, because the number is a measurement and not a preference. An INDEPENDENT REVIEW
// mutated the shape eleven ways and found SIX that left this contract GREEN -- the scope binding receiving the raw
// config, `||` for `??` on the provider, `!=` for `!==` on the calls switch, the per-seam switch read for a hardcoded
// point, the `isRecord` guard dropped, and the bridge's transport default dropped. **Each of those is now a case
// below**, and the review's own finding is `F193`. A contract that misses six of the rules it is about is the defect
// the rows fixture already was once (**F188**), and the fix is the same one: say more.
//
// **AND TWO OF THE REVIEW'S SUGGESTED CASES DID NOT HOLD, which is worth saying too.** A `null` calls switch was
// proposed to pin `!==` against `!=`, and it pins nothing: in JavaScript `null == false` is FALSE, so `null` reads the
// same under both forms. The value that discriminates is a ZERO. And the review's "the bridge's transport default is
// dropped" mutation survived because the shape carried a SECOND copy of that default -- two copies of one rule, which
// is the thing this repository keeps refusing. There is ONE default now, in the shape.

/** A config that is NOT a record, and carries a `sessions` list the normalisation must throw away. */
const NOT_A_RECORD = Object.assign([], { sessions: ['session-a'] })

/** The cases: a row's config, the firing it is read at, and the shape that must come out. */
export const cases = [
    {
        name: 'an empty row: absence means ON, an undeclared axis is ABSENT, and a provider nobody set is null',
        config: {},
        point: 'draft',
        transport: 'service',
        expected: {
            point: { id: 'draft', hostEvent: '<host-event>', enabled: true },
            callsEnabled: true,
            subjects: { observed: '<predicate>' },
            // BOTH AXES ABSENT. A label nobody declared is not an axis with an empty hash -- it is no axis.
            axes: {},
            questions: {
                questions: undefined, question: undefined, probeQuestion: undefined, maxQuestionChars: undefined,
                sets: { dir: undefined, name: undefined },
            },
            limits: { maxFieldChars: undefined, tailChars: undefined },
            redaction: { redactEnabled: undefined, redactKeys: undefined, pathMode: undefined, redactPatterns: undefined },
            // THE PROVIDER AND THE MODEL ARE `null`, NOT ABSENT. The wire asks for them by name, and a key that is
            // not there is a different answer from a key that says "nobody".
            transport: { kind: 'service', provider: null, model: null },
        },
        scope: [
            { agentId: 'session-anything', observed: true },
        ],
    },
    {
        name: 'a configured row: every group filled, both axes declared, the calls off, and one seam off',
        config: {
            callsEnabled: false,
            seamEnabled: { draft: false },
            harnessLabel: 'deepseek-v4',
            operatorLabel: 'alice',
            question: 'Does this look complete?',
            probeQuestion: 'Is this the operator?',
            maxQuestionChars: 200,
            questionSetsDir: '/srv/sets',
            questionSet: 'news-claim-check@2',
            maxFieldChars: 1000,
            tailChars: 200,
            redactEnabled: true,
            redactKeys: ['password'],
            pathMode: 'basename',
            redactPatterns: ['sk-[a-z]+'],
            provider: 'typesafe',
            model: 'jev-latest',
        },
        point: 'draft',
        transport: 'wire',
        expected: {
            point: { id: 'draft', hostEvent: '<host-event>', enabled: false },
            callsEnabled: false,
            subjects: { observed: '<predicate>' },
            // TWELVE HEX CHARACTERS, THE LENGTH `core/label-hash.js` KEEPS. The digests are written out rather than
            // computed, so a change to the hashing is a change to this contract and not a change to both sides at once.
            axes: { harnessHash: '65b9a5fcb6cb', userHash: '2bd806c97f0e' },
            questions: {
                questions: undefined, question: 'Does this look complete?', probeQuestion: 'Is this the operator?',
                maxQuestionChars: 200, sets: { dir: '/srv/sets', name: 'news-claim-check@2' },
            },
            limits: { maxFieldChars: 1000, tailChars: 200 },
            redaction: { redactEnabled: true, redactKeys: ['password'], pathMode: 'basename', redactPatterns: ['sk-[a-z]+'] },
            transport: { kind: 'wire', provider: 'typesafe', model: 'jev-latest' },
        },
        scope: [
            { agentId: 'session-anything', observed: true },
        ],
    },
    {
        name: 'a label that hashes to nothing leaves its axis ABSENT, and the other axis is still declared',
        config: { harnessLabel: '   ', operatorLabel: 'bob' },
        point: 'request',
        transport: 'service',
        expected: {
            point: { id: 'request', hostEvent: '<host-event>', enabled: true },
            callsEnabled: true,
            subjects: { observed: '<predicate>' },
            // ONE AXIS, NOT TWO. A whitespace label is a label nobody declared, and `{ harnessHash: '' }` would say
            // "a label was declared and it hashes to nothing" -- a different fact from "nothing was declared".
            axes: { userHash: '81b637d8fcd2' },
            questions: {
                questions: undefined, question: undefined, probeQuestion: undefined, maxQuestionChars: undefined,
                sets: { dir: undefined, name: undefined },
            },
            limits: { maxFieldChars: undefined, tailChars: undefined },
            redaction: { redactEnabled: undefined, redactKeys: undefined, pathMode: undefined, redactPatterns: undefined },
            transport: { kind: 'service', provider: null, model: null },
        },
        scope: [
            { agentId: 'session-anything', observed: true },
        ],
    },
    {
        name: 'the session scope is a PREFIX list, and a firing that cannot be attributed is not observed',
        config: { sessions: ['session-a'] },
        point: 'admit',
        transport: 'service',
        expected: {
            point: { id: 'admit', hostEvent: '<host-event>', enabled: true },
            callsEnabled: true,
            subjects: { observed: '<predicate>' },
            axes: {},
            questions: {
                questions: undefined, question: undefined, probeQuestion: undefined, maxQuestionChars: undefined,
                sets: { dir: undefined, name: undefined },
            },
            limits: { maxFieldChars: undefined, tailChars: undefined },
            redaction: { redactEnabled: undefined, redactKeys: undefined, pathMode: undefined, redactPatterns: undefined },
            transport: { kind: 'service', provider: null, model: null },
        },
        // FOUR ANSWERS, AND THEY ARE FOUR DIFFERENT FACTS. The list is a PREFIX list, so a longer id still matches;
        // another session does not; and a firing with no agent id is not observed at all -- a scope that fails OPEN
        // would observe a conversation nobody pointed it at, and the whole point of the gate is that it does not.
        scope: [
            { agentId: 'session-a', observed: true },
            { agentId: 'session-abcdef', observed: true },
            { agentId: 'session-b', observed: false },
            { agentId: '', observed: false },
        ],
    },
    {
        name: 'a config that is NOT A RECORD is answered, not thrown at',
        // `null` AND NOT A STRING, and the difference is the point: a string's properties read as `undefined` and the
        // shape comes out the same, so a string would NOT catch the `isRecord` guard being dropped. `null` does --
        // without the guard, `source.callsEnabled` throws.
        config: null,
        point: 'close',
        transport: 'service',
        expected: {
            point: { id: 'close', hostEvent: '<host-event>', enabled: true },
            callsEnabled: true,
            subjects: { observed: '<predicate>' },
            axes: {},
            questions: {
                questions: undefined, question: undefined, probeQuestion: undefined, maxQuestionChars: undefined,
                sets: { dir: undefined, name: undefined },
            },
            limits: { maxFieldChars: undefined, tailChars: undefined },
            redaction: { redactEnabled: undefined, redactKeys: undefined, pathMode: undefined, redactPatterns: undefined },
            transport: { kind: 'service', provider: null, model: null },
        },
        scope: [
            { agentId: 'session-anything', observed: true },
        ],
    },
    {
        name: 'a config that is not a record is NORMALISED, and the binding sees the normalisation -- not the raw value',
        // THE DISCRIMINATING CASE FOR "WHICH CONFIG REACHES THE BINDING". This value carries a `sessions` list, and
        // the shape replaces it with `{}` -- so the scope binding is asked about an EMPTY config and answers "every
        // session is in scope". A shape that handed the binding the RAW value would answer "only session-a", and the
        // 'session-b' answer below is the one that tells the two apart.
        config: NOT_A_RECORD,
        point: 'admit',
        transport: 'service',
        expected: {
            point: { id: 'admit', hostEvent: '<host-event>', enabled: true },
            callsEnabled: true,
            subjects: { observed: '<predicate>' },
            axes: {},
            questions: {
                questions: undefined, question: undefined, probeQuestion: undefined, maxQuestionChars: undefined,
                sets: { dir: undefined, name: undefined },
            },
            limits: { maxFieldChars: undefined, tailChars: undefined },
            redaction: { redactEnabled: undefined, redactKeys: undefined, pathMode: undefined, redactPatterns: undefined },
            transport: { kind: 'service', provider: null, model: null },
        },
        scope: [
            { agentId: 'session-a', observed: true },
            { agentId: 'session-b', observed: true },
        ],
    },
    {
        name: 'the calls switch is OFF only for an exact `false`, so a zero is ON',
        // `0 !== false` AND `0 != false` DISAGREE, and the disagreement is the whole rule: the loose form would
        // switch the observer OFF for a config that never said off, which is the failure `core/seams.js` warns about.
        // **THE ZERO IS THE VALUE THAT DISCRIMINATES, and not a `null`** -- in JavaScript `null == false` is FALSE
        // (only `null == undefined` is true), so `null` reads the same under both forms and pins nothing. An
        // independent review proposed a `null` case and it proved nothing; this is the case that holds the line.
        config: { callsEnabled: 0 },
        point: 'draft',
        transport: 'service',
        expected: {
            point: { id: 'draft', hostEvent: '<host-event>', enabled: true },
            callsEnabled: true,
            subjects: { observed: '<predicate>' },
            axes: {},
            questions: {
                questions: undefined, question: undefined, probeQuestion: undefined, maxQuestionChars: undefined,
                sets: { dir: undefined, name: undefined },
            },
            limits: { maxFieldChars: undefined, tailChars: undefined },
            redaction: { redactEnabled: undefined, redactKeys: undefined, pathMode: undefined, redactPatterns: undefined },
            transport: { kind: 'service', provider: null, model: null },
        },
        scope: [
            { agentId: 'session-anything', observed: true },
        ],
    },
    {
        name: 'the per-seam switch is OFF only for an exact `false`, so a zero is ON',
        // THE SAME RULE, ON THE OTHER SWITCH. `seamCallsEnabled` reads `switches[seam] !== false`, and the loose form
        // would turn a seam off for a switch nobody turned off.
        config: { seamEnabled: { draft: 0 } },
        point: 'draft',
        transport: 'service',
        expected: {
            point: { id: 'draft', hostEvent: '<host-event>', enabled: true },
            callsEnabled: true,
            subjects: { observed: '<predicate>' },
            axes: {},
            questions: {
                questions: undefined, question: undefined, probeQuestion: undefined, maxQuestionChars: undefined,
                sets: { dir: undefined, name: undefined },
            },
            limits: { maxFieldChars: undefined, tailChars: undefined },
            redaction: { redactEnabled: undefined, redactKeys: undefined, pathMode: undefined, redactPatterns: undefined },
            transport: { kind: 'service', provider: null, model: null },
        },
        scope: [
            { agentId: 'session-anything', observed: true },
        ],
    },
    {
        name: 'a provider that is the EMPTY STRING is present and holding something, so it stays an empty string',
        // `??` AND NOT `||`. The findings register already refuted the claim that `?? null` collapses `0`, `false` and
        // `''` into absent (`R9`) -- it does not -- so the contract holds the line the register holds.
        config: { provider: '', model: '' },
        point: 'draft',
        transport: 'service',
        expected: {
            point: { id: 'draft', hostEvent: '<host-event>', enabled: true },
            callsEnabled: true,
            subjects: { observed: '<predicate>' },
            axes: {},
            questions: {
                questions: undefined, question: undefined, probeQuestion: undefined, maxQuestionChars: undefined,
                sets: { dir: undefined, name: undefined },
            },
            limits: { maxFieldChars: undefined, tailChars: undefined },
            redaction: { redactEnabled: undefined, redactKeys: undefined, pathMode: undefined, redactPatterns: undefined },
            transport: { kind: 'service', provider: '', model: '' },
        },
        scope: [
            { agentId: 'session-anything', observed: true },
        ],
    },
    {
        name: 'the per-seam switch is consulted for THE POINT BEING BUILT, not for a hardcoded one',
        // THE SWITCH BELOW IS OFF FOR `draft`, AND THIS CASE IS READ AT `request` -- so the seam asked about is the
        // one the firing is at, and a shape that read the map for a hardcoded point would answer false here.
        config: { seamEnabled: { draft: false } },
        point: 'request',
        transport: 'service',
        expected: {
            point: { id: 'request', hostEvent: '<host-event>', enabled: true },
            callsEnabled: true,
            subjects: { observed: '<predicate>' },
            axes: {},
            questions: {
                questions: undefined, question: undefined, probeQuestion: undefined, maxQuestionChars: undefined,
                sets: { dir: undefined, name: undefined },
            },
            limits: { maxFieldChars: undefined, tailChars: undefined },
            redaction: { redactEnabled: undefined, redactKeys: undefined, pathMode: undefined, redactPatterns: undefined },
            transport: { kind: 'service', provider: null, model: null },
        },
        scope: [
            { agentId: 'session-anything', observed: true },
        ],
    },
    {
        name: 'the transport defaults to the service transport, so a caller that names none gets it',
        // THE CASE NAMES NO TRANSPORT, and the shape's own default answers. The default lives in the SHAPE -- the two
        // kinds are the instrument's vocabulary -- and the bridge forwards, so there is ONE place that decides it.
        config: {},
        point: 'draft',
        expected: {
            point: { id: 'draft', hostEvent: '<host-event>', enabled: true },
            callsEnabled: true,
            subjects: { observed: '<predicate>' },
            axes: {},
            questions: {
                questions: undefined, question: undefined, probeQuestion: undefined, maxQuestionChars: undefined,
                sets: { dir: undefined, name: undefined },
            },
            limits: { maxFieldChars: undefined, tailChars: undefined },
            redaction: { redactEnabled: undefined, redactKeys: undefined, pathMode: undefined, redactPatterns: undefined },
            transport: { kind: 'service', provider: null, model: null },
        },
        scope: [
            { agentId: 'session-anything', observed: true },
        ],
    },
]
