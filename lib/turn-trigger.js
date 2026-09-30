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
import { buildQuestions, TURN_HOOK } from './questions.js'

/** The specs a config carries for the scheduled hook, or an empty list. */
function turnSpecs(config) {
    const configured = config?.questions
    const given = configured !== null && typeof configured === 'object' ? configured[TURN_HOOK] : undefined
    return Array.isArray(given) ? given : []
}

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
    const specs = turnSpecs(config)
    if (specs.length === 0) {
        return {
            questions: {},
            refused: true,
            reason: `no question set is configured under "${TURN_HOOK}"; asking the probe question on a scheduled hook would corrupt the probe's calibration`,
            dropped: [],
        }
    }
    const built = buildQuestions({ seamEnabled: { [TURN_HOOK]: true }, questions: { [TURN_HOOK]: specs } }, TURN_HOOK)
    if (built.problems.length > 0) {
        // REFUSE RATHER THAN ASK A PARTIAL SET: the same rule the observation path uses, because a measurement of
        // fewer questions than the operator configured is a different measurement under the same name.
        return { questions: {}, refused: true, reason: built.problems[0], dropped: [] }
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
