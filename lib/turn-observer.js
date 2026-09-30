import { resultEnvelope } from './model/result-envelope.js'
// THE TURN MEASUREMENT, END TO END, as one orchestrator over the modules that each do one thing.
//
// WHY AN ORCHESTRATOR RATHER THAN THE WIRING ITSELF. The chain is six steps -- count, compose, decide, ask, record,
// report -- and every one of them can refuse. Written inline in a listener, each refusal would be a branch inside an
// event handler, which is the hardest place to test and the easiest place to lose one. Here the whole chain is
// exercised with stubs, including the refusals, and the row's wiring becomes a single call.
//
// THE RECORD COMES AFTER THE ASK, and that is the opposite of the settings tool's order for a reason worth stating.
// A config line must precede its change so no window is unlogged; a CALL line reports what was asked and what came
// back, so it cannot be written before the answers exist. Both are "record the thing that happened"; the two
// orderings follow from what the line claims.
//
// AND A FAILED JUDGEMENT WRITES NO CALL LINE. A line is a measurement; a backend that did not answer produced none,
// and a line with empty answers would be filed as though it were one. The failure is returned so the caller can
// record a skip with the same reason vocabulary the observation path already uses.
import { composeTurnState } from './turn-state.js'
import { turnLine } from './turn-record.js'

/**
 * @param listener   the turn listener: counts boundaries and decides whether to fire
 * @param readEvents (sessionId) => the session's events for the window
 * @param ask        ({ state, questions }) => the model's result, the same `decide` the observer uses
 * @param record     (line) => void, the trace sink
 */
export function createTurnObserver({ listener, readEvents, ask, record, compose = composeTurnState, maxChars } = {}) {
    for (const [name, fn] of Object.entries({ readEvents, ask, record })) {
        if (typeof fn !== 'function') throw new TypeError(`createTurnObserver: \`${name}\` must be a function.`)
    }
    if (listener === null || typeof listener?.onAdmit !== 'function') {
        throw new TypeError('createTurnObserver: `listener` must be the turn listener.')
    }

    return {
        /**
         * One turn boundary.
         *
         * @returns `{ fired, turn, ... }` where a refusal or a failure carries a `reason` and writes nothing.
         */
        async onAdmit({ sessionId, nextMessage } = {}) {
            const decision = listener.onAdmit({ sessionId })
            if (decision.fire !== true) return { fired: false, turn: decision.turn, reason: decision.reason ?? null, refused: decision.refused === true }

            // THE OPERATOR'S MESSAGE COMES FROM THE BOUNDARY, not only from the events: `agent/pre-step` declares
            // `messages: UserMessage[]`, and if the session stream names the operator's message as anything but
            // `user/message` the composition would refuse every turn without it.
            const composed = compose({ events: readEvents(sessionId), nextMessage, ...(maxChars === undefined ? {} : { maxChars }) })
            if (composed.refused === true) {
                return { fired: false, turn: decision.turn, refused: true, reason: composed.reason }
            }

            let result
            try {
                result = await ask({ state: composed.state, questions: decision.questions })
            } catch (error) {
                return { fired: false, turn: decision.turn, failed: true, reason: `the judge could not be asked: ${error instanceof Error ? error.message : String(error)}` }
            }
            if (result === null || typeof result !== 'object' || result.kind === 'error') {
                const reason = result !== null && typeof result === 'object' && result.reason !== undefined ? String(result.reason) : 'the judge returned no result'
                return { fired: false, turn: decision.turn, failed: true, reason }
            }

            // Only now, with answers in hand, is there a measurement to record.
            const line = turnLine({
                sessionId,
                turn: decision.turn,
                questionIds: decision.questionIds,
                dropped: decision.dropped ?? [],
                answers: result.answers,
                // BOTH TRANSPORTS CARRY `envelope`; the wire ALSO spreads the fields flat. This reads the
                // envelope and tolerates the flat form. A turn line without `executed` cannot say which checkpoint
                // judged it, and without `usage` cannot be costed -- and the observation path had already learned
                // that at lib/observe.js, which is where the precedent for reading the envelope lives.
                ...resultEnvelope(result),
                worstCase: result.worstCase,
                truncated: composed.truncated === true,
            })
            record(line)
            return { fired: true, turn: decision.turn, questionIds: decision.questionIds, dropped: decision.dropped ?? [], unclassified: composed.unclassified, truncated: composed.truncated === true, line }
        },
    }
}
