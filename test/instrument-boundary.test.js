// THE INSTRUMENT'S BOUNDARY, CHECKED AGAINST THE CODE.
//
// (a) of the topology (`ROADMAP.md` §14.6) is "the instrument: seams, question composition and validation, the model
// call path, probe calibration, batteries, readings -- a pure package, no dsh import". It is still inline, and the
// extraction plan's third step -- kept in the off-repository working notes -- is what makes the eventual extraction a
// MOVE rather than a reshaping: the instrument must read no config of this plugin's.
//
// THE SET IS DECLARED HERE, because a boundary that lives in a comment drifts the first time a file moves -- and the
// count that was carried before this test was a TEXT MATCH rather than a call graph: it named `probe-score.js` and
// `nudge-label.js` as config readers (they discuss configuration in prose and read none) and MISSED `redact.js` and
// `cost.js`, which read four and one fields. Measured before the conversion: 23 files / 4,274 lines, of which SIX
// files / 1,796 lines read the row (`F110`). After it: zero.
//
// WHAT THIS GATE CAN SEE, and what it cannot: it is a source scan, so it proves no listed file IMPORTS a config
// reader or CALLS one; it cannot prove the input object is complete, which the behaviour tests do. The two together
// are the claim.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { normalize, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The instrument, as files.
 *
 * The line between this list and the application is a judgement, not a namespace, so it is written down: these are
 * the files whose subject is the MEASUREMENT -- the loop's vocabulary, question composition and validation, the model
 * call path, probe calibration, batteries, cost, redaction and the record's own shape. Everything that binds a row,
 * mounts a listener, or offers a tool is the application, and several of those files are equally pure but are not
 * counted here because they exist only to serve this repository's row.
 */
export const INSTRUMENT = Object.freeze([
  'lib/seams.js',
  'lib/questions.js',
  'lib/question-sets.js',
  'lib/observe.js',
  'lib/redact.js',
  'lib/cost.js',
  'lib/evidence.js',
  'lib/trace-data.js',
  'lib/probe-score.js',
  'lib/calibrate.js',
  'lib/compare.js',
  'lib/battery.js',
  'lib/nudge-label.js',
  'lib/model/client.js',
  'lib/model/envelope.js',
  'lib/model/escalation.js',
  'lib/model/limits.js',
  'lib/model/narrow.js',
  'lib/model/questions.js',
  'lib/model/result-envelope.js',
  'lib/question-lint.js',
  'lib/model/wire.js',
])

/**
 * Comments are PROSE and are stripped before the scan, because a module that DOCUMENTS a config reader does not call
 * one. `test/host-inventory.test.js` learned this the expensive way (its third bug: a header naming `ctx.on(...)` read
 * as a subscription), and this is the same stripper in miniature rather than a second tokenizer.
 */
const code = (text) => {
  let inBlock = false
  return text.split('\n').map((line) => {
    let out = ''
    for (let i = 0; i < line.length; i += 1) {
      const two = line.slice(i, i + 2)
      if (inBlock) { if (two === '*/') { inBlock = false; i += 1 } continue }
      if (two === '/*') { inBlock = true; i += 1; continue }
      if (two === '//') break
      out += line[i]
    }
    return out
  }).join('\n')
}

const read = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : '')

/** The repository root, from this file, so the clean-room copy is made of the real tree. */
const rootOfTest = normalize(join(dirname(fileURLToPath(import.meta.url)), '..'))

test('every file in the instrument set exists, and the set is the one that was measured', () => {
  const missing = INSTRUMENT.filter((file) => !existsSync(file))
  assert.deepEqual(missing, [], 'the instrument set names files that are not there: ' + missing.join(', '))
  // A SET THAT SHRANK SILENTLY IS THE FAILURE THIS PAIR EXISTS FOR. 23 is not a target; it is what the boundary was
  // measured at, so a file moving out of it has to be a change somebody made on purpose (`F110`).
  assert.equal(INSTRUMENT.length, 22, 'the instrument set changed size: say so in docs/findings.md and update this list')
})

test('no instrument file imports, or calls, a config reader', () => {
  const offenders = []
  for (const file of INSTRUMENT) {
    const source = code(read(file))
    // THE IMPORT IS THE HARD EDGE; THE CALL is the one that would survive a re-export, so both are checked and both
    // are reported with the file, because "something reads the config" is not actionable and "lib/redact.js does" is.
    if (/from\s+'[^']*config-value\.js'/.test(source)) offenders.push(file + ' imports config-value.js')
    if (/\b(readConfigValue|plainConfig|liveConfig)\s*\(/.test(source)) offenders.push(file + ' calls a config reader')
  }
  assert.deepEqual(offenders, [], 'the instrument reads this plugin\'s config:\n  ' + offenders.join('\n  '))
})

test('no instrument file imports anything but node builtins and itself', () => {
  const offenders = []
  for (const file of INSTRUMENT) {
    const external = [...code(read(file)).matchAll(/from\s+'([^']+)'/g)]
      .map((match) => match[1])
      .filter((specifier) => !specifier.startsWith('.') && !specifier.startsWith('node:'))
    for (const specifier of new Set(external)) offenders.push(file + ' imports ' + specifier)
  }
  // THIS IS THE EXTRACTION CLAIM IN ONE ASSERTION: a package that imports `dsh-session-adapter` (as `lib/seams.js`
  // once did, for one event name) or `@deepseek-ai/...` cannot leave this repository, and `dsh-session-adapter` is
  // DSH-shaped even though it is ours.
  assert.deepEqual(offenders, [], 'the instrument depends on something outside node:\n  ' + offenders.join('\n  '))
})

test('no instrument file names a harness event, or reads the adapter\'s event catalogue', () => {
  const offenders = []
  for (const file of INSTRUMENT) {
    const source = code(read(file))
    // A STRING LITERAL THAT NAMES A HARNESS EVENT IS HOW THE BINDING RE-ENTERS. The id-to-event map moved to
    // `lib/host-events.js` and the per-seam argument shapes to `lib/host-payload.js`, so a name here again means the
    // harness is being re-imported by hand -- and `EVENT.AGENT_TURN_STOPPING` was the one import that made
    // `lib/seams.js` depend on the adapter package at all.
    for (const match of source.matchAll(/'(?:agent|tools|llm|system-prompt)\/[a-z-]+(?:\/[a-z-]+)*'/g)) {
      offenders.push(file + ' names ' + match[0])
    }
    if (/\bEVENT\.[A-Z_]/.test(source)) offenders.push(file + ' reads the adapter EVENT catalogue')
  }
  assert.deepEqual(offenders, [], 'an instrument file names a harness event:\n  ' + offenders.join('\n  '))
})

test('the instrument has NO host edge: it reaches a model over HTTP and nothing else', () => {
  // THIS WAS THE WHOLE ARGUMENT, AND IT IS NOW THE WHOLE RESULT. `ROADMAP.md` §14.1 recorded one host edge in the
  // instrument -- `lib/model/service.js`, the decision model reached as a Cordis service -- and this asserted it
  // stayed the only one, so a second could not appear without a reader being told. The edge existed because
  // `postSystemone` sent NO CREDENTIAL: the host route existed to borrow another plugin's key. The wire carries one
  // now (measured standalone, nothing but `fetch`), so the module is gone and so is the edge.
  //
  // The assertion is `[]` and not a list with one entry. A test that names the expected host dependency is a
  // description of the present, and this one used to read as a floor -- which is how a portable core can hold a hard
  // dependency for years while a green suite says "the ONE edge".
  const reaching = INSTRUMENT.filter((file) => /\bctx\.\w/.test(code(read(file))))
  assert.deepEqual(reaching, [], 'the instrument reaches the host again:\n  ' + reaching.join('\n  '))
})

// THE STANDALONE'S OWN BOUNDARY, DERIVED RATHER THAN DECLARED.
//
// `INSTRUMENT` above is a list somebody chose, and it is 22 files that predate the facade. Proved by injection: adding
// `import { liveConfig } from './config-value.js'` to `lib/system1.js` -- the module `scripts/ask.mjs` composes every
// question through -- left all five boundary tests GREEN, because that file is not on the list. Only the clean-room
// run caught it, and it did, by dying on the import. A boundary enforced by a hand-kept list is a boundary that is
// true until someone adds a module.
//
// So this derives the real one: walk the import graph from `scripts/ask.mjs` and assert that every file it reaches can
// be loaded with no `node_modules` at all -- no bare specifier anywhere in the closure, and nothing under `lib/host/`.
// That is the property the standalone actually has, and it is measured from the entry point rather than asserted
// about a list.
test('everything `scripts/ask.mjs` reaches is loadable with no node_modules at all', () => {
  const seen = new Set()
  const bare = []
  const queue = ['scripts/ask.mjs']
  while (queue.length > 0) {
    const file = queue.pop()
    if (seen.has(file)) continue
    seen.add(file)
    const source = read(file)
    for (const match of source.matchAll(/from\s+'([^']+)'/g)) {
      const specifier = match[1]
      if (specifier.startsWith('node:')) continue
      if (!specifier.startsWith('.')) { bare.push(file + ' imports ' + specifier); continue }
      const resolved = normalize(join(dirname(file), specifier))
      if (existsSync(resolved)) queue.push(resolved)
      else bare.push(file + ' imports ' + specifier + ' (which does not exist)')
    }
  }
  assert.deepEqual(bare, [], 'the standalone cannot be loaded without installing something:\n  ' + bare.join('\n  '))

  // AND THE CLOSURE IS CHECKED SEMANTICALLY, not just for bare specifiers. A FIRST attempt at this test only flagged
  // NON-RELATIVE imports, and it stayed green with `import { liveConfig } from './config-value.js'` injected into
  // `lib/system1.js` -- a relative path to a file that exists, so the walk simply followed it and called the closure
  // portable. Syntax cannot tell harness glue from a helper; the RULES the declared boundary already uses can, and
  // they are applied here to the DERIVED set rather than to a hand-kept list.
  const glue = []
  for (const file of seen) {
    const source = code(read(file))
    if (/from\s+'[^']*config-value\.js'/.test(source)) glue.push(file + ' imports config-value.js')
    if (/\b(readConfigValue|plainConfig|liveConfig)\s*\(/.test(source)) glue.push(file + ' calls a config reader')
    if (file.includes('lib/host/')) glue.push(file + ' is host glue')
    if (/from\s+'[^']*host-events\.js'/.test(source)) glue.push(file + ' imports host-events.js')
  }
  assert.deepEqual(glue, [], 'the standalone reaches harness glue:\n  ' + glue.join('\n  '))

  // AND THE CLOSURE IS NOT VACUOUS -- a graph that resolved to nothing would pass every assertion above.
  assert.ok(seen.has('lib/system1.js'), 'the closure really does reach the facade')
  assert.ok([...seen].filter((f) => f.startsWith('lib/')).length >= 10, `and it is a real graph, ${[...seen].filter((f) => f.startsWith('lib/')).length} lib files`)
})


// THE CLEAN ROOM, EXECUTED RATHER THAN INFERRED.
//
// The static test above reads the import graph. This one COPIES the package to a temporary directory with no
// `node_modules` at all and RUNS the entry point there, which is the property that is actually claimed: the standalone
// works with nothing installed. A static walk can be fooled by a dynamic import, an export condition, or a file it
// failed to resolve; a run cannot, and it costs one `node` process.
//
// `lib/host/` is left out because that IS the harness glue -- excluding it is the point, not a cheat, and the test
// asserts it is excluded so a later edit cannot quietly depend on it.
test('the standalone RUNS in a directory with no node_modules at all', async () => {
  const { execFileSync } = await import('node:child_process')
  const { mkdtempSync, cpSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const root = mkdtempSync(join(tmpdir(), 'clean-room-'))
  try {
    for (const dir of ['lib', 'scripts', 'criteria']) cpSync(join(rootOfTest, dir), join(root, dir), { recursive: true })
    rmSync(join(root, 'lib', 'host'), { recursive: true, force: true })
    assert.equal(existsSync(join(root, 'lib', 'host')), false, 'the harness glue is what was left out')
    assert.equal(existsSync(join(root, 'node_modules')), false, 'and nothing was installed to replace it')
    // `--list` reads every composition and prints it. It reaches the loader, the linter, the question builder and
    // the set reader -- the whole reading half of the instrument -- and it costs nothing.
    const out = execFileSync(process.execPath, [join(root, 'scripts', 'ask.mjs'), '--list'], { encoding: 'utf8' })
    assert.match(out, /set\(s\) in/, 'and it printed the sets it found')
    assert.match(out, /news-claim-check@2/, 'including a composition this repository ships')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
