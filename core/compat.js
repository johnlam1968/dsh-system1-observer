import { readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

// WHAT THIS PACKAGE WAS TESTED AGAINST, AND WHAT IT MERELY SUPPORTS.
//
// Two different claims, and conflating them is how a gate becomes noise:
//
//   `engines.node`                        the range this package SUPPORTS
//   `dsh.compatibility.testedAgainst`     the exact line it was RUN against
//
// CI exercises several supported Node lines, so a Node difference from the tested line is a NOTE. A DSH version
// that differs from the tested one is the floating-range incident itself -- the tests passed on a combination
// nobody ran -- and that is a FAILURE.
//
// IT SAYS WHEN IT CANNOT CHECK. `@deepseek-ai/dsh` is not a dependency of this package, so on a machine without
// one there is nothing to compare against, and a checker that silently passed there would be reporting a
// successful verification of nothing.
/**
 * @param manifest  the parsed `package.json`
 * @param runtime   `{ node, dsh }`, where `dsh` is the installed version or `undefined` when unresolvable
 * @returns `{ problems, notes }` -- problems fail, notes are printed and do not
 */
/**
 * WHERE AN INSTALLED `@deepseek-ai/dsh` MIGHT BE, in the order that answers the question best.
 *
 * THE GATE WAS PASSING WITHOUT CHECKING. `require.resolve` from this package's directory cannot see a global install or
 * a profile install, so `npm run ci` printed `note: could not check the DSH line` and EXITED ZERO -- a green run that
 * verified nothing, which is the failure this file's own header warns about and then committed anyway. Measured: the
 * harness is installed at `<node>/lib/node_modules/@deepseek-ai/dsh` and inside every profile, and resolvable from
 * neither place by the old call.
 *
 * THE PROFILE INSTALLS COME LAST AND MATTER MOST: that is the copy this plugin actually mounts into, so a DSH line
 * read from there is the one the tests and the mount both ran against.
 */
export function dshCandidates({ execPath = process.execPath, cwd = process.cwd(), home = homedir(), readdir = readdirSync } = {}) {
  const out = [join(cwd, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')]
  // THE PROFILE INSTALLS COME SECOND: a profile that bundles its own `dsh` is the copy this plugin actually mounts
  // into, so it must win over the global one. Measured on this machine, though, the profile has no `dsh` of its own --
  // `dsh docdrift` runs the GLOBAL binary against a profile whose `node_modules` holds plugins -- so the third rung is
  // what answers here, and the gate prints WHICH copy it read. The order is the priority, and the first version of
  // this had the profiles last, behind a global install that on some machines is a different copy entirely.
  try {
    for (const slug of readdir(join(home, '.dsh', 'profiles'))) {
      out.push(join(home, '.dsh', 'profiles', slug, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))
    }
  } catch {
    // NO PROFILES DIRECTORY IS NOT A FAILURE: a machine that has never run the harness has nothing to compare with,
    // and `checkCompatibility` already says so in a note rather than pretending it checked.
  }
  // And the Node global root last, because it is the fallback for a machine with no profile: `dirname(execPath)` is
  // the `bin` directory, so the global modules are one level across and down.
  out.push(join(dirname(execPath), '..', 'lib', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))
  return out
}

/** The first candidate that parses, with where it came from -- because a version nobody can locate is not evidence. */
export function findInstalledDsh(options = {}) {
  const read = options.readFile ?? readFileSync
  for (const candidate of dshCandidates(options)) {
    try {
      return { version: JSON.parse(read(candidate, 'utf8')).version, from: candidate }
    } catch {
      // A CANDIDATE THAT DOES NOT EXIST IS THE NORMAL CASE, not an error: three locations are tried and usually two miss.
    }
  }
  return { version: undefined, from: null }
}

export function checkCompatibility(manifest, runtime = {}) {
    const declared = manifest?.dsh?.compatibility?.testedAgainst
    const problems = []
    const notes = []
    if (declared === null || typeof declared !== 'object') {
        problems.push('dsh.compatibility.testedAgainst is not declared, so nothing here can be checked')
        return { problems, notes }
    }
    for (const key of ['node', 'dsh']) {
        if (typeof declared[key] !== 'string' || declared[key] === '') {
            problems.push(`dsh.compatibility.testedAgainst.${key} must be a version string`)
        }
    }
    if (typeof declared.note !== 'string' || declared.note === '') {
        problems.push('dsh.compatibility.testedAgainst.note must say what to re-run after an upgrade')
    }
    // The supported range has to be STATED, or a reader cannot tell a supported line from an untested one.
    if (typeof manifest?.engines?.node !== 'string' || manifest.engines.node === '') {
        problems.push('engines.node is not declared, so the supported range is unstated')
    }
    if (typeof declared.node === 'string' && declared.node !== runtime.node) {
        notes.push(`this runtime is Node ${runtime.node}; the TESTED line is ${declared.node} (engines: ${manifest?.engines?.node ?? '(unstated)'})`)
    }
    if (runtime.dsh === undefined) {
        notes.push('could not check the DSH line: no @deepseek-ai/dsh install is resolvable from here')
    }
    // ONLY COMPARED WHEN THE DECLARATION IS USABLE. A blank `dsh` is already reported above as invalid, and
    // echoing it as a drift would report one mistake twice and send the reader after the wrong fix.
    else if (typeof declared.dsh === 'string' && declared.dsh !== '' && runtime.dsh !== declared.dsh) {
        problems.push(`DSH ${runtime.dsh} is installed, declared tested against ${declared.dsh}`)
    }
    return { problems, notes }
}
