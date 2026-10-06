#!/usr/bin/env node
// The `prepublishOnly` guard for the hand-publish path. Reads the package the publish is happening IN, so the adapter
// (whose `prepublishOnly` calls this file by relative path) is checked against its own manifest, not the root's.
//
// WHY A SCRIPT AND A PURE FUNCTION: the rule lives in `lib/publish-tag.js`, where it is tested, and this file only
// reads npm's environment and turns the answer into an exit code.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { publishTagProblem } from '../lib/publish-tag.js'

const manifest = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))
// npm exposes the resolved tag to lifecycle scripts here; when the caller passed no `--tag`, it is absent and npm
// will use `latest`.
const tag = process.env.npm_config_tag ?? ''
const problem = publishTagProblem({ version: manifest.version, tag })

if (problem === null) {
  console.log(`publish tag ok: ${manifest.name}@${manifest.version} -> ${tag === '' ? 'latest (npm default)' : tag}`)
  process.exit(0)
}
console.error(`publish tag REFUSED: ${problem}`)
process.exit(1)
