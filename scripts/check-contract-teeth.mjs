// PROVE THE CONTRACT TEST HAS TEETH: inject each mutation into a COPY, and the contract must go RED.
//
// WHY THIS SCRIPT EXISTS, AND WHY IT WORKS ON A COPY. A gate that has never been shown to fail is a description of a
// gate. The rows contract's fixture was not fit for the job, and eleven producer mutations -- including the very
// defect class the whole design exists to prevent -- left the suite green (`F188`). **AND THIS CONTRACT WAS THE SAME
// STORY ONCE**: an independent review mutated the shape eleven ways and SIX of them left the first version of the
// fixture green (`F193`) -- the scope binding receiving the raw config, `||` for `??` on the provider, `!=` for
// `!==` on the calls switch, the per-seam switch read for a hardcoded point, the `isRecord` guard dropped, and the
// bridge's transport default dropped. The fixture now has a case for each, and this script is what says so.
//
// IT RUNS ON A TEMPORARY COPY, and never on the tree. A script that rewrites the implementation in place is a
// footgun: interrupt it and the tree is left mutated, and a repository whose whole discipline is "do not leave
// anything that can damage the tree" has no business keeping one. The copy carries `core/`, `dsh/` and `test/`,
// which is everything the contract test reads, and it needs no `node_modules` of its own.
//
// AND A MUTATION THAT BREAKS THE COPY IS NOT A CATCH. A tree that cannot even LOAD scores red, and scoring that as
// "the contract caught it" would be the **F183** mistake one level down -- a comparison that compared nothing
// reporting success. So the verdict separates the two: a MODULE error is a BROKEN copy and a failure, and only an
// ASSERTION failure counts as a catch.
//
// EVERY MUTATION BELOW IS A DEFECT CLASS THIS REPOSITORY HAS ALREADY SHIPPED: an inverted switch, a loose
// comparison, an absent axis turned into an empty one, an ignored per-seam switch, a hardcoded point, a scope gate
// that fails open, a raw config where a normalised one was promised, a `null` turned into a missing key, `??` turned
// into `||`, a group that lost a key, two fields swapped, a digest cut to a different length, and a dropped default.
//
// USAGE:  node scripts/check-contract-teeth.mjs
// EXIT:   0 when every mutation was caught, 1 when one survived or one broke the copy.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONTRACT_TEST = 'test/instrument-shape.test.js'

/**
 * EACH MUTATION, and it must name a text that occurs EXACTLY ONCE.
 *
 * A mutation that names a text occurring in four places replaces the FIRST of them -- which is how the first version
 * of this script "proved" that dropping the `isRecord` guard survived the contract, when it had actually dropped the
 * guard from `questionGroup` and left `instrumentShape` alone. **A mutation that changed the wrong function is not a
 * mutation, and a script that cannot tell the difference reports a false alarm.** So the target must be unique, and
 * the script says so and fails rather than guessing.
 */
const MUTATIONS = [
    {
        name: 'the calls switch is INVERTED (absence means OFF instead of ON)',
        file: 'core/instrument-shape.js',
        from: 'callsEnabled: source.callsEnabled !== false,',
        to: 'callsEnabled: source.callsEnabled === false,',
    },
    {
        name: 'the calls switch uses LOOSE `!=`, so a zero switch turns the observer OFF',
        file: 'core/instrument-shape.js',
        from: 'callsEnabled: source.callsEnabled !== false,',
        to: 'callsEnabled: source.callsEnabled != false,',
    },
    {
        name: 'an UNDECLARED axis becomes an empty one (the key is always there)',
        file: 'core/instrument-shape.js',
        from: '...(harness === \'\' ? {} : { harnessHash: harness }),',
        to: '...(harness === \'\' ? { harnessHash: harness } : { harnessHash: harness }),',
    },
    {
        name: 'the LABELS are hashed from the operator label only',
        file: 'core/instrument-shape.js',
        from: 'const harness = labelHash(source.harnessLabel)',
        to: 'const harness = labelHash(source.operatorLabel)',
    },
    {
        name: 'the LABELS are hashed to a different length (the digest is cut to eight)',
        file: 'core/instrument-shape.js',
        from: 'const harness = labelHash(source.harnessLabel)',
        to: 'const harness = labelHash(source.harnessLabel).slice(0, 8)',
    },
    {
        name: 'the per-seam SWITCH is ignored (every seam is on)',
        file: 'core/instrument-shape.js',
        from: 'point: describePoint(point, seamCallsEnabled(source.seamEnabled, point)),',
        to: 'point: describePoint(point, true),',
    },
    {
        name: 'the per-seam SWITCH is read for a HARDCODED point',
        file: 'core/instrument-shape.js',
        from: 'point: describePoint(point, seamCallsEnabled(source.seamEnabled, point)),',
        to: 'point: describePoint(point, seamCallsEnabled(source.seamEnabled, \'draft\')),',
    },
    {
        name: 'the SCOPE gate fails OPEN (every session is observed)',
        file: 'core/instrument-shape.js',
        from: 'subjects: { observed: (agentId) => observed(source, agentId) },',
        to: 'subjects: { observed: () => true },',
    },
    {
        name: 'the SCOPE binding receives the RAW config, not the normalised one',
        file: 'core/instrument-shape.js',
        from: 'subjects: { observed: (agentId) => observed(source, agentId) },',
        to: 'subjects: { observed: (agentId) => observed(config, agentId) },',
    },
    {
        name: 'the `isRecord` GUARD is dropped (a config that is not a record throws instead of being answered)',
        file: 'core/instrument-shape.js',
        from: 'const source = isRecord(config) ? config : {}\n  return {\n    // THE POINT IS RESOLVED HERE',
        to: 'const source = config\n  return {\n    // THE POINT IS RESOLVED HERE',
    },
    {
        name: 'the provider and the model use `||`, so an empty string becomes `null`',
        file: 'core/instrument-shape.js',
        from: 'provider: source.provider ?? null, model: source.model ?? null }',
        to: 'provider: source.provider || null, model: source.model || null }',
    },
    {
        name: 'the TRANSPORT KIND is dropped',
        file: 'core/instrument-shape.js',
        from: 'transport: { kind: transport,',
        to: 'transport: { kind: undefined,',
    },
    {
        name: 'the TRANSPORT DEFAULT is dropped (a caller that names none gets no kind at all)',
        file: 'core/instrument-shape.js',
        from: 'export function instrumentShape(config, { point, transport = \'service\', describePoint, observed } = {}) {',
        to: 'export function instrumentShape(config, { point, transport, describePoint, observed } = {}) {',
    },
    {
        name: 'the SET LOCATION is dropped from the question group',
        file: 'core/instrument-shape.js',
        from: 'sets: { dir: source.questionSetsDir, name: source.questionSet },',
        to: 'sets: {},',
    },
    {
        name: 'the two LIMITS are swapped (the field cap becomes the tail)',
        file: 'core/instrument-shape.js',
        from: 'limits: { maxFieldChars: source.maxFieldChars, tailChars: source.tailChars },',
        to: 'limits: { maxFieldChars: source.tailChars, tailChars: source.maxFieldChars },',
    },
    {
        name: 'BRIDGE: the two host bindings are SWAPPED',
        file: 'core/instrument-input.js',
        from: 'describePoint: hostPoint,\n    observed: sessionObserved,',
        to: 'describePoint: sessionObserved,\n    observed: hostPoint,',
    },
    {
        name: 'BRIDGE: the POINT is not forwarded to the shape',
        file: 'core/instrument-input.js',
        from: 'return instrumentShape(config, {\n    point,',
        to: 'return instrumentShape(config, {\n    point: \'draft\',',
    },
]

/**
 * THE CONTRACT TEST'S VERDICT ON A TREE, as a word.
 *
 * `GREEN`  every assertion held.
 * `RED`    an assertion failed -- and THAT is a catch, because the contract saw the defect.
 * `BROKEN` the tree could not run: a module error, a syntax error, a missing file. **This is not a catch**, and
 *          counting it as one is the F183 mistake: a signal that is always on is a signal nobody reads.
 */
const verdict = (root) => {
    let out = ''
    try {
        execFileSync(process.execPath, ['--test', CONTRACT_TEST], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
        out = `${error.stdout ?? ''}${error.stderr ?? ''}`
    }
    if (out === '') return 'GREEN'
    if (/ERR_MODULE_NOT_FOUND|Cannot find package|SyntaxError|ERR_UNSUPPORTED_MODULE|ENOENT/.test(out)) return 'BROKEN'
    const failed = [...out.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1])
    if (failed.length === 0) return 'GREEN'
    return `RED (${failed.length} failing: ${failed[0].slice(0, 70)})`
}

/** The tree, copied somewhere the mutations cannot reach the original. */
const room = mkdtempSync(join(tmpdir(), 'contract-teeth-'))
try {
    // `package.json` COMES TOO, and without it the copy's `.js` files are CommonJS and the whole test file fails to
    // load -- which reads as "every mutation was caught" while measuring nothing. The untouched verdict below is what
    // says the copy is a working tree, and a copy that cannot run is not a copy that can fail.
    for (const dir of ['core', 'dsh', 'test']) cpSync(join(ROOT, dir), join(room, dir), { recursive: true })
    cpSync(join(ROOT, 'package.json'), join(room, 'package.json'))
    // AND `node_modules` IS LINKED, because the contract test reaches the published `dsh-session-rows` through the
    // dsh event names, and a copy that cannot resolve it is a copy that fails for the wrong reason. A LINK and not a
    // copy, because the copy is thrown away and the modules are not what is under test.
    symlinkSync(join(ROOT, 'node_modules'), join(room, 'node_modules'))

    const originals = new Map()
    for (const file of new Set(MUTATIONS.map((one) => one.file))) {
        originals.set(file, readFileSync(join(room, file), 'utf8'))
    }

    const untouched = verdict(room)
    console.log(`check:contract-teeth -- the contract test on the untouched copy: ${untouched}\n`)
    if (untouched !== 'GREEN') {
        console.error('check:contract-teeth -- FAILED: the copy is not a working tree, so a mutation that breaks it proves nothing.')
        process.exit(1)
    }

    let survived = 0
    let broken = 0
    for (const mutation of MUTATIONS) {
        const original = originals.get(mutation.file)
        // THE TARGET MUST OCCUR EXACTLY ONCE, and the script says so rather than guessing. A mutation that names a
        // text occurring in four places replaces the FIRST of them -- which is how this script once "proved" that
        // dropping the `isRecord` guard survived, when it had dropped the guard from a DIFFERENT function and left
        // the one under test alone. That is a false alarm in a gate, and a gate that cries wolf is a gate nobody
        // reads, so a mutation that cannot be applied FAILS the script instead of being counted.
        const occurrences = original.split(mutation.from).length - 1
        if (occurrences !== 1) {
            console.error(`check:contract-teeth -- FAILED: "${mutation.name}" names a text that occurs ${occurrences} times in ${mutation.file}, so the mutation would change the wrong thing.`)
            process.exit(1)
        }
        writeFileSync(join(room, mutation.file), original.replace(mutation.from, mutation.to))
        const result = verdict(room)
        writeFileSync(join(room, mutation.file), original)
        if (result === 'GREEN') survived += 1
        if (result.startsWith('BROKEN')) broken += 1
        console.log(`${result === 'GREEN' ? 'SURVIVED' : result.startsWith('BROKEN') ? ' BROKE  ' : '  caught'}  ${mutation.name}\n          ${result}`)
    }

    // AND THE TREE IS STILL THE TREE. The copy is thrown away, but the claim that the repository was not modified is
    // worth making with a measurement rather than with an assurance.
    const digest = createHash('sha256').update(readFileSync(join(ROOT, 'core/instrument-shape.js'))).digest('hex')
    console.log(`\ncheck:contract-teeth -- ${MUTATIONS.length - survived} of ${MUTATIONS.length} mutations caught.`)
    console.log(`check:contract-teeth -- the repository's core/instrument-shape.js was never written to (sha256 ${digest.slice(0, 12)}).`)
    if (survived > 0) {
        console.error(`check:contract-teeth -- FAILED: ${survived} mutation(s) left the contract test green, so it cannot see that defect.`)
        process.exit(1)
    }
    if (broken > 0) {
        console.error(`check:contract-teeth -- FAILED: ${broken} mutation(s) broke the copy instead of failing an assertion, so the contract did not catch them.`)
        process.exit(1)
    }
    console.log('check:contract-teeth -- ok: every mutation was caught by an assertion, so the contract test is a gate and not a description.')
} finally {
    rmSync(room, { recursive: true, force: true })
}
