// THE VOCABULARY IS SAID ONCE, AND THIS TEST IS WHAT MAKES THAT TRUE.
//
// The session vocabulary moved WHOLE into `system1-measure`, and the plugin's copy of it is now a pure re-export
// layer -- one line, `export * from ...`, naming no event and declaring no rule. That layer is the ONE file in this
// repository that is allowed to name a session event, and everything else that names one is a second spelling of it.
//
// WHY THE SECOND SPELLING MATTERS. A bare `'user/message'` in a file that is not the vocabulary is a file that has
// grown a second harness: the plugin would be reading one shape in one place and writing another in another, and the
// two would agree until the day a substrate wrote a record the other reader could not parse. A second spelling is
// therefore not a style question; it is the failure this repository keeps recording.
//
// The same scan, over the same tree, is in the package's own `test/session-format.test.js` -- one per repository, each
// exempting its own vocabulary. Two repositories, two vocabularies to keep single.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EVENT } from '../dsh/session-adapter/lib/session-format.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

test('the vocabulary is the ONLY place in the plugin that names a session event, and it still names them all', () => {
    const NAMES = Object.values(EVENT)
    const pattern = new RegExp(`(['"])(${NAMES.map((n) => n.replace(/[/-]/g, '\\$&')).join('|')})\\1`)
    // THE ONE FILE ALLOWED TO NAME THEM is the one that exports `EVENT` -- which, after the split, is the PURE
    // RE-EXPORT LAYER at `dsh/session-adapter/lib/session-format.js`. It is resolved against THIS MODULE rather
    // than typed as a path, for the reason the original comment gives: a scan that cannot name its own exemption is a
    // scan that either throws or, worse, quietly exempts nothing.
    const VOCABULARY = fileURLToPath(import.meta.resolve('../dsh/session-adapter/lib/session-format.js'))
    const offenders = []
    const walk = (dir) => readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
        const rel = `${dir}/${entry.name}`
        if (entry.isDirectory()) return entry.name === 'host' ? [] : walk(rel)
        if (!entry.isFile() || !entry.name.endsWith('.js')) return []
        const abs = join(ROOT, rel)
        if (abs === VOCABULARY) return []
        // COMMENTS ARE NOT CODE: a header may name an event to explain it, which is documentation rather than a
        // second home.
        let code = readFileSync(abs, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .split('\n').map((line) => line.replace(/\/\/.*$/, '')).join('\n')
        // AND A HOST-EVENT NAME IS NOT A RESTATEMENT. This vocabulary types what a session LOG CONTAINS
        // (`user/message`, `tool/call`, `turn/start`). The names in `ctx.on('...')` and in a node descriptor's
        // `event: '...'` are the OTHER vocabulary -- the events the host EMITS -- and they are literal on purpose:
        // `test/host-inventory.test.js` reads those literals to check them against the `HOST_EVENTS` declaration.
        code = code
            .replace(/ctx\.on\(\s*'[^']*'/g, "ctx.on('EVENT'").replace(/ctx\.on\(\s*"[^"]*"/g, 'ctx.on("EVENT"')
            .replace(/event:\s*'[^']*'/g, "event: 'EVENT'").replace(/event:\s*"[^"]*"/g, 'event: "EVENT"')
        for (const line of code.split('\n')) if (pattern.test(line)) offenders.push(`${rel}: ${line.trim().slice(0, 70)}`)
        return []
    })
    // BOTH FOLDERS, because the plugin and the adaptation are one plugin: scanning `dsh/` alone would leave the
    // half that actually reads session events unchecked.
    walk('dsh')
    walk('core')
    assert.deepEqual(offenders, [], `these name a session event outside the vocabulary: ${offenders.join(' | ')}`)
    // And the names themselves are the harness's, not a paraphrase.
    for (const name of ['user/message', 'assistant/message', 'tool/call', 'tool/result', 'turn/start', 'turn/end']) {
        assert.ok(NAMES.includes(name), `${name} is missing from EVENT`)
    }
})
