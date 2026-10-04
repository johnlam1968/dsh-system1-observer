import { isRecord } from '../is-record.js';
// The response is narrowed with property checks, and anything unexpected is an
// error. There is no default answer here and no coercion: an answer we cannot
// read is an answer we do not have -- but "we do not have it" is a fact about THAT
// QUESTION, not about the whole reply, so it is recorded per question rather than
// returned as one error for everything. Only a body we cannot read AT ALL is a
// top-level error.
//
// READABLE AND WRONG IS NOT THE SAME AS UNREADABLE, and that distinction is the second half of this file. A
// reply that answers a `choice` question with a `noul`, or that carries a probability vector summing to 1.8, is
// perfectly readable -- and it is the most interesting thing that can arrive, because it is a fact about the
// server. Those are recorded as `invalid: true` with a reason BESIDE the answer rather than discarded: a gate
// that throws them away cannot show what it threw away.
//
// WHY THE FINITE CHECKS MATTER MORE THAN THEY LOOK. `typeof NaN === 'number'`, so every `typeof x === 'number'`
// test in here accepted `NaN`, and `JSON.stringify` writes `NaN` as `null` -- so the line read
// `"probability": null`, indistinguishable from "no answer was read". One such call then poisons every
// aggregate taken from the run, because a mean over `[0.9, 0.8, NaN, 0.7]` is `NaN`. Every number is therefore
// checked with `Number.isFinite` and written as `null` when it fails, WITH a reason on the line.
/** Probabilities must sum to 1 within this tolerance. The upstream decision servers use the same one. */
const PROBABILITY_TOLERANCE = 0.02;
function largestProbability(probabilities) {
    if (!isRecord(probabilities))
        return undefined;
    const values = Object.values(probabilities).filter((v) => typeof v === 'number' && Number.isFinite(v));
    return values.length === 0 ? undefined : Math.max(...values);
}
/** A finite number inside a closed range. `typeof NaN === 'number'`, so this is deliberately not a typeof test. */
function finiteInRange(value, min, max) {
    return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}
/** A number JSON can carry honestly. A non-finite one becomes `null`, and the reason says why. */
function finiteOrNull(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
/** How a value reads inside a reason: `NaN`, `1.8`, `"high"`. */
function describe(value) {
    return typeof value === 'string' ? JSON.stringify(value) : String(value);
}
/**
 * The probability keys a question offered.
 *
 * A `choice`'s criteria are a RECORD keyed by label; a `score`'s are a LIST of levels, index 0 first, so its
 * vector is keyed `'0'..'n-1'`. `undefined` when the question does not describe them, which records no defect:
 * inventing one from a shape we do not recognise would be worse than saying nothing.
 */
function expectedKeys(question) {
    if (question.type === 'choice')
        return isRecord(question.criteria) ? Object.keys(question.criteria) : undefined;
    if (question.type === 'score')
        return Array.isArray(question.criteria) ? question.criteria.map((_, index) => String(index)) : undefined;
    return undefined;
}
/**
 * A `probabilities` object with every non-finite value replaced by `null`.
 *
 * This also repairs `largestProbability`, which used to let a `NaN` win `Math.max` and turn a confidence into
 * `NaN` -- the value that started all of this.
 */
function withoutNonFinite(probabilities) {
    if (!isRecord(probabilities))
        return undefined;
    const value = {};
    for (const [key, entry] of Object.entries(probabilities)) {
        value[key] = typeof entry === 'number' && !Number.isFinite(entry) ? null : entry;
    }
    return value;
}
/**
 * Every way this answer can be READABLE AND WRONG. An empty list means nothing here found a defect -- not that
 * the answer is correct, which only comparing it to the text can say.
 */
function defectsOf(question, raw, answer) {
    const found = [];
    if (typeof raw.type === 'string' && raw.type !== question.type)
        found.push(`the answer declares type "${raw.type}" for a ${question.type} question`);
    if (raw.confidence !== undefined && !finiteInRange(raw.confidence, 0, 1))
        found.push(`confidence ${describe(raw.confidence)} is not a finite number in [0,1]`);
    if (raw.answer_confidence !== undefined && !finiteInRange(raw.answer_confidence, 0, 1))
        found.push(`answer_confidence ${describe(raw.answer_confidence)} is not a finite number in [0,1]`);
    if (question.type === 'noul' && !finiteInRange(raw.noul, 0, 1))
        found.push(`noul ${describe(raw.noul)} is not a finite number in [0,1]`);
    if (question.type === 'score') {
        const levels = Array.isArray(question.criteria) ? question.criteria.length : undefined;
        if (!Number.isFinite(raw.score))
            found.push(`score ${describe(raw.score)} is not a finite number`);
        else if (levels !== undefined && (raw.score < 0 || raw.score > levels - 1))
            found.push(`score ${describe(raw.score)} is outside the ${levels} level(s) the question offered`);
    }
    if (raw.probabilities !== undefined) {
        if (!isRecord(raw.probabilities)) {
            found.push('probabilities is not an object');
        }
        else {
            const entries = Object.values(raw.probabilities);
            const nonFinite = entries.filter((entry) => typeof entry === 'number' && !Number.isFinite(entry)).length;
            const outOfRange = entries.filter((entry) => typeof entry === 'number' && Number.isFinite(entry) && (entry < 0 || entry > 1)).length;
            if (nonFinite > 0)
                found.push(`${nonFinite} probability value(s) are not finite numbers`);
            if (outOfRange > 0)
                found.push(`${outOfRange} probability value(s) are outside [0,1]`);
            const expected = expectedKeys(question);
            if (expected !== undefined) {
                const keys = Object.keys(raw.probabilities);
                // A SCORE'S PROBABILITIES NAME THEIR LEVELS, AND THE WIRE HAS BEEN SEEN DOING IT BOTH WAYS. Measured
                // live: `{"no: the operator had to supply the answer...": 0.97, "partly: ...": 0.03, "yes: ...": 0}`
                // -- keyed by the LEVEL TEXT. `expectedKeys` returns INDICES for a score, which is what `legend`
                // names, so measuring against indices alone flagged a VALID answer as invalid with a message that
                // contradicted itself: "probabilities carry 3 key(s) where the question offered 3". Both encodings
                // name the same options, so either satisfies the check, and a genuinely wrong key set satisfies
                // neither.
                const byLevelText = question.type === 'score' && Array.isArray(question.criteria)
                    ? question.criteria.map((level) => String(level))
                    : null;
                const names = (candidate) => candidate !== null && candidate !== undefined
                    && keys.length === candidate.length
                    && candidate.every((key) => keys.includes(key));
                if (!names(expected) && !names(byLevelText)) {
                    const missing = expected.filter((key) => !keys.includes(key));
                    const extra = keys.filter((key) => !expected.includes(key));
                    found.push(`probabilities carry ${keys.length} key(s) where the question offered ${expected.length}${missing.length > 0 ? `, ${missing.length} missing` : ''}${extra.length > 0 ? `, ${extra.length} unexpected` : ''}`);
                }
            }
            // A sum over a vector that already failed a value check says nothing, so it is not reported twice.
            if (nonFinite === 0 && outOfRange === 0) {
                const sum = entries.reduce((total, entry) => total + (typeof entry === 'number' ? entry : 0), 0);
                if (Math.abs(sum - 1) >= PROBABILITY_TOLERANCE)
                    found.push(`probabilities sum to ${sum.toFixed(2)}`);
            }
        }
    }
    return found;
}
/**
 * A `choice`'s criteria, as a map from label to criterion. The `choice` question is the
 * only one whose criteria are a RECORD -- `score`'s are a list and `noul`'s are keyed
 * true/false -- so the label is only checked against one of those two shapes.
 */
function criterionLabels(question) {
    if (question.type !== 'choice')
        return undefined;
    return question.criteria;
}
/** Attach the defects, if any, without disturbing the answer they describe. */
function markInvalid(answer, defects) {
    if (defects.length === 0)
        return answer;
    answer.invalid = true;
    answer.invalidReason = defects.join('; ');
    return answer;
}
export function narrowAnswers(body, questions) {
    if (!isRecord(body) || !isRecord(body.answers)) {
        return { kind: 'error', reason: 'the response carried no answers object' };
    }
    const given = body.answers;
    const answers = {};
    for (const [qid, question] of Object.entries(questions)) {
        const raw = given[qid];
        if (!isRecord(raw)) {
            answers[qid] = { type: 'unreadable', reason: `the response carried no answer for ${qid}` };
            continue;
        }
        // AN ANSWER THAT ALREADY SAYS IT IS UNREADABLE PASSES ITS OWN REASON THROUGH. `lib/model/service-answers.js`
        // carries the provider's status here, because the empty record it used to send made THIS reader report "is not
        // a score" -- a statement about an answer's shape -- for a request the provider had refused outright.
        if (raw.type === 'unreadable' && typeof raw.reason === 'string') {
            answers[qid] = { type: 'unreadable', reason: raw.reason };
            continue;
        }
        if (question.type === 'noul') {
            if (typeof raw.noul !== 'number') {
                answers[qid] = { type: 'unreadable', reason: `the answer for ${qid} is not a noul probability` };
                continue;
            }
            const answer = {
                type: 'noul',
                probability: finiteOrNull(raw.noul),
                confidence: finiteOrNull(typeof raw.confidence === 'number' ? raw.confidence : Math.max(raw.noul, 1 - raw.noul)),
            };
            answers[qid] = markInvalid(answer, defectsOf(question, raw, answer));
            continue;
        }
        // A score is a real number -- the expected level over the ordered criteria --
        // and NOT a label. Measured: score 1.3734 with probabilities summing to it.
        if (question.type === 'score') {
            if (typeof raw.score !== 'number') {
                answers[qid] = { type: 'unreadable', reason: `the answer for ${qid} is not a score` };
                continue;
            }
            const probabilities = withoutNonFinite(raw.probabilities);
            const confidence = typeof raw.confidence === 'number'
                ? finiteOrNull(raw.confidence)
                : finiteOrNull(largestProbability(probabilities));
            if (confidence === null && raw.confidence === undefined && probabilities === undefined) {
                answers[qid] = { type: 'unreadable', reason: `the answer for ${qid} carried neither a confidence nor probabilities` };
                continue;
            }
            // confidence is carried but is NOT the signal for a score: it is low by
            // construction whenever the distribution is spread (measured at 0.15 where
            // p_max was 0.49). A caller thresholds the LEVEL, never this.
            const answer = probabilities === undefined
                ? { type: 'score', level: finiteOrNull(raw.score), confidence }
                : { type: 'score', level: finiteOrNull(raw.score), confidence, probabilities };
            answers[qid] = markInvalid(answer, defectsOf(question, raw, answer));
            continue;
        }
        const label = typeof raw.choice === 'string' ? raw.choice : undefined;
        if (typeof label !== 'string') {
            answers[qid] = { type: 'unreadable', reason: `the answer for ${qid} is not a ${question.type} label` };
            continue;
        }
        const criteria = criterionLabels(question);
        if (criteria === undefined || !Object.hasOwn(criteria, label)) {
            answers[qid] = { type: 'unreadable', reason: `the answer for ${qid} is "${label}", which the question never offered` };
            continue;
        }
        const probabilities = withoutNonFinite(raw.probabilities);
        const confidence = typeof raw.confidence === 'number'
            ? finiteOrNull(raw.confidence)
            : finiteOrNull(largestProbability(probabilities));
        if (confidence === null && raw.confidence === undefined && probabilities === undefined) {
            answers[qid] = { type: 'unreadable', reason: `the answer for ${qid} carried neither a confidence nor probabilities` };
            continue;
        }
        // `confidence` and the probability of the CHOSEN answer are not the same for a
        // choice. Measured on one reply: confidence 0.7514 beside answer_confidence 0.935,
        // and thresholding the first withheld a correct answer as "weakly supported". For
        // `noul` the two are equal, which is why this stayed hidden.
        const answerConfidence = typeof raw.answer_confidence === 'number'
            ? finiteOrNull(raw.answer_confidence)
            : confidence;
        const answer = probabilities === undefined
            ? { type: 'choice', label, confidence, answerConfidence }
            : { type: 'choice', label, confidence, answerConfidence, probabilities };
        answers[qid] = markInvalid(answer, defectsOf(question, raw, answer));
    }
    return { kind: 'ok', answers };
}
