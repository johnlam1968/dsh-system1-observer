// THE `turn` TRACE LINE, AND THE ACCEPTANCE CHECK THAT PROVES IT IS NOT THE PROBE'S.
//
// The plan asks for a scheduled measurement to be distinguishable from a seam measurement, and for an assertion
// that the two never collide: "assert that no trace line carries `event: 'call'` with a PROBE question under a
// NON-SEAM hook". Measured, that collision is not hypothetical -- the probe scorer maps a call's hook to a seam,
// `turn` is not one, and a probe call under `turn` scored `accuracy: 0`.
//
// THE CHECK REFUSES TO PASS ON SILENCE, which is the whole reason it is written this way. A checker that looked for
// a `probe: true` field would pass every line that omits it -- including lines written by a version that never
// knew about the field -- and would therefore certify exactly the traces it cannot read. So a call line under a
// non-seam hook must say WHICH questions it asked, and a line that does not say is a VIOLATION, not a pass.
export const SEAM_HOOKS = Object.freeze([
    'assemble', 'admit', 'request', 'draft', 'pre_execute', 'execute', 'post_execute', 'result', 'close',
])

/**
 * One scheduled measurement, as a trace line.
 *
 * `hook` is `turn`, which is deliberately NOT a seam, so the line is distinguishable from a seam call by the same
 * field a reader already groups on. `questionIds` is what makes the acceptance check possible at all.
 */
export function turnLine({ sessionId, turn, questionIds = [], dropped = [], answers, executed, usage, durationMs, worstCase } = {}) {
    if (typeof sessionId !== 'string' || sessionId.trim() === '') throw new Error('turnLine: `sessionId` is required.')
    if (!Number.isInteger(turn) || turn < 1) throw new Error('turnLine: `turn` must be a positive integer.')
    const ids = (Array.isArray(questionIds) ? questionIds : []).filter((id) => typeof id === 'string' && id.trim() !== '')
    if (ids.length === 0) {
        // A scheduled measurement that asked nothing is not a measurement, and a line claiming one would be the
        // same defect as a silent skip.
        throw new Error('turnLine: `questionIds` must name at least one question; a scheduled call that asked nothing is not a measurement.')
    }
    const line = { event: 'call', hook: 'turn', sessionId: sessionId.trim(), turn, questionIds: [...new Set(ids)] }
    if (Array.isArray(dropped) && dropped.length > 0) line.dropped = [...new Set(dropped.filter((id) => typeof id === 'string'))]
    if (answers !== undefined) line.answers = answers
    for (const [key, value] of Object.entries({ executed, usage, worstCase })) {
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) line[key] = value
    }
    if (typeof durationMs === 'number' && Number.isFinite(durationMs)) line.durationMs = durationMs
    return line
}

/**
 * Every call line that asks the probe question under a hook that is not a seam.
 *
 * The probe question is identified by the id the runtime reserves for it, `probe`. A non-seam call line that does
 * not name its questions is reported too, because silence is what this check exists to refuse.
 *
 * @returns an array of `{ index, reason }`, empty when every non-seam call is accounted for.
 */
export function probeViolations(events = []) {
    const violations = []
    const list = Array.isArray(events) ? events : []
    for (let index = 0; index < list.length; index += 1) {
        const line = list[index]
        if (line === null || typeof line !== 'object') continue
        if (line.event !== 'call') continue
        const hook = typeof line.hook === 'string' ? line.hook : ''
        if (SEAM_HOOKS.includes(hook)) continue
        const ids = Array.isArray(line.questionIds) ? line.questionIds : null
        if (ids === null) {
            violations.push({ index, reason: `a call under the non-seam hook ${JSON.stringify(hook)} does not name its questions, so it cannot be shown not to be the probe` })
            continue
        }
        if (ids.includes('probe')) {
            violations.push({ index, reason: `the probe question was asked under the non-seam hook ${JSON.stringify(hook)}; the probe is scored against the seam it came from and this hook has none` })
        }
    }
    return violations
}
