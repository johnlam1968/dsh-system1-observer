// WHAT npm WOULD ACTUALLY SHIP, ASSERTED AGAINST THE TARBALL RATHER THAN THE `files` ARRAY.
//
// The rule is the operator's: a release publishes what a USER of this application needs, and not the working notes
// that produced it. `files` is the allowlist that enforces it, but an allowlist that is only read is a promise -- this
// check runs `npm pack --dry-run --json` and inspects the file list npm itself produced, so a pattern like
// `scripts/**/*.mjs` (which shipped all five development gates until it was narrowed) cannot come back unnoticed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
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
    'dsh/index.js', // the plugin entry
    'dsh/client.js', // the settings card and the session menu
    'dsh/host/index.js', // the host adapter the entry imports -- ONE level down, which a list of entries would miss
    'dsh/exchange.js', // a dsh runtime module, to prove the folder is covered and not just its two entry points
    'cordis.patch.yml', // the bundle patch that mounts the row
    'install.sh', // the documented installer
    'README.md', // npm shows this; it is the user manual
    'LICENSE',
    'icon.svg',
    'core/seams.js', // a runtime module, to prove core/ is not being filtered away
    'scripts/trace.mjs', // the terminal reader the README documents
    'scripts/session-index.mjs', // the documented store entry point
  ]) {
    assert.ok(paths.has(needed), `${needed} is missing from the package`)
  }
  // THE SKILLS SHIP, and they are user-facing: a workflow an agent can load.
  assert.ok([...paths].some((p) => p.startsWith('skills/')), 'no skill shipped')
  assert.ok([...paths].some((p) => p.startsWith('locale/')), 'no locale shipped')
})

// THE SESSION ADAPTER SHIPS IN HERE, ALL FIVE MODULES, because it is no longer a separate package. It WAS one, and the
// guard then said the opposite — that a copy inside this tarball would be a second, unversioned, silently divergent one.
// That was true while the code imported it BY NAME. Now the code imports it by RELATIVE PATH, so there is no second
// copy to diverge: these five files are the only ones, and the entry point that imports them is in the same tarball.
// What replaces the old guard is the one that would have caught its demotion going wrong — a `dsh/*.js` pattern that
// stops at the folder boundary and ships an entry point whose fifteen imports cannot resolve.
test('the session adapter ships in here, and nothing resolves it by name any more', () => {
  const paths = new Set(packed())
  for (const module of ['session-format', 'surface', 'surface-authority', 'feed', 'reader']) {
    assert.ok(paths.has(`dsh/session-adapter/lib/${module}.js`), `dsh/session-adapter/lib/${module}.js is missing from the package`)
  }
  // AND THE NAME IS GONE FROM BOTH SIDES OF THE BOUNDARY. A surviving `dependencies` entry would make npm install a
  // published copy that nothing imports; a surviving specifier would make this package unresolvable at install time.
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  assert.equal(manifest.dependencies['dsh-session-adapter'], undefined, 'it is no longer a dependency')
  assert.equal(manifest.workspaces, undefined, 'and no longer a workspace, so npm has nothing to link')
  // SCOPED TO `.js`, and it has to be: the folder's own README quotes the specifier as an example of what it no
  // longer is, and a check that flagged its own explanation would be a check that cannot be satisfied.
  const named = spawnSync('grep', ['-rlE', "(from|import\\()\\s*['\"]dsh-session-adapter", '--include=*.js', '--include=*.mjs', 'dsh', 'core'], { cwd: root, encoding: 'utf8' }).stdout
  assert.equal(named, '', `no shipped source may still import it by name:\n${named}`)
})
