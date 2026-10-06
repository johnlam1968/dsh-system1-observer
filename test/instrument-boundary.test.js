// THE INSTRUMENT'S BOUNDARY, CHECKED AGAINST THE CODE.
//
// (a) of the topology (`ROADMAP.md` §14.6) is "the instrument: seams, question composition and validation, the model
// call path, probe calibration, batteries, readings -- a pure package, no dsh import". It is still inline, and step 3
// of `docs/handoff.md` is what makes the eventual extraction a MOVE rather than a reshaping: the instrument must read
// no config of this plugin's.
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
  'lib/model/service.js',
  'lib/model/service-answers.js',
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

test('every file in the instrument set exists, and the set is the one that was measured', () => {
  const missing = INSTRUMENT.filter((file) => !existsSync(file))
  assert.deepEqual(missing, [], 'the instrument set names files that are not there: ' + missing.join(', '))
  // A SET THAT SHRANK SILENTLY IS THE FAILURE THIS PAIR EXISTS FOR. 23 is not a target; it is what the boundary was
  // measured at, so a file moving out of it has to be a change somebody made on purpose (`F110`).
  assert.equal(INSTRUMENT.length, 23, 'the instrument set changed size: say so in docs/findings.md and update this list')
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

test('the ONE host edge in the instrument is the service route, and it is named here', () => {
  // `ctx` IS THE HOST. `ROADMAP.md` §14.1 records that `lib/model/service.js` is the instrument's host edge -- the
  // decision model reached as a Cordis service, with the wire as fallback -- and this asserts it is still the ONLY
  // one, so a second edge cannot appear without a reader being told.
  const reaching = INSTRUMENT.filter((file) => /\bctx\.\w/.test(code(read(file))))
  assert.deepEqual(reaching, ['lib/model/service.js'], 'the instrument\'s host edge moved or multiplied: ' + reaching.join(', '))
})
