import { isRecord } from '../is-record.js';
// Worst case, not average. One answer we are unsure of is enough to send the
// whole question to a person, which is the rule the record arrived at in 14.5.
/**
 * Whether an answer carries a numeric confidence. The value arrives from the decision
 * service and from the test suite, so it is narrowed rather than assumed: an answer with
 * no confidence is one the caller cannot read, which is `unavailable` and not zero.
 *
 * A predicate has to read the property before it can promise it, which is the one place
 * this repository's "narrow with property checks" rule needs an assertion at all -- and it
 * is an assertion about a value the check itself has already proved.
 */
function hasConfidence(answer) {
    return isRecord(answer) && typeof answer.confidence === 'number';
}
export function worstCase(answers) {
    const values = Object.values(answers).filter(hasConfidence).map((answer) => answer.confidence);
    return values.length === 0 ? undefined : Math.min(...values);
}
// UNEXPORTED, NOT DELETED (2026-10-18). Nothing in this repository -- lib, scripts, index, client or the tests --
// reads this name any more, so `export` on it was an invitation to use it. The body stays: it is either half of
// something already in use (`escalate` IS `worstCase` with a threshold) or the unused half of a feature that is
// built and works (see `resolveCitation`, which is the unresolved half of a citation report that prints raw paths).
// Deleting any of these is a decision for whoever owns the feature, so the export is withdrawn and the code is left
// where a reader will find it.
function escalate(answers, threshold) {
    const worst = worstCase(answers);
    return worst === undefined || worst < threshold;
}
