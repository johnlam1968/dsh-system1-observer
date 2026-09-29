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

function stubReact() {
  const store = []
  let cursor = 0
  const counts = []
  const memos = []
  return {
    counts,
    createElement(type, props, ...children) { return { type, props: props ?? {}, children } },
    useState(initial) {
      counts[counts.length - 1] = (counts[counts.length - 1] ?? 0) + 1
      const idx = cursor++
      if (!(idx in store)) store[idx] = typeof initial === 'function' ? initial() : initial
      return [store[idx], (next) => { store[idx] = typeof next === 'function' ? next(store[idx]) : next }]
    },
    useEffect() { counts[counts.length - 1] = (counts[counts.length - 1] ?? 0) + 1 },
    // The form builds its model with `useMemo`; the stub counts the hook where React would, and CACHES
    // by inputs so a re-render with the same scope reuses the model. That reuse is the whole reason the
    // memo exists: recreating the model per render would throw every staged edit away.
    useMemo(fn, inputs) {
      counts[counts.length - 1] = (counts[counts.length - 1] ?? 0) + 1
      const idx = cursor++
      const previous = memos[idx]
      // React does NOT memoise an EMPTY dependency list: it re-runs the factory on every render.
      // Caching `[]` here would make the "reuses the model" claim unfalsifiable.
      const same = previous !== undefined
        && (inputs ?? []).length > 0
        && (inputs ?? []).length === previous.inputs.length
        && (inputs ?? []).every((value, i) => Object.is(value, previous.inputs[i]))
      if (same) return previous.value
      const value = fn()
      memos[idx] = { inputs: inputs ?? [], value }
      return value
    },
    begin() { cursor = 0; counts.push(0) },
  }
}

// The shipped form toolkit, stubbed at the API the primitives package actually exports:
// `SettingsFormModel(scope, specs)`, `settingsNumberField(field)`, and the two components.
function stubPrimitives(calls) {
  // React FLATTENS nested child arrays (and a `.map` inside `h(...)` is one argument that IS an array),
  // so the stub does too -- otherwise the mapped field controls sit one array deep and are unreachable.
  const h = (...args) => ({ primitives: true, args, children: args.slice(2).flat(Infinity) })
  // The control is the one toolkit component `collectFields` looks for, and it is looked for BY this
  // reference: a second `stubPrimitives()` in the walker would build a different function and match nothing.
  const SettingsValueField = (...args) => ({ primitives: true, args, children: args.slice(2).flat(Infinity) })
  class SettingsFormModel {
    constructor(scope, specs) { calls.push({ scope, specs }); this.scope = scope; this.specs = specs }
    shell() {
      // DERIVED FROM THE SCOPE, not hard-coded. The brief's stub returned `available: true` whatever the
      // entry form said, so it could never exercise the unavailable state -- and `available` is exactly
      // what that state is about. It also discards an `undefined` model before ever calling `shell`.
      const snapshot = this.scope.getSnapshot()
      return {
        available: snapshot.status === 'ready',
        writable: snapshot.writable,
        dirty: false, invalid: false, saving: false, failed: false,
      }
    }
    field() { return { text: '', overridden: false, invalid: false } }
    actions() { return { edit() {}, resetField() {}, save: async () => {}, discard() {} } }
    // LAZY, like the real `bind(project)`: the projection runs on each read. The brief's stub mapped
    // `this.specs` EAGERLY inside `bind()`, when `this.specs` is still undefined, so it reported ZERO
    // fields and the card's field controls were never rendered at all.
    bind(project) { return { getSnapshot: () => project() } }
  }
  return {
    SettingsFormModel, SettingsForm: h, SettingsValueField,
    // MIRRORED FROM form-model.ts:156, NOT the brief's one-liner. The brief's stub parsed a blank draft as
    // `{ kind: 'set', value: 0 }`, so an assertion about the SHIPPED number spec read the stub instead.
    settingsNumberField: (field) => ({
      field,
      format: (value) => (typeof value === 'number' ? String(value) : ''),
      parse: (t) => {
        const trimmed = t.trim()
        if (trimmed === '') return { kind: 'clear' }
        const parsed = Number(trimmed)
        return Number.isFinite(parsed) ? { kind: 'set', value: parsed } : undefined
      },
    }),
  }
}

function stubMirror(namespaces) {
  return {
    getSnapshot: () => ({ status: 'ready', view: { namespaces, writable: true } }),
    subscribe: () => () => {},
    ensure: async () => {},
  }
}

async function mount(options = {}) {
  const spec = await load()
  const React = stubReact()
  const primitives = stubPrimitives(options.calls ?? [])
  const mod = spec.factory((name) => {
    if (name === 'react') return React
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitives
    throw new Error(`unexpected require: ${name}`)
  })
  const registered = []
  const namespaces = options.namespaces ?? [{ ns: 'include:system1-observer', value: {}, revision: 4 }]
  await mod.apply({
    effect: (fn) => fn(),
    // `configForms.get` is keyed by NAMESPACE and only serves a namespace the mirror lists. The brief's
    // `get: () => options.form` answered for every namespace, so it could not represent "not served" and
    // handed the unavailable test a live form -- the one state that test exists to exercise.
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
      // it then a mutation of that key cannot reach any assertion -- which is how the first version of
      // this file let the namespace be registered in place of the package name and still reported green.
      register(target, component) {
        registered[registered.length - 1].target = target
        return { target, component }
      },
    },
  })
  return { spec, React, registered, primitives }
}

// Shaped like `ConfigFormController` as far as the model reads it: the three `SettingsFormScope` methods.
function liveForm() {
  return {
    getSnapshot: () => ({ status: 'ready', value: {}, base: {}, user: {}, writable: true, revision: 7 }),
    subscribe: () => () => {},
    mutate: async () => true,
  }
}

// Every `SettingsValueField` the card renders, in order, as its props. It is identified by the toolkit
// stub's own export -- a marker property cannot work, because the walk sees the ELEMENT DESCRIPTOR the
// stub `h(...)` built, not the value the control returns.
function collectFields(node, primitives) {
  const found = []
  const walk = (current) => {
    if (current === null || current === undefined || typeof current === 'boolean') return
    if (typeof current === 'string' || typeof current === 'number' || typeof current === 'function') return
    // A child that is a `.map(...)` arrives as an ARRAY of elements (real React flattens them at render
    // time), so arrays are unfurled before anything is read off the node.
    if (Array.isArray(current)) { current.forEach(walk); return }
    if (current.type === primitives.SettingsValueField) { found.push(current.props); return }
    // A function component contributes what it RETURNS; a host element contributes its children. A stub
    // toolkit component keeps its children in `props.children`, the harness's `createElement` on the
    // element itself, so both are read. NO early return after the call: the returned frame's own array
    // child still has to be walked, or the controls below it are unreachable.
    if (typeof current.type === 'function') walk(current.type(current.props ?? {}))
    ;(current.children ?? []).forEach(walk)
    ;(current.props?.children ?? []).forEach(walk)
  }
  walk(node)
  return found
}

// The card renders a TREE, not one component: `Card` returns a `div` whose child descriptor is `Form`,
// and the model is built inside `Form`. One level deeper reaches `Card`; the tree has to be walked for
// the form to run at all. This calls every function component it meets, in the order React would, and
// collects the text found anywhere below.
function renderTree(node) {
  const texts = []
  const walk = (current) => {
    if (current === null || current === undefined || typeof current === 'boolean') return
    if (typeof current === 'string' || typeof current === 'number') { texts.push(current); return }
    if (Array.isArray(current)) { current.forEach(walk); return }
    // The argument itself may be the component function (the registered value returns `h(Card, props)`,
    // so `entry(...)` yields a DESCRIPTOR whose `type` is Card); a descriptor's `type` and its children
    // are either a string host element or another function component.
    if (typeof current === 'function') { walk(current(node.props ?? {})); return }
    // This harness's `createElement` collects children on the ELEMENT, so that is what is read here.
    // (`collectFields` above also reads `props.children`, because the toolkit STUB puts them there.)
    if (typeof current.type === 'function') { walk(current.type(current.props ?? {})); return }
    ;(current.children ?? []).forEach(walk)
  }
  walk(node)
  return texts.join(' | ')
}

test('it registers into the bundle-config slot under the package name', async () => {
  const { spec, registered } = await mount()
  assert.equal(spec.id, 'dsh-system1-observer')
  assert.equal(registered.length, 1)
  assert.deepEqual(registered[0].ownerKey, 'plugins.bundle.config')
  // The page dispatches on the PACKAGE NAME. The settings namespace (`system1-observer` /
  // `include:system1-observer`) is a different id space and registering under it is silent: no card.
  assert.deepEqual(registered[0].target, { name: 'plugins.bundle.config', key: 'dsh-system1-observer' })
})

test('both views render, and the hook count is equal and non-zero', async () => {
  const { React, registered } = await mount()
  const entry = registered[0].dispose.component
  // ONE LEVEL DEEPER. `entry` is the registered `(props) => h(Card, props)`, so calling it returns an
  // element descriptor and renders NOTHING: every assertion below would pass vacuously and the hook
  // count would be 0. The Card is the element's `type`, and its props are the element's props.
  const render = (view) => {
    React.begin()
    const wrapper = entry({ view })
    return wrapper.type(wrapper.props)
  }
  const summary = render('summary')
  const page = render('page')
  assert.ok(summary, 'summary must render something')
  assert.ok(page, 'page must render something')
  assert.equal(React.counts[0], React.counts[1], 'hook count must not differ between views')
  assert.ok(React.counts[0] > 0, 'the card must call at least one hook')
})

test('the form is built on the entry form for this bundle, with the three writable fields', async () => {
  const calls = []
  const form = liveForm()
  const { React, registered } = await mount({ form, calls })
  React.begin()
  const wrapper = registered[0].dispose.component({ view: 'page' })
  renderTree(wrapper.type(wrapper.props))     // one level deeper, then through Form
  assert.equal(calls.length, 1, 'exactly one SettingsFormModel is built per render')
  assert.equal(calls[0].scope, form, 'the model is built on configForms.get(namespace)')
  assert.deepEqual(calls[0].specs.map((s) => s.field), ['observeSubagents', 'includeNonOperatorFacing', 'maxFieldChars'])
})

test('a re-render over the same entry form reuses the model, so staged edits survive it', async () => {
  const calls = []
  const form = liveForm()
  const { React, registered } = await mount({ form, calls })
  const component = registered[0].dispose.component
  React.begin()
  renderTree(component({ view: 'page' }))
  // The card re-renders on every mirror snapshot; the memo keys the model on the scope, and the scope is
  // one object for as long as the namespace is served. A model rebuilt per render discards the drafts.
  React.begin()
  renderTree(component({ view: 'page' }))
  assert.equal(calls.length, 1, 'a re-render over the same scope must not build a second model')
})

test('with no namespace served, the page renders the unavailable state and never throws', async () => {
  const { React, registered } = await mount({ namespaces: [] })
  React.begin()
  const wrapper = registered[0].dispose.component({ view: 'page' })
  // `doesNotThrow` ALONE IS VACUOUS: the Task 1 card returns the diagnostic div without ever resolving
  // the scope, so it passes without exercising the unavailable path. Assert the rendered claim too --
  // with no namespace there is no form, and the page must still say so instead of throwing.
  let text
  assert.doesNotThrow(() => { text = renderTree(wrapper.type(wrapper.props)) })
  assert.match(text, /not available/, 'the unavailable state must actually render')
})

test('the two boolean specs round-trip on/off and refuse a draft they cannot accept', async () => {
  const calls = []
  const form = liveForm()
  const { React, registered } = await mount({ form, calls })
  React.begin()
  const wrapper = registered[0].dispose.component({ view: 'page' })
  renderTree(wrapper.type(wrapper.props))
  const specs = new Map(calls[0].specs.map((s) => [s.field, s]))
  const observe = specs.get('observeSubagents')
  // The two live booleans are ON_OFF specs: store true/'' plus the spellings a user types, and refuse
  // anything else so the save is BLOCKED and the draft stays visible instead of being dropped.
  assert.deepEqual(observe.format(true), 'on')
  assert.deepEqual(observe.format(false), 'off')
  assert.deepEqual(observe.format(undefined), 'off')
  assert.deepEqual(observe.parse('on'), { kind: 'set', value: true })
  assert.deepEqual(observe.parse(' TRUE '), { kind: 'set', value: true })
  assert.deepEqual(observe.parse('Off'), { kind: 'set', value: false })
  assert.deepEqual(observe.parse(' false '), { kind: 'set', value: false })
  assert.deepEqual(observe.parse(''), { kind: 'clear' })
  assert.equal(observe.parse('yes'), undefined, 'an unaccepted draft must block the save, not clear the field')
  assert.deepEqual(specs.get('includeNonOperatorFacing').parse('on'), { kind: 'set', value: true })
  // The number field is the shipped spec, not a hand-rolled one: a non-number is invalid, blank clears.
  const chars = specs.get('maxFieldChars')
  assert.deepEqual(chars.parse(' 4096 '), { kind: 'set', value: 4096 })
  assert.deepEqual(chars.parse(''), { kind: 'clear' })
  assert.equal(chars.parse('lots'), undefined)
})

test('every field control carries the invalidity message and the reset handler the control requires', async () => {
  const calls = []
  const form = liveForm()
  const { React, registered, primitives } = await mount({ form, calls })
  React.begin()
  const wrapper = registered[0].dispose.component({ view: 'page' })
  const node = wrapper.type(wrapper.props)
  renderTree(node)
  const fields = collectFields(node, primitives)
  // `SettingsFieldProps` marks `invalidLabel` and `onReset` REQUIRED, and the brief's render list names
  // neither. `invalidLabel` is the only copy that explains a blocked save (`SettingsValueField` renders
  // it in place of the hint while `invalid`), and the reset badge calls `onReset` -- without it that
  // button throws at the click. Both must be wired.
  assert.deepEqual(fields.map((f) => f.id), [
    'system1-observer-observeSubagents',
    'system1-observer-includeNonOperatorFacing',
    'system1-observer-maxFieldChars',
  ])
  for (const field of fields) {
    assert.equal(typeof field.invalidLabel, 'string', `${field.id} needs the invalidity message`)
    assert.ok(field.invalidLabel.length > 0, `${field.id} needs a non-empty invalidity message`)
    assert.equal(typeof field.onReset, 'function', `${field.id} needs the reset handler`)
  }
})
