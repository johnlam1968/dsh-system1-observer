// THE WRITE, AS A MODULE, so the dangerous part is tested rather than written inline in a row.
//
// WHAT IT DOES. Turns one knob change into a persisted edit of THIS row's configuration, through the harness's own
// `configEditor` service rather than by touching the profile file. Read from the service's declarations
// (`dsh-config-editor/lib/types/index.d.ts`):
//
//     configEditor: ConfigEditor                       // service name, super(ownerContext, "configEditor")
//     entries(): Entry[]                               // active rows, by profile patch id
//     edit(entry, change: (current, inherited) => Record<string, unknown>): Promise<void>
//
// THE MISTAKE THIS FILE EXISTS TO PREVENT. `edit` hands the callback the row's CURRENT config and asks for the next
// one REQUESTED. Returning a fresh object containing only the changed knob would persist a row that has lost every
// other setting it had -- a silent, destructive edit that no error would report. So the change is merged into
// `current`, and a test asserts the other knobs survive.
//
// AND IT REFUSES RATHER THAN GUESSES. If the row is not among `entries()`, there is nothing to edit and the caller
// is told which ids were available. Choosing the nearest match would persist a change to the wrong row.
//
// WHAT IT DOES NOT DO: it does not record anything. The record goes first and that ordering belongs to the caller
// (`lib/config-tool.js`), which is why this is a writer and not a tool.
export const WRITER_ERRORS = Object.freeze(['no-editor', 'row-not-found', 'no-change'])

/** The id of an entry, tolerant of the shapes the loader hands over, so an unknown field is a refusal not a crash. */
export function entryIdOf(entry) {
    if (entry === null || typeof entry !== 'object') return ''
    for (const key of ['id', 'patchId', 'name']) {
        const value = entry[key]
        if (typeof value === 'string' && value.trim() !== '') return value.trim()
    }
    const nested = entry.options
    if (nested !== null && typeof nested === 'object' && typeof nested.id === 'string') return nested.id.trim()
    return ''
}

/**
 * @param editor the `configEditor` service
 * @param rowId  the profile patch id of THIS row, so the write cannot land on another
 */
export function createConfigWriter({ editor, rowId } = {}) {
    if (editor === null || typeof editor !== 'object' || typeof editor.edit !== 'function') {
        throw new Error('createConfigWriter: `editor` must be the configEditor service (it has no `edit`).')
    }
    if (typeof editor.entries !== 'function') {
        throw new Error('createConfigWriter: `editor` has no `entries`, so the row cannot be addressed.')
    }
    if (typeof rowId !== 'string' || rowId.trim() === '') {
        throw new Error('createConfigWriter: `rowId` is required; writing without one could edit another row.')
    }
    const wanted = rowId.trim()

    const findRow = () => {
        const rows = editor.entries() ?? []
        // A ROW CORDIS INCLUDES IS NAMED `include:<id>`, and this writer asked only for the bare id -- so the
        // settings tool could not address ITS OWN ROW: measured live, `set sessions` refused with "no row with id
        // \"system1-observer\"; available: ... include:system1-observer ...". Both exact names are accepted, and
        // NOTHING FUZZIER: a prefix or suffix match could land the write on another row, which is the one thing
        // this file must never do.
        const found = rows.find((entry) => entryIdOf(entry) === wanted || entryIdOf(entry) === `include:${wanted}`)
        if (found === undefined) {
            const available = rows.map(entryIdOf).filter((id) => id !== '')
            throw new Error(`configWriter: no row with id ${JSON.stringify(wanted)}; available: ${available.join(', ') || '(none)'}.`)
        }
        return found
    }

    return async function write({ knob, value } = {}) {
        if (typeof knob !== 'string' || knob.trim() === '') {
            throw new Error('configWriter: `knob` is required.')
        }
        const name = knob.trim()
        await editor.edit(findRow(), (current) => {
            const base = current !== null && typeof current === 'object' && !Array.isArray(current) ? current : {}
            // MERGE, never replace: returning `{ [name]: value }` would drop every other setting on the row.
            return { ...base, [name]: value }
        })
    }
}
