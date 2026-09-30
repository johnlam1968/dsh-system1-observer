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
