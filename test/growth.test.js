// BLOAT IS NOT A LANGUAGE PROPERTY. It is what happens when ADDITION is invisible and DELETION is expensive.
//
// Every other gate in this repo makes an addition DECLARE itself: a host call, a lib file, a tool name, a `docs/...`
// path. None of them says anything about SIZE or about RETIREMENT -- so a file can double across commits and no gate
// notices, and a file whose own header says "this should be deleted" can sit there for months because nothing is
// waiting on it. Both gaps are checked here, and neither check is a style rule:
//
//   SIZE is ATTRIBUTION. A file may be large, but its size must be a decision somebody recorded, with a reason. An
//   exemption that is no longer needed FAILS, so shrinking a file retires its paperwork rather than leaving it
//   behind. A budget is signed; a lint rule is argued with.
//
//   RETIREMENT is a WAITING LIST that cannot go quiet. A file may be kept, but if its header nominates it for
//   deletion then `lib/README.md` must carry the condition that retires it -- so "we will delete this once X" is a
//   fact in the map rather than a sentence in a comment nobody re-reads.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Ordinary files may not pass this without a declared exemption. */
const LIB_CEILING = 400
/** Test files carry cases rather than branching, so their ceiling is higher. */
const TEST_CEILING = 700

/**
 * Files allowed past the ceiling, each with the reason its size is a decision rather than an accumulation, and the
 * count it may not exceed. RAISING a `max` is the deliberate act this file exists to force; SHRINKING a file below
 * its ceiling must remove the entry, and the test says so.
 */
const SIZE_EXEMPTIONS = {
    'lib/evaluate-tool.js': {
        max: 615,
        reason: 'one tool end to end: parameters, session resolution, evidence-group selection, segmentation, the '
            + 'judge call, aggregation and render. Splitting it by size would separate the tool contract from the '
            + 'behaviour that honours it; the split worth making is by LIFECYCLE (resolve, select, judge, aggregate), '
            + 'and it should be made when a fourth selection mode appears, not before.',
    },
    'lib/results-tool.js': {
        max: 588,
        reason: 'four actions over one trace, each with its own selection and render. The ACTIONS are the seam, so a '
            + 'split by action is the one to make -- when a fifth action appears, not by size now.',
    },
    'lib/report.js': {
        max: 455,
        reason: 'a measurement package is ONE artifact whose files must agree: skeleton, numbers, interpretation, '
            + 'manifest and the reproducible-file list. Splitting it invites the parts to disagree about the same '
            + 'measurement, which is the defect the package exists to prevent.',
    },
    'lib/sessions-tool.js': {
        max: 422,
        reason: 'the agent-facing sessions tool: three actions (`list`, `read`, `search`), one declared schema, one '
            + 'render and the refusals they share. The ACTIONS are the seam, so a split BY ACTION is the one to make '
            + 'when a fourth action arrives, not by size now. It crossed the ceiling when `list` began reporting the '
            + 'OBSERVE ALLOW-LIST -- the fact that decides WHICH session is measured at all, and the one an agent '
            + 'cannot otherwise see.',
    },
    'test/client-card.test.js': {
        max: 1752,
        reason: 'the settings card enumerated: every seam, every host-schema shape, save, refusal and error path. It '
            + 'grows in CASES rather than branching, and cases are what a card is made of. Split by host-schema shape '
            + 'if it passes 2,000, because that is the first genuine seam in it.',
    },
}

/** Every `.js` file under `dir`, recursively, relative to the repository root. */
function filesUnder(dir) {
    return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
        const rel = `${dir}/${entry.name}`
        if (entry.isDirectory()) return filesUnder(rel)
        return entry.isFile() && entry.name.endsWith('.js') ? [rel] : []
    })
}

/** Lines, counted the way `wc -l` counts them, so a budget here matches what a reader sees in a terminal. */
function linesOf(rel) {
    return (readFileSync(join(ROOT, rel), 'utf8').match(/\n/g) || []).length
}

test('every file over the ceiling is a declared size decision, and no declaration is stale', () => {
    const grown = []
    for (const [dir, ceiling] of [['lib', LIB_CEILING], ['test', TEST_CEILING]]) {
        for (const rel of filesUnder(dir)) {
            const lines = linesOf(rel)
            const declared = SIZE_EXEMPTIONS[rel]
            if (declared === undefined) {
                if (lines > ceiling) grown.push(`${rel} is ${lines} lines (ceiling ${ceiling})`)
                continue
            }
            assert.ok(declared.reason.length > 40, `${rel} is exempt without a reason worth reading`)
            assert.ok(
                lines <= declared.max,
                `${rel} is ${lines} lines and its declared budget is ${declared.max}. Shrink it, or raise \`max\` in `
                + 'SIZE_EXEMPTIONS with the reason -- a budget only works if raising it is a decision.',
            )
        }
    }
    assert.deepEqual(grown, [], `over the ceiling with no declared reason: ${grown.join('; ')}`)
})

test('an exemption whose file is at or under the ceiling is paperwork that must be removed', () => {
    const stale = []
    for (const rel of Object.keys(SIZE_EXEMPTIONS)) {
        const ceiling = rel.startsWith('test/') ? TEST_CEILING : LIB_CEILING
        if (linesOf(rel) <= ceiling) stale.push(`${rel} is ${linesOf(rel)} lines, at or under ${ceiling}`)
    }
    assert.deepEqual(stale, [], `retire these exemptions: ${stale.join('; ')}`)
})

test('a file whose header nominates it for deletion is on the map\'s retirement list, with its condition', () => {
    const NOMINATES = /should be deleted|are the ones to delete|nominated for deletion/i
    const doc = readFileSync(join(ROOT, 'lib/README.md'), 'utf8')
    const section = doc.split('## Nominated for retirement')[1]
    assert.ok(section !== undefined, 'lib/README.md has no `## Nominated for retirement` section')
    // The map writes paths relative to `lib/`; the scan returns them relative to the repository root.
    const listed = [...section.matchAll(/^\| `([^`]+)` \| ([^|]+) \|/gm)]
        .map((m) => [m[1].startsWith('lib/') ? m[1] : `lib/${m[1]}`, m[2].trim()])

    const nominating = filesUnder('lib').filter((rel) => NOMINATES.test(readFileSync(join(ROOT, rel), 'utf8')))

    const missing = nominating.filter((rel) => !listed.some(([f]) => f === rel))
    assert.deepEqual(missing, [], `these nominate themselves for deletion but are not on the retirement list: ${missing.join(', ')}`)

    const phantom = listed.filter(([f]) => !nominating.includes(f))
    assert.deepEqual(phantom.map(([f]) => f), [], 'the retirement list names files that no longer nominate themselves -- delete the row')

    for (const [file, condition] of listed) {
        assert.ok(condition.length > 20, `${file} is on the retirement list without a condition that retires it`)
        assert.ok(!/^(tbd|todo|someday)/i.test(condition), `${file} has a placeholder rather than a condition`)
    }
})
