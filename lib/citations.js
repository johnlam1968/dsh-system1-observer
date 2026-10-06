// DOES EVERY `docs/...` PATH A COMMENT NAMES ACTUALLY EXIST?
//
// Every claim a source comment makes about documentation is only checkable if the file is there. A clone of THIS
// repository cannot resolve a citation that points into a SIBLING repository, and two of this repository's
// comments do exactly that -- they are true where they were written and unresolvable where they are read.
//
// The finding class is `unknown`, deliberately: neither pass nor fail, because a sibling pointer at a pinned
// commit and a committed file are BOTH acceptable answers, and a checker that called the first one a failure
// would push an author to delete a citation rather than complete one.
//
// WHAT WOULD CLEAR THE TWO KNOWN ONES: commit the cited files, or repoint the comments at a path inside this
// repository. Both are edits to source or docs, not to this checker.
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

/**
 * The citations that are known to point into the sibling repository.
 *
 * NAMED HERE RATHER THAN SILENCED. The check still finds them and still prints them with their file and line, so
 * the debt stays visible; it simply does not fail CI on pre-existing debt it cannot fix. A new dangling citation
 * -- the one somebody adds today -- does fail.
 */
export const KNOWN_SIBLING_CITATIONS = Object.freeze([
    { file: 'lib/evidence.js', path: 'docs/RUNTIME_SEMANTICS.md' },
    // ONE SIBLING POINTER, AT ITS NEW HOME. The per-seam argument shapes and their two citation sites were
    // `lib/seams.js`'s and are `lib/host-payload.js`'s now (`F110`); the old entry was removed with the code it named,
    // because the list is checked against the sites that EXIST and an entry outliving its site is a claim nobody
    // makes any more.
    { file: 'lib/host-payload.js', path: 'docs/DSH_CORDIS_FIELD_GUIDE.md' },
])

/** Every file this check reads: the source halves, and the library beside them. */
export function defaultSources(root) {
    const found = []
    for (const name of ['index.js', 'client.js']) {
        const path = join(root, name)
        if (existsSync(path)) found.push(path)
    }
    const lib = join(root, 'lib')
    const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const path = join(dir, entry.name)
            if (entry.isDirectory()) walk(path)
            else if (entry.name.endsWith('.js')) found.push(path)
        }
    }
    if (existsSync(lib)) walk(lib)
    return found
}

/**
 * A citation is a backticked `docs/` path WITH A FILE EXTENSION.
 *
 * The extension is required because a citation is a FILE, and prose uses the bare shorthand ("every `docs/...`
 * path") to mean the class rather than a path -- which the first version of this check reported as a dangling
 * citation against its own header. A rule that cannot tell a path from a description of paths produces findings
 * nobody can act on.
 */
const CITATION = /`(docs\/[^`\s]*\.(?:md|markdown|json|ya?ml|txt))`/gu

/**
 * Every citation in one file, with its line number.
 *
 * Only comments are searched: a citation in CODE would be a path being read at runtime, which is a different
 * question with a different answer.
 */
export function citationsIn(file, root) {
    const text = readFileSync(file, 'utf8')
    const out = []
    for (const [index, line] of text.split('\n').entries()) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*')) continue
        CITATION.lastIndex = 0
        let match
        while ((match = CITATION.exec(line)) !== null) {
            out.push({ file: relative(root, file), line: index + 1, path: match[1] })
        }
    }
    return out
}

/**
 * The citations this package cannot resolve.
 *
 * @param root  the package root every path is resolved against
 * @param files the files to read; defaults to `defaultSources`
 * @returns `{ findings, known }`, each finding carrying the citing `file:line` and the path it named
 */
export function findDanglingCitations({ root, files = defaultSources(root) } = {}) {
    const findings = []
    const known = []
    for (const file of files) {
        for (const citation of citationsIn(file, root)) {
            // `lstat`, not `stat`: a BROKEN SYMLINK to the sibling repository is the most likely way this is
            // half-satisfied, and `stat` would call it missing while `lstat` says the link is there.
            const target = join(root, citation.path)
            let exists = false
            try {
                lstatSync(target)
                exists = true
            }
            catch {
                exists = false
            }
            if (exists) continue
            const entry = { ...citation, verdict: 'unknown' }
            const isKnown = KNOWN_SIBLING_CITATIONS.some(item => item.path === citation.path && item.file === citation.file)
            if (isKnown) known.push(entry)
            else findings.push(entry)
        }
    }
    return { findings, known }
}

/** The path a citation resolves to, for a message a reader can act on. */
export function resolveCitation(root, path) {
    return join(dirname(join(root, 'index.js')), path)
}
