// MEASURE THE CUT LINE: what reaches the harness, and what does not.
//
// The folder split (`core/` vs `dsh/`) was measured, not declared, and the plan of record (`ROADMAP.md` §14.8) says
// that cut line is the WRONG one: a file belongs to the package if it speaks the SESSION-LOG FORMAT and stays with
// the plugin if it speaks the HARNESS'S LIVE EVENT STREAM. This script prints the measured graph so the judgement is
// made against what the code does rather than against what a folder name suggests.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Strip COMMENTS and keep STRINGS.
 *
 * The first version of this blanked every string literal, which also blanked the IMPORT SPECIFIERS -- so the scan
 * found no imports at all and reported the harness's own plugin as harness-free. A scanner that cannot see the thing
 * it is looking for is worse than no scanner, so the strings stay and the comments go.
 */
const strip = (text) => {
  let out = ''
  let index = 0
  let string = null
  while (index < text.length) {
    const char = text[index]
    const next = text[index + 1]
    if (string !== null) {
      out += char
      if (char === '\\') { out += next ?? ''; index += 2; continue }
      if (char === string) string = null
      index += 1
      continue
    }
    if (char === "'" || char === '"' || char === '`') { string = char; out += char; index += 1; continue }
    if (char === '/' && next === '/') {
      while (index < text.length && text[index] !== '\n') index += 1
      continue
    }
    if (char === '/' && next === '*') {
      index += 2
      while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) index += 1
      index += 2
      continue
    }
    out += char
    index += 1
  }
  return out
}

const specifiers = (file) => {
  const text = strip(readFileSync(file, 'utf8'))
  const out = []
  const re = /(?:\bfrom\s+|\bimport\s*\(|\bimport\s+|\brequire\s*\()\s*['"`]([^'"`]+)['"`]/g
  for (const m of text.matchAll(re)) out.push(m[1])
  return out
}

/** Every source file the repository owns, in the folders that matter. */
const files = []
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) { walk(full); continue }
    if (entry.endsWith('.js') || entry.endsWith('.mjs')) files.push(full)
  }
}
for (const dir of ['core', 'dsh', 'scripts']) walk(join(ROOT, dir))

/** Resolve a relative specifier to a file in the tree. */
const resolveSpec = (from, spec) => {
  if (!spec.startsWith('.')) return null
  const target = resolve(dirname(from), spec)
  for (const candidate of [target, `${target}.js`, `${target}.mjs`, join(target, 'index.js')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

/** The graph: file -> the files it reaches. */
const edges = new Map()
for (const file of files) {
  const out = new Set()
  for (const spec of specifiers(file)) {
    const target = resolveSpec(file, spec)
    if (target) out.add(target)
    else if (!spec.startsWith('.') && !spec.startsWith('node:')) out.add(`BARE:${spec}`)
  }
  edges.set(file, out)
}

/** The harness-facing modules, named. */
const HARNESS = [
  'dsh/index.js', 'dsh/client.js', 'dsh/host-events.js', 'dsh/host-payload.js',
  'dsh/config-value.js', 'dsh/host/index.js', 'dsh/host/fs-journal.js',
  'dsh/session-adapter/lib/reader.js', 'dsh/session-adapter/lib/surface-authority.js',
].map((p) => join(ROOT, p))
const harnessSet = new Set(HARNESS)

/** The transitive harness-dependency of a file: the harness modules it reaches, and whether it reaches a bare package. */
const reaches = (file) => {
  const seen = new Set()
  const harness = new Set()
  const bare = new Set()
  const stack = [file]
  while (stack.length > 0) {
    const current = stack.pop()
    if (seen.has(current)) continue
    seen.add(current)
    for (const target of edges.get(current) ?? []) {
      if (typeof target === 'string' && target.startsWith('BARE:')) { bare.add(target.slice(5)); continue }
      if (harnessSet.has(target)) harness.add(relative(ROOT, target))
      stack.push(target)
    }
  }
  return { harness: [...harness].sort(), bare: [...bare].sort(), closure: seen.size }
}

const rel = (f) => relative(ROOT, f)

console.log('=== FILES THAT REACH THE HARNESS (these stay in dsh-system1-observer) ===\n')
const coupled = []
for (const file of files) {
  const r = reaches(file)
  if (r.harness.length > 0) coupled.push({ file: rel(file), harness: r.harness, bare: r.bare, closure: r.closure })
}
coupled.sort((a, b) => a.file.localeCompare(b.file))
for (const c of coupled) {
  console.log(`${c.file}  ->  ${c.harness.join(', ')}${c.bare.length ? `   [bare: ${c.bare.join(', ')}]` : ''}`)
}

console.log(`\n=== FILES THAT REACH NO HARNESS (candidates for system1-measure) ===\n`)
const free = []
for (const file of files) {
  const r = reaches(file)
  if (r.harness.length === 0) free.push({ file: rel(file), bare: r.bare, closure: r.closure })
}
free.sort((a, b) => a.file.localeCompare(b.file))
let total = 0
for (const f of free) {
  const lines = readFileSync(join(ROOT, f.file), 'utf8').split('\n').length
  total += lines
  console.log(`${String(lines).padStart(5)}  ${f.file}${f.bare.length ? `   [bare: ${f.bare.join(', ')}]` : ''}`)
}
console.log(`\ncoupled: ${coupled.length} files | harness-free: ${free.length} files, ${total} lines`)

console.log('\n=== THE BARE SPECIFIERS IN THE HARNESS-FREE SET (what a package would have to depend on) ===')
const bareAll = new Set()
for (const f of free) for (const b of f.bare) bareAll.add(b)
for (const b of [...bareAll].sort()) console.log(' ', b)
