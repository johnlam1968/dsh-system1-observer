// THE BRIDGE: this row's settings -> the instrument's one input object.
//
// WHY THE FILE IS THIS SMALL NOW. It was 99 lines, and the coupling that kept the instrument from being a package was
// TWO BINDINGS: the point descriptor, whose event name is the HARNESS's (`dsh/host-events.js`), and the session scope,
// which reads this row's own config (`core/sessions.js`). Both are the HOST's to supply, so both are supplied HERE and
// the pure shape lives in `core/instrument-shape.js` -- the part a second host imports, and the part the contract
// fixture (`test/fixtures/instrument-shape/contract.mjs`) pins.
//
// WHAT MOVED OUT, AND WHY IT IS NOT RE-EXPORTED HERE. `questionGroup`, `redactionGroup` and `declaredAxes` are the
// shape's own groups, so they live in the shape's own module, and the files that need them import them from THERE. A
// re-export would leave ONE rule with TWO import paths, and two import paths for one rule is how a second copy of a
// rule comes to exist -- the trap this repository has already paid for twice.
//
// TWO RULES, and both are load-bearing:
//
//   1. VOLATILE FIELDS ARE UNWRAPPED HERE, NEVER INSIDE. A `.volatile()` field arrives as a Cordis accessor, and
//      reading it as a value silently yields the accessor object -- every `=== true`, `typeof x === 'string'` and
//      `Array.isArray(x)` false -- so the plugin runs on its defaults while the settings card shows the saved value
//      (`dsh/config-value.js` records the measurement). The caller passes `plainConfig(config)`; this file never
//      imports `config-value.js`, and it never needs to: it is handed plain values and must be.
//
//   2. THE INPUT IS BUILT PER CALL, NOT PER MOUNT. `readInput(point)` is evaluated at each firing, so a setting
//      saved while the row runs reaches the next line -- the same property `readConfig` had, kept deliberately.
//
// THE FIELD NAMES ARE THE SETTINGS CARD'S. Inside a group, a field keeps the name an operator can find in the card
// (`probeQuestion`, `redactKeys`), because a `problem` string the instrument produces quotes that name and the
// operator has to be able to act on it. What changes is WHO READS IT: the shape, not the instrument.
//
// NOT A DSH MODULE, NOT A SERVICE, NOT A PLUGIN -- plain functions, so the host edge stays in `index.js`.
import { hostPoint } from '../dsh/host-events.js'
import { sessionObserved } from './sessions.js'
import { instrumentShape } from 'system1-measure/core/instrument-shape.js'

/**
 * The input object, for one firing at one point, bound to THIS harness.
 *
 * @param config    the row's config, PLAIN (`plainConfig(config)`), read fresh by the caller
 * @param point     the point id this firing is at, from the instrument's own vocabulary
 * @param transport `'wire'` or `'service'`: the transport is a closure the row built, not a config field
 *                 (the mount-bound snapshot is what keeps this honest -- `index.js` passes the live kind).
 *                 **THE DEFAULT LIVES IN THE SHAPE, not here**, and this used to carry a second copy of it -- two
 *                 copies of one rule is how a second copy of a rule comes to exist, and the two agreed only by
 *                 accident: the shape's default would have answered for a bridge that dropped its own.
 * @returns the object the instrument reads; a malformed CONFIG is answered, never thrown at
 */
export function instrumentInput(config, { point, transport } = {}) {
  return instrumentShape(config, {
    point,
    transport,
    // THE TWO BINDINGS, AND THEY ARE THE WHO OF THE COUPLING. `hostPoint` is the harness's event names; the scope
    // rule is ours and is not about a session format, so a second host may bind the same one.
    describePoint: hostPoint,
    observed: sessionObserved,
  })
}
