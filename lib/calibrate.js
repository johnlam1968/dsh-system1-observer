// IS THE CONFIDENCE WORTH ANYTHING?
//
// Accuracy says how often the judge is right; calibration says whether its own number means anything. Both are
// needed, because the interesting failure here is not the usual one: measured on this deployment, the model is
// **under-confident by 12 to 15 points**, so a gate that treats a high confidence as "usable" DISCARDS CORRECT
// ANSWERS. Trusting the confident calls is measurably wrong.
//
// THE ECE LOOP IS A VERBATIM PORT and the rest is ours, because the sibling implementation is binary-only. Its
// properties are load-bearing and each one is a way to get a plausible wrong number:
//
//   EQUAL-WIDTH, ten bins, THE LAST BIN CLOSED (`p <= 1`) and the others `[low, high)` -- so `p = 1` lands
//   somewhere instead of nowhere;
//   EMPTY BINS ARE SKIPPED, but THE DENOMINATOR IS THE FULL SAMPLE COUNT -- so the weights can sum to less than 1
//   and the ECE then covers a subset. `weight` is returned for exactly that reason.
//
//   WHERE `weight < 1` ACTUALLY COMES FROM, corrected after review: NOT from empty bins. On this partition the
//   half-open bins cover all of [0, 1], so every in-range `p` lands in exactly one bin and `weight` is 1 however
//   many bins are empty. It falls below 1 only when a sample is OUT of range or non-finite, and `samplesFor`
//   now excludes those rather than letting the binning drop them unannounced.
// THE LABELS COME FROM THEIR SOURCE, not from `probe-score.js`, and that is what keeps this module acyclic:
// `probe-score.js` imports this file, so importing its exports back here left `PROBE_LABELS` in its temporal dead
// zone and the module failed to load at all. Both modules derive the list from the one question that defines it,
// so there is nothing to drift.
import { PROBE_QUESTION } from './seams.js'

const PROBE_LABELS = Object.freeze(Object.keys(PROBE_QUESTION.criteria))

/** Ten equal-width bins, as the ported loop expects. */
export const BINS = 10

/**
 * The nine options a distribution is pooled over by default: every label except the abstention.
 *
 * NINE, NOT TEN, AND THE COUNT IS THE EVIDENCE. The source table records `n = 30330` for 3,370 scored calls --
 * nine samples per call -- while the sentence introducing it says "pooled over all 10 options". Ten would be
 * 33,700. `unclear` is an abstention that can never be the true seam, so dropping it is also the only reading
 * that makes the pooled question well-posed: "when it puts 0.3 on an option, is it right 30% of the time?"
 */
export const DEFAULT_OPTIONS = Object.freeze(PROBE_LABELS.filter(label => label !== 'unclear'))

/**
 * Expected calibration error, with the bin table and the weight.
 *
 * @returns `{ ece, weight, bins }`, where `weight` is the share of samples that landed in a non-empty bin
 */
export function ece(samples, bins = BINS) {
    const total = Array.isArray(samples) ? samples : []
    const table = []
    let value = 0
    let covered = 0
    for (let bin = 0; bin < bins; bin += 1) {
        const low = bin / bins
        const high = (bin + 1) / bins
        const inBin = total.filter(sample => sample.p >= low && (bin === bins - 1 ? sample.p <= high : sample.p < high))
        if (inBin.length === 0) continue
        const meanP = inBin.reduce((sum, sample) => sum + sample.p, 0) / inBin.length
        const meanY = inBin.reduce((sum, sample) => sum + sample.y, 0) / inBin.length
        value += (inBin.length / total.length) * Math.abs(meanP - meanY)
        covered += inBin.length
        // THE BIN TABLE IS THE EVIDENCE, because ECE alone is sign-blind: it cannot say whether the model is over-
        // or under-confident, and the two call for opposite responses.
        table.push({ low, high, n: inBin.length, meanP, meanY, gap: meanP - meanY })
    }
    return { ece: total.length === 0 ? null : value, weight: total.length === 0 ? null : covered / total.length, bins: table }
}

const mean = (values) => (values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length)

/** The mean of one field, so a scalar's `meanP` and the accuracy it is compared against come from one place. */
export function meanOf(samples, key) {
    return mean(samples.map(sample => sample[key]))
}

/** Brier, binary: the mean squared distance from the outcome. */
export function brierBinary(samples) {
    return mean(samples.map(sample => (sample.p - sample.y) ** 2))
}

/** Log loss, binary, with the floor that keeps a confident miss finite. */
export function logLoss(samples) {
    return mean(samples.map(sample => -Math.log(Math.max(sample.p, 1e-12))))
}

/**
 * Bias: mean predicted minus mean observed. NEGATIVE MEANS UNDER-CONFIDENT, which is this model's direction --
 * its bins say 25% where 48% of the answers are right.
 */
export function bias(samples) {
    const p = meanOf(samples, 'p')
    const y = meanOf(samples, 'y')
    return p === null || y === null ? null : p - y
}

/**
 * Multi-class Brier, under BOTH normalisations, because THE SOURCE STATES THREE THINGS THAT CANNOT ALL HOLD.
 *
 * Its prose says the classwise pool covers "all 10 options"; its own sample count says nine per call; its comment
 * says `uniform 1/N = 0.1`, which is only true when the sum is divided by the number of PAIRS; and its measured
 * `0.1659` is only reproduced by dividing the NINE-option sum by the number of CALLS. Verified: the nine-option
 * sum over this trace is 559.035 over 3,370 calls, which is 0.165886 per call and 0.018432 per pair.
 *
 * So both are reported and named. They answer different questions -- "on average how far is one distribution from
 * the truth" (per call) versus "how far is one option's probability from its outcome" (per pair) -- and a reader
 * who has seen one of the numbers can find it here instead of concluding the other is wrong.
 *
 * @returns `{ perPair, perCall, pairs, calls, options }`, or `null` when there is nothing to score
 */
export function multiclassBrier(rows, options = DEFAULT_OPTIONS) {
    const list = Array.isArray(rows) ? rows : []
    if (list.length === 0) return null
    let sum = 0
    let pairs = 0
    for (const row of list) {
        for (const label of options) {
            const p = typeof row.probabilities?.[label] === 'number' ? row.probabilities[label] : 0
            sum += (p - (row.expected === label ? 1 : 0)) ** 2
            pairs += 1
        }
    }
    return pairs === 0 ? null : {
        perPair: sum / pairs,
        perCall: sum / list.length,
        pairs,
        calls: list.length,
        options: options.length,
        // The convention is PART OF THE NUMBER, so it travels with it.
        note: 'perPair answers "how far is one option from its outcome"; perCall answers "how far is one distribution from the truth". A uniform distribution over N options scores 1/N per pair and 1 - 1/N per call.',
    }
}

/** Multi-class log loss: the negative log probability the distribution put on the true option, averaged. */
export function multiclassLogLoss(rows) {
    const list = (Array.isArray(rows) ? rows : []).filter(row => row.expected !== null && row.expected !== undefined)
    if (list.length === 0) return null
    let sum = 0
    for (const row of list) {
        const p = typeof row.probabilities?.[row.expected] === 'number' ? row.probabilities[row.expected] : 0
        sum += -Math.log(Math.max(p, 1e-12))
    }
    return sum / list.length
}

/**
 * Normalised entropy: how spread the distribution is, as a share of the maximum.
 *
 * 0 is a point mass and 1 is a uniform distribution over the options offered. A judge that is always certain has
 * an entropy of 0 and is not thereby right -- this measures the SHAPE of the answer, never its correctness.
 */
export function normalizedEntropy(probabilities) {
    const values = Object.values(probabilities ?? {}).filter(value => typeof value === 'number' && value > 0)
    if (values.length <= 1) return 0
    const total = values.reduce((sum, value) => sum + value, 0)
    if (total <= 0) return 0
    let entropy = 0
    for (const value of values) {
        const p = value / total
        entropy -= p * Math.log(p)
    }
    return entropy / Math.log(values.length)
}

/** The mean normalised entropy over the rows that carried a distribution. */
export function meanEntropy(rows) {
    const list = (Array.isArray(rows) ? rows : []).filter(row => row.probabilities !== null && row.probabilities !== undefined)
    return mean(list.map(row => normalizedEntropy(row.probabilities)))
}

/**
 * One binary sample per row from whichever scalar is being judged.
 *
 * A PROBABILITY OUTSIDE [0, 1] IS EXCLUDED, not admitted and then silently dropped by the binning. Both reviewers
 * landed here from different directions: with half-open bins that cover [0, 1], every in-range `p` falls in
 * exactly one bin, so `eceWeight` can only fall below 1 when a sample is OUT of range -- and the ported loop
 * drops such a sample from numerator and denominator alike without saying so. Excluding it here makes the
 * exclusion deliberate and visible in `n`, which is the count actually used.
 */
export function samplesFor(rows, scalarOf) {
    const out = []
    for (const row of rows) {
        const p = scalarOf(row)
        if (typeof p !== 'number' || !Number.isFinite(p)) continue
        if (p < 0 || p > 1) continue
        out.push({ p, y: row.correct ? 1 : 0 })
    }
    return out
}

/**
 * Everything a reader needs to judge one scalar, including how much of the sample the ECE actually covered.
 *
 * @param name    the scalar's name, RECORDED because the number means different things per scalar: this model's
 *                top-1 ECE over the chosen option is 0.1253 while its classwise ECE is 0.0284, and both are true
 */
export function scoreScalar(name, samples, binCount = BINS) {
    // THE BIN COUNT IS AN INPUT, which is what makes it a setting: it decides how finely the probability scale is
    // sliced, and the number it produces moves with it. `ece` already took one; nothing passed it.
    const bins = ece(samples, binCount)
    return {
        scalar: name,
        n: samples.length,
        meanP: meanOf(samples, 'p'),
        accuracy: meanOf(samples, 'y'),
        bias: bias(samples),
        ece: bins.ece,
        eceWeight: bins.weight,
        brier: brierBinary(samples),
        logLoss: logLoss(samples),
        bins: bins.bins,
    }
}

/**
 * The classwise pool: one sample per (row, option) pair, asking "when it puts 0.3 on an option, is it right 30%
 * of the time?".
 *
 * `includeAbstain` DEFAULTS TO FALSE, and that is what the measurements say rather than what the prose does: the
 * source table records `n = 30330` for 3,370 scored calls, which is NINE samples per call, while the sentence
 * above it says "pooled over all 10 options". Ten options would be 33,700. Since `unclear` is an abstention that
 * can never be the true seam, dropping it is also the only reading that makes the pooled question well-posed.
 */
export function classwiseSamples(rows, { includeAbstain = false, abstainLabel = 'unclear' } = {}) {
    const options = PROBE_LABELS.filter(label => includeAbstain || label !== abstainLabel)
    const samples = []
    for (const row of rows) {
        if (row.probabilities === null || row.probabilities === undefined) continue
        for (const label of options) {
            const p = row.probabilities[label]
            if (typeof p !== 'number' || !Number.isFinite(p)) continue
            samples.push({ p, y: row.expected === label ? 1 : 0 })
        }
    }
    return samples
}
