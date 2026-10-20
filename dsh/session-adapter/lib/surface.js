// THE SURFACE RULE, AND THE RULE IS THE PACKAGE'S NOW.
//
// This file USED TO BE the rule: it folded the log's own `surfaceOp: replace` spans and returned the records that
// remained visible. That was the second copy of a rule that decides what a row MEANS -- a `shadowed` flag is the
// difference between a message the model could read and one it could not, and 3,417 messages in a single dsh session
// sat inside a replaced span. The rule now lives ONCE, in `dsh-session-rows`, and this file is the SEAM: the
// observer's import path does not move, the session adapter keeps its vocabulary in one place, and the rule is
// stated once for every producer that has to obey it.
//
// THE FALLBACK IS UNCHANGED, and it is worth saying why. The header used to say this fold is redundant once the
// plugin is wired to the host's `sessionQuery`, and that is still true -- but it is ALSO redundant for a second
// reason now: the package carries the same fold, so the fallback a deployment with no `sessionQuery` relies on is
// the package's rule, not this file's.
//
// SO THE FILE STILL NOMINATES ITSELF, and the condition is unchanged: **when the plugin is wired to it this fold is
// redundant and should be deleted.** The package does not retire it -- the HOST AUTHORITY has to retire it, because
// the fallback is what a deployment with no `sessionQuery` relies on, and deleting the seam before that authority
// arrives brings back the shadowed-answer defect this file was written for. What the package retired is the SECOND
// COPY OF THE RULE, which is the thing that could drift; what is left is the seam that says where the rule is.
//
// AND THE RULE IS THE ONE THAT WAS HERE: read the op from the declaration rather than inferring it, treat only
// `replace` as removing anything, keep the ranges inclusive at both ends, and let a replacement's own record survive
// because its seq is outside its own range -- which is what makes the summary that replaces a history the surfaced
// message rather than a casualty of its own replacement.

export { surfaceEvents } from 'dsh-session-rows'
