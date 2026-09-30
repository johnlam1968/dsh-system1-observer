#!/usr/bin/env node
// EVERY `docs/...` PATH A COMMENT NAMES MUST EXIST IN THIS CLONE.
//
// The finding class is `unknown` -- neither pass nor fail -- because a pinned sibling pointer and a committed
// file are both acceptable. What fails is a NEW dangling citation, which is the one somebody can still fix.
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { findDanglingCitations } from '../lib/citations.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { findings, known } = findDanglingCitations({ root })

for (const entry of known) {
  console.log(`unknown (known sibling)  ${entry.file}:${entry.line}  cites ${entry.path}`)
}
for (const entry of findings) {
  console.log(`unknown                  ${entry.file}:${entry.line}  cites ${entry.path}`)
}

if (findings.length > 0) {
  console.error(`\n${findings.length} dangling citation(s) that this clone cannot resolve.`)
  console.error('Commit the cited file, or repoint the comment at a path inside this repository.')
  process.exit(1)
}
console.log(`\n${known.length} known sibling citation(s), no new ones.`)
