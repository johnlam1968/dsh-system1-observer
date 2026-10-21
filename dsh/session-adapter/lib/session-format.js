// THE VOCABULARY IS NOT HERE, AND THIS FILE IS WHY NOTHING ELSE HAS TO KNOW THAT.
//
// The session vocabulary -- `EVENT` and the readers that go with it -- moved WHOLE into `system1-measure`, because the
// format is not the harness's: it is the shape every substrate writes, and a plugin that carries its own copy is a
// plugin that will change it.
//
// This file is a PURE RE-EXPORT LAYER, and it is load-bearing twice over. It keeps the plugin's import paths stable,
// so the vocabulary's address can change again without touching every caller; and it is the ONE file in the plugin
// that `test/session-format.test.js` exempts from the guard that fails a second spelling of a session event.
//
// A PURE RE-EXPORT LAYER, MEANING: it names no event, declares no rule, and computes nothing. If a line of logic
// appears here, the layer has stopped being a layer -- and the guard in `test/session-format.test.js` is what says so.
export * from 'system1-measure/instrument/session-format.js'
