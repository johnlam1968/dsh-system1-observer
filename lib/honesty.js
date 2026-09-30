// WHAT THIS RECORD CLAIMS ABOUT ITSELF, AND WHAT NOBODY HAS CHECKED.
//
// This plugin's central claim is "it decides nothing". That claim lives in the README and in comments, and it is
// enforced only by the fact that nobody uses the return value. **Nothing on a trace line said what was claimed,
// how it was enforced, or that nobody verified it** -- so a reader could not tell "structurally cannot act" from
// "acts, but this run happened not to".
//
// The idea is ported from a run envelope whose validator REFUSES any other value, so the artifact cannot lie
// about having been checked. Two constants and an assertion; the point is not the strings, it is that they are
// asserted in the test suite, where flipping `verified` to `true` requires deleting the assertion deliberately.
//
// `enforcement: 'declarative'` is exact, not modest: there is no sandbox and no runtime gate here. The invariant
// is the SHAPE of the code -- this module's return values are read by the record and by nothing else -- and a
// shape is a declaration, not an enforcement.
import { createHash } from 'node:crypto'

/** How "it decides nothing" is enforced. Not a sandbox, not a runtime gate: the code shape. */
export const ENFORCEMENT = 'declarative'
/** Whether anyone observed that enforcement holding. Nobody has. Asserted, never observed. */
export const VERIFIED = false

/**
 * What this plugin does, declared rather than discovered.
 *
 * The allow-list is deliberately narrow and named after the SURFACES it touches, so adding one is a visible act.
 */
export const CAPABILITIES = Object.freeze([
    'read-seam-text', // observes the text at the loop's seams
    'call-decision-model', // one HTTP call per observed seam
    'write-trace', // appends JSONL to its own file
    'register-tool', // one read-only tool for the trace
    'render-settings', // the settings card
    'session-menu-item', // one row in a session's "..." menu
])

/**
 * What it must never do, whatever else changes.
 *
 * Each name is a surface another plugin in this ecosystem legitimately has -- which is exactly why the list is
 * explicit: the failure this guards against is not malice, it is a later contributor adding a resident prompt
 * section or a tool guard because it seemed useful, at which point "it decides nothing" quietly stops being true.
 */
export const FORBIDDEN_CAPABILITIES = Object.freeze([
    'approval-answer', // never answers a human-approval request
    'tool-argument-rewrite', // never modifies what a tool is about to receive
    'prompt-section', // never injects resident context into the system prompt
    'context-prune', // never removes anything from a context
    'model-route', // never selects or overrides a model
])

/**
 * Construction gate: a declaration that cannot be checked is a comment.
 *
 * Named errors rather than one generic throw, because "which invariant broke" is the only thing an operator
 * needs from this and it costs nothing to say.
 */
export function assertCapabilities(declared = CAPABILITIES, forbidden = FORBIDDEN_CAPABILITIES, allowed = CAPABILITIES) {
    // FORBIDDEN FIRST. A capability that is both undeclared and forbidden is forbidden -- checking the
    // allow-list first would report the weaker of the two facts, and "it is not on the list" invites the fix
    // "then put it on the list".
    for (const name of declared) {
        if (forbidden.includes(name)) throw new Error(`capability_forbidden: ${name}`)
    }
    for (const name of declared) {
        if (!allowed.includes(name)) throw new Error(`capability_not_declared: ${name}`)
    }
    // A capability that is both declared-allowed and forbidden is a contradiction, and picking a winner silently
    // is how a declaration stops meaning anything.
    for (const name of allowed) {
        if (forbidden.includes(name)) throw new Error(`capability_contradictory: ${name}`)
    }
    return declared
}

/**
 * Every call pattern that would mean a forbidden capability, as source text.
 *
 * The drift guard is a SEARCH rather than a promise: the moment someone adds a resident prompt section, the test
 * that says "no injected context" fails on the line they added. Deliberately textual and deliberately dumb --
 * a clever check here would be a second thing to trust.
 */
export const FORBIDDEN_SURFACES = Object.freeze([
    { capability: 'prompt-section', pattern: /systemPrompt\s*\.\s*(section|context)\s*\(/u },
    { capability: 'tool-argument-rewrite', pattern: /tools\s*\.\s*guard\s*\(/u },
    { capability: 'approval-answer', pattern: /\b(ctx|child)\s*\.\s*(approval|userQuestions)\b/u },
    { capability: 'context-prune', pattern: /\b(ctx|child)\s*\.\s*(compaction|tokenMeter)\b/u },
    { capability: 'model-route', pattern: /\b(ctx|child)\s*\.\s*(agentDefaultModel|subagentModelSelection)\b/u },
])

/** The capabilities a block of source would require, by the surfaces it touches. */
export function capabilitiesIn(source) {
    const text = typeof source === 'string' ? source : ''
    return FORBIDDEN_SURFACES.filter(entry => entry.pattern.test(text)).map(entry => entry.capability)
}

/**
 * A digest over WHAT A READ COULD AND COULD NOT SEE.
 *
 * THE SKIP COUNT IS PART OF THE HASH, and that is the whole idea: a reader that hashed only what it successfully
 * read would leave the digest unchanged while a file became unreadable or quietly disappeared. Mixing the
 * counts in makes every such degradation visible as a fingerprint change -- a trace with 4,000 scored calls and
 * a trace with 0 must not hash the same.
 */
export function readDigest({ scored = 0, full = 0, truncated = 0, unreadable = 0, skipped = {}, windowTruncated = false } = {}) {
    const skippedPart = Object.entries(skipped)
        .map(([reason, count]) => `${reason}=${count}`)
        .sort()
        .join(',')
    return createHash('sha256')
        .update(`scored=${scored};full=${full};truncated=${truncated};unreadable=${unreadable};skipped=${skippedPart};window=${windowTruncated ? 'partial' : 'whole'}`)
        .digest('hex')
        .slice(0, 12)
}
