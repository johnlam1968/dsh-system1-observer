// THE TURN LISTENER, as a decision rather than an effect.
//
// It counts turn boundaries and answers one question: fire, and with which questions? The model call and the trace
// line stay with the caller, which is what makes this testable without a session, a clock or a backend -- and what
// keeps the row's I/O in one place.
//
// WHERE A TURN BOUNDARY IS: the `admit` event, which the observer already receives, is the operator's message
// opening a step of the loop. So an admit ENDS the turn before it and begins another. That single fact settles the
// open-turn problem the plan recorded as unresolved: by the time this listener fires, the turn whose window is
// being judged HAS CLOSED, so the questions that need the operator's next message are exactly the ones that can now
// be answered -- `closed: true`, and none of them dropped. Judging the turn still in flight is what would need the
// filter, and this design never does that.
import { shouldFire, turnQuestions } from './turn-trigger.js'

/**
 * @param everyNTurns      fire every Nth turn boundary
 * @param isEnabled        the knob, read at each boundary; the agent may switch it off
 * @param readConfig       the live config, read at each boundary so a settings change takes effect without a restart
 * @param needsNextMessage ids that cannot be answered until the operator has replied
 */
export function createTurnListener({ everyNTurns, isEnabled = () => true, readConfig = () => ({}), needsNextMessage = [] } = {}) {
    for (const [name, fn] of Object.entries({ isEnabled, readConfig })) {
        if (typeof fn !== 'function') throw new TypeError(`createTurnListener: \`${name}\` must be a function.`)
    }
    const counts = new Map()

    return {
        /** How many turn boundaries this listener has seen for a session. */
        turnOf: (sessionId) => counts.get(sessionId) ?? 0,

        /**
         * One turn boundary.
         *
         * @returns `{ fire, turn, questions?, questionIds?, refused?, reason? }` -- `fire: false` carries the turn
         * number so a caller can record a skip with the same reason vocabulary the observation path uses.
         */
        onAdmit({ sessionId } = {}) {
            const key = typeof sessionId === 'string' && sessionId.trim() !== '' ? sessionId.trim() : ''
            if (key === '') return { fire: false, turn: 0, reason: 'no session on the admit event' }
            const turn = (counts.get(key) ?? 0) + 1
            counts.set(key, turn)
            if (!shouldFire({ turn, everyNTurns, enabled: isEnabled() })) return { fire: false, turn }
            const built = turnQuestions({ config: readConfig(), closed: true, needsNextMessage })
            // A REFUSAL IS NOT A FALLBACK. When the hook carries no set, `turnQuestions` refuses rather than
            // returning the probe question, so nothing can be asked under a scheduled hook that the probe scorer
            // would then mark wrong.
            if (built.refused) return { fire: false, turn, refused: true, reason: built.reason }
            return { fire: true, turn, questions: built.questions, questionIds: Object.keys(built.questions), dropped: built.dropped }
        },
    }
}
