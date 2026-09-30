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
export function escalate(answers, threshold) {
    const worst = worstCase(answers);
    return worst === undefined || worst < threshold;
}
