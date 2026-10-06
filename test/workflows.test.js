// WORKFLOW FILES ARE CODE, AND THIS ONE WAS BROKEN YAML FOR A DAY.
//
// A step named `Publish dsh-session-adapter (the anchor: the observer depends on it)` is invalid YAML -- a bare `: `
// inside an unquoted scalar -- and GitHub refuses such a file outright, so the first tag would have produced no run
// at all rather than a failed one. Nothing in the suite read `.github/`, and a REVIEW that was asked to check "YAML
// validity" did not parse it either. This gate parses every workflow and asserts the release promises that matter.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parse } from 'yaml'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, '.github', 'workflows')
const files = readdirSync(dir).filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
const workflow = (name) => parse(readFileSync(join(dir, name), 'utf8'))

test('every workflow is valid YAML with jobs and steps', () => {
  assert.ok(files.length >= 2, `only ${files.length} workflow(s) found: the check is not looking at .github/workflows`)
  for (const name of files) {
    let parsed
    assert.doesNotThrow(() => { parsed = workflow(name) }, `${name} is not valid YAML: GitHub would refuse the file`)
    assert.ok(parsed.on, `${name} has no trigger`)
    const jobs = Object.values(parsed.jobs ?? {})
    assert.ok(jobs.length >= 1, `${name} has no job`)
    for (const job of jobs) assert.ok(Array.isArray(job.steps) && job.steps.length > 0, `${name} has a job with no steps`)
  }
})

test('the publish workflow keeps the promises a release depends on', () => {
  const publish = workflow('publish.yml')
  const job = publish.jobs.publish
  assert.ok(job, 'the publish job is gone')
  // PROVENANCE NEEDS THIS PERMISSION, and the Release needs `contents: write`.
  assert.equal(publish.permissions?.['id-token'], 'write', 'provenance needs id-token: write')
  assert.equal(publish.permissions?.contents, 'write', 'the GitHub Release needs contents: write')
  const yamlText = readFileSync(join(dir, 'publish.yml'), 'utf8')
  // THE BETA DISCIPLINE, in the three places it can be lost: the flag on the command, the guard that refuses a
  // prerelease aimed at `latest`, and the post-publish check that the tag did not land there anyway.
  assert.match(yamlText, /npm publish --provenance --access public --tag beta/, 'a publish without --tag beta would make the beta `latest`')
  // THE GUARD ITSELF LIVES IN `prepublishOnly`, so the promise to assert is that the workflow does NOT skip it:
  // publishing from a directory runs `prepublishOnly`, and `--ignore-scripts` would silently bypass the tag check
  // (it is the right flag for the TARBALL route, where the guard has already run by hand).
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  assert.match(manifest.scripts.prepublishOnly, /check-publish-tag\.mjs/, 'prepublishOnly must run the tag guard')
  assert.doesNotMatch(yamlText, /npm publish[^\n]*--ignore-scripts/, 'the workflow must not skip prepublishOnly')
  // STAGING IS NOT A RELEASE: the OIDC flow can stage a publish, exit 0 and leave nothing installable (measured).
  // The workflow must check the REGISTRY, not its own exit code.
  assert.match(yamlText, /must be INSTALLABLE/, 'nothing verifies the version actually landed')
  assert.match(yamlText, /npm view "\$\{name\}@\$\{ver\}" version/, 'the installability check must query the registry')
  // AND IT MUST COVER EVERY PACKAGE THE TAG PUBLISHES, not only the root one: a staged adapter beside a published
  // plugin is half a release, which is exactly the shape that reads as success.
  assert.match(yamlText, /for pkg_dir in packages\/session-adapter \./, 'the installability check must cover both packages')
  // AND IT MUST RETRY: the registry is eventually consistent, so a single check a second after publishing can
  // report a staged release that merely lagged.
  assert.match(yamlText, /for attempt in 1 2 3 4 5/, 'the installability check must retry before declaring staging')
  // THE TAG CHECK MUST KNOW npm'S FIRST-RELEASE RULE: a brand-new package gets `latest` on its first version even
  // with `--tag beta` (measured), so the guard warns while every version is a prerelease and fails once a stable
  // version exists to point `latest` at. Both branches are asserted, because a guard that only fails would fail on
  // every first release and be deleted.
  assert.match(yamlText, /dist-tags\.latest/, 'nothing checks that the prerelease did not land on `latest`')
  assert.match(yamlText, /versions --json/, 'the tag check must distinguish a first release from a misfiled one')
  assert.match(yamlText, /::warning::[^\n]*only version published/, 'the first-release case must warn, not fail')
  // TRUSTED PUBLISHING, NOT A TOKEN: npm authenticates from the run's OIDC identity, which needs no secret and
  // cannot expire. A `NODE_AUTH_TOKEN` here would make npm prefer the token instead -- which is what failed with
  // EOTP ("this operation requires a one-time password") on the first attempt.
  assert.doesNotMatch(yamlText, /NODE_AUTH_TOKEN|secrets\.NPM_TOKEN/, 'the publish steps must not use a token')
  assert.match(yamlText, /npm --version/, 'nothing asserts an npm new enough for the OIDC exchange')
  // IDEMPOTENCY: a re-run after a partial failure must skip what is already published.
  assert.match(yamlText, /npm view "[^"]+@\$\{ver\}" version/, 'no idempotency guard on the publish steps')
  // THE TAG TRIGGER, and a manual path for repairs.
  assert.deepEqual(publish.on.push.tags, ['v*'], 'the release trigger changed')
  assert.ok(publish.on.workflow_dispatch !== undefined, 'there must be a manual re-run path')
  const releaseStep = job.steps.find((step) => String(step.uses ?? '').includes('action-gh-release'))
  assert.ok(releaseStep, 'the Release step is gone')
  assert.match(String(releaseStep.if), /startsWith\(github\.ref, 'refs\/tags\/v'\)/, 'the Release must only run for a version tag')
})
