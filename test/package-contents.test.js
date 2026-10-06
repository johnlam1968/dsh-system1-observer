// WHAT npm WOULD ACTUALLY SHIP, ASSERTED AGAINST THE TARBALL RATHER THAN THE `files` ARRAY.
//
// The rule is the operator's: a release publishes what a USER of this application needs, and not the working notes
// that produced it. `files` is the allowlist that enforces it, but an allowlist that is only read is a promise -- this
// check runs `npm pack --dry-run --json` and inspects the file list npm itself produced, so a pattern like
// `scripts/**/*.mjs` (which shipped all five development gates until it was narrowed) cannot come back unnoticed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** The paths npm says it would pack. `--dry-run` touches nothing and does NOT run `prepublishOnly`. */
function packed() {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  return JSON.parse(out)[0].files.map((entry) => entry.path)
}

test('the package ships no development material', () => {
  const paths = packed()
  assert.ok(paths.length > 40, `only ${paths.length} paths packed: the check is not reaching the tarball`)
  // THE THREE KINDS OF THING THAT MUST NOT SHIP: the working notes, the test suite, and the gates that check this
  // repository rather than the installed plugin.
  for (const [what, matches] of [
    ['working notes', paths.filter((p) => p.startsWith('docs/'))],
    ['the test suite', paths.filter((p) => p.startsWith('test/'))],
    ['development gates', paths.filter((p) => p.startsWith('scripts/check-'))],
    ['release machinery', paths.filter((p) => p.startsWith('.github/'))],
  ]) {
    assert.deepEqual(matches, [], `${what} would be published: ${matches.join(', ')}`)
  }
})

test('and ships what a user needs to run it', () => {
  const paths = new Set(packed())
  for (const needed of [
    'index.js', // the plugin entry
    'client.js', // the settings card and the session menu
    'cordis.patch.yml', // the bundle patch that mounts the row
    'install.sh', // the documented installer
    'README.md', // npm shows this; it is the user manual
    'LICENSE',
    'icon.svg',
    'lib/seams.js', // a runtime module, to prove lib/ is not being filtered away
    'scripts/trace.mjs', // the terminal reader the README documents
    'scripts/session-index.mjs', // the documented store entry point
  ]) {
    assert.ok(paths.has(needed), `${needed} is missing from the package`)
  }
  // THE SKILLS SHIP, and they are user-facing: a workflow an agent can load.
  assert.ok([...paths].some((p) => p.startsWith('skills/')), 'no skill shipped')
  assert.ok([...paths].some((p) => p.startsWith('locale/')), 'no locale shipped')
})
