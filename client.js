/**
 * The CLIENT half: the settings card on the Plugins page.
 *
 * A card is REGISTERED, not generated. Three things make it appear, and each failure is silent:
 *   1. the manifest exports `./client` and declares `dsh.client`;
 *   2. the factory id equals the PACKAGE NAME;
 *   3. it registers into a slot the page DECLARES, under a key the page dispatches.
 *
 * TWO SEATS, because they are different rooms. `plugins.bundle.config` is keyed by PACKAGE and puts a
 * card on the bundle's page; `plugins.row.config` is keyed `<package>#<row id>` and puts the configure
 * control on the row in the Components list. Nothing is passed as `form` on the bundle page and a
 * `ConfigPageForm` is passed on the row page, so the card accepts both.
 *
 * THE PLUMBING IS THE LIVE REFERENCE'S, at `~/.dsh/profiles/web/node_modules/dsh-system1/lib/client.js`
 * `:178-186` and `:266-300`: SUBSCRIBE to the entry form with `useSyncExternalStore`, keep the drafts
 * in `useState` seeded by an effect on the snapshot's status/revision/value, build the `SettingsForm`
 * shell yourself, and render PLAIN DOM controls. The shipped `SettingsFormModel`/`SettingsValueField`
 * pair is deliberately NOT used here. It stages correctly, but its shell reads
 * `scope.getSnapshot().writable`, and a form store that has not derived yet answers `writable: false`
 * (`config-form.ts:84`) -- so a one-shot read disabled every control permanently and nothing could be
 * typed or clicked. `SettingsForm` is chrome only; it draws no field.
 */
window.__ModuleLoader__.load({
  id: 'dsh-system1-observer',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    // THE CHROME ONLY: the availability line, the Save/Discard buttons and the failure line. The value
    // plumbing above is the card's own, so this is the one export the card needs from the toolkit.
    const { SettingsForm } = require('@deepseek-ai/dsh-client-ui-primitives')

    const PACKAGE = 'dsh-system1-observer'
    // THE ROW AS `cordis.patch.yml` DECLARES IT. The row seat's key is `<package>#<row id>`, and a row
    // id that does not match the patch is a registration nothing dispatches -- silent, like all of them.
    const ROW_ID = 'system1-observer'
    // THE NAMESPACE IS THE PROFILE ENTRY ID, NOT THE PACKAGE NAME: `describe()` is keyed by unique
    // profile entry ids, so the spelling depends on how the profile composed this bundle -- bare when
    // the row sits in the profile, `include:<rowId>` when it arrives through the patch. Accept both.
    const NAMESPACES = ['system1-observer', 'include:system1-observer']

    // THE THREE FIELDS THE HOST ACCEPTS TODAY -- the only `.volatile()` ones (`index.js:56-58`), so the
    // only ones a save can write. The other seven are YAML-only; a write against one is refused with
    // `Config field "x" is not volatile`, so they are deliberately absent. The third is `.min(1)`.
    const MAX_FIELD_CHARS_DEFAULT = 4096

    const styles = {
      wrap: { display: 'grid', gap: '12px', maxWidth: '680px', color: 'var(--dsw-alias-label-primary)' },
      title: { margin: 0, fontSize: '14px', fontWeight: 600 },
      note: { margin: 0, fontSize: '12px', lineHeight: 1.5, color: 'var(--dsw-alias-label-secondary)' },
      field: { display: 'grid', gap: '4px' },
      label: { fontSize: '13px', fontWeight: 500 },
      row: { display: 'flex', alignItems: 'center', gap: '8px' },
      error: { margin: 0, fontSize: '12px', lineHeight: 1.5, color: 'var(--dsw-alias-label-error, #c0392b)' },
    }

    // The control the three fields share: label above, control, hint below. Every one of these is a
    // plain DOM element, so nothing between the user and the input can disable it.
    function fieldEl(id, label, control, hint) {
      return h('div', { key: id, style: styles.field },
        h('label', { htmlFor: id, style: styles.label }, label),
        control,
        h('p', { style: styles.note }, hint),
      )
    }

    // Values from `state.value` are narrowed with property checks, never trusted to a shape: the host
    // omits an unset optional field, and a string is not a boolean.
    function asObject(value) {
      return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
    }

    function booleanValue(value) {
      return value === true
    }

    function numberText(value) {
      return typeof value === 'number' && Number.isFinite(value) ? String(value) : String(MAX_FIELD_CHARS_DEFAULT)
    }

    function Form(props) {
      const { current, draft, saving, notice, error, onSave, onDiscard, onEdit, onReset } = props
      const labels = {
        unavailable: 'Settings are unavailable while this component is not loaded.',
        readOnly: 'This profile does not allow settings changes.',
        saveFailed: 'DSH did not accept these settings.',
        save: 'Save',
        saving: 'Saving\u2026',
      }
      // THE SHELL IS BUILT HERE, not by a model. `writable` is `canSave`, so a form with no revision
      // shows the read-only notice instead of a Save button that cannot work.
      const formState = {
        available: true,
        writable: props.canSave,
        dirty: props.dirty,
        invalid: props.invalid,
        saving,
        failed: false,
      }
      const observe = draft.observeSubagents
      const include = draft.includeNonOperatorFacing
      const chars = draft.maxFieldChars
      return h(SettingsForm, { state: formState, labels, onSave, onDiscard },
        fieldEl('system1-observer-observeSubagents', 'Observe subagents',
          h('div', { style: styles.row },
            h('input', {
              id: 'system1-observer-observeSubagents', name: 'observeSubagents', type: 'checkbox',
              checked: observe, disabled: !props.canSave || saving,
              onChange: (event) => onEdit('observeSubagents', event.currentTarget.checked),
            }),
            h('span', { style: styles.note }, observe ? 'on' : 'off'),
          ),
          'Off records a subagent\u2019s streams and tool calls as skip lines; their text never reaches the model.'),
        fieldEl('system1-observer-includeNonOperatorFacing', 'Include the harness\u2019s own calls',
          h('div', { style: styles.row },
            h('input', {
              id: 'system1-observer-includeNonOperatorFacing', name: 'includeNonOperatorFacing', type: 'checkbox',
              checked: include, disabled: !props.canSave || saving,
              onChange: (event) => onEdit('includeNonOperatorFacing', event.currentTarget.checked),
            }),
            h('span', { style: styles.note }, include ? 'on' : 'off'),
          ),
          'Also observe purpose-tagged streams: session titles and compaction.'),
        fieldEl('system1-observer-maxFieldChars', 'Longest recorded field',
          h('div', { style: styles.row },
            h('input', {
              id: 'system1-observer-maxFieldChars', name: 'maxFieldChars', type: 'text', inputMode: 'numeric',
              value: chars, disabled: !props.canSave || saving,
              onChange: (event) => onEdit('maxFieldChars', event.currentTarget.value),
            }),
            // The toolkit's reset badge is not rendered beside a plain control, so its action is kept
            // here: it restores the schema default rather than clearing the box, which `.min(1)` would
            // refuse. Without a handler that badge would throw at the click.
            h('button', {
              type: 'button', disabled: !props.canSave || saving,
              onClick: () => onReset('maxFieldChars', numberText(current.maxFieldChars)),
            }, 'reset'),
          ),
          'Characters kept per state field; longer values are cut and the line is marked truncated.'),
        error !== '' ? h('p', { style: styles.error, role: 'alert' }, error) : null,
        notice !== '' ? h('p', { style: styles.note, role: 'status' }, notice) : null,
        h('p', { style: styles.note }, 'The other seven settings are YAML-only and are refused by the host.'),
      )
    }

    function Card(props) {
      const { view, services } = props
      const mirror = services.configForms.describe()

      // THE MIRROR SUBSCRIPTION: it lists the namespaces this profile serves, and it is where the
      // namespace's spelling is read from rather than guessed.
      const subscribeMirror = React.useCallback((listener) => mirror.subscribe(listener), [mirror])
      const getMirrorSnapshot = React.useCallback(() => mirror.getSnapshot(), [mirror])
      const snap = React.useSyncExternalStore(subscribeMirror, getMirrorSnapshot, getMirrorSnapshot)
      React.useEffect(() => { void mirror.ensure() }, [mirror])

      // EVERY hook runs before any early return, and the hook count is IDENTICAL in both views -- the
      // Plugins page renders one entry for `summary` and one for `page`, and a conditional hook would
      // blank the slot entry rather than render a shorter list. The count is also the same on both
      // SEATS: the row page starts from the provided form and never resolves a namespace, but it runs
      // the same five hooks below over that form.
      const namespaces = snap && snap.view ? snap.view.namespaces : null
      const ns = namespaces ? namespaces.find((n) => NAMESPACES.includes(n.ns)) : undefined
      const nsName = ns === undefined ? undefined : ns.ns
      const resolved = React.useMemo(
        // `get()` takes the BARE namespace, which is exactly the entry id the mirror reports.
        () => (nsName === undefined ? undefined : services.configForms.get(nsName)),
        [nsName, services],
      )
      // THE PAGE-SUPPLIED FORM WINS WHEN PRESENT. On a row page the page owner hands `props.form`, a
      // `ConfigPageForm` (`{ state, mutate }`) that it keeps fresh itself -- so there is NOTHING to
      // subscribe to and no `getSnapshot` to call. On the bundle page it is absent and the controller
      // is subscribed instead.
      const provided = props.form !== undefined && props.form !== null ? props.form : undefined
      const source = provided !== undefined ? provided : resolved
      // A `ConfigPageForm` HAS NO `subscribe`/`getSnapshot` -- it is `{ state, mutate }`, kept fresh by
      // the page owner -- so the hook is fed a no-op pair for it rather than called into a missing
      // method. The hook still runs, because its position in the order must not depend on the seat.
      const subscribeForm = React.useCallback(
        (listener) => (provided !== undefined || source === undefined ? () => {} : source.subscribe(listener)),
        [provided, source],
      )
      const getFormSnapshot = React.useCallback(
        () => (provided !== undefined || source === undefined ? undefined : source.getSnapshot()),
        [provided, source],
      )
      const subscribed = React.useSyncExternalStore(subscribeForm, getFormSnapshot, getFormSnapshot)
      // THE FORM'S OWN STATE, SUBSCRIBED. This is the fix: a store that has not derived yet answers
      // `status: 'loading'` at `writable: false`, and this hook re-reads it when it does derive, so the
      // controls appear instead of the card sitting on a status line forever.
      const state = provided !== undefined ? provided.state : subscribed
      const status = state === undefined || state === null ? undefined : state.status
      const revision = state === undefined || state === null ? undefined : state.revision
      const value = state === undefined || state === null ? undefined : state.value
      const valueObject = asObject(value)

      // THE DRAFTS. The two booleans are booleans -- a checkbox stages `true`/`false` -- and the number
      // is TEXT, because an empty or half-typed box is a state a number cannot hold.
      const current = React.useMemo(() => ({
        observeSubagents: booleanValue(valueObject.observeSubagents),
        includeNonOperatorFacing: booleanValue(valueObject.includeNonOperatorFacing),
        maxFieldChars: numberText(valueObject.maxFieldChars),
      }), [status, revision, value])
      const [draft, setDraft] = React.useState(current)
      const [saving, setSaving] = React.useState(false)
      const [notice, setNotice] = React.useState('')
      const [error, setError] = React.useState('')
      React.useEffect(() => {
        // THE SEED, on status/revision/value -- the reference's exact dependency triple, so it runs when
        // the SNAPSHOT changes and not on every render. Re-seeding replaces a draft that diverged
        // because a new source arrived; the draft is derived state, and nothing else may key it.
        setDraft(current)
      }, [current])

      const parsedChars = Number(draft.maxFieldChars)
      // WHOLE NUMBERS ONLY, because the copy below says "a whole number" and the reference does the same
      // (`dsh-system1/lib/client.js:212`: Number.isInteger(parsedTimeout) && parsedTimeout >= 1). A fractional
      // count reached `mutate` before this, so the card refused in words what it accepted in code.
      const charsValid = draft.maxFieldChars.trim() !== '' && Number.isInteger(parsedChars) && parsedChars >= 1
      const invalid = !charsValid
      const dirty = draft.observeSubagents !== current.observeSubagents
        || draft.includeNonOperatorFacing !== current.includeNonOperatorFacing
        || draft.maxFieldChars !== current.maxFieldChars
      // STRICT: a save needs a state that PERMITS writes AND a revision to fence them with, and both
      // must be true -- a missing `writable` is not a licence to write.
      const canSave = state !== undefined && state !== null
        && state.writable === true && state.revision !== undefined

      const edit = React.useCallback((field, next) => {
        setNotice('')
        setError('')
        setDraft((previous) => Object.assign({}, previous, { [field]: next }))
      }, [])
      const resetField = React.useCallback((field, next) => {
        setNotice('')
        setError('')
        setDraft((previous) => Object.assign({}, previous, { [field]: next }))
      }, [])
      const discard = React.useCallback(() => {
        setNotice('')
        setError('')
        setDraft(current)
      }, [current])
      const save = React.useCallback(async () => {
        if (source === undefined || state === undefined || !canSave) return
        if (invalid) { setError('Enter a whole number of characters, 1 or more.'); return }
        // ONLY THE CHANGED FIELDS, as `set` ops against the path the host accepts.
        const ops = []
        if (draft.observeSubagents !== current.observeSubagents) {
          ops.push({ op: 'set', path: ['observeSubagents'], value: draft.observeSubagents })
        }
        if (draft.includeNonOperatorFacing !== current.includeNonOperatorFacing) {
          ops.push({ op: 'set', path: ['includeNonOperatorFacing'], value: draft.includeNonOperatorFacing })
        }
        if (draft.maxFieldChars !== current.maxFieldChars) {
          ops.push({ op: 'set', path: ['maxFieldChars'], value: parsedChars })
        }
        if (ops.length === 0) { setNotice('No changes to save.'); return }
        setSaving(true)
        try {
          // THE SAME MUTATE ON BOTH SEATS: `ConfigPageForm.mutate` and `ConfigFormController.mutate`
          // have the same shape, and `revision` is optional to the controller, which falls back to its
          // own. A REFUSAL IS NOT A SUCCESS: resolving `false` is how a stale write is rejected, and
          // reporting that as saved is how it comes to look like it worked.
          const mutate = provided !== undefined ? provided.mutate : source.mutate
          if (await mutate.call(source, ops, state.revision)) {
            setNotice('Saved.')
            setError('')
          } else {
            setError('DSH refused the change; the form may be stale. Reload the page and try again.')
          }
        } catch {
          setError('DSH did not accept these settings.')
        } finally {
          setSaving(false)
        }
      }, [source, provided, state, canSave, invalid, draft, current, parsedChars])

      // THE SUMMARY VIEW, after every hook: one entry renders for both views.
      if (view === 'summary') {
        return h('span', null, 'Calls a System One model at chosen points of the agent loop and traces every call.')
      }

      const diagnostic = h('p', { style: styles.note },
        'diagnostic \u2014 mirror status: ' + (snap ? snap.status : 'no mirror')
        + ' \u00b7 namespace: ' + (ns ? ns.ns : 'not found')
        + ' \u00b7 available: ' + (namespaces ? namespaces.map((n) => n.ns).join('|') : '-')
        + ' \u00b7 writable: ' + (state === undefined || state === null ? 'no state' : String(state.writable))
        + ' \u00b7 status: ' + (status === undefined ? 'no state' : String(status))
        + ' \u00b7 revision: ' + (revision === undefined ? 'none' : String(revision))
        + ' \u00b7 canSave: ' + String(canSave))
      const heading = h('h2', { style: styles.title }, 'System One observer')

      // STRICT, LIKE THE REFERENCE: when no state is available, or its status says it is not ready, a
      // STATUS LINE replaces the form. Never dead controls, and never controls that look usable but
      // cannot save. Every hook above has already run, so this early return costs nothing.
      const pageState = status === 'loading'
        ? h('p', { role: 'status', style: styles.note }, 'Loading settings\u2026')
        : (status === 'unavailable' || status === undefined)
          ? h('p', { role: 'note', style: styles.note }, 'Settings are unavailable while this component is not loaded.')
          : null

      return h('div', { style: styles.wrap },
        heading,
        // THE DIAGNOSTIC STAYS THROUGH TASKS 2-3, by the controller's ruling: it is what identifies the
        // namespace on the live page, and `describe()` can spell this row either `system1-observer` or
        // `include:system1-observer` depending on how the profile composed the bundle. Task 3 Step 6
        // removes it. The four EXTRA fields are the values that make a dead control obvious at a
        // glance: `writable`, `status`, `revision`, and the `canSave` conclusion drawn from them.
        diagnostic,
        pageState !== null
          ? pageState
          : h(Form, {
            current, draft, canSave, dirty, invalid, saving, notice, error,
            onSave: () => { void save() },
            onDiscard: discard,
            onEdit: edit,
            onReset: resetField,
          }),
      )
    }

    return {
      inject: ['slots', 'configForms'],
      apply(ctx) {
        const services = { configForms: ctx.configForms }
        const wrap = (props) => h(Card, Object.assign({}, props, { services }))
        // `slots.inject(ownerKey, ...)` keeps each registration alive across the slot's own
        // re-declaration, which matters because the Plugins page declares its slots at runtime.
        ctx.effect(() => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register(
          { name: 'plugins.bundle.config', key: PACKAGE },
          wrap,
        )))
        ctx.effect(() => ctx.slots.inject('plugins.row.config', () => ctx.slots.register(
          // The ROW page is keyed `<package name>#<row id>`, with the row id as the patch declares it.
          // This is the seat that gives the row in the Components list a configure control.
          { name: 'plugins.row.config', key: PACKAGE + '#' + ROW_ID },
          wrap,
        )))
      },
    }
  },
})
