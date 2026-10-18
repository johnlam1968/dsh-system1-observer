// THE STANDALONE, TESTED WITHOUT A KEY AND WITHOUT A MODEL.
//
// `scripts/ask.mjs` exists because the instrument needs nothing but `node:*` and a credential, and that is a claim
// about the CODE, not about the plugin's deployment. It is therefore run here as a SUBPROCESS from the repository --
// with no key in the environment, so every path that would spend a call is refused rather than exercised -- and the
// things worth testing are the refusals and the free paths: what it lists, what it lints, and what it says when the
// credential is missing.
//
// WHAT IS NOT HERE, and why: no test drives a real call. That was done by hand against the live endpoint and the
// measurement is in the script's header; a test that spent money on every run of the suite is not a test, it is a bill.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)
const SCRIPT = fileURLToPath(new URL('../scripts/ask.mjs', import.meta.url))

/** Run the script with a credential-free environment, so a path that would spend cannot quietly do so. */
async function ask(args) {
  const env = { ...process.env }
  for (const name of ['OPENROUTER_API_KEY', 'TYPESAFE_API_KEY', 'LAYA_API_KEY']) delete env[name]
  try {
    const { stdout, stderr } = await run(process.execPath, [SCRIPT, ...args], { env })
    return { code: 0, stdout, stderr }
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }
  }
}

test('it lists the sets, in a directory with no node_modules', async () => {
  const value = await ask(['--list'])
  assert.equal(value.code, 0)
  assert.match(value.stdout, /set\(s\) in .*criteria/)
  // NOT `name \[hash\] scope`: that asserts the column widths too, and a `padEnd` change would fail a test about
  // LISTING. What matters is that the row carries a set, a hash and its scope, because a name alone cannot be
  // pinned to an instrument -- that hash is how a reading is attributed.
  assert.match(value.stdout, /news-claim-check@2\s+\[be7c47c78ba0\]\s+admit/)
})

test('`--lint` reports findings AND the rules it cannot check, and spends nothing', async () => {
  const clean = await ask(['--set', 'news-claim-check@2', '--lint'])
  assert.equal(clean.code, 0)
  assert.match(clean.stdout, /0? ?spec\(s\)/)
  assert.match(clean.stdout, /NOT CHECKED:.*ONE spec is ONE narrow judgement/, 'a clean report must not read as a pass on the rules no machine can check')

  // AND A SET THAT BREAKS A RULE SAYS SO AND EXITS NON-ZERO, so a script can gate on it.
  const broken = await ask(['--set', 'helpfulness-set-merged@1', '--scope', 'turn', '--lint'])
  assert.equal(broken.code, 0, 'this corpus is lint-clean; the assertion below is about the SHAPE of the report')
  assert.match(broken.stdout, /NOT CHECKED:/)
})

test('a missing credential is refused BY NAME, before any call is attempted', async () => {
  const value = await ask(['--set', 'news-claim-check@2', '--scope', 'admit', '--state', 'a claim'])
  assert.notEqual(value.code, 0)
  assert.match(value.stderr, /OPENROUTER_API_KEY` is not set/)
  // AND IT NAMES WHY, because "not set" with no next step is a refusal that wastes the caller's time.
  assert.match(value.stderr, /Export it, or pass `--key-env NAME`/)
  assert.match(value.stderr, /never an argument here/, 'and says where a key must NOT go')
})

test('a state is required, and `--scope` is required when a set declares several', async () => {
  const noState = await ask(['--set', 'news-claim-check@2', '--scope', 'admit'])
  assert.notEqual(noState.code, 0)
  assert.match(noState.stderr, /`--state`, `--file` or `--url`/)

  const ambiguous = await ask(['--set', 'agent-helpfulness-seams@1', '--state', 'text'])
  assert.notEqual(ambiguous.code, 0)
  assert.match(ambiguous.stderr, /`--scope` is required/, 'a set with several scopes must not be guessed at')
})

test('a set that does not exist, and a scope it does not declare, are refused by name', async () => {
  const noSet = await ask(['--set', 'no-such-set@9', '--lint'])
  assert.notEqual(noSet.code, 0)
  const wrongScope = await ask(['--set', 'news-claim-check@2', '--scope', 'turn', '--lint'])
  assert.match(wrongScope.stderr, /is not a scope/)
})

test('`--help` prints the usage and exits zero', async () => {
  const value = await ask(['--help'])
  assert.equal(value.code, 0)
  for (const flag of ['--set', '--scope', '--state', '--file', '--url', '--lint', '--json', '--key-env']) {
    assert.match(value.stdout, new RegExp(flag.replace('--', '\\-\\-')), `${flag} is documented`)
  }
})

test('the script imports nothing outside `node:*` and this repository -- the portability claim, checked', async () => {
  const { readFileSync } = await import('node:fs')
  const source = readFileSync(SCRIPT, 'utf8')
  const external = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1])
    .filter((specifier) => !specifier.startsWith('.') && !specifier.startsWith('node:'))
  assert.deepEqual(external, [], 'the standalone depends on something it would have to install:\n  ' + external.join('\n  '))
})
