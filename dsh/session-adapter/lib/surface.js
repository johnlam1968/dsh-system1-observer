// THE MODEL SURFACE, DERIVED FROM THE LOG'S OWN SURFACE OPS.
//
// WHY THIS EXISTS. `lib/turn-state.js` searched the RAW event log for the newest message of each role, and the
// newest message of a role is not always IN the surface. Measured with a fixture: a `replace` carried by a
// tool/result drops an assistant message from a range and puts nothing of that role back, so the composer judged
// text the subject never saw -- "THE SHADOWED ANSWER -- dropped from the surface" as AGENT RESPONSE.
//
// AND THE FIX IS STRONGER THAN A SWAP: once the shadowed response is gone, that turn has NO response in the
// surface, and the composer REFUSES it rather than picking another message out of the log. Measured -- the
// refusal is what the corrected test asserts.
//
// THE ORDINARY CASE DOES NOT REPRODUCE THE DEFECT, which is worth keeping: when a compaction replaces a request
// with a summary, the composer quotes the SUMMARY, because a replacement always arrives after what it replaces and
// "newest wins" happens to agree with "surface wins". The divergence needs NEWEST != SURFACED.
//
// THIS FILE IS THE ADAPTER SEAM. The host answers the same question authoritatively -- `sessionQuery.readSurface`
// returns a session's complete current surface -- and when the plugin is wired to it this fold is redundant and
// should be deleted. Until then it is one small, pure, testable rule in one place, which is what makes that
// deletion a one-line change rather than an archaeology exercise.
//
// The op shape is read from the harness's own declarations rather than inferred:
//   surfaceOp: 'append' | { op: 'replace'; startSeq: SessionSeq; endSeq: SessionSeq }
// Only `replace` removes anything; every other event is appended and stays.

/** The events that remain in the surface, in order. Pure; never throws; an absent op means append. */
export function surfaceEvents(events) {
    const list = Array.isArray(events) ? events : []
    const replaced = []
    for (const event of list) {
        const op = event?.surfaceOp
        if (op === null || typeof op !== 'object') continue
        if (op.op !== 'replace') continue
        if (typeof op.startSeq !== 'number' || typeof op.endSeq !== 'number') continue
        replaced.push([op.startSeq, op.endSeq])
    }
    // The common case costs nothing: no replacements means the log IS the surface.
    if (replaced.length === 0) return list
    // A replacement's own event carries a seq OUTSIDE its range, so it survives -- which is what makes the summary
    // the surfaced message. Ranges are inclusive at both ends, as the declaration's start/end imply.
    return list.filter((event) => {
        const seq = event?.seq
        if (typeof seq !== 'number') return true
        return !replaced.some(([start, end]) => seq >= start && seq <= end)
    })
}
