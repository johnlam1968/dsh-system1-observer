// THE README IS A FRONT PAGE, AND THAT IS NOW ENFORCED RATHER THAN PROMISED.
//
// The rule exists because this repository already grew a 775-line, 8,490-word README, and a measured evaluation said
// what that costs: judged as a front page it read as a CONTRIBUTOR document (0.57, against 0.27 for a first-time
// visitor), carried internal plumbing at 0.97, offered no install command in its first screen (0.13) and no way to
// ask for help (0.08), and graded 1.91 of 4 for the audience GitHub and opensource.guide describe. The landing page
// that replaced it graded 3.26 of 4. The measurements are in `docs/readme-standards.md`, with their limits.
//
// So the limit is not taste. It is the length at which the Standard Readme specification starts REQUIRING a table of
// contents -- at or below it, a README is still a single-screen document -- and GitHub's own guidance points the same
// way: a README carries what a developer needs to get started, and "longer documentation is best suited for wikis".
//
// A FAILING TEST HERE IS NOT A NUISANCE. It means reference material, a defect register row, or a repository rule is
// sitting where a first-time visitor has to walk past it. The fix is to MOVE it -- to `docs/manual.md` for reference,
// `docs/findings.md` for a defect, `docs/conventions.md` for a rule -- and never to raise this number without
// re-measuring the audience question above.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
const lines = readme.split('\n').length - (readme.endsWith('\n') ? 1 : 0)
const words = readme.split(/\s+/).filter(Boolean).length

/** Deliberately below the point where Standard Readme requires a table of contents, with room for an honest edit. */
const MAX_LINES = 100
const MAX_WORDS = 800

const WHERE = 'Move the material to docs/manual.md (reference), docs/findings.md (a defect), or docs/conventions.md '
  + '(a rule). Do not raise this limit without re-measuring the audience question in docs/readme-standards.md.'

test('the README stays a front page: at most ' + MAX_LINES + ' lines', () => {
  assert.ok(lines <= MAX_LINES, `README.md is ${lines} lines, over the ${MAX_LINES}-line cap. ${WHERE}`)
})

test('the README stays a front page: at most ' + MAX_WORDS + ' words', () => {
  // LINES ALONE ARE NOT A LIMIT: 100 long lines can hold a manual. The word ceiling is what makes the line cap real.
  assert.ok(words <= MAX_WORDS, `README.md is ${words} words, over the ${MAX_WORDS}-word cap. ${WHERE}`)
})

test('every repository link in the README is absolute, because npm renders this same file', () => {
  // npm shows the README from the tarball, where a relative link resolves against npmjs.com and breaks -- and the
  // Standard Readme specification requires that a README "must not contain broken links". Absolute links work on
  // both surfaces, so there is one front page instead of two documents to keep in agreement.
  const targets = [...readme.matchAll(/\]\(([^)\s]+)\)/g)].map(m => m[1])
  const relative = targets.filter(t => !t.startsWith('http') && !t.startsWith('#'))
  assert.deepEqual(relative, [], 'README.md links relatively to ' + relative.join(', ')
    + ': use the full https://github.com/johnlam1968/dsh-system1-observer/blob/master/<path> URL.')
})

test('the README says where to ask for help', () => {
  // MEASURED, and the single largest move in the whole exercise: the help path scored 0.08 on the manual and 0.11 on
  // the first landing page, and 0.99 once a paragraph and an issues link were there. It is the one line that moved a
  // question by a large, repeatable margin, and the ablation showed the MARGIN was the paragraph and the link rather
  // than the heading. So it is a gate and not a hope: the standard's biggest lever, enforced.
  // THE LINK, NOT THE WORD. The first version of this check matched /issues/ and /contribut/i, and it PASSED a page
  // whose issues link had been deleted -- because the heading still said "contributing" and the word "issues" still
  // appeared elsewhere. A gate that checks a WORD is not a gate on the THING, and the ablation that found it is the
  // one that matters: the paragraph and the LINK are what moved the reading from 0.11 to 0.99.
  assert.match(readme, /https:\/\/github\.com\/[^)\s]+\/issues/, 'the README must link to the issue tracker: a reader who cannot ask is stuck')
  assert.match(readme, /pull requests? are welcome|\]\([^)]*CONTRIBUTING[^)]*\)/i,
        'the README must say how to contribute -- a heading alone is not a way to contribute')
})

test('the front page names no internal gate, no CI command, and no defect register', () => {
  // MEASURED, 2026-10-22, and this is the gate the earlier one was missing. The page was measured with the twelve
  // questions and read as INTERNAL PLUMBING at 0.92 -- while the retired proposal page, measured on the same model
  // revision days later, read 0.35. The difference was two passages that only someone working ON this project
  // would need: a `npm run ci` block naming the six gates, and a pointer to the defect register. Moving them out
  // took the reading to 0.58, and taking the gate file's name out of one sentence took it to 0.53 -- with the help
  // path at 0.99 and the getting-started scope at 0.88 unchanged.
  //
  // So the front page is now held to the thing the measurement was about. A name here is a claim that this text is
  // for someone working on the project, and the measurement says that is exactly what it reads as.
  const internals = [
    /npm run /,                       // a CI command
    /test\/[A-Za-z0-9_.-]*\.test\.js/, // an internal gate's own file name
    /docs\/findings\.md/,           // the defect register
    /coverage floor/i,
    /the register/,
  ]
  const found = internals.filter((re) => re.test(readme))
  assert.deepEqual(found.map(String), [], 'the front page names internal material: ' + found.map(String).join(', ')
    + '. It belongs in CONTRIBUTING.md or docs/manual.md, and the measurement of what that costs is in '
    + 'docs/readme-standards.md.')
})

test('the manual exists, and the README points a reader at it', () => {
  // The length cap is only honest if what leaves the front page LANDS somewhere a reader can follow.
  assert.ok(existsSync(join(ROOT, 'docs', 'manual.md')), 'docs/manual.md is missing: the cap would have nowhere to put things')
  assert.match(readme, /docs\/manual\.md/, 'the README must link to docs/manual.md, or the moved material is unreachable')
})
