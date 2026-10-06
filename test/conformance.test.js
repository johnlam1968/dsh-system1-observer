// THE CONFORMANCE TEST: this plugin's SHAPE, checked against the documented conventions.
//
// WHY THIS FILE EXISTS. Four shape bugs and one flake survived 509 passing tests in this repo, because the
// tests were written from the same beliefs as the code -- a test that asserts the ledger [1,2,3] agrees with
// code that counts the ledger, whether or not the harness numbers turns that way. Every one of those bugs was
// eventually caught by reading a declaration. This file is that reading, made executable.
//
// Each test names the convention it checks and where the convention is written down. Citations are to the
// dsh-plugin-dev-kb mirror; the MODE of every event is a CHECKSUM of the generated `cordis-surface` entries, kept in
// `lib/host/index.js` beside the declarations so this file and `test/hooks-live.test.js` read ONE table rather than
// two. `docs/conventions.md` carries the record.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { readConfigValue } from '../lib/config-value.js'
import { HOST_EVENT_MODES, HOST_EVENTS } from '../lib/host/index.js'
import { DEFAULT_MAX_PER_SESSION } from 'dsh-session-adapter/feed'
import { DEFAULT_MAX_PATHS, DEFAULT_MAX_PER_PATH } from '../lib/host/fs-journal.js'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { createTraceTool } from '../lib/tool.js'
import { createConfigTool } from '../lib/config-tool.js'
import { createDecideTool } from '../lib/decide-tool.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (p) => readFileSync(join(ROOT, p), 'utf8')
const pkg = JSON.parse(read('package.json'))
const plugin = (await import(new URL('../index.js', import.meta.url).href)).default

const TRACE_TOOL = createTraceTool({ path: '/tmp/none.jsonl', runId: () => 'r', liveAgents: () => [] })
const CONFIG_TOOL = createConfigTool({ read: () => ({}), write: () => ({}), record: () => {} })
const DECIDE_TOOL = createDecideTool({ decide: async () => ({ kind: 'answers', answers: {} }), record: () => {} })

// ---------------------------------------------------------------------------------------------------------
// 1. Module shape -- basic/index.md:19-31, basic/config.md:31, framework/service.md:95
// ---------------------------------------------------------------------------------------------------------

test('module shape: the object form, with apply(ctx, config)', () => {
  // The documented object form is `export default { name, inject, apply }`, and config.md:31 gives apply its
  // resolved config as the SECOND argument. `export function apply` alone would also be legal; what would not
  // be legal is a default export that is not the object, or an apply that takes one argument.
  assert.equal(typeof plugin, 'object', 'the documented form is a default-exported object')
  assert.equal(typeof plugin.name, 'string')
  assert.ok(plugin.name.length > 0, 'name is required for diagnostics')
  assert.equal(typeof plugin.apply, 'function')
  assert.equal(plugin.apply.length, 2, 'apply(ctx, config) -- config.md:31')
  assert.ok(Array.isArray(plugin.inject), 'inject declares REQUIRED services -- service.md:95')
  for (const service of plugin.inject) assert.equal(typeof service, 'string')
  assert.equal(typeof plugin.Config, 'function', 'Config must be a Standard Schema, not a plain object -- config.md:47')
})

// ---------------------------------------------------------------------------------------------------------
// 2. Packaging -- basic/publish.md:20-64, and the dsh-plugin-settings-card skill's checklist item 3
// ---------------------------------------------------------------------------------------------------------

test('packaging: a bundle that names its patch, and a declared client half', () => {
  assert.equal(pkg.type, 'module')
  assert.equal(typeof pkg.main, 'string', 'publish.md:42 -- main names the entry')
  assert.equal(typeof pkg.dsh.bundle.patch, 'string',
    'the patch must be NAMED: `"bundle": true` reads no patch at all, silently (skill)')
  assert.ok(existsSync(join(ROOT, pkg.dsh.bundle.patch)), 'the named patch file exists')
  assert.ok(pkg.exports['./client'], 'the browser half is exported as ./client')
  assert.equal(pkg.dsh.client.platform, 'web', 'dsh.client declares the platform')
  for (const file of ['index.js', 'client.js', 'cordis.patch.yml']) {
    assert.ok(pkg.files.includes(file), `files must ship ${file}`)
  }
})

test('packaging: the patch inserts a row the profile can target by id', () => {
  const patch = read(pkg.dsh.bundle.patch)
  assert.ok(patch.includes(`id: ${plugin.name}`),
    'the profile overrides this row by id, so the id must be the one publish.md:127 describes')
  assert.ok(patch.includes(pkg.name),
    'the inserted row names the PACKAGE, so Node resolves the installed code -- publish.md:58')
})

// ---------------------------------------------------------------------------------------------------------
// 3. Config -- config.md:11-47, and the volatile accessor rule (skill section 3.1: the published mirror
//    documents `volatile` NOWHERE, which is why lib/config-value.js quotes the installed source instead)
// ---------------------------------------------------------------------------------------------------------

test('config: a volatile field is an accessor, and readConfigValue unwraps it', () => {
  // Composed through the REAL schema rather than a hand-built { get: () => v } stand-in, which would only
  // check the model of the boundary and not the boundary (skill, on schemastery materialising optionals).
  const config = plugin.Config({ callsEnabled: true, maxFieldChars: 42, seamEnabled: { assemble: false } })
  assert.equal(readConfigValue(config.callsEnabled), true,
    'a .volatile() field arrives as an accessor; read plain it is an object, and every comparison fails')
  assert.equal(readConfigValue(config.maxFieldChars), 42)
  assert.equal(readConfigValue(config.seamEnabled).assemble, false, 'a nested volatile object unwraps too')
  assert.equal(readConfigValue('plain'), 'plain', 'ordinary values must pass through untouched')
})

test('config: no tunable is reachable only by editing code', () => {
  // config.md:80-94 states the convention and its test: "can you change this value in cordis.yml without
  // changing code?" Five values failed that test. The defaults here must equal the module constants, so the
  // schema cannot drift away from the factory defaults it is standing in for.
  const config = plugin.Config({})
  assert.equal(readConfigValue(config.feedMaxPerSession), DEFAULT_MAX_PER_SESSION)
  assert.equal(readConfigValue(config.fsJournalMaxPaths), DEFAULT_MAX_PATHS)
  assert.equal(readConfigValue(config.fsJournalMaxPerPath), DEFAULT_MAX_PER_PATH)
  assert.equal(typeof readConfigValue(config.composeMaxChars), 'number')
  assert.equal(typeof readConfigValue(config.toolBlockMaxChars), 'number')
})

// ---------------------------------------------------------------------------------------------------------
// 4. Events -- the generated catalogue (source lines above), and framework/events.md:104-108 for the
//    Cordis-event versus persisted-session-event-type distinction
// ---------------------------------------------------------------------------------------------------------

test('events: every declared event is in the generated catalogue, with its mode', () => {
  const declared = Object.keys(HOST_EVENTS)
  assert.ok(declared.length > 0)
  for (const name of declared) {
    assert.ok(HOST_EVENT_MODES[name], `${name} is declared but is not in the catalogue checksum`)
    // The mode is checked WHERE THE DECLARATION STATES ONE. Requiring every description to name its mode was my
    // first version of this assertion and it failed on `session/event`, whose declaration describes what the event
    // carries rather than how it dispatches -- a test asserting a house style, not a convention.
    const stated = /^(emit|serial|waterfall|bail)\b/.exec(String(HOST_EVENTS[name]).trim())
    if (stated !== null) {
      assert.equal(stated[1], HOST_EVENT_MODES[name],
        `${name} is declared ${stated[1]} and the catalogue documents ${HOST_EVENT_MODES[name]}`)
    }
  }
})

test('events: every catalogue name this plugin relies on appears in the sources', () => {
  // THE ROW, THE INSTRUMENT'S POINT TABLE, AND THE APPLICATION'S EVENT MAP. The event names used to live in
  // `lib/seams.js`; they moved to `lib/host-events.js` so the instrument names no harness event at all (F110), and a
  // scan that did not follow them would report every one of them missing.
  const sources = read('index.js') + read('lib/seams.js') + read('lib/host-events.js')
  for (const name of Object.keys(HOST_EVENT_MODES)) {
    assert.ok(sources.includes(`'${name}'`), `${name} is in the checksum but nowhere in the row, the point table or the event map`)
  }
})

// ---------------------------------------------------------------------------------------------------------
// 5. The tool declarations, against the registry's OWN schema gate.
//    `adding-a-tool.md:44`: an explicit object node must declare `additionalProperties`, and a raw registration
//    skips the DSL path that would have compiled and checked it. The harness ships the gate itself --
//    `assertObjectJsonSchema` -- so the declaration is checked by the code that will receive it, not by a second
//    opinion of ours. Imported here and NOT by the plugin: `lib/tool.js:8` records why a module-level harness
//    import is wrong for a `link:` install, and a test is not the row.
// ---------------------------------------------------------------------------------------------------------

async function harnessPackage(name) {
  const candidates = []
  // LOCAL FIRST, AND BY ENTRY RATHER THAN BY MANIFEST: the suite must not require a global harness install to run.
  // `resolve(name)` asks for the package's own entry, which works whatever its `exports` map allows -- asking for
  // `<name>/package.json` depends on that map permitting the subpath, and one harness package does not.
  try {
    return import(pathToFileURL(createRequire(import.meta.url).resolve(name)).href)
  } catch { /* not declared as a dependency: fall through to the install */ }
  try {
    const root = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim()
    candidates.push(join(root, `@deepseek-ai/dsh/node_modules/${name}/package.json`))
    candidates.push(join(root, `${name}/package.json`))
  } catch { /* no npm on PATH */ }
  for (const manifest of candidates) {
    if (!existsSync(manifest)) continue
    return import(pathToFileURL(createRequire(manifest).resolve(name)).href)
  }
  throw new Error(`no reachable ${name}: declare it as a devDependency, or install a harness that provides it`)
}

test('every tool takes the caller\'s `exec`, so a cancellation can be honoured', () => {
  // `reference/cookbook/adding-a-tool.md:49`: "honour `exec.signal`; cancel in-flight work when it fires". Measured
  // 2026-10-05 (F112): FOUR of the eight tools ignored it ENTIRELY -- the four written after the first batch --
  // because the obligation lives in each tool\'s own `execute` and nothing required one. This names the signature;
  // the behavioural assertions live in each tool\'s test file, because a tool that takes `exec` and ignores it would
  // pass this scan.
  const tools = readdirSync('lib').filter((name) => name === 'tool.js' || name.endsWith('-tool.js'))
  assert.ok(tools.length >= 8, 'the scan found fewer tool files than the row registers')
  const offenders = tools.filter((name) => !/async execute\(args, exec\)/.test(read('lib/' + name)))
  assert.deepEqual(offenders, [], 'these tools cannot see exec.signal: ' + offenders.join(', '))
})

test('every tool declaration passes the registry\'s own object-schema gate', async () => {
  const { assertObjectJsonSchema } = await harnessPackage('@deepseek-ai/dsh-tools')
  const tools = [TRACE_TOOL, CONFIG_TOOL, DECIDE_TOOL]
  for (const tool of tools) {
    assert.equal(tool.parameters.type, 'object', `${tool.name} must be object-rooted`)
    assertObjectJsonSchema(tool.parameters)
  }
})

// ---------------------------------------------------------------------------------------------------------
// 6. The Loader's own export unwrapping, on this build.
//    `docs/dsh-plugin-contracts.md:39` asks for "a real Loader export-shape test", and this is one: the
//    harness's Loader is imported and its own `unwrapExports` is called on THIS module's namespace. It is the
//    authority three sources disagree about -- one template contracts page says a plugin has no default export,
//    the official form list names three forms including the object one -- and it answers by measurement:
//    `exports.default ?? exports`, so a default object IS what gets mounted, and the hazard belongs to the
//    function form, whose named exports are discarded if a stray default sits beside them.
// ---------------------------------------------------------------------------------------------------------

test('the Loader takes the object form: unwrapExports returns this module\'s default, by identity', async () => {
  const { default: Loader } = await harnessPackage('@deepseek-ai/cordis-plugin-loader')
  const unwrap = Loader.prototype.unwrapExports
  assert.equal(typeof unwrap, 'function', 'the Loader unwraps exports itself; this is that function, not a copy of it')
  const loader = Object.create(Loader.prototype)

  const namespace = await import(new URL('../index.js', import.meta.url).href)
  const mounted = unwrap.call(loader, namespace)
  assert.equal(mounted, plugin, 'the Loader mounts the DEFAULT object -- by identity, not a rebuilt copy')
  for (const key of ['name', 'inject', 'apply', 'Config']) {
    assert.ok(mounted[key] !== undefined, `the mounted value carries ${key}`)
  }

  // AND THE HAZARD THE OTHER RULE IS ABOUT, measured rather than repeated: a function-form namespace that also
  // carries a default mounts the DEFAULT and loses `name`, `inject` and `Config` -- which is why the two rules
  // are not in conflict, only about different forms.
  const strayed = unwrap.call(loader, { default: { apply: () => {} }, name: 'x', inject: [], Config: () => {} })
  assert.equal(strayed.name, undefined, 'a function plugin with a stray default loses its namespace exports')
  assert.equal(typeof strayed.apply, 'function', 'and mounts the default instead')
})
