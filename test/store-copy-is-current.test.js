// THE OBSERVER'S OWN COPY OF THE STORE MUST BE THE CODE THE STORE'S REPOSITORY HAS.
//
// TWO MODULES HERE IMPORT IT -- `lib/sessions-search.js` (`searchLocalIndex`, the search fallback) and
// `lib/sessions-tool.js` (`refreshIndex`, the `refresh` action). The dependency spec is `github:` in `package.json`,
// which is RIGHT for a consumer and WRONG for a two-repo development checkout: the installed copy is a fetch, and a
// fetch is only as current as the last install.
//
// MEASURED LIVE, 2026-10-05 (`F117`): `node_modules/dsh-session-index` sat at `SCHEMA_VERSION = 3` with no
// `mirror_state`, while the sibling checkout was at 4 -- so `system1_sessions { action: 'refresh' }` would have run the
// OLD builder against a v4 store, and the search fallback would have queried it with v3 expectations. The fix on the
// spot was `npm update dsh-session-index`; this test is the fix that lasts, because the next store commit reintroduces
// exactly the same silence.
//
// WHERE THERE IS NO SIBLING, THERE IS NOTHING TO COMPARE, and the test SKIPS rather than passing: a published consumer
// has a pinned fetch and no working tree to drift from, and a passing test would claim a comparison that never ran.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(import.meta.url), '..', '..')
const SIBLING = join(ROOT, '..', 'dsh-session-index')
const INSTALLED = join(ROOT, 'node_modules', 'dsh-session-index')

/** The files the observer actually reaches through the package's subpath exports, plus the entry. */
const REACHED = ['index.js', 'lib/store.js', 'lib/build.js', 'lib/tools.js', 'lib/refresh.js', 'lib/read.js']

test('the installed store copy matches the sibling checkout, or there is no sibling to compare with', (t) => {
  if (!existsSync(SIBLING)) {
    t.skip('no sibling checkout at ' + SIBLING + ' -- nothing to drift from')
    return
  }
  assert.ok(existsSync(INSTALLED), 'the store is installed at ' + INSTALLED)
  const differing = REACHED.filter((file) => {
    const a = join(SIBLING, file)
    const b = join(INSTALLED, file)
    if (!existsSync(a)) return false
    if (!existsSync(b)) return true
    return readFileSync(a, 'utf8') !== readFileSync(b, 'utf8')
  })
  assert.deepEqual(differing, [],
    'node_modules/dsh-session-index differs from the sibling checkout in: ' + differing.join(', ')
    + ' -- run `npm update dsh-session-index`, because the observer\'s refresh and search paths run THIS copy')
})

test('the installed copy is the one the observer resolves at runtime', () => {
  // The comparison above is only meaningful if this is the path Node picks. A resolution that walked past it would
  // make the test agree with a file nothing loads -- the failure mode `F95` records for a derived schema.
  const resolved = import.meta.resolve('dsh-session-index/store', import.meta.url)
  assert.ok(resolved.startsWith('file://' + INSTALLED + '/') || resolved.includes('/node_modules/dsh-session-index/'),
    'the store resolves through node_modules: ' + resolved)
})
