#!/usr/bin/env node
// The CLI half: read the manifest and the live runtime, then report. The judgement lives in `lib/compat.js`, so
// the gate itself can be tested -- a gate nothing tests is a gate that rots.
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { checkCompatibility } from '../lib/compat.js'

const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
let dsh
try {
  dsh = JSON.parse(readFileSync(require.resolve('@deepseek-ai/dsh/package.json'), 'utf8')).version
}
catch {
  dsh = undefined
}

const { problems, notes } = checkCompatibility(manifest, { node: process.versions.node, dsh })
for (const note of notes) console.log(`note: ${note}`)
for (const problem of problems) console.error(`compat: ${problem}`)
if (problems.length > 0) {
  console.error('\nUpdate dsh.compatibility.testedAgainst ONLY after re-running: npm run ci')
  process.exit(1)
}
const tested = manifest.dsh.compatibility.testedAgainst
console.log(`declared tested against DSH ${tested.dsh} on Node ${tested.node}`)
console.log(`declared note: ${tested.note}`)
