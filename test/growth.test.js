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
//   deletion then `core/README.md` must carry the condition that retires it -- so "we will delete this once X" is a
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
    'dsh/evaluate-tool.js': {
        // RAISED FROM 615 TO 620, which the gate asks to be a DECISION rather than a drift: four of the added lines
        // are the declarations and their reasons for shapes the live calls produced and the schema had not described --
        // a nullable `exchange.turns` item (`F122`), the selector echo, and the segmented subject's keys (`F119`,
        // `F120`). Each is a fact about what this tool EMITS, so the alternatives were to understate the declaration
        // (which is how all four defects shipped) or to split a lifecycle that this reason still says should not be
        // split yet. The next raise should be the split, not a number.
        max: 620,
        reason: 'one tool end to end: parameters, session resolution, evidence-group selection, segmentation, the '
            + 'judge call, aggregation and render. Splitting it by size would separate the tool contract from the '
            + 'behaviour that honours it; the split worth making is by LIFECYCLE (resolve, select, judge, aggregate), '
            + 'and it should be made when a fourth selection mode appears, not before.',
    },
    'core/results-tool.js': {
        max: 588,
        reason: 'four actions over one trace, each with its own selection and render. The ACTIONS are the seam, so a '
            + 'split by action is the one to make -- when a fifth action appears, not by size now.',
    },
    'core/report.js': {
        // RAISED FROM 455 TO 465, and the gate asks for a DECISION rather than a drift. The ten lines are the export
        // of `cellOf` -- the ONE renderer of a question's cell -- and the reason it is exported is the same reason this
        // file exists: the package's files must agree. The standalone's terminal now prints a measurement's numbers
        // with this renderer instead of a second one of its own, and two renderers of the same question is the defect
        // the package exists to prevent, moved rather than fixed. The next raise should be a SPLIT, not a number.
        max: 465,
        reason: 'a measurement package is ONE artifact whose files must agree: skeleton, numbers, interpretation, '
            + 'manifest and the reproducible-file list -- and now the one renderer of a question\'s cell, so the '
            + 'terminal and the report cannot say different things about the same measurement. Splitting it invites '
            + 'the parts to disagree about the same measurement, which is the defect the package exists to prevent.',
    },
    'dsh/pi-session-export.js': {
        max: 606,
        reason: 'ONE conversion, held whole on purpose: parse -> live branch -> ask-groups -> events -> the facts the '
            + 'log does not carry. The half that is easy to get wrong is the STRUCTURE -- an `assistant/message` '
            + 'outside an open turn and step, or a `tool-call` block with no matching `tool/call`, is refused at '
            + 'read time by the harness -- and splitting the mapper from the accounting would put the accounting '
            + 'where it cannot see the events it counts. 137 of the 606 lines are the measured corpus rules the '
            + 'header carries, and they are why the NEXT conversion will not get them wrong again. THE CUT WORTH '
            + 'MAKING, when it is made: the LOSS ACCOUNTING (the `facts` object and `countNonMessageEntries`, ~90 '
            + 'lines) into its own module, so the mapper is the seam and the sidecar is the receipt. Not before -- '
            + 'one importer is not two.',
    },
    // `core/sessions-tool.js` USED TO BE EXEMPT AND IS NOT ANY MORE. Its own note said the seam to cut was by concern,
    // and when the fourth action (`refresh`) arrived the cut was made -- the schema and the render moved to
    // `core/sessions-tool-output.js` -- so the tool now sits at 285 lines, under the ceiling, with no exemption. The
    // gate is what said so: an exemption whose file is at or under the ceiling is paperwork, and it fails rather than
    // lingering.
    // THE TWO ENTRY POINTS WERE NEVER SCANNED UNTIL THEY MOVED. `index.js` and `client.js` sat at the repository
    // ROOT, and this check walks `core/` and `dsh/` -- so the two largest files in the plugin were outside its ceiling
    // entirely, and no exemption was needed because nothing asked. That is the failure mode this file exists to
    // prevent, found by the reorganisation rather than by growth: a budget that does not cover a file is not a budget.
    // They are declared here because their size is a real decision about what an ENTRY POINT IS, not an accumulation.
    'dsh/index.js': {
        max: 1426,
        reason: 'the Cordis plugin entry: every row, schema, service and tool registration this package performs '
            + 'inside ONE harness, and nothing it performs anywhere else. The cut worth making is by LIFECYCLE -- '
            + 'registration, then the question plumbing, then the session tools -- and it should be made when a second '
            + 'harness needs the row, because that is what proves the split is at a seam rather than at a convenient '
            + 'line. Not before: one importer is not two.',
    },
    'dsh/client.js': {
        max: 1932,
        reason: 'the Web UI half: the settings cards and the conversation projection, each field the harness schema '
            + 'declares rendered once and then edited in place. It grows in CASES -- one card per writable setting, one '
            + 'node per rendered group -- and cases are what a card is made of, so splitting it separates a form from '
            + 'the schema it is a form OF. The seam, when it comes, is per card rather than per field.',
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
    // `core/` and `dsh/` are ONE instrument split across two folders, so both carry the same ceiling -- scanning
    // either alone would let a file cross the line by being moved to the other.
    for (const [dir, ceiling] of [['core', LIB_CEILING], ['dsh', LIB_CEILING], ['test', TEST_CEILING]]) {
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
    const doc = readFileSync(join(ROOT, 'core/README.md'), 'utf8')
    const section = doc.split('## Nominated for retirement')[1]
    assert.ok(section !== undefined, 'core/README.md has no `## Nominated for retirement` section')
    // The map writes paths relative to its own folder; the scan returns them relative to the repository root. A row
    // may name a path in either -- the session-shaped adapter modules moved into their own package (`F104`), and this
    // check follows them there, because a check that stopped at one folder would quietly stop covering them.
    const listed = [...section.matchAll(/^\| `([^`]+)` \| ([^|]+) \|/gm)]
        .map((m) => [m[1].startsWith('core/') || m[1].startsWith('dsh/') ? m[1] : `core/${m[1]}`, m[2].trim()])

    const nominating = [...filesUnder('core'), ...filesUnder('dsh')]
        .filter((rel) => NOMINATES.test(readFileSync(join(ROOT, rel), 'utf8')))

    const missing = nominating.filter((rel) => !listed.some(([f]) => f === rel))
    assert.deepEqual(missing, [], `these nominate themselves for deletion but are not on the retirement list: ${missing.join(', ')}`)

    const phantom = listed.filter(([f]) => !nominating.includes(f))
    assert.deepEqual(phantom.map(([f]) => f), [], 'the retirement list names files that no longer nominate themselves -- delete the row')

    for (const [file, condition] of listed) {
        assert.ok(condition.length > 20, `${file} is on the retirement list without a condition that retires it`)
        assert.ok(!/^(tbd|todo|someday)/i.test(condition), `${file} has a placeholder rather than a condition`)
    }
})
