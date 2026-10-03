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
  // The shipped menu row the sidebar's own ⋯ entries use; our Observe row is one of them.
  const MenuItemButton = (props) => ({ primitives: true, menuitem: true, props, children: (props.children ?? []).flat(Infinity) })
  return { MenuItemButton, SettingsForm }
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
/** Every `progressbar` in a rendered tree, by its props. */
function collectBars(node) {
  const found = []
  const walk = (current) => {
    if (current === null || current === undefined || typeof current === 'boolean') return
    if (typeof current === 'string' || typeof current === 'number' || typeof current === 'function') return
    if (Array.isArray(current)) { current.forEach(walk); return }
    if (current.props?.role === 'progressbar') found.push(current.props)
    if (typeof current.type === 'function') { walk(current.type(current.props ?? {})); return }
    ;(current.children ?? []).forEach(walk)
  }
  walk(node)
  return found
}

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

test('it registers all FIVE seats: the two config pages, the session menu, and the two tool cards', async () => {
  const { spec, registered } = await mount()
  assert.equal(spec.id, 'dsh-system1-observer')
  assert.equal(registered.length, 5, 'two config seats, the session menu row, and the two tool cards')
  const seats = registered.map((entry) => ({ ownerKey: entry.ownerKey, target: entry.target }))
  // The BUNDLE page dispatches on the PACKAGE NAME. The settings namespace (`system1-observer` /
  // `include:system1-observer`) is a different id space and registering under it is silent: no card.
  assert.deepEqual(seats, [
    { ownerKey: 'plugins.bundle.config', target: { name: 'plugins.bundle.config', key: 'dsh-system1-observer' } },
    // The ROW page is keyed `<package name>#<row id>`, with the row id exactly as `cordis.patch.yml`
    // declares it. Without this seat the Components list shows the row with NO configure control.
    { ownerKey: 'plugins.row.config', target: { name: 'plugins.row.config', key: 'dsh-system1-observer#system1-observer' } },
    // ONE ROW OF ONE SESSION'S "..." MENU. The id is package-namespaced because reusing a shipped id
    // (`pin`, `rename`, `fork`, `archive`) would SHADOW that row rather than sit beside it, and the order
    // places it after all four.
    { ownerKey: 'sidebar.workspaces.session.menu.item', target: { name: 'sidebar.workspaces.session.menu.item', id: 'system1-observer:observe', order: 500 } },
    // THE CARD FOR OUR OWN TOOL. The seat is keyed by WIRE TOOL NAME and its key domain is open, so a name
    // this package registered is allowed -- and a mismatch is silent: the generic row renders and nothing
    // says why. `system1_trace` is therefore spelled identically here and in `lib/tool.js`.
    { ownerKey: 'tool.call.toolview', target: { name: 'tool.call.toolview', key: 'system1_trace' } },
    // AND THE EVALUATION CARD, for the whole-conversation tool. Same seat, same open key domain, same silence on a
    // mismatch -- so the name is spelled identically here and in `lib/evaluate-tool.js`.
    { ownerKey: 'tool.call.toolview', target: { name: 'tool.call.toolview', key: 'system1_evaluate_session' } },
  ])
})

/** Every string in a rendered tree, recursively: enough to assert what a card says without a DOM. */
function textOf(node) {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  if (typeof node === 'object' && node.props !== undefined) {
    return textOf(node.props.children) + ' ' + Object.values(node.props).filter((v) => typeof v === 'string').join(' ')
  }
  return ''
}

test('the tool-name literals in the card match their modules, because a mismatch is silent', async () => {
  // The seat's key domain is open and "a typo never renders": the generic row appears and nothing says why. Both names
  // are therefore pinned to the modules that declare them.
  const { readFileSync } = await import('node:fs')
  const { TRACE_TOOL_NAME } = await import('../lib/tool.js')
  const { EVALUATE_TOOL_NAME } = await import('../lib/evaluate-tool.js')
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  assert.ok(source.includes("const TRACE_TOOL_NAME = '" + TRACE_TOOL_NAME + "'"), 'the trace tool name')
  assert.ok(source.includes("const EVALUATE_TOOL_NAME = '" + EVALUATE_TOOL_NAME + "'"), 'the evaluate tool name')
})

test('the evaluation card renders the subject, the slice and the answers from the projection', async () => {
  const { registered } = await mount()
  const seat = registered.find((entry) => entry.target?.key === 'system1_evaluate_session')
  assert.notEqual(seat, undefined, 'the evaluation card claims its seat')
  const Card = seat.dispose.component
  const painted = Card({
    phase: 'result',
    block: {
      meta: {
        subject: { source: 'stored', sessionId: 'session-abc', kinds: ['operator', 'assistant'], lastMessages: 0, messages: 4, total: 9, chars: 259445 },
        stateHash: 'abcdef123456',
        stateChars: 1200,
        truncated: true,
        answers: { review: { label: 'yes', confidence: 0.8 } },
        executed: { model: 'jev-latest' },
      },
    },
  })
  const text = textOf(painted)
  assert.match(text, /conversation evaluation/)
  assert.match(text, /session-abc/, 'the subject is named')
  assert.match(text, /4 of 9 message/, 'and the slice says how much of it was judged')
  // AND HOW MUCH CONVERSATION THERE WAS TO JUDGE IT FROM: register row O26, where 8,000 chars of a 259,445-character
  // conversation was displayed exactly like a reading of the whole thing. The card says the same ratio the agent's
  // render and the trace line do.
  assert.match(text, /1200 of 259445 chars of conversation/, 'the state against the conversation it was cut from')
  assert.match(text, /operator, assistant/)
  assert.match(text, /abcdef123456/, 'the identity of what was sent')
  assert.match(text, /truncated/, 'and whether the budget cut it')
  assert.match(text, /review: yes 0\.8/, 'the answers, with their confidence')
  assert.match(text, /jev-latest/, 'and what answered')
  // AN UNANSWERED EVALUATION SAYS SO, rather than rendering an empty answer set as a success.
  const failed = textOf(Card({ phase: 'result', block: { meta: { subject: { source: 'live', messages: 0, total: 0 }, stateHash: 'x', stateChars: 0, truncated: false, answers: {}, failure: { reason: 'timed out' } } } }))
  assert.match(failed, /no answer/)
  assert.match(failed, /could not answer: timed out/)
})

test('with no projection it shows the text the model saw, and a throwing projection does not take the row down', async () => {
  const { registered } = await mount()
  const Card = registered.find((entry) => entry.target?.key === 'system1_evaluate_session').dispose.component
  // A HOST THAT PREDATES THE PROJECTION: the text is the same judgement, shown as it is.
  const fallback = textOf(Card({ phase: 'result', block: { content: [{ type: 'text', text: 'system1_evaluate_session: stored subject' }] } }))
  assert.match(fallback, /no structured projection from this host/)
  assert.match(fallback, /system1_evaluate_session: stored subject/)
  // THE SEAT IS ALL-OR-NOTHING, so the card catches its own errors -- here a projection whose getter throws.
  const hostile = { meta: { get subject() { throw new Error('boom') } } }
  const guarded = textOf(Card({ phase: 'result', block: hostile }))
  assert.match(guarded, /evaluate card failed: boom/)
  assert.match(guarded, /this is the card, not the judge/)
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
  // BY ID, NOT BY COUNT: the card adds controls as it grows, and a bare count turns every new field into a
  // red test about the wrong thing. The nine per-seam switches are excluded on purpose -- they are not
  // settings, and two of them are disabled by design.
  const SETTINGS = [
    'system1-observer-callsEnabled',
    'system1-observer-includeNonOperatorFacing',
    'system1-observer-maxFieldChars',
    'system1-observer-observeSubagents',
  ]
  assert.deepEqual(
    inputs.map((input) => input.id).filter(id => SETTINGS.includes(id)).sort(),
    [...SETTINGS].sort(),
    'the row page must render the four settings controls',
  )
  const settingsInputs = inputs.filter((input) => SETTINGS.includes(input.id))
  assert.ok(settingsInputs.every((input) => input.disabled === false), 'a ready page form enables every settings control')
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
  // EVERY CONTROL EXCEPT THE TWO THAT CAN NEVER BE ONE. A derived, writable form enables the settings, the
  // seven applicable seam switches and every question field; `request` and `close` stay disabled because
  // there is no text at either to ask about.
  assert.deepEqual(
    after.inputs.filter((input) => input.disabled === true).map((input) => input.id),
    ['system1-observer-seam-enabled-request', 'system1-observer-seam-enabled-close'],
    'a derived form enables every control except the two not-applicable seams',
  )
})

test('a DERIVED form that reports writable: false renders the controls disabled', async () => {
  const form = readOnlyForm()
  const { React, registered } = await mount({ form })
  const { node, text, inputs } = paint(React, registered)
  // A real, derived state that merely forbids writes still shows the settings, disabled, with the
  // read-only notice -- so the operator can READ them. Only an underived store hides them. The two
  // not-applicable seam switches are disabled whatever the form says, so they are counted separately.
  const SETTINGS = ['system1-observer-callsEnabled', 'system1-observer-includeNonOperatorFacing', 'system1-observer-maxFieldChars', 'system1-observer-observeSubagents']
  assert.equal(inputs.filter(i => SETTINGS.includes(i.id)).length, 4, 'the four settings controls must render when the profile forbids writes')
  assert.ok(inputs.every((input) => input.disabled === true), 'a read-only form disables every control')
  assert.equal(formProps(node).state.writable, false, 'the shell the card built reports the read-only state')
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

// THE UI RATCHET, AND THE POINT OF THE WHOLE PANEL CHANGE. The host projects a schema and never draws a form, so a
// setting with no entry in the card's table is a setting nobody can reach -- which is exactly what O2 recorded for
// nineteen of them. This is the UI analogue of the read-wiring ratchet in test/schema.test.js: it fails the moment a
// field is added to `index.js` and not to `client.js`.
test('EVERY volatile setting has a control, and the panels that group them all exist', async () => {
  const { readFileSync } = await import('node:fs')
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  const { Config } = await import('../index.js')
  // The settings the table drives, read from the table itself rather than restated here.
  const tableFields = [...source.matchAll(/field: '([a-zA-Z]+)'/g)].map((match) => match[1])
  assert.ok(tableFields.length >= 20, 'the table was found: ' + tableFields.length + ' entries')
  for (const field of tableFields) {
    assert.notEqual(Config.dict[field], undefined, 'the card table names ' + field + ', which the schema does not declare')
    assert.equal(Config.dict[field].meta?.volatile, true, field + ' is in the card table, so it must be writable')
  }
  // THE HAND-WRITTEN EDITORS, which have their own tests: the seam switches, the questions, the session list, the
  // master switch and the three fields the card rendered before the table existed. This list was SHORT by three when
  // the ratchet first ran, and the ratchet was right to complain -- it accused fields that do have controls, which is
  // the failure mode of an exception list rather than of the card.
  const HAND_WRITTEN = ['callsEnabled', 'sessions', 'seamEnabled', 'questions', 'observeSubagents', 'includeNonOperatorFacing', 'maxFieldChars']
  const covered = new Set(tableFields.concat(HAND_WRITTEN))
  const volatile = Object.keys(Config.dict).filter((field) => Config.dict[field].meta?.volatile === true)
  const unreachable = volatile.filter((field) => !covered.has(field))
  assert.deepEqual(unreachable, [], 'writable settings the card offers no control for: ' + unreachable.join(', '))
  assert.equal(covered.has('tracePath'), false, 'the mount-bound field must not be claimed as writable')
  // AND THE PANELS, by the ids the layout gives them: an id is what a test can address and what a person sees.
  for (const group of ['observe', 'send', 'see', 'turn', 'keep', 'numbers']) {
    assert.ok(source.includes("'system1-observer-panel-' + group.id"), 'the panel id is built from the group')
    assert.ok(source.includes("{ id: '" + group + "'"), 'the ' + group + ' panel is declared')
  }
})

test('the card\u2019s subject-kind choices ARE the adapter\u2019s map -- pinned, because a browser half cannot import it', async () => {
  // `lib/` cannot be imported by a browser half, so the kind names are literals in the card. This is the check that
  // keeps them honest: the adapter is the authority and the card must offer exactly its keys. A drift here would show
  // a person a checkbox that maps to no event type -- a slice that judges less than the row asked for.
  const { readFileSync } = await import('node:fs')
  const { SUBJECT_KINDS } = await import('../lib/session-subject.js')
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  const entry = /field: 'subjectKinds'[\s\S]{0,220}?choices: \[([^\]]*)\]/.exec(source)
  assert.ok(entry, 'the subjectKinds entry must name its choices')
  const choices = entry[1].split(',').map((part) => part.trim().replace(/^'|'$/g, '')).filter((part) => part !== '')
  assert.deepEqual(choices, Object.keys(SUBJECT_KINDS), 'the card and the adapter must offer the same kinds')
  assert.ok(Object.keys(SUBJECT_KINDS).length >= 2, 'and the map must not be empty: ' + JSON.stringify(Object.keys(SUBJECT_KINDS)))
})

test('EVERY card fallback equals the SCHEMA default -- one home per number, checked', async () => {
  // The card cannot import `lib/`, and the host does not project a schema default, so a fallback IS a literal in this
  // file. This is what keeps a literal honest. It is the check that O14's fix produced, and the moment it ran it found
  // three settings whose reset buttons restored values the running row never uses -- 2000/50/20 against the schema's
  // 4000/200/4 -- which is the SAME defect the card's own comment records for `maxFieldChars` ("this constant said
  // 4096, so the reset button silently restored a value the host never uses").
  const { readFileSync } = await import('node:fs')
  // THE SCHEMA, IMPORTED HERE: this file deliberately does not import the plugin at the top, because the card is a
  // browser half and the test drives it through a stubbed module table. `Config` comes in where it is used.
  const { Config } = await import('../index.js')
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  // ENTRIES ARE SPLIT ON THE TABLE'S OWN DELIMITER, not matched with a regex that spans them: a `[\s\S]{0,300}?`
  // pattern reached into the NEXT entry and reported `model` (a text field with no fallback) as a mismatch.
  const chunks = source.split("{ panel: '").slice(1)
  const entries = chunks.map((chunk) => ({
    field: /field: '([a-zA-Z]+)'/.exec(chunk)?.[1],
    fallback: /fallback: ([^,}\n]+)/.exec(chunk)?.[1],
  })).filter((entry) => entry.field !== undefined)
  assert.ok(entries.length >= 20, 'the table was found: ' + entries.length + ' entries')
  const withFallback = entries.filter((entry) => entry.fallback !== undefined)
  assert.ok(withFallback.length >= 10, 'entries with a fallback: ' + withFallback.length)
  const wrong = []
  for (const { field, fallback } of withFallback) {
    const expected = Config.dict[field]?.meta?.default
    if (expected === undefined) {
      wrong.push(field + ' has a card fallback while the schema declares no default')
      continue
    }
    const shown = fallback.trim().replace(/^'|'$/g, '')
    if (String(shown) !== String(expected)) {
      wrong.push(field + ': the card resets to ' + fallback.trim() + ' while the schema says ' + JSON.stringify(expected))
    }
  }
  assert.deepEqual(wrong, [], 'the card and the schema disagree about a default: ' + wrong.join(' | '))
})

test('a setting in the Numbers panel renders and saves as a NUMBER, fractional rates included', async () => {
  // The fractional case is not decoration: the first version of the table demanded a whole number from every numeric
  // field, so the price (0.042) failed validation and the card refused to save ANYTHING -- including fields beside
  // it. This asserts the control renders, is editable, and stages a number rather than the text that was typed.
  const form = stubForm()
  const { React, registered } = await mount({ form })
  paint(React, registered)
  form.derive()
  const second = paint(React, registered)
  const price = second.inputs.find((input) => input.id === 'system1-observer-pricePerMTokInput')
  assert.ok(price, 'the price control must render, or the setting is unreachable')
  assert.equal(price.disabled, false, 'a derived form is editable')
  price.onChange({ currentTarget: { value: '0.03' } })
  const edited = paint(React, registered)
  await formProps(edited.node).onSave()
  assert.deepEqual(form.calls[0].ops, [{ op: 'set', path: ['pricePerMTokInput'], value: 0.03 }],
    'a rate is staged as a number, not the string that was typed')
})

test('the Observe panel calls seams through checkboxes, and the list saves whole', async () => {
  const form = stubForm()
  const { React, registered } = await mount({ form })
  paint(React, registered)
  form.derive()
  const second = paint(React, registered)
  const seam = second.inputs.find((input) => input.id === 'system1-observer-hooks-draft')
  assert.ok(seam, 'one checkbox per accepted hook, or the hooks cannot be chosen')
  assert.equal(seam.type, 'checkbox')
  seam.onChange({ currentTarget: { checked: true } })
  const picked = paint(React, registered)
  await formProps(picked.node).onSave()
  assert.deepEqual(form.calls[0].ops, [{ op: 'set', path: ['hooks'], value: ['draft'] }],
    'the hook list is written as a list, which is what the schema declares')
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
  // THE WORD, NOT THE SUBSTRING: the card's success notice is "Saved.", and a word boundary is what tells it
  // apart from the legitimate "UNSAVED changes" warning that sits on the same screen once the form is dirty.
  assert.doesNotMatch(after.text, /\bsaved\b/i, 'a refusal must never be reported as success')
})

// THE DIAGNOSTIC LINE IS GONE, so these assert the BEHAVIOUR it was there to make readable. It reported
// `namespace`, `writable`, `status`, `revision` and `canSave`; every one of those is still what the card
// gates on, and each is now covered by an assertion on what the card DOES rather than on a string a person
// had to read off the page.
test('the `include:` namespace spelling resolves the form, so the card is not dead on that spelling', async () => {
  const form = stubForm()
  const { React, registered } = await mount({ form, namespaces: [{ ns: 'include:system1-observer', value: {}, revision: 4 }] })
  paint(React, registered)
  form.derive()
  const second = paint(React, registered)
  // The namespace was spelled `include:system1-observer`, which is how a patch-composed profile reports it.
  // What matters is not that the card can PRINT that name but that it found the form behind it.
  assert.equal(typeof formProps(second.node).onSave, 'function', 'the card must resolve the form and render its chrome')
  assert.ok(second.inputs.some(i => i.id === 'system1-observer-callsEnabled'), 'and its controls must be live')
  assert.doesNotMatch(second.text, /unavailable/i, 'a served namespace must not render the unavailable line')
})

test('with no namespace served, the page renders the unavailable state and never throws', async () => {
  const { React, registered } = await mount({ namespaces: [], form: stubForm() })
  // `doesNotThrow` ALONE IS VACUOUS: a card that never resolves the scope passes it without exercising
  // the unavailable path. Assert the rendered claim and the absence of controls too.
  let painted
  assert.doesNotThrow(() => { painted = paint(React, registered) })
  assert.match(painted.text, /unavailable/i, 'the unavailable state must actually render')
  assert.equal(painted.inputs.length, 0, 'and nothing may be editable behind it')
})

test('with no revision there is nothing to save, so no controls are drawn', async () => {
  const form = stubForm({ derives: false })
  const { React, registered } = await mount({ form })
  const { text, inputs } = paint(React, registered)
  // `canSave` was the diagnostic's last field. Without a revision the store is still loading, so the card
  // must show the status line rather than controls whose Save could never work.
  assert.match(text, /loading settings/i, 'no revision means no save, and the card must say it is not ready')
  assert.equal(inputs.length, 0, 'and must not offer controls it cannot save')
})

// ---------------------------------------------------------------------------------------------
// THE PER-SEAM QUESTION EDITOR
//
// `collectInputs` above stays inputs-only for the older assertions. The editor needs the whole set,
// because its type control is a `select` and its structural actions are `button`s.
// ---------------------------------------------------------------------------------------------
function collectControls(node) {
  const found = []
  const walk = (current) => {
    if (current === null || current === undefined || typeof current === 'boolean') return
    if (typeof current === 'string' || typeof current === 'number' || typeof current === 'function') return
    if (Array.isArray(current)) { current.forEach(walk); return }
    if (typeof current.type === 'string' && ['input', 'select', 'button', 'textarea'].includes(current.type)) {
      found.push({ tag: current.type, props: current.props ?? {} })
      return
    }
    if (typeof current.type === 'function') { walk(current.type(current.props ?? {})); return }
    ;(current.children ?? []).forEach(walk)
  }
  walk(node)
  return found
}

// A click on a control the editor rendered, by id. Throws with the ids it did find, because "undefined is
// not a function" is the failure that hides a renamed id.
function click(controls, id) {
  const found = controls.find(c => c.props.id === id)
  if (found === undefined) throw new Error(`no control ${id}; found ${controls.map(c => c.props.id).filter(Boolean).join(', ')}`)
  if (typeof found.props.onClick !== 'function') throw new Error(`${id} has no onClick`)
  found.props.onClick()
}

function typeInto(controls, id, value) {
  const found = controls.find(c => c.props.id === id)
  if (found === undefined) throw new Error(`no control ${id}; found ${controls.map(c => c.props.id).filter(Boolean).join(', ')}`)
  found.props.onChange({ currentTarget: { value } })
}

function chooseControl(controls, id) {
  const found = controls.find(c => c.props.id === id)
  if (found === undefined) throw new Error(`no control ${id}; found ${controls.map(c => c.props.id).filter(Boolean).join(', ')}`)
  if (typeof found.props.onChange !== 'function') throw new Error(`${id} has no onChange`)
  found.props.onChange({ currentTarget: { checked: true } })
}

// A CHECKBOX CLICK SENDS THE OPPOSITE OF WHAT IT SHOWS. `chooseControl` hard-codes `true`, which is right
// for a box that starts unchecked and silently does nothing to one that starts checked -- so a test that
// used it to turn the kill switch off would pass while never turning it off.
function toggleControl(controls, id) {
  const found = controls.find(c => c.props.id === id)
  if (found === undefined) throw new Error(`no control ${id}; found ${controls.map(c => c.props.id).filter(Boolean).join(', ')}`)
  if (typeof found.props.onChange !== 'function') throw new Error(`${id} has no onChange`)
  found.props.onChange({ currentTarget: { checked: found.props.checked !== true } })
}

/**
 * ONE USER EVENT, ONE RENDER -- what the browser does, and what a test must do too.
 *
 * Firing two events through a SINGLE painted tree hands the second a stale `draft`: every control's
 * handler closed over the render that produced it, so the second edit would revive the pre-first-edit
 * value and clobber it. A real page re-renders between two clicks, so a test that does not would be
 * measuring a defect the card cannot have -- and would hide one it can.
 */
function act(ctx) {
  const controls = () => collectControls(paint(ctx.React, ctx.registered).node)
  return {
    click: (id) => click(controls(), id),
    type: (id, value) => typeInto(controls(), id, value),
    choose: (id) => chooseControl(controls(), id),
    toggle: (id) => toggleControl(controls(), id),
    controls,
    paint: () => paint(ctx.React, ctx.registered),
  }
}

// The nine-seam map as the HOST hands it back: every key present, the untouched ones empty. An unset
// `questions` materialises this way in schemastery, which is exactly why an all-empty map must mean
// "legacy" rather than "ask nothing".
function seamValue(seam, specs) {
  const seams = ['assemble', 'admit', 'request', 'draft', 'pre_execute', 'execute', 'post_execute', 'result', 'close']
  const questions = Object.fromEntries(seams.map(name => [name, []]))
  if (seam !== undefined) questions[seam] = specs
  return questions
}

// Render the page with a derived form, so the controls are live. `mountOptions` lets a test take a seat away
// from the harness (no namespaces served) without a second mount helper.
async function liveCard(value, mountOptions = {}) {
  const form = stubForm({ value })
  const mounted = await mount(Object.assign({}, mountOptions, { form }))
  paint(mounted.React, mounted.registered)
  form.derive()
  return { ...mounted, form }
}

test('the editor lists every seam with its host event, and marks the two that are not applicable', async () => {
  const { React, registered } = await liveCard({})
  const { node, text } = paint(React, registered)
  const controls = collectControls(node)
  const APPLICABLE = ['assemble', 'admit', 'draft', 'pre_execute', 'execute', 'post_execute', 'result']
  for (const seam of APPLICABLE) {
    assert.ok(controls.some(c => c.props.id === `system1-observer-add-${seam}`), `${seam} must have an add control`)
  }
  for (const seam of ['request', 'close']) {
    // NOT EVEN A DISABLED BUTTON. Offering one is what let a spec be staged at `request` and refuse the
    // whole save over a question that could never be asked.
    assert.equal(controls.some(c => c.props.id === `system1-observer-add-${seam}`), false, `${seam} must offer no add control`)
    assert.equal(controls.some(c => String(c.props.id).startsWith(`system1-observer-q-${seam}-`)), false, `${seam} must render no question editor`)
  }
  assert.match(text, /system-prompt\/assemble/, 'the host event is what maps a seam to the YAML')
  assert.match(text, /agent\/turn-stopping/)
  // NOT APPLICABLE is a property of the seam, not of its settings: `request` and `close` carry no text, so
  // there is nothing to ask and nothing to test at either, whatever the config says.
  assert.equal((text.match(/not applicable — no text/g) ?? []).length, 2, 'exactly the two textless seams say so')
  assert.match(text, /Two of the nine seams are not applicable/, 'the card must state it in prose, not only in a badge')
  assert.match(text, /`request` \(routing parameters\) and `close`/, 'and must name them')
  assert.match(text, /nothing to test/, 'the reason a person needs is that there is no test to make')
  assert.match(text, /Leave both out of `hooks`/, 'and what to do about it')
})

test('a stored question at a not-applicable seam is ignored, and cannot block a save', async () => {
  // THE FIELD BUG: an empty spec at `request` made the whole form invalid -- `request[0]: needs an
  // instruction` -- over a question that could never run, and there was no way to clear it from the card.
  const ctx = await liveCard({
    questions: seamValue('request', [{ id: '', type: 'noul', instructions: '' }]),
  })
  const ui = act(ctx)
  const painted = ui.paint()
  assert.doesNotMatch(painted.text, /request\[0\]/, 'a seam that cannot be asked has no rule to break')
  assert.equal(ui.controls().some(c => c.props.id === 'system1-observer-add-request'), false)
  // Still savable, and the map it writes carries the seam emptied rather than the stray spec.
  ui.choose('system1-observer-observeSubagents')
  await formProps(ui.paint().node).onSave()
  assert.equal(ctx.form.calls.length, 1, 'the stray spec must not make the form unsavable')
  assert.deepEqual(ctx.form.calls[0].ops, [{ op: 'set', path: ['observeSubagents'], value: true }])
})

test('with nothing configured every seam says it asks the probe question', async () => {
  const { React, registered } = await liveCard({})
  const { text } = paint(React, registered)
  assert.match(text, /No question is configured/, 'the mode must be stated, not inferred')
  assert.match(text, /probe question/, 'an empty seam asks the built-in question in legacy mode')
  assert.doesNotMatch(text, /asks nothing/, 'nothing asks nothing while the row is unconfigured')
})

test('one configured question switches the card to per-seam mode, and empty seams say they ask nothing', async () => {
  const { React, registered } = await liveCard({
    questions: seamValue('admit', [{ id: 'opening', type: 'noul', instructions: 'Is this the operator?' }]),
  })
  const { node, text } = paint(React, registered)
  assert.match(text, /only the seams that carry one are asked/, 'the mode must be stated in the card')
  assert.ok((text.match(/asks nothing/g) ?? []).length >= 7, 'every unconfigured seam must say it asks nothing')
  const controls = collectControls(node)
  assert.equal(controls.find(c => c.props.id === 'system1-observer-q-admit-0-instructions').props.value, 'Is this the operator?', 'a stored question must render into its field')
  assert.equal(controls.find(c => c.props.id === 'system1-observer-q-admit-0-id').props.value, 'opening')
  assert.equal(controls.find(c => c.props.id === 'system1-observer-q-admit-0-type').props.value, 'noul')
})

test('adding a question and filling it in saves ONE set op carrying all nine seams', async () => {
  const ctx = await liveCard({})
  const { form } = ctx
  const ui = act(ctx)
  ui.click('system1-observer-add-admit')
  // A NEW QUESTION IS INVALID UNTIL IT IS FILLED, so the problem is on screen before any save.
  assert.match(ui.paint().text, /admit\[0\]: needs an instruction/, 'the card must say what is missing')
  ui.type('system1-observer-q-admit-0-instructions', 'Is this the operator?')
  await formProps(ui.paint().node).onSave()
  assert.equal(form.calls.length, 1, 'a complete question must reach the host')
  assert.deepEqual(form.calls[0].ops, [{
    op: 'set',
    path: ['questions'],
    value: seamValue('admit', [{ id: 'probe', type: 'noul', instructions: 'Is this the operator?' }]),
  }], 'the whole map is written, so an untouched seam cannot be dropped by the host projection')
})

test('an incomplete question refuses the save and names the seam, rather than saving something else', async () => {
  const ctx = await liveCard({})
  const ui = act(ctx)
  ui.click('system1-observer-add-draft')
  await formProps(ui.paint().node).onSave()
  assert.equal(ctx.form.calls.length, 0, 'a half-written question must not be persisted')
  assert.match(ui.paint().text, /draft\[0\]: needs an instruction/)
})

test('switching to a choice seeds two options with one abstain, and the op carries them through', async () => {
  const ctx = await liveCard({})
  const ui = act(ctx)
  ui.click('system1-observer-add-draft')
  ui.type('system1-observer-q-draft-0-instructions', 'Which part of the loop produced this?')
  ui.type('system1-observer-q-draft-0-type', 'choice')
  // THE SEED: a choice with fewer than two options is refused by the builder, so a type change that left
  // it empty would present a Save that can never succeed.
  const seeded = ui.controls()
  assert.ok(seeded.some(c => c.props.id === 'system1-observer-q-draft-0-label-0'), 'two options are seeded')
  assert.ok(seeded.some(c => c.props.id === 'system1-observer-q-draft-0-label-1'))
  assert.equal(seeded.find(c => c.props.id === 'system1-observer-abstain-draft-0-1').props.checked, true, 'the second is the abstain option')
  ui.type('system1-observer-q-draft-0-label-0', 'model_output')
  ui.type('system1-observer-q-draft-0-criterion-0', 'text the model produced')
  ui.type('system1-observer-q-draft-0-label-1', 'unclear')
  ui.type('system1-observer-q-draft-0-criterion-1', 'none of these fits')
  await formProps(ui.paint().node).onSave()
  assert.equal(ctx.form.calls.length, 1)
  assert.deepEqual(ctx.form.calls[0].ops[0].value.draft, [{
    id: 'probe',
    type: 'choice',
    instructions: 'Which part of the loop produced this?',
    options: [
      { label: 'model_output', criterion: 'text the model produced' },
      { label: 'unclear', criterion: 'none of these fits', abstain: true },
    ],
  }])
})

test('moving the abstain radio moves it in the state too, so a save keeps exactly one', async () => {
  const ctx = await liveCard({
    questions: seamValue('draft', [{
      id: 'purpose',
      type: 'choice',
      instructions: 'Which part of the loop produced this?',
      options: [
        { label: 'model_output', criterion: 'text the model produced' },
        { label: 'unclear', criterion: 'none of these fits', abstain: true },
      ],
    }]),
  })
  const ui = act(ctx)
  // THE RADIO CANNOT UNCHECK ITS SIBLING BY ITSELF. Firing the first radio's change must clear the second,
  // or the state carries two abstain options and every save is refused from then on.
  ui.choose('system1-observer-abstain-draft-0-0')
  const moved = ui.controls()
  assert.equal(moved.find(c => c.props.id === 'system1-observer-abstain-draft-0-0').props.checked, true)
  assert.equal(moved.find(c => c.props.id === 'system1-observer-abstain-draft-0-1').props.checked, false)
  await formProps(ui.paint().node).onSave()
  assert.equal(ctx.form.calls.length, 1, 'moving the abstain option must leave a savable question')
  assert.deepEqual(ctx.form.calls[0].ops[0].value.draft[0].options[1], { label: 'unclear', criterion: 'none of these fits' }, 'the old abstain flag is gone, not set to false')
  assert.equal(ctx.form.calls[0].ops[0].value.draft[0].options[0].abstain, true)
})

test('a choice with no abstain option is refused in the card, in the words the builder would use', async () => {
  const ctx = await liveCard({
    questions: seamValue('result', [{
      id: 'outcome',
      type: 'choice',
      instructions: 'What did the tool return?',
      options: [
        { label: 'ok', criterion: 'a result' },
        { label: 'failed', criterion: 'an error' },
      ],
    }]),
  })
  const ui = act(ctx)
  const painted = ui.paint()
  assert.match(painted.text, /exactly one option must be the abstain option \(found 0\)/, 'the rule must be on screen before the Save')
  await formProps(painted.node).onSave()
  assert.equal(ctx.form.calls.length, 0, 'the host would accept this and the model would refuse it -- the card must not send it')
})

test('a score keeps its levels in order and refuses fewer than two', async () => {
  // AN APPLICABLE SEAM, because `close` carries no text and is now correctly impossible to author at.
  const ctx = await liveCard({
    questions: seamValue('execute', [{ id: 'done', type: 'score', instructions: 'How complete is this turn?', levels: ['barely', 'partly', 'done'] }]),
  })
  const ui = act(ctx)
  const controls = ui.controls()
  assert.equal(controls.find(c => c.props.id === 'system1-observer-q-execute-0-level-0').props.value, 'barely')
  assert.equal(controls.find(c => c.props.id === 'system1-observer-q-execute-0-level-2').props.value, 'done')
  ui.click('system1-observer-level-remove-execute-0-2')
  assert.equal(ui.controls().filter(c => String(c.props.id).includes('q-execute-0-level-')).length, 2, 'a level can be removed')
  // TWO LEVELS IS STILL VALID; one is not.
  ui.click('system1-observer-level-remove-execute-0-1')
  const one = ui.paint()
  assert.match(one.text, /execute\[0\]: a score needs at least two levels/)
  await formProps(one.node).onSave()
  assert.equal(ctx.form.calls.length, 0)
})

test('a boolean flip in legacy mode writes no questions op at all', async () => {
  const ctx = await liveCard({})
  const ui = act(ctx)
  ui.choose('system1-observer-observeSubagents')
  await formProps(ui.paint().node).onSave()
  // THE UPGRADE PATH: an untouched editor must not write an empty map, because an empty map is what the
  // host would then hold, and the next release's reading of it is not this card's to decide.
  assert.deepEqual(ctx.form.calls[0].ops, [{ op: 'set', path: ['observeSubagents'], value: true }])
})

// ---------------------------------------------------------------------------------------------
// THE PER-SEAM SWITCHES
// ---------------------------------------------------------------------------------------------
test('all nine seams get a switch, and the two that cannot be called are disabled and off', async () => {
  const ctx = await liveCard({})
  const ui = act(ctx)
  const byId = new Map(ui.controls().map(c => [c.props.id, c.props]))
  const APPLICABLE = ['assemble', 'admit', 'draft', 'pre_execute', 'execute', 'post_execute', 'result']
  for (const seam of APPLICABLE) {
    const toggle = byId.get(`system1-observer-seam-enabled-${seam}`)
    assert.equal(toggle?.type, 'checkbox', `${seam} must have a switch`)
    assert.equal(toggle.checked, true, `${seam} is on when the field has never been written`)
    assert.equal(toggle.disabled, false, `${seam} must be switchable`)
  }
  for (const seam of ['request', 'close']) {
    const toggle = byId.get(`system1-observer-seam-enabled-${seam}`)
    assert.equal(toggle?.disabled, true, `${seam} carries no text, so its switch can never mean anything`)
    assert.equal(toggle.checked, false, `${seam} is off because it can never be called`)
  }
})

test('switching one seam off saves the whole map, and the other seams stay on', async () => {
  const ctx = await liveCard({})
  const ui = act(ctx)
  ui.toggle('system1-observer-seam-enabled-execute')
  await formProps(ui.paint().node).onSave()
  const op = ctx.form.calls[0].ops.find(o => o.path[0] === 'seamEnabled')
  assert.ok(op !== undefined, 'a seam switch must save')
  // THE WHOLE MAP, ALL NINE, because `seamEnabled` is a volatile object at the root and the host writes it
  // as one node: a seam left out of the op is a seam the projection would drop from the stored config.
  assert.deepEqual(op.value, {
    assemble: true, admit: true, request: false, draft: true, pre_execute: true,
    execute: false, post_execute: true, result: true, close: false,
  })
})

test('an untouched switch grid writes nothing at all', async () => {
  const ctx = await liveCard({})
  const ui = act(ctx)
  ui.choose('system1-observer-observeSubagents')
  await formProps(ui.paint().node).onSave()
  // Off-by-absence: the card must not write nine `true`s into the profile just because it drew the row.
  assert.equal(ctx.form.calls[0].ops.some(o => o.path[0] === 'seamEnabled'), false)
})

test('a stored seam switched off renders off, and switching it back on saves true', async () => {
  const ctx = await liveCard({ seamEnabled: { assemble: false, admit: true, close: true } })
  const ui = act(ctx)
  const byId = new Map(ui.controls().map(c => [c.props.id, c.props]))
  assert.equal(byId.get('system1-observer-seam-enabled-assemble').checked, false, 'a stored false must render off')
  assert.equal(byId.get('system1-observer-seam-enabled-close').checked, false, 'and a not-applicable seam is off whatever is stored')
  ui.toggle('system1-observer-seam-enabled-assemble')
  await formProps(ui.paint().node).onSave()
  const op = ctx.form.calls[0].ops.find(o => o.path[0] === 'seamEnabled')
  assert.equal(op.value.assemble, true, 'switching it back on must be what gets saved')
})

// ---------------------------------------------------------------------------------------------
// THE MASTER SWITCH
// ---------------------------------------------------------------------------------------------
test('the call switch reads ON when the field has never been written', async () => {
  const ctx = await liveCard({})
  const ui = act(ctx)
  const toggle = ui.controls().find(c => c.props.id === 'system1-observer-callsEnabled')
  // `!== false`, not `=== true`: a card that showed this OFF while the host was calling would be lying
  // about the live state, and an existing install has never written the field.
  assert.equal(toggle.props.checked, true, 'an absent callsEnabled means the calls are on')
  // AND IT WRITES NOTHING. An untouched switch must not put `true` into the profile: that would be the
  // card claiming a setting nobody made.
  ui.choose('system1-observer-observeSubagents')
  await formProps(ui.paint().node).onSave()
  assert.deepEqual(ctx.form.calls[0].ops, [{ op: 'set', path: ['observeSubagents'], value: true }])
})

test('turning the call switch off saves one op and keeps the questions untouched', async () => {
  const ctx = await liveCard({
    questions: seamValue('draft', [{ id: 'reply_kind', type: 'noul', instructions: 'Is this the reply?' }]),
  })
  const ui = act(ctx)
  ui.toggle('system1-observer-callsEnabled')
  const painted = ui.paint()
  assert.equal(painted.inputs.find(i => i.id === 'system1-observer-callsEnabled').checked, false, 'the tick must show the staged state')
  await formProps(painted.node).onSave()
  assert.deepEqual(ctx.form.calls[0].ops, [{ op: 'set', path: ['callsEnabled'], value: false }], 'only the switch, so a paused observer does not rewrite its questions')
})

test('a stored callsEnabled false renders the switch off, and turning it back on saves true', async () => {
  const ctx = await liveCard({ callsEnabled: false })
  const ui = act(ctx)
  assert.equal(ui.controls().find(c => c.props.id === 'system1-observer-callsEnabled').props.checked, false)
  ui.toggle('system1-observer-callsEnabled')
  await formProps(ui.paint().node).onSave()
  assert.deepEqual(ctx.form.calls[0].ops, [{ op: 'set', path: ['callsEnabled'], value: true }])
})

test('a stored question that no longer parses is reported, not silently dropped', async () => {
  const ctx = await liveCard({
    questions: seamValue('admit', [{ id: '', type: 'noul', instructions: '' }]),
  })
  const { text } = act(ctx).paint()
  assert.match(text, /admit\[0\]: needs an id/)
  assert.match(text, /admit\[0\]: needs an instruction/)
})

// ---------------------------------------------------------------------------------------------
// THE HINTS. They are the part of the card that teaches, so they are asserted on the RENDERED TEXT
// rather than on the constants: a hint that exists in the source and not on the screen teaches nobody.
// ---------------------------------------------------------------------------------------------
test('every seam says what text it carries, and the textless ones say a question is impossible', async () => {
  const ctx = await liveCard({})
  const { text } = act(ctx).paint()
  // The commonest wasted call is a question aimed at text the seam was never given.
  assert.match(text, /Nothing at this seam is model output/, 'assemble must say what its text is')
  assert.match(text, /own streamed output/, 'draft must say what its text is')
  assert.match(text, /tool name and its arguments, before the call runs/, 'pre_execute must say what its text is')
  assert.match(text, /the result the tool returned, normalized/, 'post_execute must say what its text is')
  assert.equal(
    (text.match(/can never be asked/g) ?? []).length,
    2,
    'only request and close carry no text, and only they may say a question is impossible',
  )
})

test('the editor carries the rules for asking well', async () => {
  const ctx = await liveCard({})
  const { text } = act(ctx).paint()
  assert.match(text, /How to ask well/, 'the rules must be reachable from the editor')
  assert.match(text, /Prefer choice over noul/, 'the primitive choice is the first rule')
  assert.match(text, /exactly one abstain option/, 'the abstain rule is what makes a choice usable')
  assert.match(text, /two or three cases whose right answer you already know/, 'nothing may be trusted unvalidated')
  assert.match(text, /do not sum to 1/, 'a question and its complement must not be cross-checked')
})

test('the type control explains what the selected type is for, per question', async () => {
  const seams = ['assemble', 'admit', 'request', 'draft', 'pre_execute', 'execute', 'post_execute', 'result', 'close']
  const questions = Object.fromEntries(seams.map(name => [name, []]))
  questions.draft = [{ id: 'a', type: 'noul', instructions: 'Is this the reply?' }]
  questions.pre_execute = [{
    id: 'b', type: 'choice', instructions: 'Would this change something?',
    options: [{ label: 'yes', criterion: 'it writes' }, { label: 'unclear', criterion: 'none of these fits', abstain: true }],
  }]
  questions.post_execute = [{ id: 'c', type: 'score', instructions: 'How complete?', levels: ['barely', 'done'] }]
  const ctx = await liveCard({ questions })
  const { text } = act(ctx).paint()
  assert.match(text, /polarity-blind/, 'a noul must carry the warning that it can be inverted')
  assert.match(text, /Exactly one option must be the abstain case/, 'a choice must carry the abstain rule')
  assert.match(text, /probability-weighted level/, 'a score must say what it actually returns')
})

// ---------------------------------------------------------------------------------------------
// TARGETING A SESSION
// ---------------------------------------------------------------------------------------------
test('the card shows each observed session by its headline, with the id it is matched by', async () => {
  const ctx = await liveCard({
    sessions: [
      { id: 'session-01234567-89ab-4cde-8f01-23456789abcd', title: 'test session' },
      'session-bbb',   // the shape written before titles existed, and what a hand-edit looks like
    ],
  })
  const { text } = act(ctx).paint()
  assert.match(text, /test session/, 'the headline is what a person reads')
  assert.match(text, /session-01234567-89ab-4cde-8f01-23456789abcd/, 'and the id is still shown, so an entry is identifiable')
  assert.match(text, /no headline recorded/, "an entry with no cached title says so rather than showing nothing")
  assert.doesNotMatch(text, /No session is observed/, 'a non-empty list is not the empty state')
})

test('removing the last observed session is the visible way to observe nothing', async () => {
  const ctx = await liveCard({ sessions: [{ id: 'session-aaa', title: 'a' }] })
  const ui = act(ctx)
  ui.click('system1-observer-session-remove-0')
  const painted = ui.paint()
  assert.match(painted.text, /No session is observed/, 'the empty state says what it means')
  assert.match(painted.text, /“...” menu on a session/, 'and where the way back in is')
  await formProps(painted.node).onSave()
  assert.deepEqual(ctx.form.calls[0].ops, [{ op: 'set', path: ['sessions'], value: [] }], 'an empty list observes NOTHING')
})

// THE CARD HAS NO "ADD" CONTROL, and these two tests are what says so: a session id is 36 characters of uuid,
// and a control that asks a person to find one is a control that will not be used. The "..." menu already has
// the id and the headline in hand, and it is the only way in.
test('the card offers no way to add a session by id', async () => {
  const ctx = await liveCard({ sessions: [] })
  const controls = act(ctx).controls()
  assert.equal(controls.some(c => String(c.props.id).includes('session-add')), false, 'no add box and no add button')
  const { text } = act(ctx).paint()
  assert.doesNotMatch(text, /paste a session id/, 'and no instruction to go and find one')
  assert.match(text, /menu on a session/, 'the menu is named as the way in instead')
})

test('an untouched sessions box writes nothing', async () => {
  // `sessions: []` PRESENT is what a host that knows the field projects; see the stale-host tests below,
  // where the key is absent and means something quite different.
  const ctx = await liveCard({ sessions: [] })
  const ui = act(ctx)
  ui.choose('system1-observer-observeSubagents')
  await formProps(ui.paint().node).onSave()
  assert.equal(ctx.form.calls[0].ops.some(o => o.path[0] === 'sessions'), false, 'the card must not write an empty list nobody asked for')
})

// A PAGE NEWER THAN THE HOST. Twice now a field has been added, the client bundle has followed the package,
// and the running host has still been the previous generation -- leaving a control that renders, accepts a
// click, and does nothing, because `settings.write` refuses a path the live schema does not declare. A
// volatile `Schema.array` materialises to `[]`, so `sessions` is ABSENT from the projected value only when
// the host predates the field: that is the discriminator, and it is what these two tests pin.
test('a host whose schema predates `sessions` says so, instead of showing a box that cannot work', async () => {
  const ctx = await liveCard({})
  const { text } = act(ctx).paint()
  assert.match(text, /This page is newer than the running host/, 'the state must be named')
  assert.match(text, /Restart the host/, 'and the way out of it')
  assert.doesNotMatch(text, /Observation is opt-in/, 'the ordinary hint is replaced, not stacked')
})

test('a host that knows `sessions` shows the ordinary hint', async () => {
  const ctx = await liveCard({ sessions: [] })
  const { text } = act(ctx).paint()
  assert.doesNotMatch(text, /newer than the running host/)
  assert.match(text, /`\*` means EVERY session/, 'the wildcard is the default and the hint says so')
  assert.match(text, /EMPTY list means none/, 'and emptying it is the one explicit way to observe nothing')
})

/** The `onSelect` of the menu row the plugin registered, found by the primitives stub's own identity. */
function menuItem(node, primitives) {
  const found = []
  const walk = (current) => {
    if (current === null || current === undefined || typeof current === 'boolean') return
    if (typeof current === 'string' || typeof current === 'number' || typeof current === 'function') return
    if (Array.isArray(current)) { current.forEach(walk); return }
    if (current.type === primitives.MenuItemButton) { found.push(current.props); return }
    if (typeof current.type === 'function') { walk(current.type(current.props ?? {})); return }
    ;(current.children ?? []).forEach(walk)
  }
  walk(node)
  return found[0]
}

/** Render the session-menu seat with one session, and return what the row says and does. */
function renderMenu(ctx, props, primitives) {
  const entry = ctx.registered.find(e => e.ownerKey === 'sidebar.workspaces.session.menu.item').dispose.component
  const session = ctx.React.begin()
  const wrapper = entry(props)
  const node = wrapper.type(wrapper.props)
  const text = renderTree(node)
  void session
  return { text, item: menuItem(node, primitives) }
}

test('the session menu offers to observe the session it belongs to', async () => {
  const ctx = await liveCard({ sessions: [] })
  const { text, item } = renderMenu(ctx, { sessionId: 'session-target-1', displayTitle: 'Question flow to decision model', useMenuOpenState: () => [true, () => {}] }, ctx.primitives)
  assert.match(text, /Observe this session/, 'an unobserved session is offered, not assumed')
  assert.equal(typeof item.onSelect, 'function', 'the row must be selectable')
})

test('selecting Observe writes the id AND the headline it was handed, then closes the menu', async () => {
  const ctx = await liveCard({ sessions: [] })
  let closed = 0
  const { item } = renderMenu(ctx, {
    sessionId: 'session-target-1',
    displayTitle: 'test session',
    useMenuOpenState: () => [true, () => { closed += 1 }],
  }, ctx.primitives)
  item.onSelect()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(closed, 1, 'the menu must dismiss itself, or the row acts invisibly')
  // THE TITLE IS CAPTURED HERE OR NOWHERE: the seat is the only place that has it, and the settings card has
  // no way to look a session up. An id alone is unreadable there.
  assert.deepEqual(ctx.form.calls[0].ops, [{
    op: 'set', path: ['sessions'],
    value: [{ id: 'session-target-1', title: 'test session' }],
  }])
})

test('a session already in the list offers to stop, and dropping it removes every entry it matches', async () => {
  // The stored entry is a PREFIX of this session -- as a hand-typed entry would be. Leaving it behind would
  // make "stop observing" a lie, so the removal drops every entry the session matches, and it does not
  // disturb the entry that came with a title.
  const ctx = await liveCard({
    sessions: [
      { id: 'session-target', title: 'a stale prefix entry' },
      { id: 'session-other', title: 'kept' },
    ],
  })
  const { text, item } = renderMenu(ctx, { sessionId: 'session-target-1', displayTitle: 'test session', useMenuOpenState: () => [true, () => {}] }, ctx.primitives)
  assert.match(text, /Stop observing this session/)
  item.onSelect()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(ctx.form.calls[0].ops, [{
    op: 'set', path: ['sessions'],
    value: [{ id: 'session-other', title: 'kept' }],
  }], 'the untouched entry keeps its title')
})

test('with no namespace served the row reads as unobserved and writes nothing', async () => {
  const ctx = await liveCard({}, { namespaces: [] })
  const { text, item } = renderMenu(ctx, { sessionId: 'session-target-1', useMenuOpenState: () => [true, () => {}] }, ctx.primitives)
  assert.match(text, /Observe this session/)
  item.onSelect()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(ctx.form.calls.length, 0, 'a row that cannot resolve the namespace must not claim it changed something')
})






test('the wildcard is a row a person can read and remove, not a bare asterisk', async () => {
  const ctx = await liveCard({ sessions: ['*'] })
  const ui = act(ctx)
  const painted = ui.paint()
  assert.match(painted.text, /every session/, 'the asterisk is spelled out')
  assert.doesNotMatch(painted.text, /No session is observed/, 'and it is not the empty state')
  ui.click('system1-observer-session-remove-0')
  const emptied = ui.paint()
  assert.match(emptied.text, /No session is observed/, 'removing it observes nothing')
  await formProps(emptied.node).onSave()
  assert.deepEqual(ctx.form.calls[0].ops, [{ op: 'set', path: ['sessions'], value: [] }])
})

// THE THIRD LABEL. `stop` cannot apply while the wildcard is active -- "every session EXCEPT this one" is not
// expressible in a list of inclusions -- so the honest action there is to narrow to this session alone.
test('with the wildcard active the menu offers to NARROW, and writes only this session', async () => {
  const ctx = await liveCard({ sessions: ['*'] })
  const { text, item } = renderMenu(ctx, {
    sessionId: 'session-target-1',
    displayTitle: 'test session',
    useMenuOpenState: () => [true, () => {}],
  }, ctx.primitives)
  assert.match(text, /Observe only this session/, 'not "stop observing", which cannot be expressed here')
  item.onSelect()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(ctx.form.calls[0].ops, [{
    op: 'set', path: ['sessions'],
    value: [{ id: 'session-target-1', title: 'test session' }],
  }], 'the wildcard is dropped and this session takes its place')
})

test('a wildcard beside a specific entry still offers to narrow, and drops both', async () => {
  const ctx = await liveCard({ sessions: ['*', { id: 'session-other', title: 'kept until now' }] })
  const { text, item } = renderMenu(ctx, { sessionId: 'session-target-1', useMenuOpenState: () => [true, () => {}] }, ctx.primitives)
  assert.match(text, /Observe only this session/)
  item.onSelect()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(ctx.form.calls[0].ops, [{ op: 'set', path: ['sessions'], value: [{ id: 'session-target-1' }] }])
})

// THREE CONTROLS CAN EACH STOP EVERY CALL, and all three look identical from the outside: no calls. The line
// that says WHICH one is stopping things is therefore not decoration -- it is the difference between a user
// who fixes it and a user who concludes the plugin is broken. Each state is asserted in its own words.
test('the effective line names the gate that is actually stopping the calls', async () => {
  const masterOff = await liveCard({ callsEnabled: false, sessions: ['*'] })
  assert.match(act(masterOff).paint().text,
    /Calls are OFF.*overrides both/s,
    'the master switch outranks the sessions, and the line says so rather than letting a session list look broken')

  const noSession = await liveCard({ callsEnabled: true, sessions: [] })
  assert.match(act(noSession).paint().text,
    /Calls are ON but NO session is observed/,
    'the second gate, in its own words')

  const everySeamOff = await liveCard({
    callsEnabled: true, sessions: ['*'],
    seamEnabled: Object.fromEntries(['assemble', 'admit', 'draft', 'pre_execute', 'execute', 'post_execute', 'result', 'request', 'close'].map(s => [s, false])),
  })
  assert.match(act(everySeamOff).paint().text, /every seam is switched off/, 'the third gate')

  const running = await liveCard({ callsEnabled: true, sessions: [{ id: 'session-aaa', title: 'a' }] })
  assert.match(act(running).paint().text,
    /Calls are ON for 1 session; every observed seam calls/,
    'and when nothing is stopping them, it says that too rather than staying silent')

  const wild = await liveCard({ callsEnabled: true, sessions: ['*'] })
  assert.match(act(wild).paint().text, /Calls are ON for every session/, 'the wildcard reads as a scope, not as an asterisk')
})

// THE LINE THAT EXPLAINS WHY NOTHING IS HAPPENING MUST DESCRIBE THE RUNNING ROW, NOT THE DRAFT. Read from the
// draft it said "Calls are ON" the moment the box was ticked -- while the host was still recording
// `calls disabled` -- which is a line confidently explaining the opposite of the truth. This cost a real
// confusion: a save was forgotten, and the card had already said the switch was on.
test('the effective line reports the SAVED state and flags unsaved changes separately', async () => {
  const ctx = await liveCard({ callsEnabled: false, sessions: ['*'] })
  const ui = act(ctx)
  assert.match(ui.paint().text, /Calls are OFF/, 'what the running row is doing')
  assert.doesNotMatch(ui.paint().text, /UNSAVED/, 'and nothing is pending yet')

  ui.toggle('system1-observer-callsEnabled')
  const pending = ui.paint()
  assert.match(pending.text, /Calls are OFF/, 'the running row is still off -- the tick is only a draft')
  assert.match(pending.text, /UNSAVED changes/, 'and the card says so, rather than implying the tick took effect')

  // THE STORE UPDATE A REAL MUTATE TRIGGERS. `stubForm.mutate` records the ops but does not apply them, so the
  // test applies them the way the host would -- a new value object, pushed through the subscription the card
  // is subscribed to -- and only then re-renders.
  await formProps(pending.node).onSave()
  ctx.form.value = { callsEnabled: true, sessions: ['*'] }
  ctx.form.notify()
  const saved = ui.paint()
  assert.match(saved.text, /Calls are ON for every session/, 'once saved, the line follows the running row')
  assert.doesNotMatch(saved.text, /UNSAVED/, 'and the warning goes with the change')
})

// THE TRACE CARD. It is the one seat whose data arrives from the host with the tool result rather than from
// the config mirror, so the shape it must survive is `block.meta` -- the `output.presentationMeta` projection
// persisted on `tool/result`. Both paths are asserted: the projection when the host sends it, and the
// model-facing text when it does not, because an empty card is worse than a plain one.
// `renderView` renders ONE level deeper than the registered value, because the other seats register a
// wrapper. This seat registers the component itself -- there is nothing to wrap -- so the helper supplies the
// descriptor the walk expects, which is exactly what `h(TraceCard, props)` would have built in the browser.
function traceCard(registered) {
  const entry = registered.find(candidate => candidate.target?.name === 'tool.call.toolview')
  assert.ok(entry !== undefined, 'the tool card must be registered')
  const component = entry.dispose.component
  return (props) => ({ type: component, props })
}

const TRACE_META = {
  path: '/home/x/.dsh/logs/system1-observer.jsonl',
  run: '2026-09-30T04-06-13-609Z-50f06f13',
  runs: ['2026-09-30T04-06-13-609Z-50f06f13'],
  unknownRun: false,
  hook: null,
  window: { events: 204, truncated: false },
  counts: { call: 1, skip: 202, error: 0, mount: 1, events: 204 },
  seams: [{ key: 'draft', count: 1 }],
  reasons: [{ key: 'session not observed', count: 193 }, { key: 'calls disabled at this seam', count: 8 }],
  sessions: [{ key: 'session-91d07', count: 146 }],
  subjects: [{ key: 'openrouter/mistralai/ministral-3b-2512', count: 175 }],
  models: [{ key: 'typesafe/jev-1.13-20260917', count: 1 }],
  latency: { min: 804, median: 804, max: 804 },
  liveAgents: ['session-fedcba98-7654-4321-0fed-cba987654321 (openrouter/mistralai/ministral-3b-2512)'],
  mounts: [{
    at: '2026-09-30T04:06:13.609Z', hooks: ['admit', 'draft'], transport: 'service',
    provider: 'typesafe', model: 'jev-latest', questions: ['reply_kind'],
    callsEnabled: true, seamsOff: ['admit'], sessions: ['*'], tracePath: '/home/x/.dsh/logs/system1-observer.jsonl',
  }],
  listed: [
    {
      at: '2026-09-30T04:09:47.350Z', clock: '04:09:47', event: 'call', hook: 'draft',
      session: 'session-91d07', ms: 804, excerpt: 'Yes! To find and manage DSH plugins…', truncated: false,
      answers: [{ id: 'reply_kind', type: 'choice', label: 'an_answer', confidence: 0.9, probabilities: { an_answer: 0.95 } }],
      questions: [{ id: 'reply_kind', type: 'choice', instructions: 'Is it an answer?', options: null }],
      subject: 'openrouter/mistralai/ministral-3b-2512',
    },
    { at: '2026-09-30T04:09:48.000Z', clock: '04:09:48', event: 'skip', hook: 'execute', session: 'session-91d07', reason: 'calls disabled at this seam', problems: null },
  ],
  listedOf: 204,
}

test('the card draws the run, its scope, and the rows -- from the structured projection', async () => {
  const { React, registered } = await mount()
  const { text } = renderView(React, traceCard(registered), { phase: 'result', block: { meta: TRACE_META, content: [] } })
  assert.match(text, /System One trace/)
  assert.match(text, /2026-09-30T04-06-13-609Z-50f06f13/, 'which run')
  assert.match(text, /1 call/, 'the counts cover the run')
  assert.match(text, /202 skips/)
  assert.match(text, /804-804ms/)
  // THE SCOPE, because it is what explains a run that recorded nothing.
  assert.match(text, /calls on/)
  assert.match(text, /seams off admit/)
  assert.match(text, /sessions: \*/)
  // BOTH MODELS, side by side: the subject is who wrote the text, `graded by` is who judged it.
  assert.match(text, /openrouter\/mistralai\/ministral-3b-2512/)
  assert.match(text, /typesafe\/jev-1\.13-20260917/)
  // AND THE ROWS: the answer with the confidence a gate would threshold on, and the skip's own reason.
  assert.match(text, /an_answer/)
  assert.match(text, /p=0\.9/)
  // THE DISTRIBUTION IS A BAR, not a string: the option and its percentage are text, and the proportion is a
  // `progressbar` carrying its value -- see the bar tests below.
  assert.match(text, /an_answer/)
  assert.match(text, /95%/)
  assert.match(text, /calls disabled at this seam/)
  assert.match(text, /showing the last 2 of 204 events/)
})

test('an emptied session list is shown as observing nothing, not as a missing field', async () => {
  const { React, registered } = await mount()
  const meta = { ...TRACE_META, mounts: [{ ...TRACE_META.mounts[0], sessions: [], callsEnabled: false, seamsOff: [] }] }
  const { text } = renderView(React, traceCard(registered), { phase: 'result', block: { meta, content: [] } })
  assert.match(text, /calls OFF/)
  assert.match(text, /NONE — observes nothing/)
})

test('an unmatched run offers the runs that exist instead of drawing an empty card', async () => {
  const { React, registered } = await mount()
  const meta = { ...TRACE_META, unknownRun: true, run: null, listed: [], listedOf: 0 }
  const { text } = renderView(React, traceCard(registered), { phase: 'result', block: { meta, content: [] } })
  assert.match(text, /Runs in this file:/)
  assert.match(text, /2026-09-30T04-06-13-609Z-50f06f13/)
})

// A HOST THAT PREDATES THE PROJECTION still gets a readable card: the same report, as the model saw it.
test('without the projection the card falls back to the model-facing text', async () => {
  const { React, registered } = await mount()
  const { text } = renderView(React, traceCard(registered), {
    phase: 'result',
    block: { content: [{ type: 'text', text: '3 events · 1 calls\n  calls by seam: draft 1' }] },
  })
  assert.match(text, /no structured projection from this host/)
  assert.match(text, /calls by seam: draft 1/)
})

test('the card renders while the call is still running, and never throws on a bare block', async () => {
  const { React, registered } = await mount()
  const card = traceCard(registered)
  assert.match(renderView(React, card, { phase: 'start', block: null }).text, /Reading the System One observer trace/)
  assert.doesNotThrow(() => renderView(React, card, { phase: 'result', block: undefined }))
})

// THE SEAT IS ALL-OR-NOTHING. A keyed `tool.call.toolview` entry REPLACES the generic card, and the seat's
// `fallback` is used only when NOTHING claims the key -- so a component that throws does not degrade to the
// generic row, it removes the row. A card that can vanish silently is worse than no card, so it catches its
// own errors and shows them.
test('a card that throws shows the error instead of taking the row down with it', async () => {
  const { React, registered } = await mount()
  // A `block` whose `meta` is a non-object that still beats the guard is awkward to fake, so the throw is
  // provoked where it would really happen: a listing that is not iterable.
  const { text } = renderView(React, traceCard(registered), {
    phase: 'result',
    block: { meta: { ...TRACE_META, listed: { not: 'an array' } }, content: [] },
  })
  assert.match(text, /System One trace card failed/, 'the failure is visible, not silent')
  assert.match(text, /not iterable|map is not a function/, 'and it names the cause')
})

// --- PROPORTION BARS -----------------------------------------------------------------------------------
// A BAR RATHER THAN A NUMBER, because the distribution's SHAPE is what a person is judging: `p=0.4` has to be
// read, while a filled track is seen. The competitor on this same seat hard-codes hex and says why -- its
// comment calls the design tokens "an internal contract that may move between releases" -- but this card already
// uses tokens everywhere else, so a hard-coded fill would be the one element that ignores the theme.
//
// TraceCard holds no hooks, so walking the rendered tree a second time to read the bars is safe here; the harness
// warns about a second walk precisely because it would reset a hook universe, and there is none to reset.
function barsOf(node) {
  return collectBars(node)
}

test('an answer shows its distribution as labelled proportion bars, with the value on each one', async () => {
  const { React, registered } = await mount()
  // THREE OPTIONS, so the properties below are exercised across a distribution rather than one bar.
  const meta = {
    ...TRACE_META,
    listed: [{
      at: '2026-01-02T00:00:00.000Z', clock: '00:00:00', event: 'call', hook: 'draft', session: 'session-a', ms: 10, truncated: false, subject: null,
      answers: [{ id: 'reply_kind', type: 'choice', label: 'an_answer', confidence: 0.9, answerConfidence: 0.9, level: null, invalid: null, invalidReason: null,
        probabilities: { an_answer: 0.95, a_tool_call: 0.03, unclear: 0.02 } }],
      questions: [], probe: true,
    }],
  }
  const { node } = renderView(React, traceCard(registered), { phase: 'result', block: { meta, content: [] } })
  const bars = barsOf(node)
  assert.equal(bars.length, 3, 'one bar per option in the recorded distribution')
  for (const bar of bars) {
    assert.equal(bar.role, 'progressbar')
    assert.equal(bar['aria-valuemin'], 0)
    assert.equal(bar['aria-valuemax'], 100)
    assert.ok(Number.isInteger(bar['aria-valuenow']), 'the value is ON the element, so it survives without the bar')
    assert.match(bar['aria-label'], /^[a-z_]+: \d+%$/)
  }
  assert.equal(bars.find(bar => bar['aria-label'].startsWith('an_answer'))['aria-valuenow'], 95, '95% on the option it chose')
})

test('a ten-option distribution cannot make sixty rows ten rows taller, and it says what it hid', async () => {
  const { React, registered } = await mount()
  const spread = {}
  for (let i = 0; i < 10; i += 1) spread[`option_${i}`] = (10 - i) / 55
  const meta = {
    ...TRACE_META,
    listed: [{
      at: '2026-01-02T00:00:00.000Z', clock: '00:00:00', event: 'call', hook: 'draft', session: 'session-a', ms: 10, truncated: false, subject: null,
      answers: [{ id: 'probe', type: 'choice', label: 'option_0', confidence: 0.5, answerConfidence: 0.5, probabilities: spread, invalid: null, invalidReason: null, level: null }],
      questions: [], probe: true,
    }],
  }
  const { node, text } = renderView(React, traceCard(registered), { phase: 'result', block: { meta, content: [] } })
  assert.equal(barsOf(node).length, 4, 'capped at four per answer')
  assert.match(text, /\+6 more option\(s\)/, 'and the rest is counted rather than dropped in silence')
})

test('a defect the answer carried is shown, because a readable wrong answer is the interesting one', async () => {
  const { React, registered } = await mount()
  const meta = {
    ...TRACE_META,
    listed: [{
      at: '2026-01-02T00:00:00.000Z', clock: '00:00:00', event: 'call', hook: 'draft', session: 'session-a', ms: 10, truncated: false, subject: null,
      answers: [{ id: 'probe', type: 'choice', label: 'an_answer', confidence: 0.5, answerConfidence: 0.5, probabilities: { an_answer: 0.5 }, invalid: true, invalidReason: 'probabilities sum to 1.80', level: null }],
      questions: [], probe: true,
    }],
  }
  const { text } = renderView(React, traceCard(registered), { phase: 'result', block: { meta, content: [] } })
  assert.match(text, /invalid: probabilities sum to 1\.80/)
})

// THE RUNS PANEL, whose first line is the verdict rather than a number. Two lanes of counts look comparable, and
// only the verdict says whether they are -- so a reader who takes in one line learns whether they may read the
// rest together.
test('the card shows the comparability verdict above the lanes', async () => {
  const { React, registered } = await mount()
  const lane = run => ({ id: run, firstAt: '2026-01-02T00:00:00.000Z', lastAt: '2026-01-02T00:01:00.000Z', calls: 3, errors: 0, skips: 1, msSum: 300, seamMix: [{ key: 'draft', count: 3 }] })
  const panel = (note, reason, lanes = 2, total = 2) => ({
    verdict: { sameTask: reason === 'same', reason, differIn: [], missing: [] },
    lanes: [lane('RUN-A'), lane('RUN-B')].slice(0, lanes), selected: lanes, total, limit: 5, note,
  })

  const same = renderView(React, traceCard(registered), { phase: 'result', block: { meta: { ...TRACE_META, compare: panel('2 runs of the same questions under the same instrument: directly comparable', 'same') }, content: [] } })
  assert.match(same.text, /runs side by side/)
  assert.match(same.text, /directly comparable/)
  assert.match(same.text, /RUN-A/)
  assert.match(same.text, /3 calls · 0 errors · 1 skips/)

  const cannotTell = renderView(React, traceCard(registered), { phase: 'result', block: { meta: { ...TRACE_META, compare: panel('2 runs selected but switches is unrecorded in at least one: this is not a difference, it is a missing record', 'no-task-key') }, content: [] } })
  assert.match(cannotTell.text, /not a difference, it is a missing record/)
})

test('one lane is no comparison, and there is no panel for nothing', async () => {
  const { React, registered } = await mount()
  const single = { verdict: { sameTask: false, reason: 'single', differIn: [], missing: [] }, lanes: [{ id: 'RUN-A', calls: 1, errors: 0, skips: 0, msSum: 1, seamMix: [] }], selected: 1, total: 1, limit: 5, note: 'one run selected: nothing to compare' }
  const { text } = renderView(React, traceCard(registered), { phase: 'result', block: { meta: { ...TRACE_META, compare: single }, content: [] } })
  assert.doesNotMatch(text, /runs side by side/, 'a single run is not a comparison')
})
