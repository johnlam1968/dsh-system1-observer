// ARE TWO RUNS THE SAME EXPERIMENT?
//
// The reference for this block compares SESSIONS by their first user message. We have no first user message --
// our unit is a RUN of the observer, and what makes two runs the same experiment is the question configuration
// they were asked under. Two runs of the same configured questions ARE a question-engineering A/B, which is this
// plugin's actual purpose, so the key is the `mount` line's own record of what was asked.
//
// THE REASON VOCABULARY IS THE POINT, and it is four values rather than the three the port notes paraphrase. The
// reference's own comment says why: "a missing first user message is not 'different tasks', it is 'cannot tell' --
// the two reasons are kept apart". Reproduced here in its check ORDER, because the order is what makes `single`
// and `no-task-key` unreachable when they should be:
//
//   single        fewer than two runs are selected, so there is nothing to compare
//   no-task-key   at least one selected run has no mount line, so comparability CANNOT BE JUDGED
//   same          every selected run was asked the same questions under the same instrument
//   diff          they were not, and `differIn` names which part changed
//
// A report that collapsed `no-task-key` into `diff` would tell an operator their questions changed when in fact
// nobody could tell -- and the fix for the two is different.
/** How many runs are shown side by side. The reference's limit, kept. */
export const MAX_LANES = 5

/**
 * The parts of the mount record that must match for two runs to be the same experiment.
 *
 * `switches` is in here because it decides WHICH SEAMS ACTUALLY CALLED: a run with every seam on and a run with
 * only `draft` on measured different things, whatever their question lists say. Measured on this deployment: a
 * key without it called five runs "directly comparable" whose seam mixes differed by two orders of magnitude.
 */
export const KEY_PARTS = Object.freeze(['questions', 'hooks', 'switches', 'instrument'])

/**
 * The comparability key of one run, from its mount line, or `undefined` when there is nothing to key on.
 *
 * THREE PARTS, NOT ONE, and that is a deliberate widening of the reference's single text key. A question A/B
 * holds the INSTRUMENT fixed; two runs under different judges answer a different question, and reporting that as
 * a question change would mislabel the experiment. A run with no mount line has no key at all, which is the
 * `no-task-key` case and not a difference.
 */
export function taskKeyOf(mount) {
    if (mount === null || typeof mount !== 'object') return undefined
    const list = value => (Array.isArray(value) ? value.map(item => String(item)).sort() : null)
    return {
        // What was asked. `probeHash` is the instrument's identity, so an edited probe is a new instrument even
        // when the ids are unchanged -- the same reasoning that puts it on the mount line.
        questions: list(mount.questionIds),
        hooks: list(mount.hooks),
        // ABSENT IS NOT "NO SEAMS OFF". A line written before these fields existed says nothing about which seams
        // were switched or whether calls were on at all, so `null` here means CANNOT JUDGE -- the same distinction
        // the reference draws between "different tasks" and "cannot tell".
        // PER PART, AND EACH PART REFUSES ON ABSENCE. This used to test only "both missing", so a mount that
        // recorded `seamsOff` but not `callsEnabled` silently merged with "calls were on" -- a MISSING RECORD
        // AGREEING WITH A VALUE, which is the exact error this key exists to prevent. The tell was the asymmetry
        // with `instrument` below, where a missing `probeHash` counts as a DIFFERENCE. Found by the reviewer
        // session, not by me.
        switches: mount.seamsOff === undefined || mount.callsEnabled === undefined
            ? null
            : JSON.stringify([list(mount.seamsOff), mount.callsEnabled !== false]),
        // JSON, NOT A JOINED STRING. `|` as a separator is ambiguous whenever a field contains one, and the fields
        // come from the server: measured, `provider: 'a|b'` with `model: 'c'` and `provider: 'a'` with
        // `model: 'b|c'` both produced `"t|a|b|c|d"`, so two different instruments compared as one. `switches`
        // already used `JSON.stringify`, so the two parts also disagreed in KIND. Found by the reviewer session,
        // which framed it as a comment-vs-code observation rather than a defensive-coding one -- correctly, since
        // nothing tested that no model id contains the separator.
        instrument: JSON.stringify([mount.transport ?? null, mount.provider ?? null, mount.model ?? null, mount.probeHash ?? null, mount.questionSetHash ?? null].map(value => (value === null ? '' : String(value)))),
    }
}

/**
 * Whether the selected runs are the same experiment, and if not, why not.
 *
 * @param keys one key per selected run, `undefined` for a run with no mount line
 * @returns `{ sameTask, reason, differIn }` -- `differIn` is empty unless the reason is `diff`
 */
export function taskComparability(keys) {
    const list = Array.isArray(keys) ? keys : []
    if (list.length < 2) return { sameTask: false, reason: 'single', differIn: [], missing: [] }
    if (list.some(key => key === undefined || key === null)) return { sameTask: false, reason: 'no-task-key', differIn: [], missing: ['mount'] }
    // A RUN WHOSE KEY IS INCOMPLETE CANNOT BE JUDGED. This is the common case on an existing deployment: mount
    // lines written before the scope fields existed record no switches, and treating that silence as agreement
    // would report comparability the record does not support.
    const missing = KEY_PARTS.filter(part => list.some(key => key[part] === null || key[part] === undefined))
    if (missing.length > 0) return { sameTask: false, reason: 'no-task-key', differIn: [], missing }
    const differIn = KEY_PARTS.filter(part => !list.every(key => JSON.stringify(key[part]) === JSON.stringify(list[0][part])))
    return { sameTask: differIn.length === 0, reason: differIn.length === 0 ? 'same' : 'diff', differIn, missing: [] }
}

/** One line the legend can print, in the reference's spirit: say WHICH kind of "not the same" this is. */
export function comparabilityNote(verdict, count) {
    switch (verdict?.reason) {
        case 'single': return `one run selected: nothing to compare`
        case 'no-task-key': return `${count} runs selected but ${verdict.missing.join(', ')} is unrecorded in at least one, so comparability cannot be judged -- this is not a difference, it is a missing record`
        case 'same': return `${count} runs of the same questions under the same instrument: directly comparable`
        case 'diff': return `${count} runs that differ in ${verdict.differIn.join(', ')} -- comparable only as different experiments`
        default: return 'comparability not recorded'
    }
}

function atOf(value) {
    const parsed = Date.parse(typeof value === 'string' ? value : '')
    return Number.isFinite(parsed) ? parsed : null
}

/**
 * The runs, side by side, with the verdict that gates whether their numbers may be read together.
 *
 * @param events every event read
 * @param options.limit how many lanes; the newest are taken, because comparing recent runs is the common case
 */
export function compareRuns(events, options = {}) {
    const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : MAX_LANES
    const list = Array.isArray(events) ? events : []
    const runs = []
    const byRun = new Map()
    for (const event of list) {
        const id = typeof event?.run === 'string' ? event.run : '(no run)'
        if (!byRun.has(id)) {
            byRun.set(id, { id, firstAt: null, lastAt: null, calls: 0, errors: 0, skips: 0, msSum: 0, mount: null, seams: new Map() })
            runs.push(id)
        }
        const lane = byRun.get(id)
        const at = atOf(event?.at)
        if (at !== null) {
            if (lane.firstAt === null || at < lane.firstAt) lane.firstAt = at
            if (lane.lastAt === null || at > lane.lastAt) lane.lastAt = at
        }
        if (event?.event === 'mount' && lane.mount === null) lane.mount = event
        if (event?.event === 'call') {
            lane.calls += 1
            if (typeof event.ms === 'number') lane.msSum += event.ms
            const seam = typeof event.hook === 'string' ? event.hook : '(unknown)'
            lane.seams.set(seam, (lane.seams.get(seam) ?? 0) + 1)
        }
        if (event?.event === 'error') lane.errors += 1
        if (event?.event === 'skip') lane.skips += 1
    }
    // THE NEWEST LANES, and the selection is reported because the verdict is about the SELECTION: taking five of
    // eighteen runs and calling them comparable would be a claim about the five, not about the file.
    const selected = [...byRun.values()].filter(lane => lane.mount !== null).slice(-limit)
    const keys = selected.map(lane => taskKeyOf(lane.mount))
    const verdict = taskComparability(keys)
    return {
        verdict,
        lanes: selected.map(lane => ({
            id: lane.id,
            firstAt: lane.firstAt === null ? null : new Date(lane.firstAt).toISOString(),
            lastAt: lane.lastAt === null ? null : new Date(lane.lastAt).toISOString(),
            calls: lane.calls,
            errors: lane.errors,
            skips: lane.skips,
            msSum: lane.msSum,
            seamMix: [...lane.seams.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, count })),
        })),
        // Every run in the window, so a reader can tell "these are the only runs" from "these are the five shown".
        selected: selected.length,
        total: byRun.size,
        limit,
        note: comparabilityNote(verdict, selected.length),
    }
}
