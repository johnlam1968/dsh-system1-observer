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
    begin() { cursor = 0; counts.push(0) },
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
  const mod = spec.factory((name) => {
    if (name === 'react') return React
    throw new Error(`unexpected require: ${name}`)
  })
  const registered = []
  const namespaces = options.namespaces ?? [{ ns: 'include:system1-observer', value: {}, revision: 4 }]
  await mod.apply({
    effect: (fn) => fn(),
    configForms: { describe: () => stubMirror(namespaces), get: () => options.form },
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
  return { spec, React, registered }
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
