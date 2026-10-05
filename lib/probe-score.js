// DOES THE QUESTION ACTUALLY SEPARATE?
//
// The README and the code both promise an accuracy figure. Nothing computed one. This module computes it from
// the trace, where the data has been sitting all along: every `call` line carries the question that was asked
// and the answer that came back, and the harness -- not us -- says which seam produced the text. That
// ground truth is the design's real strength, and no competing plugin has it.
//
// TWO WAYS TO GET THIS WRONG, both of which produce a number that looks like a measurement:
//
//   1. SCORING BY SEAM. The row was reconfigured between runs, so the trace holds 15 distinct (seam, question)
//      pairs. Judging every `choice` at a seam against that seam's expected label scores 72.0% overall and
//      three seams at 0% -- which reads as a defect and is an artifact: those calls were asked different
//      questions.
//   2. SCORING BY QUESTION ID. `lib/questions.js` builds the operator's custom question under the SAME id as
//      the built-in probe (`QUESTION_ID = 'probe'`), and a configured per-seam spec may take that id too. Of
//      4,369 call lines, 816 are operator questions, several of them under the id `probe`.
//
// So the predicate is STRUCTURAL -- it compares against `PROBE_QUESTION` itself, imported rather than restated,
// the same precedent `lib/questions.js` set by importing `PROBE_SEAMS`.
//
// AND THE FLOOR IS NOT 1/9. `pre_execute` and `post_execute` are ~40% of all scored calls, so a model that
// ignored the text and always answered `before_a_tool_call` scores 39.94%. Reporting 88.99% against "1 in 9"
// overstates by roughly eight times, so the majority-class floor and Cohen's κ are computed here and are meant
// to be quoted beside the accuracy or not at all.
import { createHash } from 'node:crypto';
import { PROBE_QUESTION, PROBE_SEAMS } from './seams.js';
// NO CYCLE: `questions.js` imports `seams.js`, `model/questions.js`, `is-record.js` and `question-sets.js` -- not this
// module -- so the turn hook can be imported rather than retyped. A second copy of the literal 'turn' is a second
// answer to which sites count.
import { readDigest } from './honesty.js';
import { classwiseSamples, meanEntropy, multiclassBrier, multiclassLogLoss, samplesFor, scoreScalar } from './calibrate.js';
/** The option that means "none of these fits", and the only one that is not a seam. */
export const ABSTAIN_LABEL = 'unclear';
/** Every option the probe offers, in the order it offers them. */
export const PROBE_LABELS = Object.freeze(Object.keys(PROBE_QUESTION.criteria));
/**
 * The label each seam's text should produce. The probe's options and the nine seams are the same list in the
 * same order, which is what lets the harness's own seam be the ground truth.
 */
export const SEAM_OF_LABEL = Object.freeze({
    assembling_the_prompt: 'assemble',
    admitting_a_step: 'admit',
    requesting_from_the_model: 'request',
    model_output: 'draft',
    before_a_tool_call: 'pre_execute',
    during_a_tool_call: 'execute',
    after_a_tool_call: 'post_execute',
    recording_a_tool_result: 'result',
    closing_the_turn: 'close',
});
/**
 * The INVERSE of `SEAM_OF_LABEL`: the option a seam's text should produce.
 *
 * Both directions are needed and they are easy to confuse -- looking a seam up in the label-to-seam map returns
 * `undefined` for every row, which silently turns every calibration truth into 0 and makes the classwise ECE
 * equal the mean probability instead of a disagreement. That is exactly what it did before this existed.
 */
export const LABEL_OF_SEAM = Object.freeze(Object.fromEntries(
    Object.entries(SEAM_OF_LABEL).map(([label, seam]) => [seam, label]),
))

/**
 * The instrument's identity.
 *
 * THE QUESTION TEXT WAS AUTHORED BY INTUITION, so a run with edited instructions is a NEW MEASUREMENT, not a
 * comparison. The hash is recorded on the mount line so two runs can be told apart as instruments rather than
 * silently averaged.
 */
/**
 * THE SITES A PROBE ANSWER CAN COME FROM: THE NINE SEAMS, AND NOTHING ELSE.
 *
 * `turn` WAS LISTED HERE AND IS NOT, and the measurement is why. A probe row's ground truth is the SEAM its answer
 * label names (`:203`), so its `expected` is `LABEL_OF_SEAM[hook]` (`:185`) -- and there is no seam called `turn`.
 * Measured on this machine: a call line with `hook: 'turn'`, the probe question and an answer to it IS scored, gets
 * `expected: null`, and is therefore `correct: false` ALWAYS, with no per-seam bucket. It can never be right, so
 * scoring it can only drag a published accuracy down.
 *
 * THAT IS WHY THE TRIGGER REFUSES TO ASK THE PROBE ON A SCHEDULED HOOK, and the two rules now agree instead of
 * contradicting each other. The scheduled measurement is unaffected: it asks ITS OWN questions, which are not the
 * probe, so it never contributed a probe row that this filter could remove -- which is what register row O17 was
 * read as being about, and why its "two writers, two shapes" diagnosis is superseded.
 *
 * A TURN LINE DOES NOT BECOME SCORABLE BY RECORDING `questions` ON IT. That would turn today's silence into a WRONG
 * NUMBER in exactly the misconfiguration `lib/turn-trigger.js` refuses by name.
 */
const SCORABLE_SITES = new Set(PROBE_SEAMS.map((seam) => (typeof seam === 'string' ? seam : seam?.name)));

export function probeFingerprint(instructions = PROBE_QUESTION.instructions) {
    // THE INSTRUCTIONS ARE THE ARGUMENT because they ARE the identity: a row that rewords the question is a different
    // instrument, and the mount line's hash is what says so.
    return createHash('sha256').update(instructions).digest('hex').slice(0, 12);
}
/**
 * Whether this question IS the built-in probe.
 *
 * Structural on purpose: the id cannot be trusted (see the header) and the instructions alone would miss a
 * renamed option. The label COUNT plus every label being present is enough -- a reworded criterion is still the
 * same instrument, which is the honest reading, since only the labels decide what an answer means.
 */
/** The label set of the built-in probe: the half of the identity that never changes with the wording. */
function sameLabels(question) {
    const criteria = question.criteria ?? {};
    const expected = Object.keys(PROBE_QUESTION.criteria);
    return Object.keys(criteria).length === expected.length && expected.every((label) => label in criteria);
}

/**
 * WHETHER THIS QUESTION IS THE PROBE OF THE RUN THE LINE BELONGS TO.
 *
 * TWO IDENTITIES, IN ORDER OF STRENGTH, and the order is the whole point:
 *
 * 1. **The run's own recorded hash.** Every mount line carries `probeHash` -- the fingerprint of the question that
 *    was in force when the run started -- and every call line carries the question it actually asked. So a line is
 *    matched against the run IT belongs to, and the reader needs no configuration at all.
 * 2. **The instructions in force**, which is what this file did before identity (1) existed, and remains the
 *    fallback for a trace whose mount line is outside the window.
 *
 * Register row O15 is why (1) exists: a row that reworded its probe and then read its own older trace found NO probe
 * calls at all, because every old line was compared against the row's CURRENT question. The calibration read empty
 * rather than wrong, which is the failure mode that hides.
 */
export function isProbeOfRun(question, identity) {
    if (question === undefined || question === null || question.type !== 'choice')
        return false;
    const probeHash = typeof identity?.probeHash === 'string' ? identity.probeHash : '';
    if (probeHash !== '' && probeFingerprint(question.instructions) === probeHash)
        return sameLabels(question);
    return isProbeQuestion(question, identity?.instructions);
}

/** The older call shape passed the instructions as a bare string; both are accepted. */
function asIdentity(identity) {
    if (typeof identity === 'string') return { instructions: identity };
    if (identity !== null && typeof identity === 'object') return identity;
    return {};
}

export function isProbeQuestion(question, instructions = PROBE_QUESTION.instructions) {
    if (question === undefined || question === null || question.type !== 'choice')
        return false;
    // AGAINST THE ROW'S QUESTION, NOT ALWAYS THE BUILT-IN ONE. The constant is the default so every existing caller
    // and test keeps its meaning; without the parameter a row that rewords the probe would have every one of its
    // calls judged "not the probe" and dropped from every calibration -- SILENTLY, which is the failure mode this
    // whole file exists to avoid.
    if (question.instructions !== instructions)
        return false;
    return sameLabels(question);
}
/**
 * One probe call, as a scorable row. `null` when this event is not a probe call at all.
 *
 * An UNREADABLE answer is still a probe call -- it just is not a scored one. It gets its own bucket rather than
 * landing in the denominator as wrong: "the model answered something we could not read" and "the model read the
 * text wrongly" are different facts about the instrument, and 183 of 3,553 probe calls are the first.
 */
/** A per-tier percentage is suppressed below this many samples, because a rate over a handful is noise. */
export const TIER_FLOOR = 100
export function probeAnswerOf(event, identity) {
    const resolved = asIdentity(identity);
    if (event === null || typeof event !== 'object' || event.event !== 'call')
        return null;
    if (typeof event.hook !== 'string')
        return null;
    // AND THE HOOK MUST BE A PROBE SITE. Every call line a model produced is not a measurement of the probe question:
    // `system1_decide` records `hook: 'tool'` -- with the comment "`hook: 'tool'` is not a seam" at
    // `lib/decide-tool.js:212` -- and a stored-session evaluation records its own, and either can carry the probe
    // question by identity. Until this filter existed the rule was "any call with the probe question", which happened
    // to exclude them only because neither records a `questions` map: the DATA kept them out, not the RULE.
    if (!SCORABLE_SITES.has(event.hook))
        return null;
    const questions = event.questions;
    if (questions === null || typeof questions !== 'object')
        return null;
    const asked = Object.entries(questions).find(([, question]) => isProbeOfRun(question, resolved));
    if (asked === undefined)
        return null;
    const [qid] = asked;
    const answer = event.answer?.answers?.[qid];
    const row = {
        hook: event.hook,
        at: typeof event.at === 'string' ? event.at : null,
        qid,
        readable: false,
        label: null,
        abstain: false,
        correct: false,
        confidence: null,
        answerConfidence: null,
        probabilities: null,
        subject: null,
        // THE GROUND TRUTH IN LABEL SPACE, beside the seam it came from. `hook` is the true seam and `expected`
        // is the option that seam's text should have produced -- which is what calibration needs, since a
        // distribution is keyed by option and the truth has to be in the same space to be compared with it.
        expected: LABEL_OF_SEAM[event.hook] ?? null,
        // THE STRENGTH OF THE EVIDENCE FOR THIS CALL, as data rather than prose. A truncated excerpt is not a
        // measurement of the same thing as a full one, and an accuracy that silently mixed them would be a
        // number about neither. `lib/observe.js` marks a cut; this carries the mark into the metric.
        tier: event.truncated === true ? 'truncated' : 'full',
    };
    const subject = event.subject;
    if (subject !== null && typeof subject === 'object' && typeof subject.model === 'string')
        row.subject = subject.model;
    if (answer === null || typeof answer !== 'object' || answer.type === 'unreadable')
        return row;
    if (typeof answer.label !== 'string')
        return row;
    row.readable = true;
    row.label = answer.label;
    row.abstain = answer.label === ABSTAIN_LABEL;
    // THE GROUND TRUTH IS THE SEAM. A seam with no expected label (there is none among the nine, but a
    // configured row could name its own) is not scored rather than scored as wrong.
    const expected = SEAM_OF_LABEL[answer.label];
    row.correct = expected !== undefined && expected === event.hook;
    row.confidence = typeof answer.confidence === 'number' ? answer.confidence : null;
    row.answerConfidence = typeof answer.answerConfidence === 'number' ? answer.answerConfidence : null;
    row.probabilities = answer.probabilities !== null && typeof answer.probabilities === 'object' ? answer.probabilities : null;
    return row;
}
function tally(values, key) {
    const counts = new Map();
    for (const value of values) {
        const name = key(value);
        counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return counts;
}
function rate(part, whole) {
    return whole === 0 ? null : part / whole;
}
/**
 * The accuracy block, computed over every probe call in the events given.
 *
 * IMPORTANT: pass the RUN's events, not a hook-filtered subset. A `hook` filter would change which seams appear
 * in the confusion matrix while leaving the matrix labelled as if it covered the run -- a filter silently
 * redefining what the numbers mean.
 */
export function probeScore(events, options = {}) {
    // THE QUESTION TEXT IN FORCE FOR THIS ROW. It is the instrument's identity (`probeFingerprint` hashes it), so a
    // row that rewords the probe asks a different question and its own calls must still be recognised as probe calls.
    // Defaulting to the constant keeps every existing caller -- and every trace written before this existed -- exact.
    const instructions = typeof options.probeInstructions === 'string' && options.probeInstructions.trim() !== ''
        ? options.probeInstructions.trim()
        : PROBE_QUESTION.instructions
    // The report's bin count, passed down to every scalar so one report cannot mix two slicings of the same scale.
    const binCount = typeof options.calibrationBins === 'number' ? options.calibrationBins : undefined
    // THE RUN'S OWN INSTRUMENT, FROM ITS OWN MOUNT LINE -- which is in this array, because a window that carries
    // calls carries the mount that opened them. This is what makes the reader independent of the row's CURRENT
    // configuration: a line is matched against the question its run recorded, not against today's setting.
    const list = Array.isArray(events) ? events : [];
    const hashByRun = new Map();
    for (const event of list) {
        if (event?.event === 'mount' && typeof event.run === 'string' && typeof event.probeHash === 'string') {
            hashByRun.set(event.run, event.probeHash);
        }
    }
    const rows = [];
    for (const event of list) {
        const row = probeAnswerOf(event, { instructions, probeHash: hashByRun.get(event?.run) });
        if (row !== null)
            rows.push(row);
    }
    const scored = rows.filter((row) => row.readable);
    // PER TIER, because the two tiers measure different things. Reported only above the floor: a percentage
    // computed from nine calls is not a weaker result, it is not a result.
    const byTier = ['full', 'truncated'].map((tier) => {
        const ofTier = scored.filter((row) => row.tier === tier);
        const right = ofTier.filter((row) => row.correct).length;
        return {
            tier,
            n: ofTier.length,
            correct: right,
            accuracy: rate(right, ofTier.length),
            reported: ofTier.length >= TIER_FLOOR,
        };
    });
    const correct = scored.filter((row) => row.correct).length;
    const abstained = scored.filter((row) => row.abstain).length;
    const accuracy = rate(correct, scored.length);
    // THE FLOOR: always answering the COMMONEST TRUE SEAM. Not 1/9, and not 1/10 -- those are only honest over
    // a uniform mix, and the mix is skewed by construction because a loop calls some seams far more often.
    const bySeam = tally(scored, (row) => row.hook);
    let floorLabel = null;
    let floorCount = 0;
    for (const [label, count] of bySeam) {
        if (count > floorCount) {
            floorLabel = label;
            floorCount = count;
        }
    }
    const floor = rate(floorCount, scored.length);
    // COHEN'S κ: what remains of the accuracy once agreement by chance is removed.
    //
    // THE TWO SIDES LIVE IN DIFFERENT NAME SPACES AND MUST BE RELABELLED FIRST. A true class is a SEAM
    // (`pre_execute`); a predicted class is an OPTION (`before_a_tool_call`). Indexing the truth by seam and
    // the predictions by label makes every lookup miss, so `p_e` collapses to 0 and κ collapses to the raw
    // accuracy -- which is exactly the number this statistic exists to correct, reported as if it had been
    // corrected. Mapping each prediction through `SEAM_OF_LABEL` puts both on the same nine classes; the
    // abstain option maps to no seam and so contributes to the denominator but never to the agreement.
    const predictedBySeam = new Map();
    for (const row of scored) {
        const seam = SEAM_OF_LABEL[row.label];
        if (seam !== undefined)
            predictedBySeam.set(seam, (predictedBySeam.get(seam) ?? 0) + 1);
    }
    const total = scored.length || 1;
    let chance = 0;
    for (const [seam, count] of bySeam) {
        chance += (count / total) * ((predictedBySeam.get(seam) ?? 0) / total);
    }
    const kappa = accuracy === null || chance >= 1 ? null : (accuracy - chance) / (1 - chance);
    const labels = [...PROBE_LABELS];
    const seams = [...bySeam.keys()].sort();
    const confusion = seams.map((seam) => labels.map((label) => scored.filter((row) => row.hook === seam && row.label === label).length));
    // COVERAGE: "looked and found nothing" is not "could not look". Every event is counted, and the digest
    // mixes the skips in, so a trace that could not read something never hashes the same as one that read
    // everything and found it empty.
    const skipped = {};
    for (const event of Array.isArray(events) ? events : []) {
        if (event?.event !== 'skip') continue;
        const reason = typeof event.reason === 'string' ? event.reason : '(no reason)';
        skipped[reason] = (skipped[reason] ?? 0) + 1;
    }
    const full = byTier.find(entry => entry.tier === 'full')?.n ?? 0;
    const truncatedTier = byTier.find(entry => entry.tier === 'truncated')?.n ?? 0;
    // CALIBRATION, because accuracy says how often the judge is right and this says whether its own number means
    // anything. Measured on this deployment the model is UNDER-confident by 12-15 points, so a gate that treats a
    // high confidence as usable discards correct answers -- the opposite of the usual failure mode.
    const withDistributions = scored.filter(row => row.probabilities !== null)
    const classwise = classwiseSamples(scored)
    const calibration = {
        scalars: [
            scoreScalar('confidence', samplesFor(scored, row => row.confidence), binCount),
            scoreScalar('answerConfidence', samplesFor(scored, row => row.answerConfidence), binCount),
            // THE HEADLINE SCALAR, and the one the study quotes: the probability the distribution put on the
            // option it chose.
            scoreScalar('probabilities[chosen]', samplesFor(scored, row => row.probabilities?.[row.label]), binCount),
        ],
        classwise: { ...scoreScalar('classwise', classwise, binCount), options: classwise.length / (scored.length || 1) },
        multiclass: {
            brier: multiclassBrier(withDistributions),
            logLoss: multiclassLogLoss(withDistributions),
            meanPCorrect: withDistributions.length === 0 ? null : withDistributions.reduce((sum, row) => sum + (row.probabilities[row.expected] ?? 0), 0) / withDistributions.length,
            meanEntropy: meanEntropy(withDistributions),
        },
        // THE CAVEAT THAT MUST TRAVEL WITH THE NUMBER: ECE is sign-blind and ranking-blind, so the bin table is
        // the evidence and this sentence is the reason it is printed.
        note: 'ECE alone is sign-blind: it cannot say whether the model is over- or under-confident, and the two call for opposite responses. Read the bins, and read `eceWeight` -- below 1 the ECE covers only the samples that landed in a non-empty bin.',
    };
    return {
        instrument: {
            instructions: PROBE_QUESTION.instructions,
            labels,
            hash: probeFingerprint(),
        },
        calls: rows.length,
        scored: scored.length,
        unreadable: rows.length - scored.length,
        accuracy,
        byTier,
        calibration,
        tierFloor: TIER_FLOOR,
        coverage: {
            scored: { n: scored.length, full, truncated: truncatedTier },
            unreadable: rows.length - scored.length,
            skipped,
            digest: readDigest({
                scored: scored.length, full, truncated: truncatedTier,
                unreadable: rows.length - scored.length, skipped,
            }),
        },
        abstain: { label: ABSTAIN_LABEL, count: abstained, rate: rate(abstained, scored.length) },
        selective: { correct, n: scored.length - abstained, accuracy: rate(correct, scored.length - abstained) },
        majority: { label: floorLabel, count: floorCount, floor },
        kappa,
        seams: seams.map((seam) => {
            const rowsOfSeam = scored.filter((row) => row.hook === seam);
            const right = rowsOfSeam.filter((row) => row.correct).length;
            const abstains = rowsOfSeam.filter((row) => row.abstain).length;
            return {
                seam,
                n: rowsOfSeam.length,
                accuracy: rate(right, rowsOfSeam.length),
                abstain: rate(abstains, rowsOfSeam.length),
                // A per-seam rate over a handful of calls is noise, and the label says so rather than hiding it.
                thin: rowsOfSeam.length < 30,
            };
        }),
        confusion: { rows: seams, columns: labels, counts: confusion },
    };
}
