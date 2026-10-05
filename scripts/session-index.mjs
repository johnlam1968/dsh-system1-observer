// THE DOCUMENTED ENTRY POINT, now a shim: the store, its builder and its CLI live in their own package
// (`packages/session-index/`), and this path is kept because it is what the docs, the tool's own render text and
// several habits point at.
//
//   node scripts/session-index.mjs build  [--text] [--incremental] [--tokenizer trigram|unicode61] [--no-fts]
//   node scripts/session-index.mjs find   <term>
//   node scripts/session-index.mjs search <phrase>
//   node scripts/session-index.mjs stats
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const cli = fileURLToPath(new URL('../packages/session-index/bin/session-index.mjs', import.meta.url))
const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], { stdio: 'inherit' })
process.exit(result.status === null ? 1 : result.status)
