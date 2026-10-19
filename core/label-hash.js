// A DECLARED LABEL, AS A HASH ON THE LINE.
//
// Two facts the plugin cannot INFER are declared instead, because inferring them would confound the subject with the
// treatment: which HARNESS TECHNIQUE is in force (the system prompt, the steering, the loop policy) and which USER is
// driving. The assembled prompt contains the operator's request as well as the harness, so hashing that text would mix
// the two; and the plugin has no other sight of either.
//
// WHAT THIS HASH IS FOR: grouping. `harnessHash` and `userHash` are recorded on the line so a reader can ask "did this
// technique do better" or "does this user get more out of this model" -- the two questions ROADMAP §12 exists for.
//
// WHAT IT IS DELIBERATELY NOT: a comparability key. `lib/compare.js`'s `instrument` carries the model, the probe and
// the question set, and refuses comparison when they differ. Putting a technique or a user there would refuse exactly
// the comparison the device is for. Measured: `instrument` is built at `lib/compare.js:65` from the MOUNT line only.
//
// THE PRIVACY, STATED HONESTLY RATHER THAN CLAIMED. A 12-hex-character prefix of a SHA-256 digest is what
// `probeFingerprint` and `setHash` already use for questions and sets, so this is consistent -- but a short, guessable
// label is not protected by it: someone holding the trace can enumerate candidate labels and match. That is judged
// acceptable HERE because the trace already holds redacted excerpts of the conversation, so the labels are not the most
// sensitive thing in it. If a label ever needs to be unguessable, the fix is not a longer prefix: it is a random
// opaque id that the operator stores beside the label, and that change belongs in one place -- this file.
import { createHash } from 'node:crypto'

/** How much of the digest is kept. Twelve hex characters is what the rest of this repository records. */
export const LABEL_HASH_CHARS = 12

/**
 * The hash of a declared label, or `''` when nothing was declared.
 *
 * An empty string is returned rather than a hash of the empty string, because "no label declared" and "a label whose
 * text is empty" must not be the same value on a line: the first is a gap to be reported, the second cannot occur.
 */
export function labelHash(label) {
  const text = typeof label === 'string' ? label.trim() : ''
  if (text === '') return ''
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, LABEL_HASH_CHARS)
}
