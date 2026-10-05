// THE DOCUMENTED ENTRY POINT, now a shim: the store, its builder and its CLI live in their own plugin
// (`dsh-session-index`, https://github.com/johnlam1968/dsh-session-index), and this path is kept because it is what the
// docs, the tool's own render text and several habits point at.
//
//   node scripts/session-index.mjs build  [--text] [--incremental] [--tokenizer trigram|unicode61] [--no-fts]
//   node scripts/session-index.mjs find   <term>
//   node scripts/session-index.mjs search <phrase>
//   node scripts/session-index.mjs stats
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const manifest = createRequire(import.meta.url).resolve('dsh-session-index/package.json')
const cli = join(dirname(manifest), 'bin', 'session-index.mjs')
const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], { stdio: 'inherit' })
process.exit(result.status === null ? 1 : result.status)
