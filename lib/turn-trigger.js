// THE TURN TRIGGER'S DECISION: whether to fire, and WHICH questions a given turn may be asked.
//
// This is the part of ROADMAP §10.2 that is pure logic, so it is here rather than inside the listener: the
// conditions are testable without a session, a clock or a model.
//
// THE TWO REFUSALS, and each has a measurement behind it rather than a preference:
//
// 1. NO SET, NO CALL. `buildQuestions` falls back to the runtime PROBE question when a hook carries no specs. For a
//    seam that fallback is the design -- an unconfigured row still observes. For `turn` it is a hazard: the probe's
//    answers are scored against the seam they came from, and a call under `turn` has no seam, so the probe scorer
//    was measured returning `accuracy: 0` (`correct = (expected !== undefined && expected === hook)` with `expected
//    === null`). Firing the probe under a scheduled hook would corrupt a published figure silently. So a turn with
//    no set of its own REFUSES, and the reason says why.
//
// 2. NO OPEN-ENDED QUESTION ABOUT AN OPEN TURN. A question that needs the operator's NEXT message cannot be
//    answered while the turn is still in flight, and `noul` has no abstain option, so an unanswerable one invites a
//    confident arbitrary answer. The trigger drops those questions for an open turn and asks them once it closes.
//    Which ids need a next message is INJECTED rather than hard-coded: the set is a file, and a list compiled into
//    this module would be wrong the first time somebody wrote a new set.
//
// AND THE GATE ITSELF WAS SET-BLIND, which is register row O25. `turnSpecs` read `config.questions.turn` directly, so
// a row that SELECTED a set declaring `turn` was refused with "no question set is configured under turn" -- a reason
// that was not true. Measured: `turnQuestions({config: {questionSetsDir: 'criteria', questionSet:
// 'helpfulness-set@1'}})` refused, although that set declares `turn`. The set is resolved first now, and the two
// refusals are told apart: NOTHING CONFIGURED is the legacy path (the probe hazard above), while A SET THAT SAYS
// NOTHING ABOUT TURNS is its own case and names the set.
import { buildQuestions, hasSpecs, probeOf, readQuestionConfig, TURN_HOOK } from './questions.js'
import { readSelectedSet, setSettings } from './question-sets.js'
import { isProbeQuestion } from './probe-score.js'
import { questionGroup } from './instrument-input.js'

/** Whether this turn boundary is the Nth, and the measurement is switched on. */
export function shouldFire({ turn, everyNTurns, enabled = true } = {}) {
    if (enabled !== true) return false
    const every = Number(everyNTurns)
    if (!Number.isInteger(every) || every < 1) return false
    const at = Number(turn)
    if (!Number.isInteger(at) || at < 1) return false
    return at % every === 0
}

/**
 * The questions one turn may be asked, or the reason it may not be asked at all.
 *
 * @param config            the row's config, read for the `turn` hook's specs
 * @param closed            whether the turn has finished, which decides the next-message questions
 * @param needsNextMessage  ids that cannot be answered until the operator has replied
 * @returns `{ questions, refused, reason, dropped }` -- `refused` is a refusal, never a fallback to the probe
 */
export function turnQuestions({ config, closed = false, needsNextMessage = [] } = {}) {
    // THE SET IS RESOLVED BEFORE THE DECISION, and the two ways of having nothing to ask are kept apart. The row's
    // config becomes the instrument's question group first (`lib/instrument-input.js`), because the functions below
    // read the instrument's own object rather than a row.
    const group = questionGroup(config)
    const settings = setSettings(group.sets)
    const selected = readSelectedSet(settings.dir, settings.name)
    if (selected.problem !== null) {
        // A SELECTED SET THAT CANNOT BE READ IS NOT "NO SET CONFIGURED", and saying so would send a reader looking for
        // a missing file when the file is there and broken.
        return { questions: {}, refused: true, reason: selected.problem, dropped: [] }
    }
    const hasAny = selected.questions !== null ? hasSpecs(selected.questions) : hasSpecs(readQuestionConfig(group))
    if (!hasAny) {
        // THE LEGACY PATH: nothing configured anywhere, so `buildQuestions` would hand back the PROBE question -- which
        // is the hazard this refusal exists for. Named as before.
        return {
            questions: {},
            refused: true,
            reason: `no question set is configured under "${TURN_HOOK}"; asking the probe question on a scheduled hook would corrupt the probe's calibration`,
            dropped: [],
        }
    }
    const built = buildQuestions(group, TURN_HOOK)
    if (built.problems.length > 0) {
        // REFUSE RATHER THAN ASK A PARTIAL SET: the same rule the observation path uses, because a measurement of
        // fewer questions than the operator configured is a different measurement under the same name.
        return { questions: {}, refused: true, reason: built.problems[0], dropped: [] }
    }
    if (Object.keys(built.questions).length === 0) {
        // SOMETHING IS CONFIGURED AND IT SAYS NOTHING ABOUT TURNS. The old message claimed no set was configured,
        // which for a SELECTED set was false -- register row O25. The set is named, because the fix is to add a `turn`
        // scope to it or select another one.
        return {
            questions: {},
            refused: true,
            reason: settings.name === ''
                ? `the configured questions declare no "${TURN_HOOK}" scope, so a scheduled turn measurement has nothing to ask`
                : `the selected set \`${settings.name}\` declares no "${TURN_HOOK}" scope, so a scheduled turn measurement has nothing to ask`,
            dropped: [],
        }
    }
    // THE PROBE CANNOT BE ASKED HERE, and this closes the loop the scorer's rule opened. A probe row's ground truth
    // is the SEAM its answer label names, and there is no seam called `turn`: measured in `lib/probe-score.js`, such
    // a row is `correct: false` ALWAYS. `SCORABLE_SITES` no longer lists `turn`, so it would go unscored -- and
    // UNSCORED BY SILENCE is the failure this repository keeps refusing. A row that hand-wrote the probe into its
    // `turn` scope is refused by name instead.
    const instructions = probeOf(group).instructions
    const probeId = Object.keys(built.questions).find((id) => isProbeQuestion(built.questions[id], instructions))
    if (probeId !== undefined) {
        return {
            questions: {},
            refused: true,
            reason: `the turn question \`${probeId}\` IS the probe question, and a scheduled boundary has no seam for it to be right about -- it would score as wrong every time`,
            dropped: [],
        }
    }
    const questions = { ...built.questions }
    const dropped = []
    if (closed !== true) {
        for (const id of Array.isArray(needsNextMessage) ? needsNextMessage : []) {
            if (Object.hasOwn(questions, id)) {
                delete questions[id]
                dropped.push(id)
            }
        }
    }
    return { questions, refused: false, reason: null, dropped }
}
