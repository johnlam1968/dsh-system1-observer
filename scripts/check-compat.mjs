#!/usr/bin/env node
// The CLI half: read the manifest and the live runtime, then report. The judgement lives in `lib/compat.js`, so
// the gate itself can be tested -- a gate nothing tests is a gate that rots.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { checkCompatibility, findInstalledDsh } from '../lib/compat.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
// THE RESOLUTION LIVES IN `lib/compat.js` SO IT CAN BE TESTED, and it looks in three places rather than one: a local
// install, the Node global root, and every profile -- the last being the copy this plugin actually mounts into. The
// old single `require.resolve` saw none of them, which is how this gate passed for weeks without checking anything.
const found = findInstalledDsh()
const dsh = found.version

const { problems, notes } = checkCompatibility(manifest, { node: process.versions.node, dsh })
if (found.from !== null) console.log(`note: the DSH line was read from ${found.from}`)
for (const note of notes) console.log(`note: ${note}`)
for (const problem of problems) console.error(`compat: ${problem}`)
if (problems.length > 0) {
  console.error('\nUpdate dsh.compatibility.testedAgainst ONLY after re-running: npm run ci')
  process.exit(1)
}
const tested = manifest.dsh.compatibility.testedAgainst
console.log(`declared tested against DSH ${tested.dsh} on Node ${tested.node}`)
console.log(`declared note: ${tested.note}`)
