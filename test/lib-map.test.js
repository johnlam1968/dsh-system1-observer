// THE MAP IS CHECKED, NOT ASPIRATIONAL.
//
// `core/README.md` is the one page that says what each file is FOR. A map nobody checks goes stale silently: a new
// file is simply absent from it, a rename leaves a name pointing at nothing, and both failures LOOK like a complete
// map. So the scan is mechanical and it is recursive, for the reason `host-inventory.test.js` records -- a flat
// `lib/*.js` scan cannot see a nested file, and the nested files are where the layering already lives.
//
// WHAT THIS DELIBERATELY DOES NOT CHECK: whether a file touches the harness. That is derived by
// `host-inventory.test.js` from real host calls with comments stripped, and a second hand-written answer to the same
// question would be free to disagree with it.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// THE MAP NAMES BOTH FOLDERS NOW. `core/README.md` is the map of the instrument; the adaptation gets its own, because
// a single list spanning both is a list nobody can hold -- the point of the split is that the two halves are read for
// different reasons.
const LIB = join(ROOT, 'core')
const DSH = join(ROOT, 'dsh')

/** Every `.js` file under `lib/`, recursively, as paths relative to `lib/`. */
function libFiles(dir = LIB, prefix = '') {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
        if (entry.isDirectory()) return libFiles(join(dir, entry.name), rel)
        return entry.isFile() && entry.name.endsWith('.js') ? [rel] : []
    })
}

/**
 * Every `.js` path the map DECLARES, taken from an entry line only.
 *
 * An entry is a bullet that OPENS with a backticked path -- `* \`file.js\` -- what it is`. Prose is not an entry:
 * this file's own header mentions `host-inventory.test.js`, and a scan that accepted any backticked path would
 * demand that a TEST be declared in a map of `lib/`.
 */
function declaredIn(doc) {
    return [...doc.matchAll(/^\* `([^`\s]+\.js)`/gm)].map((m) => m[1].replace(/^lib\//, ''))
}

test('the map names every lib file, and every name in it exists', () => {
    const doc = readFileSync(join(LIB, 'README.md'), 'utf8')
    // BOTH FOLDERS. `dsh/x.js` is declared as written -- the prefix is part of the name, not decoration -- so the scan
    // prefixes the adaptation's files to match the map, and the map is what decides where a file belongs.
    const files = [...libFiles(join(ROOT, 'core')), ...libFiles(join(ROOT, 'dsh')).map((f) => 'dsh/' + f)].sort()
    const declared = declaredIn(doc)
    const unique = [...new Set(declared)].sort()

    const missing = files.filter((f) => !unique.includes(f))
    const phantom = unique.filter((d) => !files.includes(d))
    assert.deepEqual(missing, [], `undeclared in core/README.md: ${missing.join(', ')}`)
    assert.deepEqual(phantom, [], `named in core/README.md but absent: ${phantom.join(', ')}`)
    assert.equal(declared.length, unique.length, 'a file named twice makes the map longer than the code it maps')
    // THE FLOOR IS A FLOOR, and it is lower than it was because the tree is: the measurement moved to
    // `system1-measure` and this repository kept the glue. What the floor protects is the RECURSION, so the
    // assertion below says that directly rather than through a number that happens to be near.
    assert.ok(files.length > 25, 'the scan found suspiciously few files, so it is probably not recursing')
    assert.ok(files.some((f) => f.startsWith('dsh/session-adapter/lib/')), 'the scan reaches the modules nested two folders down')
})

test('the map says which file owns which tool name, and the tool names are real', () => {
    const doc = readFileSync(join(LIB, 'README.md'), 'utf8')
    // The tool files are the agent-facing surface, and a tool name in the map that no file declares is a map
    // describing a tool that does not exist.
    const tools = ['system1_decide', 'system1_evaluate_session', 'system1_measurements', 'system1_sessions', 'system1_question_sets', 'system1_battery', 'system1_settings', 'system1_trace']
    const source = libFiles().map((f) => readFileSync(join(LIB, f), 'utf8')).join('\n')
    for (const named of tools) {
        if (!source.includes(`'${named}'`) && !source.includes(`"${named}"`)) continue
        assert.ok(doc.includes(`\`${named}\``), `${named} is registered but the map does not name it`)
    }
})
