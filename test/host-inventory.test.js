// THE ADAPTER'S INVENTORY, CHECKED AGAINST THE CODE.
//
// The objective says to route every host call through one adapter so porting means re-deriving that file. A list in a
// comment would drift the first time someone added a call, so this greps the source and fails on a literal call that
// is not declared, or a declaration with nothing behind it.
//
// THE SCANNER READ CODE AS TEXT, AND THREE BUGS FOLLOWED -- each found by printing the exact bytes rather than
// reasoning about them:
//   1. `lib/*.js` was not recursive, so `lib/model/service.js` was invisible.
//   2. `[A-Za-z]+` cannot match `system1`. A service name with a DIGIT was hidden by a character class.
//   3. comments counted as code: `lib/host/feed.js` documents `ctx.on('session/event', ...)` in its header, which the
//      purity check read as a subscription. Comments are stripped before extraction now.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { HOST_SERVICES, HOST_EVENTS, HOST_SYMBOL_REACHED, ADAPTER_MODULES } from '../lib/host/index.js'

const ROOT = process.cwd()
const NAME = '[A-Za-z0-9_-]+'
const read = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : '')
/**
 * Comments are PROSE and are stripped before extraction, because a module that documents an event does not subscribe
 * to it.
 *
 * THE STRIPPER IS LINE-AWARE, AND IT HAS TO BE. An earlier version removed block comments with one regex over the
 * WHOLE FILE, so a block-comment opener written INSIDE a line comment -- as prose, while quoting a namespace -- began
 * a block that ran to the next closer and swallowed everything between. Measured: it hid the `fs/observed`
 * subscription, which is plainly still subscribed, and the inventory reported it as a stale declaration. A checker
 * whose own input can be desynchronized by a comment is not checking the code.
 *
 * Quotes are tracked so that a `//` inside a string -- a URL, most often -- does not truncate the line. Known limit:
 * a regex literal containing `//` or a comment opener is still read as a comment, and a template literal spanning
 * lines is not tracked; neither can hide a `ctx.on('…')` or `ctx.get('…')` in practice, and naming the limit is
 * better than pretending to a tokenizer.
 */
const code = (text) => {
  let inBlock = false
  let quote = null
  return text.split('\n').map((line) => {
    let out = ''
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i]
      const two = line.slice(i, i + 2)
      if (inBlock) { if (two === '*/') { inBlock = false; i += 1 } continue }
      if (quote !== null) {
        out += ch
        if (ch === '\\') { out += line[i + 1] ?? ''; i += 1; continue }
        if (ch === quote) quote = null
        continue
      }
      if (two === '/*') { inBlock = true; i += 1; continue }
      if (two === '//') break
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; out += ch; continue }
      out += ch
    }
    if (quote !== null && quote !== '`') quote = null
    return out
  }).join('\n')
}

function jsFiles(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return jsFiles(full)
    return entry.isFile() && entry.name.endsWith('.js') ? [full] : []
  })
}

const ROW = code(read(join(ROOT, 'index.js')))
const LIB = jsFiles(join(ROOT, 'lib'))
  .filter((file) => !file.includes(join('lib', 'host')))
  .map((file) => code(read(file)))
  .join('\n')
// AND THE PACKAGES THIS REPOSITORY SHIPS, because a host edge moved there and an unscanned edge is an undeclared one:
// `dsh-session-adapter`'s plugin entry reaches `sessionQuery` with the same literal the row does. `lib/host` is excluded
// above for the same reason it is excluded for `lib`: it is the INVENTORY, prose about the host rather than a call to it.
const PACKAGES = jsFiles(join(ROOT, 'packages'))
  .map((file) => code(read(file)))
  .join('\n')

const grab = (text, pattern) => [...text.matchAll(pattern)].map((m) => m[1])
const servicesIn = (text) => grab(text, new RegExp(`ctx\\.get\\('(${NAME})'\\)`, 'g'))
const injectedIn = (text) => [...text.matchAll(new RegExp(`inject\\(\\[([^\\]]*)\\]`, 'g'))].flatMap((m) => grab(m[1], new RegExp(`'(${NAME})'`, 'g')))
const eventsIn = (text) => grab(text, new RegExp(`ctx\\.on\\('(${NAME}(?:/${NAME})*)'`, 'g'))
const unique = (list) => [...new Set(list)].sort()

test('every service reached BY LITERAL is declared, and no declaration is stale', () => {
  const used = unique([...servicesIn(ROW), ...injectedIn(ROW), ...servicesIn(LIB), ...injectedIn(LIB), ...servicesIn(PACKAGES), ...injectedIn(PACKAGES)])
  const declared = Object.keys(HOST_SERVICES)
  assert.deepEqual(used.filter((name) => !declared.includes(name)), [], 'an undeclared service is a host dependency nobody wrote down')
  assert.deepEqual(declared.filter((name) => !used.includes(name)), [], 'and a stale declaration claims one the plugin does not have')
  assert.ok(used.includes('system1'), 'system1 is reached by a literal in the row -- the digit is why it was invisible for three rounds')
})

test('every event subscribed BY LITERAL is declared, and no declaration is stale', () => {
  const used = unique([...eventsIn(ROW), ...eventsIn(LIB), ...eventsIn(PACKAGES)])
  const declared = Object.keys(HOST_EVENTS)
  assert.deepEqual(used.filter((name) => !declared.includes(name)), [], 'an undeclared event is a host dependency nobody wrote down')
  assert.deepEqual(declared.filter((name) => !used.includes(name)), [], 'and a stale declaration claims one the plugin does not have')
})

test('the symbol-reached tier names real files, and records the dynamic service resolution', () => {
  const entries = Object.entries(HOST_SYMBOL_REACHED)
  assert.ok(entries.length >= 3, 'constants, a variable and a table are all declared rather than omitted')
  assert.ok(Object.keys(HOST_SYMBOL_REACHED).some((key) => key.includes('ctx.get(name)')), 'the dynamic service key in lib/model/service.js is declared')
  for (const [key, description] of entries) {
    for (const match of description.matchAll(/\b((?:lib|test)\/[A-Za-z0-9/._-]+\.js)\b/g)) {
      assert.ok(existsSync(join(ROOT, match[1])), `${key} names ${match[1]}, which should exist`)
    }
  }
})

test('the adapter modules are PURE: no host service, no event subscription, comments notwithstanding', () => {
  for (const relative of ADAPTER_MODULES) {
    const text = code(read(join(ROOT, relative)))
    assert.notEqual(text, '', relative + ' should exist')
    assert.deepEqual(servicesIn(text), [], relative + ' must not read a host service')
    assert.deepEqual(injectedIn(text), [], relative + ' must not inject a host service')
    assert.deepEqual(eventsIn(text), [], relative + ' must not subscribe to a host event')
  }
})

test('the scan is RECURSIVE, so a nested lib file cannot hide a host call', () => {
  const nested = jsFiles(join(ROOT, 'lib')).filter((file) => file.includes(join('lib', 'model')))
  assert.ok(nested.length > 0, 'lib/model holds files')
  assert.ok(nested.some((file) => code(read(file)).includes('ctx.get(')), 'and at least one reaches a host service -- which the first, non-recursive scan could not see')
})
