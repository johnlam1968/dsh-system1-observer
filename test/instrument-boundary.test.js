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
// THE SET WAS 22 FILES AND THE DIRECTORY IS 61, AND THE GAP WAS THE PROBLEM. `core/` holds the instrument, and it also
// holds the application, the tools, the readers and the report -- and only 22 of the 60 were checked, so a `dsh/`
// import could appear in any of the other 38 with nothing failing. The boundary is now declared over the WHOLE
// directory, in two lists, and a file that moves between them has to be a change somebody made on purpose.
//
// THE COUPLING IS TRANSITIVE, and the first version of this was wrong about that. It checked each file's OWN imports,
// so `core/battery-tool.js`, `core/decide-tool.js`, `core/turn-listener.js` and `core/turn-trigger.js` were declared
// PORTABLE while reaching `dsh/host-events.js` THROUGH `core/instrument-input.js` -- and the portable list said so in
// as many words, which is how a claim like that survives. The walk follows the graph, so the coupled list is the
// TRANSITIVE closure: **6 of the 61 files are coupled to the dsh side and 55 are portable**, and those six are the
// whole dsh surface of `core/`. A pi extension -- or any other host -- binds at those six and nowhere else.
//
// AND THE FOUR THAT ARE NOT IN THAT SIX WERE NOT ALWAYS PORTABLE. They were declared COUPLED for one reason -- they
// imported `core/instrument-input.js` for `questionGroup`, and that file reached `dsh/host-events.js` -- and the pure
// shape moved to `core/instrument-shape.js` on 2026-10-21 (`ROADMAP.md` §14.8 step 1), so they reach no harness event
// at all. A file that has become portable is PROMOTED, and a list that keeps an excuse that no longer holds is a
// list that has stopped being a measurement.
//
// THREE MORE HOLES, all found by a review that read the code rather than the intent:
//
//   * THE SCAN MISSED THREE IMPORT FORMS. It matched `from '...'`, so a side-effect `import '...'`, a dynamic
//     `await import('...')` and a `require('...')` were all invisible -- and a dsh import through any of them would
//     have passed. All four forms are matched now.
//   * THE COMMENT STRIPPER WAS NOT STRING-AWARE, so a literal `'/*'` inside a string opened a block comment that
//     swallowed the rest of the file -- and every import after it was invisible. The stripper now tracks strings.
//   * A `.mjs` OR `.cjs` FILE IN `core/` WAS INVISIBLE: the walk took only `.js`, so a `core/thing.mjs` importing dsh
//     was neither declared nor scanned. Every file in the directory is walked now, and one that is not a `.js` must be
//     declared or it fails.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { normalize, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The instrument, as files: every `core/` file that must stay portable.
 *
 * The line between this list and the application is a judgement, not a namespace, so it is written down: these are
 * the files whose subject is the MEASUREMENT -- the loop's vocabulary, question composition and validation, the model
 * call path, probe calibration, batteries, cost, redaction and the record's own shape. Everything that binds a row,
 * mounts a listener, or offers a tool is the application, and several of those files are equally pure but are not
 * counted here because they exist only to serve this repository's row.
 *
 * IT WAS FIFTY-FIVE, AND THE FORTY-TWO THAT LEFT ARE THE PACKAGE'S. `ROADMAP.md` §14.8's cut moved the measurement's
 * own machinery into `system1-measure`: the question sets, the composition, the chain, the format, the producer, the
 * reader and the rules. What is left here is the row's GLUE -- the settings tool, the seam subscription, the session
 * scope, the harness's own telemetry, and the tools this plugin offers an agent.
 *
 * AND THE MEANING OF "PORTABLE" CHANGED WITH IT. A file on this list now depends on node builtins, on itself, and on
 * `system1-measure` -- which is the portable half, and the reason these files are portable rather than merely pure.
 * The rule that says so is the one below, and it was widened to name the package rather than to keep a rule that no
 * longer described the tree.
 */
export const INSTRUMENT = Object.freeze([
  'core/citations.js',
  'core/compat.js',
  'core/config-event.js',
  'core/config-writer.js',
  'core/decide-tool.js',
  'core/deploy-drift.js',
  'core/explain-tool.js',
  'core/publish-tag.js',
  'core/results-tool.js',
  'core/service.js',
  'core/turn-listener.js',
  'core/turn-observer.js',
  'core/zeroclaw-interchange.js',
])

/**
 * The `core/` files that are COUPLED to this harness, and why each one is.
 *
 * THESE SIX ARE THE WHOLE DSH SURFACE OF `core/`, and that is the number that matters for a second host: everything
 * else in the directory is already portable, so a pi extension -- or any other harness -- binds at these six and
 * nowhere else. **EACH OF THE SIX ESCAPES DIRECTLY** -- `config-tool.js` and `sessions.js` to `dsh/config-value.js`,
 * `instrument-input.js` to `dsh/host-events.js`, `register.js` to three dsh files, `turn-observer.js` to
 * `dsh/turn-state.js`, and `telemetry.js` by reaching `ctx` -- so none of them needs another core file to get there.
 * That was NOT true of the list before: four of the ten reached `dsh/host-events.js` only THROUGH
 * `core/instrument-input.js`, which is why the walk follows the graph at all.
 *
 * IT WAS TEN, AND THE FOUR THAT LEFT ARE THE POINT OF `ROADMAP.md` §14.8 STEP 1. `core/battery-tool.js`,
 * `core/decide-tool.js`, `core/turn-trigger.js` and `core/turn-listener.js` were coupled for ONE reason: they
 * imported `core/instrument-input.js` for `questionGroup`, and that file imported `dsh/host-events.js` to build the
 * point descriptor. The pure shape moved to `core/instrument-shape.js` and the two host bindings are now passed IN,
 * so those four reach no harness event at all -- and this list is not allowed to keep an excuse that no longer holds.
 *
 * THE LIST IS PINNED. A coupled file may be ADDED here only by changing the count below, which is the same discipline
 * `test/growth.test.js` uses for a size budget: raising a limit is a deliberate act this file exists to force, and a
 * file that has become portable is PROMOTED to the instrument list rather than left carrying an excuse.
 */
export const HOST_COUPLED = Object.freeze({
  'core/config-tool.js': "the settings tool, and it reads this row's own config to render it",
  'core/instrument-input.js': "the point descriptor, and the point CARRIES the host event name (dsh/host-events.js)",
  'core/register.js': 'the seam subscription, so it reaches `ctx` and the dsh payload shapes',
  'core/sessions.js': "the session scope, and it reads this row's own config for the scope it may read",
  'core/telemetry.js': "the harness's OWN outbound telemetry, and mounting it reaches `ctx`",
})

/** How many files may be coupled to the dsh side. Raising this is a decision, and the reason lives above. */
export const HOST_COUPLED_MAX = 5

/**
 * COMMENTS ARE PROSE and are stripped before the scan, because a module that DOCUMENTS a config reader does not call
 * one. `test/host-inventory.test.js` learned this the expensive way (its third bug: a header naming `ctx.on(...)` read
 * as a subscription), and this is the same stripper in miniature rather than a second tokenizer.
 *
 * AND IT IS NOW STRING-AWARE, which it was not. A literal `'/*'` inside a string opened a block comment that ran to
 * the end of the file, and every import after it was invisible -- so a file could hide a `dsh/` import behind a
 * string. Strings are tracked here, with their escapes, so a comment marker inside one is just a character.
 *
 * AND IT IS NOW REGEX-AWARE, which it also was not, and this one was found by an independent review rather than by a
 * failure: a regex literal holding a quote -- `/it's/` -- put the stripper into string mode, so the `//` of the next
 * comment was read as code and the comment's text was scanned for imports. A file with no import at all was reported
 * as importing a host module, because a COMMENT mentioned one. A gate that cries wolf is a gate that gets ignored, so
 * the fix is here: a `/` that is neither `//` nor `/*` starts a regex literal when the code before it says one can,
 * and the body of that literal is opaque -- quotes inside it are not quotes.
 */
const code = (text) => {
  let out = ''
  let index = 0
  let string = null
  let keepString = false
  let line = false
  let block = false
  // WHAT MAY PRECEDE A REGEX LITERAL. This is the standard reading, and it is a READING rather than a proof: a `/`
  // after an operator is a regex, and a `/` after a value is a division. The failure mode is chosen on purpose -- a
  // misread that hides an import is worse than one that reports a false positive.
  const PRECEDES_REGEX = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^'])
  const REGEX_KEYWORDS = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'case', 'do', 'else', 'yield', 'await', 'void', 'delete', 'new'])
  // AND WHERE A STRING IS A SPECIFIER, which is the ONE place a string is the argument of an import and its content
  // has to survive the scan.
  const SPECIFIER_BEFORE = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*|\brequire\s+)$/
  const lastSignificant = () => {
    for (let at = out.length - 1; at >= 0; at -= 1) {
      const char = out[at]
      if (char !== ' ' && char !== '\t' && char !== '\n' && char !== '\r') return char
    }
    return ''
  }
  const lastWord = () => {
    const match = /([A-Za-z_$][A-Za-z0-9_$]*)\s*$/.exec(out)
    return match === null ? '' : match[1]
  }
  const startsRegex = () => {
    const before = lastSignificant()
    if (before === '') return true
    if (PRECEDES_REGEX.has(before)) return true
    return REGEX_KEYWORDS.has(lastWord())
  }
  while (index < text.length) {
    const char = text[index]
    const next = text[index + 1]
    if (line) { if (char === '\n') { line = false; out += char } index += 1; continue }
    if (block) {
      if (char === '*' && next === '/') { block = false; index += 2; continue }
      if (char === '\n') out += char
      index += 1
      continue
    }
    if (string !== null) {
      if (char === '\\') { if (keepString) out += char + (next ?? ''); index += 2; continue }
      if (char === string) { string = null; out += char; index += 1; continue }
      // THE CONTENT OF A STRING IS PROSE, NOT CODE, and the scan has to know that. `core/report.js` carries the line
      // `'> The numbers below are read from `readings.json` in this package'`, and a scan that reads string contents as
      // code found `from `readings.json`` in it -- an import of a file that does not exist, reported against a file that
      // imports nothing but node builtins. So the content is BLANKED, and kept in the one place it is the argument of
      // an import.
      if (keepString) out += char
      index += 1
      continue
    }
    if (char === '/' && next === '/') { line = true; index += 2; continue }
    if (char === '/' && next === '*') { block = true; index += 2; continue }
    if (char === '/' && startsRegex()) {
      // THE BODY OF A REGEX LITERAL IS OPAQUE, and a quote inside it is not a quote. The body is dropped rather than
      // kept, because a regex that CONTAINS the word `import` is not an import.
      index += 1
      let inClass = false
      while (index < text.length) {
        const body = text[index]
        if (body === '\\') { index += 2; continue }
        if (body === '\n') break
        if (body === '[') inClass = true
        else if (body === ']') inClass = false
        else if (body === '/' && !inClass) { index += 1; break }
        index += 1
      }
      out += ' '
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      string = char
      keepString = SPECIFIER_BEFORE.test(out)
      out += char
      index += 1
      continue
    }
    out += char
    index += 1
  }
  return out
}

/**
 * EVERY IMPORT FORM, and there are four.
 *
 * `from '...'` was the only one the first version of this scan matched, so a side-effect `import '...'`, a dynamic
 * `await import('...')` and a `require('...')` were all invisible -- and a `dsh/` import through any of them would
 * have passed a gate that read as exhaustive.
 *
 * AND A TEMPLATE LITERAL COUNTS TOO, which the first version of this scan also missed: `import(\`...\`)` is a dynamic
 * import like any other, and a gate that catches three forms and says it catches them all is a gate with a hole in it.
 */
const IMPORTS = /(?:\bfrom\s+|\bimport\s*\(|\bimport\s+|\brequire\s*\()\s*['"`]([^'"`]+)['"`]/g

/** The specifiers a file imports, by every form. */
const importsOf = (file) => [...code(read(file)).matchAll(IMPORTS)].map((match) => match[1])

/** The specifiers a SOURCE STRING imports, so a case can be written down instead of injected into the tree. */
const importsIn = (text) => [...code(text).matchAll(IMPORTS)].map((match) => match[1])

const read = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : '')

/**
 * THE FILES A FILE REACHES, and the ones it reaches OUTSIDE `core/`.
 *
 * The graph is followed, because the coupling is transitive: `core/battery-tool.js` imports `core/instrument-input.js`
 * and never mentions `dsh/`, and it is coupled to the harness all the same. The walk stops at `core/` and reports the
 * first escape it finds, which is the import that made the file coupled.
 */
const escapesOf = (file) => {
  const seen = new Set()
  const queue = [file]
  const escapes = []
  while (queue.length > 0) {
    const current = queue.pop()
    if (seen.has(current)) continue
    seen.add(current)
    for (const specifier of importsOf(current)) {
      if (!specifier.startsWith('.')) continue
      const resolved = normalize(join(dirname(current), specifier))
      if (!resolved.startsWith('core/')) { escapes.push(`${current} imports ${specifier}`); continue }
      if (existsSync(resolved)) queue.push(resolved)
    }
  }
  return escapes
}

/** Whether a file reaches the host object directly. */
const reachesHost = (file) => /\bctx\.\w/.test(code(read(file)))

/** The repository root, from this file, so the clean-room copy is made of the real tree. */
const rootOfTest = normalize(join(dirname(fileURLToPath(import.meta.url)), '..'))

test('every file in the instrument set exists, and the set is the one that was measured', () => {
  const missing = INSTRUMENT.filter((file) => !existsSync(file))
  assert.deepEqual(missing, [], 'the instrument set names files that are not there: ' + missing.join(', '))
  // A SET THAT SHRANK SILENTLY IS THE FAILURE THIS PAIR EXISTS FOR. 13 is not a target; it is what the boundary was
  // measured at, so a file moving out of it has to be a change somebody made on purpose (`F110`). The forty-two that
  // left went to `system1-measure`, which is a change somebody made on purpose -- and it is recorded in
  // `docs/findings.md` and in `ROADMAP.md` §14.8.
  assert.equal(INSTRUMENT.length, 13, 'the instrument set changed size: say so in docs/findings.md and update this list')
})

/**
 * EVERY `core/` FILE IS DECLARED, in exactly one of the two lists.
 *
 * The old gate named 22 files and checked those 22, so the other 38 were outside the boundary without being outside
 * the directory -- and a `dsh/` import could land in any of them with nothing failing. This walks the directory
 * instead of trusting a hand-kept list, and it fails in BOTH directions: a new file nobody declared, and a file
 * declared in both lists.
 */
test('every core file is declared, in exactly one list', () => {
  const inCore = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      inCore.push(normalize(join('.', full)))
    }
  }
  walk('core')
  // THE MODULES ARE THE `.js` FILES, and the map is not a module: `core/README.md` is the MAP of this directory, and
  // `test/readme.test.js` holds it to the files that exist.
  const modules = inCore.filter((file) => file.endsWith('.js'))
  const declared = new Set([...INSTRUMENT, ...Object.keys(HOST_COUPLED)])
  const undeclared = modules.filter((file) => !declared.has(file))
  assert.deepEqual(undeclared, [], 'these core files are in neither list, so nothing holds them to the boundary:\n  ' + undeclared.join('\n  '))
  const both = modules.filter((file) => INSTRUMENT.includes(file) && Object.hasOwn(HOST_COUPLED, file))
  assert.deepEqual(both, [], 'these are declared portable AND coupled:\n  ' + both.join('\n  '))
  const elsewhere = [...declared].filter((file) => !inCore.includes(file))
  assert.deepEqual(elsewhere, [], 'these are declared but are not in core/:\n  ' + elsewhere.join('\n  '))
  // AND A FILE THAT IS NOT A `.js` IS NAMED, because the walk used to take only `.js` and a `core/thing.mjs` importing
  // dsh was then invisible to every check here. The map itself is the one exception: `core/README.md` is the MAP of the
  // directory, it is not a module, and no scan of this file could read it.
  const notJs = inCore.filter((file) => !file.endsWith('.js') && file !== 'core/README.md')
  assert.deepEqual(notJs, [], 'these are in core/ and are not JavaScript, so no scan of this file can see them:\n  ' + notJs.join('\n  '))
})

/**
 * THE COUPLED LIST IS A BUDGET, AND AN EXCEPTION THAT NO LONGER APPLIES IS PAPERWORK.
 *
 * `test/growth.test.js` does this for a file's size: the budget is signed, and raising it is a deliberate act. The
 * same is true here -- a file may be coupled to the dsh side, but the reason is written down, the count is pinned, and
 * a file that has become portable is PROMOTED rather than left carrying an excuse that no longer holds.
 */
test('every coupled file is still coupled, and the count is a budget', () => {
  const coupled = Object.keys(HOST_COUPLED)
  assert.equal(coupled.length, HOST_COUPLED_MAX,
    `the coupled list holds ${coupled.length} files and the budget is ${HOST_COUPLED_MAX}: say so in docs/findings.md, and write down why`)
  for (const file of coupled) {
    assert.ok(String(HOST_COUPLED[file]).length > 30, `${file} is coupled without a reason worth reading`)
    // AND A DECLARED EXCEPTION THAT NO LONGER BREAKS A RULE FAILS, so the list cannot be used to silence a violation.
    const escapes = escapesOf(file)
    assert.ok(escapes.length > 0 || reachesHost(file),
      `${file} is declared coupled but breaks no rule: promote it to the instrument list instead of leaving the excuse`)
  }
})

test('no instrument file imports, or calls, a config reader', () => {
  const offenders = []
  for (const file of INSTRUMENT) {
    const source = code(read(file))
    // THE IMPORT IS THE HARD EDGE; THE CALL is the one that would survive a re-export, so both are checked and both
    // are reported with the file, because "something reads the config" is not actionable and "core/redact.js does" is.
    if (/from\s+'[^']*config-value\.js'/.test(source)) offenders.push(file + ' imports config-value.js')
    if (/\b(readConfigValue|plainConfig|liveConfig)\s*\(/.test(source)) offenders.push(file + ' calls a config reader')
  }
  assert.deepEqual(offenders, [], 'the instrument reads this plugin\'s config:\n  ' + offenders.join('\n  '))
})

test('no instrument file imports anything but node builtins, itself and the package', () => {
  const offenders = []
  for (const file of INSTRUMENT) {
    const external = importsOf(file).filter((specifier) =>
      !specifier.startsWith('.') && !specifier.startsWith('node:') && !specifier.startsWith('system1-measure/'))
    for (const specifier of new Set(external)) offenders.push(file + ' imports ' + specifier)
  }
  // THIS IS THE EXTRACTION CLAIM IN ONE ASSERTION, AND THE CLAIM CHANGED WITH THE CUT. It used to read "nothing but
  // node builtins and itself", because the portable half lived HERE and the session adapter -- which is DSH-shaped
  // even though it is ours -- was the one thing that could not leave. Now the portable half is `system1-measure`, so
  // the rule names it: a file on this list may reach the package, and may reach nothing else. A module that imports
  // `@deepseek-ai/...` or any other third party is still refused, and the refusal is the same assertion.
  assert.deepEqual(offenders, [], 'the instrument depends on something outside node and the package:\n  ' + offenders.join('\n  '))
})

/**
 * THE SCAN READS CODE AND NOT PROSE, and it catches every import form.
 *
 * Both halves of that sentence were found by a failure rather than by an argument, and both are about a GATE: a gate
 * that reports an import that does not exist is a gate whose findings nobody quotes, and a gate that misses one is a
 * gate that was never there.
 */
test('the scan reads code and not prose, and it catches every import form', () => {
  // A STRING IS PROSE. `core/report.js` carries the line `'> The numbers below are read from `readings.json` in this
  // package'`, and a scan that read string CONTENTS as code found `from `readings.json`` in it -- an import of a file
  // that does not exist, reported against a file that imports nothing but node builtins.
  assert.deepEqual(importsIn("const line = '> The numbers below are read from `readings.json` in this package'"), [], 'prose in a string is not an import')

  // AND A REGEX LITERAL DOES NOT DESYNC THE SCAN. A quote inside one -- /it's/ -- used to put the scanner into string
  // mode, and every `//` comment after it stopped being a comment, so a comment mentioning a host import was read as
  // the import itself.
  assert.deepEqual(importsIn("const RX = /it's/\n// import { EVENT } from '../dsh/host-events.js'\nexport const x = 1"), [], 'a comment after a regex literal is still a comment')

  // AND THE FOUR FORMS ARE CAUGHT, plus the template literal, because a gate that catches three forms and says it
  // catches them all is a gate with a hole in it.
  for (const source of [
    "import { EVENT } from '../dsh/host-events.js'",
    "import '../dsh/host-events.js'",
    "const m = await import('../dsh/host-events.js')",
    "const m = require('../dsh/host-events.js')",
    "const m = await import(`../dsh/host-events.js`)",
  ]) {
    assert.deepEqual(importsIn(source), ['../dsh/host-events.js'], 'this form is caught: ' + source)
  }
})

test('no instrument file reaches OUT of core/, DIRECTLY or THROUGH another core file', () => {
  const offenders = []
  for (const file of INSTRUMENT) {
    const escapes = escapesOf(file)
    if (escapes.length > 0) offenders.push(`${file}: ${escapes[0]}`)
  }
  // THE WALK, NOT THE FILE. The first version of this checked each file's OWN imports, so four files were declared
  // PORTABLE while reaching `dsh/host-events.js` through `core/instrument-input.js` -- and the portable list said so in
  // as many words, which is how a claim like that survives. The coupling is transitive, so the check is too.
  assert.deepEqual(offenders, [], 'the instrument reaches the dsh side, directly or through another core file:\n  ' + offenders.join('\n  '))
})

test('no instrument file names a harness event, or reads the adapter\'s event catalogue', () => {
  const offenders = []
  for (const file of INSTRUMENT) {
    const source = code(read(file))
    // A STRING LITERAL THAT NAMES A HARNESS EVENT IS HOW THE BINDING RE-ENTERS. The id-to-event map moved to
    // `dsh/host-events.js` and the per-seam argument shapes to `dsh/host-payload.js`, so a name here again means the
    // harness is being re-imported by hand -- and `EVENT.AGENT_TURN_STOPPING` was the one import that made
    // `core/seams.js` depend on the adapter package at all.
    for (const match of source.matchAll(/'(?:agent|tools|llm|system-prompt)\/[a-z-]+(?:\/[a-z-]+)*'/g)) {
      offenders.push(file + ' names ' + match[0])
    }
    if (/\bEVENT\.[A-Z_]/.test(source)) offenders.push(file + ' reads the adapter EVENT catalogue')
  }
  assert.deepEqual(offenders, [], 'an instrument file names a harness event:\n  ' + offenders.join('\n  '))
})

test('the instrument has NO host edge: it reaches a model over HTTP and nothing else', () => {
  // THIS WAS THE WHOLE ARGUMENT, AND IT IS NOW THE WHOLE RESULT. `ROADMAP.md` §14.1 recorded one host edge in the
  // instrument -- `core/model/service.js`, the decision model reached as a Cordis service -- and this asserted it
  // stayed the only one, so a second could not appear without a reader being told. The edge existed because
  // `postSystemone` sent NO CREDENTIAL: the host route existed to borrow another plugin's key. The wire carries one
  // now (measured standalone, nothing but `fetch`), so the module is gone and so is the edge.
  //
  // The assertion is `[]` and not a list with one entry. A test that names the expected host dependency is a
  // description of the present, and this one used to read as a floor -- which is how a portable core can hold a hard
  // dependency for years while a green suite says "the ONE edge".
  const reaching = INSTRUMENT.filter((file) => reachesHost(file))
  assert.deepEqual(reaching, [], 'the instrument reaches the host again:\n  ' + reaching.join('\n  '))
})

// THE STANDALONE'S OWN BOUNDARY BELONGS TO THE PACKAGE, AND SAYING SO IS THE POINT.
//
// There were two tests here that walked the import graph from `scripts/ask.mjs` and asserted that everything it
// reaches loads with no `node_modules` at all, and that the standalone RUNS in a clean room with nothing installed.
// Both were the strongest claims this repository made, and both are now THE PACKAGE'S claims: `scripts/ask.mjs` is
// `bin/ask.mjs` in `system1-measure`, and `system1-measure/test/instrument-boundary.test.js` proves the same two
// properties about the same entry point.
//
// A TEST THAT LIVES IN THE WRONG REPOSITORY IS A TEST NOBODY RUNS. A copy here would be a second copy of a claim
// about a file that is not in this tree -- and it would rot the moment the package's entry point moved, which is
// exactly the kind of quiet rot this repository keeps recording. The rule is: the claim is checked where the claim
// is.
