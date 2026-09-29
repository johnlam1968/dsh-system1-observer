import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'

// THE DEFECT THIS EXISTS FOR: the manifest once declared no `dsh.bundle`, so the harness installed the package
// as a plain dependency and no row was ever composed. Every unit test passed while the plugin did nothing.
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

test('the package declares a bundle patch that exists, so the harness mounts it as a layer', () => {
  const patch = manifest.dsh?.bundle?.patch
  assert.equal(typeof patch, 'string', 'dsh.bundle.patch must be a string')
  assert.ok(patch.length > 0)
  assert.ok(existsSync(join(root, patch)), `${patch} does not exist`)
})

test('the patch inserts THIS package, under the row id the settings namespace uses', () => {
  const rows = parseYaml(readFileSync(join(root, manifest.dsh.bundle.patch), 'utf8'))
  const inserted = rows.flatMap(row => row.insert ?? [])
  const row = inserted.find(candidate => candidate.id === 'system1-observer')
  assert.ok(row !== undefined, 'the patch inserts no system1-observer row')
  assert.equal(row.name, manifest.name, 'the row name must be the package name, or the module cannot resolve')
})
