// READING A CONFIG FIELD, WHEN THE FIELD MAY BE AN ACCESSOR.
//
// A `.volatile()` field does NOT arrive as its value. Cordis hands the plugin a `Volatile<T>`
// reference, and the value is only available through `.get()`. Measured in the installed harness
// (0.1.7-rc.2), in shipped plugins:
//
//   config.apiKey.get(), config.baseURL.get(), config.model.get()   web-search-deepseek/src/index.ts:129
//   config.defaultPreset.get() ?? inferredDefault                   permission-presets/src/index.ts:223
//   ctx.agentLoop.config.maxParallelToolCalls.get()                 core/agent-loop/src/tool-calls.ts:132
//
// Read one as a plain value and you get the accessor object, so `=== true`, `typeof x === 'string'`
// and `Array.isArray(x)` are all false and the plugin silently runs on its defaults: the settings
// card looks right, the save persists, and the running plugin ignores it. That is the whole failure
// mode, and it is invisible from the UI.
//
// The `dsh-system1` plugin ships the same guard (`lib/index.js:40-46`). Ours is defensive in both
// directions, because ordinary fields DO arrive plain — a schema field without `.volatile()` is not
// wrapped, and a value that merely happens to have a `get` method must not be mistaken for one.

/**
 * The value behind a config field, whether it is a `Volatile` accessor or an ordinary value.
 *
 * @param value what Cordis put on the config object for this field
 * @returns the setting itself
 */
export function readConfigValue(value) {
  if (value !== null && typeof value === 'object' && typeof value.get === 'function') {
    return value.get()
  }
  return value
}

/**
 * Every field of a config object, unwrapped.
 *
 * Call this AT THE POINT OF USE for a volatile field: `.get()` reads the current value, and a live
 * edit is delivered to a running plugin without re-applying it. A snapshot taken once in `apply`
 * is fine for mount-bound fields and wrong for volatile ones.
 *
 * @param config the row's config, as Cordis passed it
 * @returns a plain object with every accessor read
 */
export function plainConfig(config) {
  const out = {}
  if (config === null || typeof config !== 'object') return out
  for (const [key, value] of Object.entries(config)) out[key] = readConfigValue(value)
  return out
}
