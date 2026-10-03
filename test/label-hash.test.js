// A DECLARED LABEL IS RECORDED AS A HASH, and the two ways that can go wrong are both about "nothing declared".
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LABEL_HASH_CHARS, labelHash } from '../lib/label-hash.js'

test('a declared label hashes to a stable 12-character digest', () => {
  const once = labelHash('v3 concise-directed')
  assert.equal(once.length, LABEL_HASH_CHARS)
  assert.match(once, /^[0-9a-f]{12}$/)
  assert.equal(labelHash('v3 concise-directed'), once, 'the same label is the same group every time')
  assert.notEqual(labelHash('v4 concise-directed'), once, 'a different label is a different group')
  // SURROUNDING SPACE IS NOT A DIFFERENT TECHNIQUE. A label typed with a trailing space in a card would otherwise
  // silently split one experiment into two, which is the failure mode this axis exists to avoid.
  assert.equal(labelHash('  v3 concise-directed  '), once)
})

test('NOTHING DECLARED is the empty string, never a hash of the empty string', () => {
  // "no label" and "a label whose text is empty" must not be the same value on a line: the first is a gap to report,
  // the second cannot occur.
  assert.equal(labelHash(''), '')
  assert.equal(labelHash('   '), '')
  assert.equal(labelHash(undefined), '')
  assert.equal(labelHash(null), '')
  assert.equal(labelHash(42), '')
  // AND A WHITESPACE-ONLY LABEL IS THE SAME "NOTHING DECLARED" AS AN EMPTY ONE -- which is the point of trimming:
  // the alternative is a hash of a space, which would look like a declared technique nobody declared.
  assert.equal(labelHash(' '), '')
})
