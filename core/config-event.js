// THE CONFIG EVENT, AND THE READER THAT MAKES IT WORTH WRITING.
//
// WHY THIS FILE EXISTS. The plan requires that a settings write "appears on the trace as a config event, and a run
// is attributable to a config state". A review found that the first version of that requirement named an event
// nothing else knows: `lib/evidence.js` accepts any event string, so a `config` line would be WRITTEN and then be
// invisible, because every reader (`trace-report.js`, `compare.js`, `readDigest`) knows only `mount`, `call`,
// `skip` and `rotate`. A line no one can read is not a record. So the schema and the replay are written here,
// together, rather than the line being emitted and the reconstruction hoped for.
//
// THE TWO HALVES OF "NO SILENT WRITE":
//   1. a change is recorded BEFORE it takes effect, so no window is unlogged;
//   2. a recorded change that cannot be READ is reported, not skipped -- `replay` returns `unusable` rather than
//      quietly continuing. A write that vanishes on the way back is the same defect as a write that was never
//      logged, and only one of the two is obvious.
//
// WHAT A CONFIG EVENT IS NOT. It is not a record of what the agent decided, and it carries no judgement about the
// change being good. It says what knob moved, from what to what, and who moved it -- which is the whole of what a
// measurement needs to attribute its own conditions.
export const CONFIG_EVENT = 'config'

/** The actions a settings write may take. A knob is either set to a value, or switched on or off. */
export const CONFIG_ACTIONS = Object.freeze(['set', 'enable', 'disable'])

/**
 * One config line: what moved, from what, to what, and by whom.
 *
 * @param action one of CONFIG_ACTIONS
 * @param knob the setting's name
 * @param from the value before, or `undefined` when it was absent
 * @param to the value after
 * @param by who asked for the change, so a measurement can be attributed to an actor as well as a state
 */
export function configEvent({ action, knob, from, to, by } = {}) {
    if (!CONFIG_ACTIONS.includes(action)) {
        throw new Error(`configEvent: action ${JSON.stringify(action)} is not one of ${CONFIG_ACTIONS.join(', ')}.`)
    }
    if (typeof knob !== 'string' || knob.trim() === '') {
        throw new Error('configEvent: `knob` must be a non-empty string.')
    }
    const line = { event: CONFIG_EVENT, action, knob: knob.trim() }
    // `from` is carried even when absent, spelled explicitly, because "was not set" and "was set to null" are
    // different states and a reader cannot tell them apart from a missing field.
    line.from = from === undefined ? null : from
    line.to = to === undefined ? null : to
    if (typeof by === 'string' && by.trim() !== '') line.by = by.trim()
    return line
}

/** The value one line produces for its knob, or the reason it cannot be read. */
function applyOne(line) {
    if (line === null || typeof line !== 'object' || Array.isArray(line)) return { reason: 'not an object' }
    if (!CONFIG_ACTIONS.includes(line.action)) return { reason: `action ${JSON.stringify(line.action)} is not one of ${CONFIG_ACTIONS.join(', ')}` }
    if (typeof line.knob !== 'string' || line.knob.trim() === '') return { reason: 'knob is not a non-empty string' }
    if (line.action === 'set') return { knob: line.knob.trim(), value: line.to === undefined ? null : line.to }
    return { knob: line.knob.trim(), value: line.action === 'enable' }
}

/**
 * The configuration a sequence of trace lines describes, in order.
 *
 * `unusable` is the point of the function as much as `knobs` is: a config line that cannot be applied is returned
 * by index and reason, so a row whose settings cannot be reconstructed says so instead of presenting a plausible
 * state built from the lines it happened to understand.
 */
export function replayConfig(lines = []) {
    const knobs = {}
    const unusable = []
    let applied = 0
    const list = Array.isArray(lines) ? lines : []
    for (let index = 0; index < list.length; index += 1) {
        const line = list[index]
        if (line === null || typeof line !== 'object' || line.event !== CONFIG_EVENT) continue
        const outcome = applyOne(line)
        if (outcome.reason !== undefined) {
            unusable.push({ index, reason: outcome.reason })
            continue
        }
        knobs[outcome.knob] = outcome.value
        applied += 1
    }
    return { knobs, applied, unusable }
}
