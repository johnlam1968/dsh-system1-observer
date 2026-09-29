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

      return h('div', { style: styles.wrap },
        h('h2', { style: styles.title }, 'System One observer'),
        h('p', { style: styles.note },
          'diagnostic \u2014 mirror status: ' + (snap ? snap.status : 'no mirror')
          + ' \u00b7 namespace: ' + (ns ? ns.ns : 'not found')
          + ' \u00b7 available: ' + (namespaces ? namespaces.map((n) => n.ns).join('|') : '-')),
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
