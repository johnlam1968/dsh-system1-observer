// THE GUARD FOR THE HAND-PUBLISH PATH, tested in both directions and through the SCRIPT rather than only the rule.
//
// Why it exists: npm 11.8.0 IGNORES `publishConfig.tag` -- measured, a dry run announced `with tag latest` -- so a
// bare `npm publish` of a PRERELEASE would make the beta the version `npm i` installs. Since 0.1.0 the manifest pins
// no tag at all, and the workflow computes one from the version (`-beta.x` -> beta, stable -> latest); this is the
// guard for a maintainer at a terminal, where nothing computes anything.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { publishTagProblem } from '../lib/publish-tag.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = join(root, 'scripts', 'check-publish-tag.mjs')

/** Run the guard in a package directory with npm's tag environment, and report its exit code and output. */
function guard(cwd, tag) {
  const env = { ...process.env }
  if (tag === null) delete env.npm_config_tag
  else env.npm_config_tag = tag
  try {
    const out = execFileSync(process.execPath, [script], { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { code: 0, out }
  } catch (error) {
    return { code: error.status, out: String(error.stdout) + String(error.stderr) }
  }
}

test('a prerelease published to `latest` is refused, and the message names the fix', () => {
  const problem = publishTagProblem({ version: '0.1.0-beta.1', tag: 'latest' })
  assert.match(problem, /PRERELEASE/)
  assert.match(problem, /--tag beta/, 'the reader must be told what to type')
  // AN ABSENT TAG IS `latest`: npm resolves one, and it is not the one a prerelease wants.
  assert.equal(publishTagProblem({ version: '0.1.0-beta.1', tag: '' }), publishTagProblem({ version: '0.1.0-beta.1', tag: 'latest' }))
})

test('the three cases that are NOT problems stay allowed', () => {
  // A prerelease with the right tag.
  assert.equal(publishTagProblem({ version: '0.1.0-beta.1', tag: 'beta' }), null)
  // A stable version is what `latest` is FOR.
  assert.equal(publishTagProblem({ version: '0.1.0', tag: 'latest' }), null)
  assert.equal(publishTagProblem({ version: '0.1.0', tag: '' }), null)
  // A stable version published deliberately to a prerelease tag is unusual, not dangerous: a guard that refused it
  // would be a guard somebody works around.
  assert.equal(publishTagProblem({ version: '0.1.0', tag: 'beta' }), null)
})

test('the SCRIPT settles it by exit code, in the package it is run from', () => {
  // A FIXTURE, because this test used to assert against the repository's own manifest and said "the root package is a
  // prerelease today" -- which stopped being true the day the root became a stable 0.1.0, and the guard correctly
  // allowed it. A test that tracks the release it guards breaks once per release for no reason.
  const fixture = mkdtempSync(join(tmpdir(), 'publish-tag-'))
  writeFileSync(join(fixture, 'package.json'), JSON.stringify({ name: 'fixture', version: '0.2.0-beta.1' }))
  const refused = guard(fixture, null)
  assert.equal(refused.code, 1, 'no tag + a prerelease version must fail the publish')
  assert.match(refused.out, /publish tag REFUSED/)
  const allowed = guard(fixture, 'beta')
  assert.equal(allowed.code, 0)
  assert.match(allowed.out, /publish tag ok/)
  // AND A STABLE VERSION NEEDS NO TAG: `latest` is what it is for, which is the release this guard exists to allow.
  const stable = guard(root, null)
  assert.equal(stable.code, 0, 'a stable version with no tag is the normal release')
  // AND IT READS THE MANIFEST OF ITS OWN DIRECTORY: the adapter has its own name and version, and its
  // `prepublishOnly` calls this same script, so a guard that read the root's package.json would report the wrong
  // package -- which it did, until the relative path was measured (`packages/../scripts` does not exist).
  const adapter = guard(join(root, 'packages', 'session-adapter'), 'beta')
  assert.equal(adapter.code, 0)
  assert.match(adapter.out, /dsh-session-adapter@/, 'the guard must name the package being published')
})
