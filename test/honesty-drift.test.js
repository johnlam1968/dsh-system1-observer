// THE PLUGIN'S OWN SOURCE TOUCHES NONE OF THE FORBIDDEN SURFACES.
//
// "It decides nothing" is a claim about DECISIONS: the plugin never answers an approval, never rewrites what a tool
// receives, never injects resident context, never prunes, never routes a model. The moment somebody adds one of
// those because it seemed useful, this fails on the line they added.
//
// The scan and the list of surfaces live in the PACKAGE (`system1-measure/core/honesty.js`), because the posture is
// the measurement's, not the plugin's -- and the plugin is the thing that has to keep to it. The scan stays here
// because the files it reads are here: the plugin's entry and its Web UI half.
//
// BOTH ENTRY POINTS, wherever they live: naming one folder would let the other drift out of the guard silently,
// which is the failure this guard exists to make loud.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { capabilitiesIn } from 'system1-measure/core/honesty.js'

test('the plugin’s own source touches none of the forbidden surfaces', () => {
  for (const file of ['dsh/index.js', 'dsh/client.js']) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
    assert.deepEqual(capabilitiesIn(source), [], `${file} must not reach for a forbidden surface`)
  }
})
