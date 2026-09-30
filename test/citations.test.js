// A CLONE OF THIS REPOSITORY MUST BE ABLE TO RESOLVE WHAT ITS COMMENTS CITE.
//
// Two comments point into the SIBLING `system1-runtime` repository. They are true where they were written and
// unresolvable where they are read -- which is the finding this turns into a check. The finding class is
// `unknown`, deliberately: a pinned sibling pointer and a committed file are both acceptable answers.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { KNOWN_SIBLING_CITATIONS, citationsIn, findDanglingCitations } from '../lib/citations.js'

const root = join(fileURLToPath(import.meta.url), '..', '..')

test('this package’s citations are exactly the known sibling ones, and no new ones', () => {
  const { findings, known } = findDanglingCitations({ root })
  assert.deepEqual(findings, [], 'a NEW dangling citation fails this test')
  // Counted as SITES, not as paths: `lib/seams.js` cites the field guide twice, and each site is a place a
  // reader is sent to something that is not here.
  assert.ok(known.length >= 2)
  for (const entry of known) {
    assert.equal(entry.verdict, 'unknown', 'neither pass nor fail: an acceptable answer exists in two forms')
    assert.ok(KNOWN_SIBLING_CITATIONS.some(item => item.path === entry.path), `${entry.path} must be a named debt`)
    assert.match(entry.file, /\.js$/)
    assert.ok(entry.line > 0, 'a finding carries where it was made')
  }
})

test('a citation is a backticked docs path with an extension, in a comment, and nothing else', () => {
  const dir = mkdtempSync(join(tmpdir(), 'citations-'))
  writeFileSync(join(dir, 'sample.js'), [
    '// see `docs/PRESENT.md` for the mechanism',
    '/** and `docs/ALSO_HERE.md` from the block comment */',
    'const x = "docs/NOT_A_CITATION.md"  // in code, not a comment',
    '// prose about the `docs/...` shorthand is not a path',
    '// and `docs/no-extension` is not a file either',
  ].join('\n'))
  const found = citationsIn(join(dir, 'sample.js'), dir)
  assert.deepEqual(found.map(entry => entry.path), ['docs/PRESENT.md', 'docs/ALSO_HERE.md'])
  assert.deepEqual(found.map(entry => entry.line), [1, 2])
})

test('an existing file resolves, and a missing one is reported with its citing site', () => {
  const dir = mkdtempSync(join(tmpdir(), 'citations-'))
  mkdirSync(join(dir, 'docs'), { recursive: true })
  writeFileSync(join(dir, 'docs', 'PRESENT.md'), '# here\n')
  writeFileSync(join(dir, 'code.js'), [
    '// `docs/PRESENT.md` is resolvable',
    '// `docs/ABSENT.md` is not',
  ].join('\n'))
  const { findings } = findDanglingCitations({ root: dir, files: [join(dir, 'code.js')] })
  assert.equal(findings.length, 1, 'only the absent one is a finding')
  assert.equal(findings[0].path, 'docs/ABSENT.md')
  assert.equal(findings[0].line, 2)
  assert.equal(findings[0].verdict, 'unknown')
})

test('the check reads this package’s real sources, so it cannot pass by looking at nothing', () => {
  const { findings, known } = findDanglingCitations({ root })
  assert.ok(findings.length + known.length > 0, 'a check with no inputs proves nothing')
})
