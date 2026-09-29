/**
 * The CLIENT half: the settings card on the Plugins page.
 *
 * A card is REGISTERED, not generated. Three things make it appear, and each failure is silent:
 *   1. the manifest exports `./client` and declares `dsh.client`;
 *   2. the factory id equals the PACKAGE NAME;
 *   3. it registers into a slot the page DECLARES, under a key the page dispatches.
 *
 * The slot is keyed by PACKAGE, and a bundle may declare several rows, so the page supplies `view`
 * and NO `form`. This card resolves its own settings entry from the shared mirror by NAMESPACE.
 */
window.__ModuleLoader__.load({
  id: 'dsh-system1-observer',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    // THE SHARED FORM TOOLKIT, not hand-rolled chrome: the primitives package owns the staged model
    // (dirty/invalid/saving/failed, revision-fenced save, per-field overridden badge) and the controls.
    const {
      SettingsFormModel, SettingsForm, SettingsValueField, settingsNumberField,
    } = require('@deepseek-ai/dsh-client-ui-primitives')

    const PACKAGE = 'dsh-system1-observer'
    // THE NAMESPACE IS THE PROFILE ENTRY ID, NOT THE PACKAGE NAME: `describe()` is keyed by unique
    // profile entry ids, so the spelling depends on how the profile composed this bundle -- bare when
    // the row sits in the profile, `include:<rowId>` when it arrives through the patch. Accept both.
    const NAMESPACES = ['system1-observer', 'include:system1-observer']

    const styles = {
      wrap: { display: 'grid', gap: '12px', maxWidth: '680px', color: 'var(--dsw-alias-label-primary)' },
      title: { margin: 0, fontSize: '14px', fontWeight: 600 },
      note: { margin: 0, fontSize: '12px', lineHeight: 1.5, color: 'var(--dsw-alias-label-secondary)' },
    }

    /**
     * The two live booleans, as one spec factory. There is NO shipped `settingsBooleanField`, so this is
     * the card's own conversion: `on`/`true` and `off`/`false` stage a set, a blank draft clears the field
     * back to the schema default, and ANY OTHER draft returns `undefined` -- which marks the field invalid
     * and blocks the save while the draft stays on screen, rather than silently dropping what was typed.
     */
    const ON_OFF = (field, label, hint) => ({
      field, label, hint,
      format: (value) => (value === true ? 'on' : 'off'),
      parse: (text) => {
        const t = String(text).trim().toLowerCase()
        if (t === 'on' || t === 'true') return { kind: 'set', value: true }
        if (t === 'off' || t === 'false') return { kind: 'set', value: false }
        if (t === '') return { kind: 'clear' }
        return undefined                      // invalid: the save is blocked, the draft is kept visible
      },
    })

    // THE THREE FIELDS THE HOST ACCEPTS TODAY -- the only `.volatile()` ones, so the only ones a save can
    // write. The other seven are YAML-only; a write against one is refused with
    // `Config field "x" is not volatile`, so they are deliberately absent.
    const FIELDS = [
      ON_OFF('observeSubagents', 'Observe subagents', 'Off records a subagent\u2019s streams and tool calls as skip lines; their text never reaches the model.'),
      ON_OFF('includeNonOperatorFacing', 'Include the harness\u2019s own calls', 'Also observe purpose-tagged streams: session titles and compaction.'),
      { ...settingsNumberField('maxFieldChars'), label: 'Longest recorded field', hint: 'Characters kept per state field; longer values are cut and the line is marked truncated.' },
    ]

    function Form(props) {
      const { scope } = props
      // THE HOOK RUNS UNCONDITIONALLY. `configForms.get(ns)` returns a live entry for any namespace the
      // mirror serves, so the scope is present exactly when this card has settings to edit; with none,
      // the memo builds nothing and the page says so -- an early return before the hook would blank the
      // slot entry the moment the namespace appeared.
      const model = React.useMemo(
        () => (scope === undefined ? undefined : new SettingsFormModel(scope, FIELDS)),
        [scope],
      )
      if (model === undefined) return h('p', { style: styles.note }, 'These settings are not available to this page.')
      const bind = model.bind(() => ({ shell: model.shell(), fields: FIELDS.map((f) => ({ f, s: model.field(f.field) })) }))
      const view = bind.getSnapshot()
      if (!view.shell.available) return h('p', { style: styles.note }, 'These settings are not available to this page.')
      return h(SettingsForm, {
        labels: { unavailable: 'Settings are unavailable.', readOnly: 'This profile does not allow settings changes.', saveFailed: 'DSH did not accept these settings.', save: 'Save', saving: 'Saving\u2026' },
        state: view.shell,
        onSave: () => { void model.actions().save() },
        onDiscard: () => model.actions().discard(),
      }, view.fields.map(({ f, s }) => h(SettingsValueField, {
        key: f.field, id: 'system1-observer-' + f.field, label: f.label, hint: f.hint,
        text: s.text === undefined ? f.format(undefined) : s.text,
        overridden: s.overridden, invalid: s.invalid,
        overriddenLabel: 'overridden', resetLabel: 'reset',
        // The control renders `invalidLabel` in place of the hint while a draft is invalid -- which is the
        // ONLY thing that tells the user why the save is blocked, since the brief's own list of props stops
        // short of it. `onReset` is the badge's clear-to-default control; without it that button throws.
        invalidLabel: 'Enter on, off, true, or false.',
        onReset: () => model.actions().resetField(f.field),
        disabled: !view.shell.writable,
        onEdit: (text) => model.actions().edit(f.field, text),
      })))
    }

    function Card(props) {
      const { view, services } = props
      const mirror = services.configForms.describe()

      // EVERY hook runs before any early return.
      const [snap, setSnap] = React.useState(mirror.getSnapshot())
      React.useEffect(() => mirror.subscribe(() => setSnap(mirror.getSnapshot())), [mirror])
      React.useEffect(() => { void mirror.ensure() }, [mirror])

      if (view === 'summary') {
        return h('span', null, 'Calls a System One model at chosen points of the agent loop and traces every call.')
      }

      const namespaces = snap && snap.view ? snap.view.namespaces : null
      const ns = namespaces ? namespaces.find((n) => NAMESPACES.includes(n.ns)) : undefined
      // NO ADAPTER: `configForms.get(ns)` returns exactly the `SettingsFormScope` the model stages over
      // (`getSnapshot` / `subscribe` / `mutate`), so the entry form is handed to the model unchanged.
      const scope = ns === undefined ? undefined : services.configForms.get(ns.ns)

      return h('div', { style: styles.wrap },
        h('h2', { style: styles.title }, 'System One observer'),
        h(Form, { scope, services }),
      )
    }

    return {
      inject: ['slots', 'configForms'],
      apply(ctx) {
        const services = { configForms: ctx.configForms }
        // `slots.inject(ownerKey, ...)` keeps the registration alive across the slot's own
        // re-declaration, which matters because the Plugins page declares its slots at runtime.
        ctx.effect(() => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register(
          { name: 'plugins.bundle.config', key: PACKAGE },
          (props) => h(Card, Object.assign({}, props, { services })),
        )))
      },
    }
  },
})
