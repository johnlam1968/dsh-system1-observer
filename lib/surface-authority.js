// WHICH EVENTS ARE IN THE CURRENT MODEL SURFACE -- asked of the HOST, not folded from the log we happen to hold.
//
// WHY THIS EXISTS. `dsh-session-adapter/surface` folds `surfaceOp: replace` spans out of the events in hand, and its own header
// nominates itself for deletion "when the plugin is wired to" the authority. The authority is
// `sessionQuery.filterEvents(sessionId, [{ kind: 'surface', values: ['current'] }])`, verified in the producer:
// `SessionEventResultFilter` carries a `surface` kind and `SessionEventSurface = 'current' | 'shadowed' | 'log-only'`,
// so the host answers not only "is it surfaced" but WHICH of the three it is -- a distinction our fold cannot make.
//
// WHY THE FOLD CANNOT SIMPLY BE DELETED, which the plan claimed until this was measured:
//   * the authority is ASYNC, and an in-band seam handler cannot await: it has to return;
//   * it is OPTIONAL. A deployment without `sessionQuery` must keep working, and without the fold the defect
//     `dsh-session-adapter/surface` was written for comes straight back -- a composer quoting a message the subject never saw.
// So the rule is: THE AUTHORITY WHEREVER A CALLER CAN AWAIT, THE FOLD EVERYWHERE ELSE -- and where both are reachable in
// one place, they are compared rather than trusted (`surface-compare` in `index.js`).
//
// A REFUSAL IS NOT AN ANSWER. Anything that goes wrong here -- no service, no such method, a throw, a page with no
// sequence numbers -- returns `null`, which leaves the fold in charge exactly as before. Returning an empty list would
// claim "nothing is in the surface", and the composer would refuse every turn.

/**
 * The seqs in the session's CURRENT surface, or `null` when the authority could not answer.
 *
 * @param query      the mounted `sessionQuery` service, or undefined
 * @param sessionId  the session to ask about
 */
export async function currentSurfaceSeqs(query, sessionId) {
    if (query === undefined || query === null || typeof query.filterEvents !== 'function') return null
    if (typeof sessionId !== 'string' || sessionId === '') return null
    try {
        const documents = await query.filterEvents(sessionId, [{ kind: 'surface', values: ['current'] }])
        const list = Array.isArray(documents) ? documents : []
        const seqs = list.map((document) => (typeof document?.seq === 'number' ? document.seq : null)).filter((seq) => seq !== null)
        return seqs.length > 0 ? seqs : null
    } catch {
        return null
    }
}
