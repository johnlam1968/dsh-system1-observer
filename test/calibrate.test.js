// IS THE CONFIDENCE WORTH ANYTHING? Every number here is computable by hand, deliberately: the formulas are the
// kind that produce a plausible wrong answer, and only a fixture whose arithmetic is checkable catches that.
//
// NOTHING HERE READS THE DEV TRACE. It is 40 MB, it is gitignored and it is not shipped, so a test that needed it
// would pass on one machine and prove nothing anywhere else.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BINS, DEFAULT_OPTIONS, bias, brierBinary, classwiseSamples, ece, logLoss, meanEntropy,
  multiclassBrier, multiclassLogLoss, normalizedEntropy, samplesFor, scoreScalar,
} from '../lib/calibrate.js'
import { LABEL_OF_SEAM, PROBE_LABELS, SEAM_OF_LABEL, probeAnswerOf } from '../lib/probe-score.js'
import { PROBE_QUESTION } from '../lib/seams.js'

const near = (got, want, epsilon = 1e-9) => assert.ok(Math.abs(got - want) < epsilon, `${got} != ${want}`)

// --- the ported ECE loop, property by property ---------------------------------------------------------
// Four samples, two in one bin and two in another:
//   bin [0.2,0.3): p = 0.2 (y=1), 0.3 is NOT in it (half-open) -- so p=0.2 alone: says 0.2, right 0.
//   bin [0.3,0.4): p = 0.3 (y=1)
//   bin [0.8,0.9): p = 0.8 (y=1), 0.85 (y=1) -> says 0.825, right 1
// ECE = (1/4)|0.2-0| + (1/4)|0.3-1| + (2/4)|0.825-1| = 0.05 + 0.175 + 0.0875 = 0.3125
test('ECE is equal-width, half-open except the last bin, and weighted by the FULL sample count', () => {
  const samples = [{ p: 0.2, y: 0 }, { p: 0.3, y: 1 }, { p: 0.8, y: 1 }, { p: 0.85, y: 1 }]
  const result = ece(samples)
  near(result.ece, 0.3125)
  near(result.weight, 1, 1e-12)
  assert.equal(result.bins.length, 3, 'empty bins are skipped')
  assert.equal(result.bins[0].n, 1)
})

test('the last bin is CLOSED, so p = 1 lands somewhere instead of nowhere', () => {
  const result = ece([{ p: 1, y: 1 }, { p: 1, y: 0 }])
  assert.equal(result.bins.length, 1)
  assert.equal(result.bins[0].n, 2)
  // Both land in the LAST bin, which is the point: with a half-open last bin they would land nowhere and the
  // weight would be 0. meanP = 1, meanY = 0.5, weight = 1, so the ECE is 0.5.
  near(result.ece, 0.5, 1e-12)
})

// A SPARSE ECE DESCRIBES A SUBSET, and the weight is the only thing that says so.
test('the weight falls below 1 when samples land in no bin, and the ECE says so', () => {
  // p = 0.95 is in bin 9; p = 0.05 is in bin 0. Both non-empty, so the weight stays 1.
  const covered = ece([{ p: 0.95, y: 1 }, { p: 0.05, y: 0 }])
  near(covered.weight, 1, 1e-12)
  const empty = ece([])
  assert.equal(empty.ece, null)
  assert.equal(empty.weight, null)
})

// --- the scalar formulas -------------------------------------------------------------------------------
test('bias is signed, and its sign is the whole point', () => {
  const under = [{ p: 0.3, y: 1 }, { p: 0.3, y: 0 }]
  near(bias(under), -0.2, 1e-12)
  assert.ok(bias(under) < 0, 'negative means the model says less than it delivers')
  near(bias([{ p: 0.9, y: 0 }, { p: 0.9, y: 0 }]), 0.9, 1e-12, 'and positive means it says more')
})

test('Brier is the mean squared miss, and log loss is the mean negative log with a floor', () => {
  const samples = [{ p: 0.5, y: 1 }, { p: 0.5, y: 0 }]
  near(brierBinary(samples), 0.25, 1e-12)
  near(logLoss(samples), Math.log(2), 1e-12)
  // A confident miss is finite rather than infinite: the floor is what keeps an aggregate readable.
  assert.ok(Number.isFinite(logLoss([{ p: 0, y: 1 }])))
})

// --- multi-class Brier under BOTH conventions ----------------------------------------------------------
// ONE number cannot carry both, and the source states three things that cannot all hold: its prose says ten
// options for a classwise pool whose recorded n is nine per call, its comment's "1/N = 0.1" needs a per-PAIR
// denominator, and its measured 0.1659 needs the nine-option sum over CALLS.
test('multi-class Brier reports per-pair and per-call, and a uniform distribution pins both', () => {
  const uniform = PROBE_LABELS.map(label => [label, 0.1])
  const rows = [{ probabilities: Object.fromEntries(uniform), expected: 'unclear' }]
  const brier = multiclassBrier(rows, PROBE_LABELS)
  near(brier.perPair, 0.09, 1e-12, 'uniform over ten options scores (1/N)(1 - 1/N) per pair')
  near(brier.perCall, 0.9, 1e-12, 'and the same distribution scores 1 - 1/N per call')
  assert.equal(brier.pairs, 10, 'one row, ten options')
  assert.equal(brier.calls, 1)
  assert.match(brier.note, /perPair answers/)
})

test('the default pool is NINE options, because the abstention can never be the truth', () => {
  assert.equal(DEFAULT_OPTIONS.length, 9)
  assert.equal(DEFAULT_OPTIONS.includes('unclear'), false)
  assert.equal(PROBE_LABELS.length, 10, 'the question still offers ten')
  const row = { probabilities: Object.fromEntries(PROBE_LABELS.map(label => [label, 0.1])), expected: 'model_output' }
  assert.equal(classwiseSamples([row]).length, 9, 'nine samples per call, as the source count says')
  assert.equal(classwiseSamples([row], { includeAbstain: true }).length, 10, 'and ten when asked explicitly')
  assert.equal(classwiseSamples([row]).filter(sample => sample.y === 1).length, 1, 'exactly one option is right')
})

test('multi-class log loss charges the probability the distribution put on the truth', () => {
  const rows = [
    { probabilities: { model_output: 0.5, unclear: 0.5 }, expected: 'model_output' },
    { probabilities: { model_output: 0.25, unclear: 0.75 }, expected: 'model_output' },
  ]
  near(multiclassLogLoss(rows), (Math.log(2) + Math.log(4)) / 2, 1e-12)
})

// --- entropy measures the SHAPE of an answer, never its correctness ------------------------------------
test('normalized entropy runs from a point mass to uniform, and says nothing about being right', () => {
  near(normalizedEntropy({ a: 1, b: 0 }), 0, 1e-12)
  near(normalizedEntropy({ a: 0.5, b: 0.5 }), 1, 1e-12)
  near(normalizedEntropy({ a: 0.25, b: 0.25, c: 0.25, d: 0.25 }), 1, 1e-12)
  assert.equal(normalizedEntropy({}), 0)
  assert.equal(normalizedEntropy({ a: 0.5 }), 0, 'a single option is a point mass, not a flat one')
  near(meanEntropy([{ probabilities: { a: 0.5, b: 0.5 } }, { probabilities: { a: 1, b: 0 } }]), 0.5, 1e-12)
})

// --- the ground truth has to be in the SAME SPACE as the distribution ---------------------------------
// THE BUG THIS PINS: a seam looked up in the label-to-seam map returns `undefined` for every row, which silently
// turns every calibration truth into 0 -- so the classwise ECE becomes the mean probability instead of a
// disagreement, and it looks like a plausible small number rather than a failure.
test('the ground truth is the LABEL a seam should produce, and the two maps are inverses', () => {
  assert.equal(LABEL_OF_SEAM.pre_execute, 'before_a_tool_call')
  assert.equal(LABEL_OF_SEAM.draft, 'model_output')
  for (const [label, seam] of Object.entries(SEAM_OF_LABEL)) assert.equal(LABEL_OF_SEAM[seam], label)
  assert.equal(Object.keys(LABEL_OF_SEAM).length, Object.keys(SEAM_OF_LABEL).length)

  const event = {
    at: '2026-01-02T00:00:00.000Z', event: 'call', hook: 'pre_execute',
    questions: { probe: PROBE_QUESTION },
    answer: { answers: { probe: { type: 'choice', label: 'before_a_tool_call', confidence: 0.7, probabilities: { before_a_tool_call: 0.7, unclear: 0.3 } } } },
  }
  const row = probeAnswerOf(event)
  assert.equal(row.expected, 'before_a_tool_call', 'the truth is a LABEL, so it can be compared with the vector')
  assert.equal(row.correct, true)
  near(row.probabilities[row.expected], 0.7, 1e-12, 'and the truth indexes the distribution')
})

test('a scalar carries its sample count, its weight and its bins, so the number cannot travel alone', () => {
  const score = scoreScalar('probabilities[chosen]', [{ p: 0.8, y: 1 }, { p: 0.8, y: 0 }, { p: 0.2, y: 1 }])
  assert.equal(score.scalar, 'probabilities[chosen]', 'the scalar is RECORDED: the same data gives 0.1253 top-1 and 0.0284 classwise')
  assert.equal(score.n, 3)
  // meanP = (0.8 + 0.8 + 0.2)/3 = 0.6, meanY = 2/3.
  near(score.bias, 0.6 - 2 / 3, 1e-12)
  assert.ok(Number.isFinite(score.ece))
  near(score.eceWeight, 1, 1e-12)
  assert.equal(score.bins.length, 2)
})

test('a row with no usable scalar is skipped rather than counted as a miss', () => {
  assert.equal(samplesFor([{ correct: true }, { correct: false }], () => undefined).length, 0)
  assert.equal(samplesFor([{ correct: true }], () => Number.NaN).length, 0)
  assert.equal(samplesFor([{ correct: true }], () => 0.5).length, 1)
  assert.equal(BINS, 10)
})

// BOTH REVIEWERS LANDED HERE FROM DIFFERENT DIRECTIONS, and my comment had the mechanism wrong.
//
// I wrote that `weight < 1` happens "when samples land in no bin" because empty bins are skipped against a full-N
// denominator. On this partition that is impossible: the half-open bins cover all of [0, 1], so every in-range `p`
// is in exactly one bin and the weight is 1 however many bins are empty. The weight can only fall below 1 when a
// sample is OUT of range -- which the ported loop then drops from numerator and denominator alike, in silence.
test('the weight is 1 for in-range samples, however many bins are empty', () => {
  // Two samples at opposite ends: eight bins empty, and the weight is still 1.
  const spread = ece([{ p: 0.95, y: 1 }, { p: 0.05, y: 0 }])
  assert.equal(spread.bins.length, 2, 'eight empty bins were skipped')
  near(spread.weight, 1, 1e-12, 'and the weight is unaffected by them')
})

test('the weight falls below 1 only when a probability is out of range', () => {
  // Handed directly to `ece`, bypassing `samplesFor`: this is the real mechanism, now documented as such.
  const outOfRange = ece([{ p: 1.0001, y: 1 }, { p: -0.1, y: 0 }, { p: 0.5, y: 1 }])
  near(outOfRange.weight, 1 / 3, 1e-12, 'two of three samples landed in no bin')
})

test('samplesFor excludes an out-of-range probability, so the exclusion shows up in n', () => {
  // Silent dropping was the defect: the number shrank and nothing said why. Now it is deliberate and `n` is the
  // count actually used.
  assert.equal(samplesFor([{ correct: true }, { correct: false }], () => 1.0001).length, 0)
  assert.equal(samplesFor([{ correct: true }, { correct: false }], () => -0.1).length, 0)
  assert.equal(samplesFor([{ correct: true }, { correct: false }], (row) => (row.correct ? 0.9 : 0.1)).length, 2)
  // The boundaries themselves are in range and must be kept.
  assert.equal(samplesFor([{ correct: true }], () => 0).length, 1)
  assert.equal(samplesFor([{ correct: true }], () => 1).length, 1)
})
