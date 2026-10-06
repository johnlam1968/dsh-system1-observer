// THE DEPLOYMENT'S RECORDED DECISIONS, AND THE DRIFT BETWEEN THEM AND WHAT IS ACTUALLY MOUNTED.
//
// WHY THIS EXISTS AT ALL. `ROADMAP.md` §14.6 (e): the profile at `$DSH_HOME/profiles/docdrift` is **not under version
// control**, and one tooling rewrite already dropped a mounted bundle silently (`F105`). Three things there are
// load-bearing and exist nowhere else: the exact bundle list, the patch that carries the persona override and this
// plugin's rows, and the `peer-bridge` plugin, whose source lives ONLY in the profile directory. `deploy/profile/`
// carries a copy of each; this module is the comparison that says whether the copy still describes the machine.
//
// IT IS A CHECK'S LOGIC, NOT RUNTIME CODE, which is why it sits beside `lib/citations.js` and `lib/compat.js` rather
// than inside `scripts/`: the comparison has to be testable without a profile on disk, and the script has to be thin
// enough to read.
//
// WHAT IS NOT RECORDED, deliberately: `node_modules/`, `data/`, `.plugin-manager/` and the `*.bak-*` files a tooling
// rewrite leaves behind. They are machine-local by construction -- a lockfile and a bundle list reproduce the first,
// and the rest are caches or backups of the very files this directory already carries.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** The files this directory records, relative to it. A file added to the profile and not here is the drift. */
export const RECORDED = Object.freeze([
  'cordis.yml',
  'cordis.patch.yml',
  'package.json',
  'pnpm-lock.yaml',
  'peer-bridge/index.js',
  'peer-bridge/package.json',
  'peer-bridge/smoke.mjs',
])

/** Every file under one directory, relative to it and sorted, so a comparison is about CONTENT and not about order. */
export function filesUnder(dir) {
  if (!existsSync(dir)) return []
  const found = []
  const walk = (current, prefix) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      const name = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) walk(full, name)
      else found.push(name)
    }
  }
  walk(dir, '')
  return found.sort()
}

/** The bundle list a profile package.json declares, or `null` when it declares none. */
export function bundlesOf(profilePackage) {
  const list = profilePackage?.dsh?.profile?.bundles
  return Array.isArray(list) ? list.map((name) => String(name)) : null
}

/**
 * The dependency specs a deployment cannot reproduce elsewhere.
 *
 * A `file:` path or an absolute path is a pin to THIS machine: a second host would copy the profile and fail to install.
 * `ROADMAP.md` §14.6 (e) records the pin half as "half-done" for exactly this reason, so they are REPORTED rather than
 * treated as drift -- the recorded file is right, and the note is that it is not portable.
 */
export function machineLocalPins(profilePackage) {
  const deps = profilePackage?.dependencies ?? {}
  return Object.entries(deps)
    .filter(([, spec]) => typeof spec === 'string' && (spec.startsWith('file:') || spec.startsWith('/')))
    .map(([name, spec]) => ({ name, spec }))
}

/**
 * What differs between the recorded copy and the live profile.
 *
 * @param recorded read of `deploy/profile/`
 * @param live     read of the profile directory, or `null` when there is none on this machine
 * @returns `{ problems, absent, pins, bundles }` -- `problems` empty means the copy still describes the machine
 */
export function compareDeploy(recorded, live) {
  if (live === null) {
    return { problems: [], absent: true, pins: machineLocalPins(recorded?.packageJson), bundles: bundlesOf(recorded?.packageJson) ?? [] }
  }
  const problems = []
  // `package.json` IS COMPARED BY ITS DECISIONS, NOT ITS BYTES. A byte comparison of it would report the same edit
  // twice -- once as "the file differs" and once as "the bundle list differs" -- and the second is the one a reader can
  // act on. Its dependencies are compared too, because a version that moved is a deployment that moved.
  for (const file of RECORDED) {
    if (file === 'package.json') continue
    const a = recorded?.files?.[file]
    const b = live?.files?.[file]
    if (a === undefined) { problems.push(`deploy/profile/${file} is not recorded`); continue }
    if (b === undefined) { problems.push(`${file} is recorded but absent from the live profile`); continue }
    if (a !== b) problems.push(`${file} DIFFERS from the live profile (${a.length} vs ${b.length} bytes) -- re-record it, or find out what changed it`)
  }
  // A BUNDLE THAT IS IN THE PROFILE AND NOT IN THE RECORD IS THE `F105` FAILURE. The list is compared by NAME and by
  // ORDER, because the order decides which layer wins.
  const recordedBundles = bundlesOf(recorded?.packageJson)
  const liveBundles = bundlesOf(live?.packageJson)
  if (recordedBundles === null || liveBundles === null) {
    problems.push('a profile package.json declares no `dsh.profile.bundles` list')
  } else if (recordedBundles.join('\n') !== liveBundles.join('\n')) {
    const missing = liveBundles.filter((name) => !recordedBundles.includes(name))
    const extra = recordedBundles.filter((name) => !liveBundles.includes(name))
    problems.push(`the bundle list differs: live-only ${JSON.stringify(missing)}, recorded-only ${JSON.stringify(extra)}, or the ORDER differs`)
  }
  const recordedDeps = recorded?.packageJson?.dependencies ?? {}
  const liveDeps = live?.packageJson?.dependencies ?? {}
  for (const [name, spec] of Object.entries(recordedDeps)) {
    if (liveDeps[name] === undefined) problems.push(`dependency ${name} is recorded but not in the live profile`)
    else if (liveDeps[name] !== spec) problems.push(`dependency ${name} moved: recorded ${JSON.stringify(spec)}, live ${JSON.stringify(liveDeps[name])}`)
  }
  for (const name of Object.keys(liveDeps)) {
    if (recordedDeps[name] === undefined) problems.push(`dependency ${name} is in the live profile and not in the record (${JSON.stringify(liveDeps[name])})`)
  }
  return { problems, absent: false, pins: machineLocalPins(live?.packageJson), bundles: liveBundles ?? [] }
}

/** Read one profile directory into the shape `compareDeploy` takes. Text files only, and never a throw. */
export function readDeploy(dir) {
  const files = {}
  let text = null
  const read = (path) => {
    try { return readFileSync(path, 'utf8') } catch { return undefined }
  }
  for (const file of RECORDED) files[file] = read(join(dir, file))
  text = read(join(dir, 'package.json'))
  let packageJson = null
  try { packageJson = text === undefined ? null : JSON.parse(text) } catch { packageJson = null }
  return { files, packageJson, exists: existsSync(dir) && statSync(dir).isDirectory() }
}
