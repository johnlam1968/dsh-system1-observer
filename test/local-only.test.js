// THE RUNTIME IS OURS NOW, AND THIS FILE IS WHAT KEEPS IT THAT WAY.
//
// The decision runtime is source in this repository, under `lib/`, not a package fetched at install time.
// Two things can silently undo that: a
// specifier left pointing at a package (which resolves from a stale `node_modules` and looks fine
// locally), and a `package.json` that still asks npm to fetch it. Both are checked here, because the
// failure they cause -- an install that needs credentials nobody has -- is invisible from this checkout.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SKIP_DIRS = new Set(['node_modules', 'data'])

/** Every `.js` this repository owns: the plugin source, its tests and its scripts. */
function jsFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) jsFiles(full, out)
    else if (entry.endsWith('.js')) out.push(full)
  }
  return out
}

test('no file in this repository imports dsh-system1-runtime', () => {
  const offenders = []
  for (const file of jsFiles(root)) {
    const source = readFileSync(file, 'utf8')
    for (const [index, line] of source.split('\n').entries()) {
      if (/from\s*['"]dsh-system1-runtime/.test(line) || /import\(\s*['"]dsh-system1-runtime/.test(line)) {
        offenders.push(`${relative(root, file)}:${index + 1}`)
      }
    }
  }
  assert.deepEqual(offenders, [], `these still resolve the removed package:\n  ${offenders.join('\n  ')}`)
})

test('package.json asks for no decision-runtime package', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const named = Object.keys(manifest.dependencies ?? {}).filter((name) => name.includes('system1-runtime'))
  assert.deepEqual(named, [], 'the manifest still declares a runtime dependency')
})

// THE WHOLE CLOSURE, IMPORTED THROUGH ITS NEW PATHS. A relocation that missed one specifier fails at
// the first `import` below, not on the first turn of a live session.
test('every local runtime module loads from lib/', async () => {
  const seams = await import('../lib/seams.js')
  const evidence = await import('../lib/evidence.js')
  const client = await import('../lib/model/client.js')
  const service = await import('../lib/model/service.js')

  assert.equal(typeof seams.probeText, 'function')
  assert.equal(seams.PROBE_SEAMS.length, 9)
  assert.equal(seams.PROBE_QUESTION.type, 'choice')
  assert.equal(typeof evidence.createEvidence, 'function')
  assert.equal(typeof client.createModel, 'function')
  assert.equal(typeof service.createServiceModel, 'function')
})

// The support modules the five public ones drag in. Named separately so a move that breaks only, say,
// the answer reader says which module it was.
test('the runtime modules behind them load too', async () => {
  const questions = await import('../lib/model/questions.js')
  const wire = await import('../lib/model/wire.js')
  const narrow = await import('../lib/model/narrow.js')
  const escalation = await import('../lib/model/escalation.js')
  const answers = await import('../lib/model/service-answers.js')
  const record = await import('../lib/is-record.js')

  assert.equal(typeof questions.noul, 'function')
  assert.equal(typeof wire.postSystemone, 'function')
  assert.equal(typeof narrow.narrowAnswers, 'function')
  assert.equal(typeof escalation.worstCase, 'function')
  assert.equal(typeof answers.serviceAnswers, 'function')
  assert.equal(record.isRecord({}), true)
})

// The lockfile is what `npm ci` follows, so a dependency removed from the manifest but left here is
// still fetched -- with the credentials this change exists to stop needing.
test('the lockfile no longer resolves a decision-runtime package', () => {
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))
  const paths = Object.keys(lock.packages ?? {}).filter((path) => path.includes('system1-runtime'))
  const declared = Object.keys(lock.packages?.['']?.dependencies ?? {}).filter((name) => name.includes('system1-runtime'))
  assert.deepEqual({ paths, declared }, { paths: [], declared: [] }, 'the lockfile still carries the runtime package')
})
