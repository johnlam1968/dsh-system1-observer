import { test } from 'node:test'
import assert from 'node:assert/strict'

// Running the factory and apply() is what proves REGISTRATION; fetching the served bundle would only
// prove delivery. And the registered value is `(props) => h(Card, props)`, so a render must go ONE
// LEVEL DEEPER: calling it and inspecting the result renders nothing and every assertion sees ''.

let captured
async function load() {
  if (captured !== undefined) return captured
  globalThis.window = { __ModuleLoader__: { load(spec) { captured = spec } } }
  await import('../client.js')
  delete globalThis.window
  return captured
}

/**
 * React, at the API the card uses.
 *
 * `useSyncExternalStore` is a REAL hook here and not a one-shot read: it records the live
 * subscribe/getSnapshot pair and returns what the store says NOW, which is how a test flips the store
 * underneath the card and re-renders exactly as the page would. A card that calls it only to read once
 * still loads -- so the subscription is not asserted, it is MEASURED: the controls only become enabled
 * after `form.derive()`.
 */
// The session the CURRENT walk belongs to, so a bare function component can report the element it
// returned without the walker having to thread a context parameter through every branch.
let React_currentSession

function stubReact() {
  const store = []
  const refs = []
  const memos = []
  const callbacks = []
  const effects = []
  const subscriptions = []
  const counts = []
  let cursor = 0
  let session
  const depsSame = (next, previous) =>
    Array.isArray(previous)
    && Array.isArray(next)
    && previous.length === next.length
    && next.every((value, i) => Object.is(value, previous[i]))
  const bump = () => { counts[counts.length - 1] = (counts[counts.length - 1] ?? 0) + 1 }
  return {
    counts,
    // REACT'S OWN SHAPE: the children live on `props.children` AND on the element. A component invoked
    // as `type(props)` then SEES its children, which the variadic-only shape silently dropped. The two
    // are the same array, so a walker must descend into exactly one of them or every field is walked
    // twice (and, because the array holds the element that owns it, more than twice).
    createElement(type, props, ...children) {
      return { type, props: Object.assign({}, props ?? {}, { children }), children }
    },
    useState(initial) {
      bump()
      const idx = cursor++
      if (!(idx in store)) store[idx] = typeof initial === 'function' ? initial() : initial
      return [store[idx], (next) => { store[idx] = typeof next === 'function' ? next(store[idx]) : next }]
    },
    // The effect is counted and RECORDED, so a test can run it -- React would, after the render.
    useEffect(fn) { bump(); effects[cursor++] = fn },
    // `useRef` hands back the same object across renders (one per slot index).
    useRef(initial) {
      bump()
      const idx = cursor++
      if (refs[idx] === undefined) refs[idx] = { current: initial }
      return refs[idx]
    },
    // CACHED BY DEPS, like React: a memo whose deps did not change must not re-run, which is what makes
    // "the drafts are seeded once per snapshot" a property rather than a fresh object every render.
    // A call with NO dependency list is NOT memoised.
    useMemo(fn, deps) {
      bump()
      const idx = cursor++
      const previous = memos[idx]
      const same = previous !== undefined && Array.isArray(deps) && depsSame(deps, previous.deps)
      if (same) return previous.value
      const value = fn()
      memos[idx] = { deps: Array.isArray(deps) ? deps : undefined, value }
      return value
    },
    useCallback(fn, deps) {
      bump()
      const idx = cursor++
      const previous = callbacks[idx]
      const same = previous !== undefined && Array.isArray(deps) && depsSame(deps, previous.deps)
      if (same) return previous.value
      callbacks[idx] = { deps: Array.isArray(deps) ? deps : undefined, value: fn }
      return fn
    },
    // React's own contract: re-read the store on every render, and subscribe to it while mounted.
    useSyncExternalStore(subscribe, getSnapshot) {
      bump()
      const idx = cursor++
      if (refs[idx] === undefined) refs[idx] = { current: getSnapshot }
      if (session !== undefined) session.subs.push({ subscribe, getSnapshot })
      return getSnapshot()
    },
    // ONE RENDER SESSION. Hook slots reset per render; the count and the subscriptions that render
    // registered belong to the session, so a walk (which can invoke the component again) cannot inflate
    // them and a test can ask the session what React would have committed.
    begin() {
      cursor = 0
      counts.push(0)
      session = { count: counts.length - 1, subs: [], roots: [] }
      return session
    },
    session() { return session },
    runEffects() { effects.slice(0, cursor).forEach((fn) => { if (typeof fn === 'function') fn() }) },
  }
}

/**
 * The shipped toolkit, stubbed at the ONE export the card is allowed to need.
 *
 * The card builds its own shell and renders plain DOM controls, so `SettingsFormModel` and
 * `SettingsValueField` are deliberately ABSENT: a card that requires them throws here, which is the
 * boundary the defect crossed. The returned `SettingsForm` is an ordinary component function, so
 * `createElement` yields a descriptor whose `type` is that exact function and a test can find it.
 */
function stubPrimitives() {
  // A REACT COMPONENT RECEIVES ITS CHILDREN IN `props.children`, so this stub does too. A variadic
  // `(...args)` stub reads them from the call site instead, and a walker that invokes `type(props)`
  // then hands it none -- which renders the chrome with every field missing, silently.
  const SettingsForm = (props) => ({ primitives: true, props, children: (props.children ?? []).flat(Infinity) })
  return { SettingsForm }
}

function stubMirror(namespaces) {
  return {
    getSnapshot: () => ({ status: 'ready', view: { namespaces, writable: true } }),
    subscribe: () => () => {},
    ensure: async () => {},
  }
}

/**
 * A `SettingsFormScope`, as `configForms.get(ns)` returns it.
 *
 * `derive()` models exactly what the live defect turns on: a store that has not derived yet answers
 * `writable: false` at `revision: undefined`, and crosses the boundary later. `mutate` records its
 * arguments and resolves whatever the test says.
 */
function stubForm(options = {}) {
  return {
    derived: false,
    mutable: options.mutable ?? true,
    derives: options.derives ?? true,
    ready: options.ready ?? true,
    value: options.value ?? {},
    calls: [],
    listeners: new Set(),
    subscriptions: 0,
    derive() { this.derived = true; this.notify() },
    notify() { for (const listener of this.listeners) listener() },
    getSnapshot() {
      if (!this.derived) return { status: 'loading', value: this.value, base: {}, writable: false, revision: undefined }
      if (!this.ready) return { status: options.status ?? 'unavailable', value: this.value, base: {}, writable: false, revision: undefined }
      return { status: 'ready', value: this.value, base: {}, writable: true, revision: 7 }
    },
    // A REAL SUBSCRIPTION, AT REACT'S CONTRACT. `useSyncExternalStore(subscribe, ...)` calls
    // `subscribe(handleStoreChange)` and keeps the returned unsubscribe, so the listener the store
    // receives IS React's re-render request. A test fires it with `notify()`, which is the push a
    // one-shot read can never receive.
    subscribe(listener) {
      this.subscriptions += 1
      this.listeners.add(listener)
      return () => { this.subscriptions -= 1; this.listeners.delete(listener) }
    },
    async mutate(ops, revision) { this.calls.push({ ops, revision }); return this.mutable },
  }
}

// The READY-BUT-READ-ONLY form: a derived store that says `writable: false`. This is the state that
// must still render its controls so the user can SEE the three settings, disabled, with the read-only
// notice -- distinct from a store that has not derived, which is a status line and no controls at all.
function readOnlyForm() {
  return {
    derived: true,
    calls: [],
    getSnapshot: () => ({ status: 'ready', value: {}, base: {}, writable: false, revision: 7 }),
    subscribe: () => () => {},
    async mutate(ops, revision) { this.calls.push({ ops, revision }); return true },
  }
}

// THE PAGE-SUPPLIED SHAPE, `ConfigPageForm`: `{ state, mutate }` and NO `subscribe` / `getSnapshot`.
// It is what a card receives as `props.form` on a ROW page, and it is NOT a `ConfigFormController`.
function pageForm(options = {}) {
  return {
    calls: [],
    state: { status: 'ready', value: options.value ?? {}, base: {}, writable: true, revision: 9 },
    async mutate(ops, revision) { this.calls.push({ ops, revision }); return true },
  }
}

async function mount(options = {}) {
  const spec = await load()
  const React = stubReact()
  const primitives = stubPrimitives()
  const mod = spec.factory((name) => {
    if (name === 'react') return React
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitives
    throw new Error(`unexpected require: ${name}`)
  })
  const registered = []
  const namespaces = options.namespaces ?? [{ ns: 'system1-observer', value: {}, revision: 4 }]
  await mod.apply({
    effect: (fn) => fn(),
    // `configForms.get` is keyed by NAMESPACE and only serves a namespace the mirror lists, so "not
    // served" is representable and hands the card no form at all.
    configForms: {
      describe: () => stubMirror(namespaces),
      get: (ns) => (namespaces.some((n) => n.ns === ns) ? options.form : undefined),
    },
    slots: {
      inject(ownerKey, fn) {
        // `fn()` calls back into `register` BELOW while this push is still an argument, so the entry
        // must be pushed before `fn()` runs, not as part of the same statement.
        const entry = { ownerKey }
        registered.push(entry)
        entry.dispose = fn()
      },
      // The registered TARGET must be captured too: it holds the slot key, and if the harness discards
      // it then a mutation of that key cannot reach any assertion.
      register(target, component) {
        registered[registered.length - 1].target = target
        return { target, component }
      },
    },
  })
  return { spec, React, registered, primitives }
}

/**
 * ONE COMPLETE RENDER of the page view, one level deeper than the registered value.
 *
 * The walk IS the render: it invokes every function component in React's order, which is what runs the
 * card's effects (they are recorded while the render runs). Everything -- the painted elements AND the
 * rendered text -- is returned by that SAME walk, because dispatching the component a second time would
 * run it in a fresh hook universe: effects would write state no later read could see, and a card whose
 * drafts never seeded would look identical to one whose drafts did.
 *
 * A state update an effect makes lands in the NEXT render, so a test that needs to see it calls
 * `paint` once more -- which is exactly React's own behaviour.
 */
function paint(React, registered, extra = {}) {
  return renderView(React, registered[0].dispose.component, Object.assign({ view: 'page' }, extra))
}

/**
 * THE COMMIT. React calls `subscribe(handleStoreChange)` after a render that read the store, and keeps
 * the returned unsubscribe. The stub has to do it too, or the store has no listener and a test cannot
 * tell a subscribed card from a one-shot read. Returns the unsubscribes, so a test can count them.
 */
function commit(React, session) {
  const handles = []
  for (const { subscribe } of session.subs) {
    const unsubscribe = subscribe(() => {})
    if (typeof unsubscribe === 'function') handles.push(unsubscribe)
  }
  return handles
}

/**
 * ONE COMPLETE RENDER of a view: render, walk (which runs the effects), then COMMIT the subscriptions
 * that render registered -- which is the order React uses. Returns the painted node, the text the walk
 * produced, the host inputs, and the unsubscribes React committed.
 */
function renderView(React, entry, props) {
  const session = React.begin()
  React_currentSession = session
  // ONE LEVEL DEEPER, and only once: the registered value is `(props) => h(Card, props)`, so calling it
  // yields the card's descriptor and THAT is what the walk renders -- a second invocation of the card
  // would double its subscriptions and read a different hook universe.
  const wrapper = entry(props)
  const node = wrapper.type(wrapper.props)
  session.roots.push(node)
  const { text } = walkNodes(node)
  const mounted = commit(React, session)
  React_currentSession = undefined
  return { node, text, inputs: collectInputs(node), mounted, session }
}

// HOW MANY LIVE SUBSCRIPTIONS THE CARD HOLDS, measured at the STORE. `useSyncExternalStore` calls
// `subscribe(listener)` at commit and keeps the unsubscribe, so a card that merely READ the snapshot
// leaves the store with no subscription at all. This is the subscription, tested where it is real.
function subscribedTo(form) {
  return form.subscriptions
}

// The entry registered for one slot key, so a test can exercise a specific seat.
function seat(registered, key) {
  const entry = registered.find((e) => e.target && e.target.key === key)
  if (entry === undefined) throw new Error(`no registration for ${key}; got ${registered.map((e) => e.target && e.target.key).join(', ')}`)
  return entry.dispose.component
}

// The host `input` props anywhere below `node`, keyed by `id` -- the only thing the card guarantees.
function collectInputs(node) {
  const found = []
  const walk = (current, d = 0) => {
    if (current === null || current === undefined || typeof current === 'boolean') return
    if (typeof current === 'string' || typeof current === 'number' || typeof current === 'function') return
    if (Array.isArray(current)) { current.forEach(walk); return }
    if (current.type === 'input') found.push(current.props)
    if (typeof current.type === 'function') { walk(current.type(current.props ?? {}), d + 1); return }
    ;(current.children ?? []).forEach((c) => walk(c, d + 1))
  }
  walk(node)
  return found
}

// The `SettingsForm` element the card renders: the one stub component whose props carry `state`.
// Found by SHAPE rather than by stub identity, because the identity is per-mount and a test that
// renders without going through `paint` would otherwise have to thread it through by hand.
function collectForms(node) {
  const found = []
  const walk = (current) => {
    if (current === null || current === undefined || typeof current === 'boolean') return
    if (typeof current === 'string' || typeof current === 'number' || typeof current === 'function') return
    if (Array.isArray(current)) { current.forEach(walk); return }
    if (typeof current.type === 'function' && current.props !== undefined && current.props.state !== undefined) {
      found.push({ props: current.props, node: current })
      return
    }
    if (typeof current.type === 'function') { walk(current.type(current.props ?? {})); return }
    ;(current.children ?? []).forEach(walk)
  }
  walk(node)
  return found
}

// The settings chrome alone: its props, or `undefined` when the card rendered a status line instead.
function formProps(node) {
  const found = collectForms(node)
  return found.length === 0 ? undefined : found[0].props
}

/**
 * THE WALK, as React performs it.
 *
 * Two jobs at once: RENDER every function component in order (which is what runs the effects, because
 * they are recorded while the component runs), and collect the text a real renderer would put on
 * screen. The reconciliation map matters: `paint` renders the card, and without the map the walk would
 * render it AGAIN -- doubling `useSyncExternalStore` and finding a foreign component's nodes. Each node
 * is rendered exactly once, and the components it returns are registered so their own nodes reuse them.
 */
function walkNodes(node) {
  const texts = []
  const rendered = new WeakMap()
  const walk = (current) => {
    if (current === null || current === undefined || typeof current === 'boolean') return null
    if (typeof current === 'string' || typeof current === 'number') { texts.push(current); return null }
    if (Array.isArray(current)) { current.forEach(walk); return null }
    // A bare function IS a component here (the registered value, or one a test passes in).
    if (typeof current === 'function') { walk(current({})); return null }
    if (typeof current.type === 'function') {
      const props = (rendered.has(current) ? Object.assign({}, current.props, { children: current.children }) : current.props) ?? {}
      const out = current.type(props)
      if (out !== null && typeof out === 'object' && out.type !== undefined) rendered.set(out, current.type)
      walk(out)
      return null
    }
    ;(current.children ?? []).forEach(walk)
    return null
  }
  walk(node)
  return { text: texts.join(' | '), roots: rendered }
}

// `renderTree` is the text-only face of the walk, kept for callers that have already rendered.
function renderTree(node) {
  return walkNodes(node).text
}

// The diagnostic line's `namespace:` field, on its own. Read from the rendered TEXT rather than
// reconstructed from the fixtures, so dropping the paragraph fails this and so does a wrong spelling.
function diagnosticNamespace(text) {
  // The value runs to the middle dot that follows it, NOT to the next space: 'not found' is the value
  // when nothing was resolved.
  const found = /namespace: ([^\u00b7]+?)\s*(?:\u00b7|$)/.exec(text)
  return found === null ? null : found[1]
}

test('it registers BOTH seats: the bundle page and the row page', async () => {
  const { spec, registered } = await mount()
  assert.equal(spec.id, 'dsh-system1-observer')
  assert.equal(registered.length, 2, 'the card needs a seat on the bundle page AND on the row page')
  const seats = registered.map((entry) => ({ ownerKey: entry.ownerKey, target: entry.target }))
  // The BUNDLE page dispatches on the PACKAGE NAME. The settings namespace (`system1-observer` /
  // `include:system1-observer`) is a different id space and registering under it is silent: no card.
  assert.deepEqual(seats, [
    { ownerKey: 'plugins.bundle.config', target: { name: 'plugins.bundle.config', key: 'dsh-system1-observer' } },
    // The ROW page is keyed `<package name>#<row id>`, with the row id exactly as `cordis.patch.yml`
    // declares it. Without this seat the Components list shows the row with NO configure control.
    { ownerKey: 'plugins.row.config', target: { name: 'plugins.row.config', key: 'dsh-system1-observer#system1-observer' } },
  ])
})

test('both views render, and the hook count is equal and non-zero', async () => {
  const { React, registered } = await mount({ form: stubForm() })
  const entry = registered[0].dispose.component
  // ONE LEVEL DEEPER. `entry` is the registered `(props) => h(Card, props)`, so calling it returns an
  // element descriptor and renders NOTHING: every assertion below would pass vacuously and the hook
  // count would be 0. The Card is the element's `type`, and its props are the element's props.
  const summary = renderView(React, entry, { view: 'summary' })
  const page = renderView(React, entry, { view: 'page' })
  assert.ok(summary.node, 'summary must render something')
  assert.ok(page.node, 'page must render something')
  const summaryHooks = React.counts[summary.session.count]
  const pageHooks = React.counts[page.session.count]
  assert.equal(summaryHooks, pageHooks, 'hook count must not differ between views')
  assert.ok(summaryHooks > 0, 'the card must call at least one hook')
})

test('with a page-supplied `form` prop the controls are enabled and Save calls THAT form', async () => {
  const form = pageForm()
  const { React, registered } = await mount({ form: stubForm() })
  // A row page hands the card `props.form` = `{ state, mutate }` -- the `ConfigPageForm` shape, which
  // has NO `subscribe`/`getSnapshot`. The card must use it directly: its owner keeps `state` fresh, so
  // there is nothing to subscribe to.
  const entry = seat(registered, 'dsh-system1-observer#system1-observer')
  React.begin()
  const wrapper = entry({ view: 'page', form })
  const node = wrapper.type(wrapper.props)
  renderTree(node)
  const inputs = collectInputs(node)
  assert.equal(inputs.length, 3, 'the row page must render the three controls')
  assert.ok(inputs.every((input) => input.disabled === false), 'a ready page form enables every control')
  const observe = inputs.find((input) => input.id === 'system1-observer-observeSubagents')
  observe.onChange({ currentTarget: { checked: true } })
  React.begin()
  const flippedWrapper = entry({ view: 'page', form })
  const flipped = flippedWrapper.type(flippedWrapper.props)
  renderTree(flipped)
  await formProps(flipped).onSave()
  assert.deepEqual(form.calls[0].ops, [{ op: 'set', path: ['observeSubagents'], value: true }])
  assert.equal(form.calls[0].revision, 9, 'the revision comes from the page-supplied state')
})

test('a card SUBSCRIBED to the entry form re-renders to live controls when it derives', async () => {
  const form = stubForm()
  const { React, registered } = await mount({ form })
  // THE LIVE DEFECT, exactly: at first paint the entry form has not derived, so it answers
  // `status: 'loading'` at `writable: false`. Reading that ONCE and never subscribing leaves the card
  // on this status line forever -- which is what the operator saw.
  const before = paint(React, registered)
  assert.match(before.text, /writable: false/, 'the diagnostic reports the pre-derived store')
  // STRICT: a store that has not derived gets a STATUS LINE and NO CONTROLS, not dead controls. The
  // naive fix is to render them disabled and hope; the reference renders the status instead.
  assert.equal(before.inputs.length, 0, 'no controls before a real state arrives')
  assert.equal(formProps(before.node), undefined, 'and no form chrome either')
  assert.match(before.text, /loading settings/i, 'the status line must say the settings are still loading')
  // THE SUBSCRIPTION. React keeps the unsubscribe; the store keeps the callback React handed it. A card
  // that read the snapshot instead of subscribing never called `subscribe` at all, so this is empty and
  // `notify()` below reaches nobody -- the defect in one assertion.
  // THE SUBSCRIPTION. A card that read the snapshot once committed NOTHING here, so this is empty and
  // the store holds no listener -- the defect, in one assertion.
  assert.ok(before.mounted.length >= 1, 'React must have committed a subscription to the entry form')
  assert.ok(subscribedTo(form) >= 1, 'the store must hold a listener the card registered')
  form.derive()
  const after = paint(React, registered)
  assert.equal(formProps(after.node).state.writable, true, 'the shell becomes writable once the form derives')
  assert.ok(after.inputs.every((input) => input.disabled === false), 'a derived form enables every control -- the subscription, not a one-shot read')
  assert.match(after.text, /writable: true/, 'the diagnostic follows the store too')
})

test('a DERIVED form that reports writable: false renders the controls disabled', async () => {
  const form = readOnlyForm()
  const { React, registered } = await mount({ form })
  const { node, text, inputs } = paint(React, registered)
  // A real, derived state that merely forbids writes still shows the three fields, disabled, with the
  // read-only notice -- so the operator can READ their settings. Only an underived store hides them.
  assert.equal(inputs.length, 3, 'the three fields must render when the profile forbids writes')
  for (const input of inputs) {
    assert.equal(input.disabled, true, `a read-only form must disable ${input.id}`)
  }
  assert.equal(formProps(node).state.writable, false, 'the shell the card built reports the read-only state')
  assert.match(text, /writable: false/, 'and the diagnostic says why')
})

test('a status that is unavailable renders the status line and no controls', async () => {
  const form = stubForm({ derives: true, ready: false, status: 'unavailable' })
  form.derive()
  const { React, registered } = await mount({ form })
  const { text, inputs } = paint(React, registered)
  assert.equal(inputs.length, 0, 'an unavailable store must not draw controls')
  assert.match(text, /unavailable/i, 'it must say the settings are unavailable instead')
  assert.doesNotMatch(text, /Observe subagents/, 'and no field may render')
})

test('the two booleans are real checkboxes that can be flipped', async () => {
  const form = stubForm()
  const { React, registered } = await mount({ form })
  paint(React, registered)
  form.derive()
  const second = paint(React, registered)
  const inputs = new Map(second.inputs.map((input) => [input.id, input]))
  const observe = inputs.get('system1-observer-observeSubagents')
  const include = inputs.get('system1-observer-includeNonOperatorFacing')
  assert.equal(observe.type, 'checkbox', 'the flip complaint is about exactly this control')
  assert.equal(include.type, 'checkbox', 'both booleans are checkboxes, not typed on/off text')
  assert.equal(typeof observe.onChange, 'function', 'a checkbox with no onChange cannot be flipped')
  assert.equal(observe.checked, false, 'an unset boolean reads as off')
  // THE FLIP: it stages a change, so the shell the card builds reports dirty and the save has work.
  observe.onChange({ currentTarget: { checked: true } })
  // ONE MORE RENDER, because a state update lands in the next render -- exactly as it does live.
  const flipped = paint(React, registered)
  assert.equal(formProps(flipped.node).state.dirty, true, 'flipping a boolean must mark the form dirty')
  assert.equal(flipped.inputs.find((input) => input.id === observe.id).checked, true, 'the checkbox shows the flipped value')
})

test('saving after a flip sends only the changed field, as a set op, at the snapshot revision', async () => {
  const form = stubForm()
  const { React, registered } = await mount({ form })
  paint(React, registered)
  form.derive()
  const second = paint(React, registered)
  const observe = second.inputs.find((input) => input.id === 'system1-observer-observeSubagents')
  assert.ok(observe, 'the observeSubagents control must render')
  assert.equal(observe.disabled, false, 'a derived form is editable')
  observe.onChange({ currentTarget: { checked: true } })
  const flipped = paint(React, registered)
  const onSave = formProps(flipped.node).onSave
  assert.equal(typeof onSave, 'function', 'the Save chrome must be wired to the card')
  await onSave()
  assert.equal(form.calls.length, 1, 'exactly one mutate per save')
  assert.deepEqual(form.calls[0].ops, [{ op: 'set', path: ['observeSubagents'], value: true }])
  assert.equal(form.calls[0].revision, 7, 'the revision comes from the subscribed snapshot')
})

test('the number field saves a number, not the string that was typed', async () => {
  const form = stubForm()
  const { React, registered } = await mount({ form })
  paint(React, registered)
  form.derive()
  const second = paint(React, registered)
  const chars = second.inputs.find((input) => input.id === 'system1-observer-maxFieldChars')
  assert.equal(chars.inputMode, 'numeric', 'the numeric field asks for a numeric keyboard')
  chars.onChange({ currentTarget: { value: '2048' } })
  const edited = paint(React, registered)
  await formProps(edited.node).onSave()
  assert.deepEqual(form.calls[0].ops, [{ op: 'set', path: ['maxFieldChars'], value: 2048 }], 'a number is staged as a number')
  assert.equal(form.calls[0].revision, 7)
})

test("a fractional character count is refused, as the card's own copy promises", async () => {
  const form = stubForm()
  const { React, registered } = await mount({ form })
  paint(React, registered)
  form.derive()
  const ready = paint(React, registered)
  ready.inputs.find((input) => input.id === 'system1-observer-maxFieldChars')
    .onChange({ currentTarget: { value: '1.5' } })
  const edited = paint(React, registered)
  await formProps(edited.node).onSave()
  assert.equal(form.calls.length, 0, 'a fractional character count must not reach mutate')
  const after = paint(React, registered)
  assert.match(after.text, /whole number/, 'and the card must say why, in the words it already uses')
})

test('a refused mutate surfaces a refusal rather than claiming success', async () => {
  const form = stubForm({ mutable: false })
  const { React, registered } = await mount({ form })
  paint(React, registered)
  form.derive()
  const second = paint(React, registered)
  second.inputs.find((input) => input.id === 'system1-observer-observeSubagents')
    .onChange({ currentTarget: { checked: true } })
  const flipped = paint(React, registered)
  await formProps(flipped.node).onSave()
  assert.equal(form.calls.length, 1, 'the save must reach the host')
  // The refusal is a state update like any other, so it lands in the next render -- which is the render
  // the operator would see, and the one a card that reported success would get wrong.
  const after = paint(React, registered)
  assert.match(after.text, /refus/i, 'mutate resolving false is a refusal and must be shown as one')
  assert.doesNotMatch(after.text, /saved/i, 'a refusal must never be reported as success')
})

test('the diagnostic line reports the namespace it resolved, so a spelling mismatch is readable', async () => {
  const form = stubForm()
  const { React, registered } = await mount({ form, namespaces: [{ ns: 'include:system1-observer', value: {}, revision: 4 }] })
  const { text } = paint(React, registered)
  assert.match(text, /diagnostic/, 'the development diagnostic must render on the page view')
  assert.match(text, /mirror status: ready/, 'it must report the mirror status')
  assert.equal(diagnosticNamespace(text), 'include:system1-observer', 'it must name the namespace it found')
})

test('the diagnostic reports the values that make a dead control obvious', async () => {
  const form = stubForm()
  const { React, registered } = await mount({ form })
  paint(React, registered)
  form.derive()
  const { text } = paint(React, registered)
  assert.match(text, /writable: true/, 'writable is the value that was false when the card went dead')
  assert.match(text, /status: ready/, 'status says whether the store has derived')
  assert.match(text, /revision: 7/, 'a save needs a revision, so it must be visible')
  assert.match(text, /canSave: true/, 'canSave is the conclusion the user could not see')
})

test('with no namespace served, the page renders the unavailable state and never throws', async () => {
  const { React, registered } = await mount({ namespaces: [], form: stubForm() })
  // `doesNotThrow` ALONE IS VACUOUS: a card that never resolves the scope passes it without exercising
  // the unavailable path. Assert the rendered claim too.
  let text
  assert.doesNotThrow(() => { text = paint(React, registered).text })
  assert.match(text, /unavailable/i, 'the unavailable state must actually render')
  // The unavailable line is the USER-FACING state; the diagnostic is the development aid beside it.
  assert.match(text, /diagnostic/, 'the diagnostic must survive the unavailable path too')
  assert.equal(diagnosticNamespace(text), 'not found', 'it must report that no namespace was found')
})

test('with no revision there is nothing to save, and the diagnostic says so', async () => {
  const form = stubForm({ derives: false })
  const { React, registered } = await mount({ form })
  const { text } = paint(React, registered)
  assert.match(text, /canSave: false/, 'no revision means no save, and the card must say so')
})




