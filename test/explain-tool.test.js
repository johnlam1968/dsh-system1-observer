// THE EXPLANATION MUST EQUAL THE RUNTIME, NOT DESCRIBE IT.
//
// `lib/explain-tool.js` exists because an agent on a task reads its tool list and not the README. That makes it a
// SECOND place where this plugin's facts are written down -- and this repository has paid twice for a second copy that
// drifted (a README row naming a seam-to-event map `lib/seams.js` no longer had; a comment promising a probe fallback
// the code never had, `F123`). So the tool DERIVES what can be read: the writable/mount-bound split comes from the
// schema's own `volatile` metadata, the live values from the config it is handed, the sets from the directory.
//
// THIS FILE ASSERTS THE EQUALITY, against the REAL schema (`plugin.Config.dict`), so a knob added or made volatile
// tomorrow appears in the explanation without anybody remembering to write it down -- and the day the two disagree,
// this fails rather than the reader being misled.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import plugin from '../index.js'
import { EXPLAIN_TOOL_NAME, TOOL_SUMMARIES, createExplainTool, explainFacts } from '../lib/explain-tool.js'
import { assertValidOutput } from './tool-output-validated.js'

const dict = plugin.Config.dict
const volatileFromSchema = Object.keys(dict).filter((name) => dict[name]?.meta?.volatile === true).sort()
const mountBoundFromSchema = Object.keys(dict).filter((name) => dict[name]?.meta?.volatile !== true).sort()

const toolFor = (config = {}) => createExplainTool({
  facts: () => explainFacts({ dict, config, tracePath: '/tmp/trace.jsonl', measurementsDir: '/tmp/packages', tools: [{ name: 'system1_settings', what: TOOL_SUMMARIES.system1_settings }] }),
})

test('the live-writable list IS the schema\'s volatile set -- derived, so it cannot drift', () => {
  const value = explainFacts({ dict, config: {} })
  assert.deepEqual(value.agentWritable, volatileFromSchema)
  // AND IT IS NOT EVERYTHING: a list that named every field would be wrong in the way that matters most, because the
  // agent would try to write a mount-bound one and be refused.
  assert.equal(value.agentWritable.includes('probeQuestion'), false)
  assert.equal(value.agentWritable.length, 42, 'measured on this schema: 42 of 44')
})

test('the mount-bound list IS the schema\'s non-volatile set, each with its reason', () => {
  const value = explainFacts({ dict, config: {} })
  assert.deepEqual(value.mountBound.map((entry) => entry.name), mountBoundFromSchema)
  assert.deepEqual(value.mountBound.map((entry) => entry.name), ['probeQuestion', 'tracePath'])
  // The REASONS are prose and cannot be derived, so they are asserted to say the thing that makes them mount-bound.
  const byName = Object.fromEntries(value.mountBound.map((entry) => [entry.name, entry.reason]))
  assert.match(byName.probeQuestion, /hash|MOUNT line|instrument/i)
  assert.match(byName.tracePath, /opened once|applied|MOUNT line/i)
})

test('the reported live state is the config it was handed, including what is OFF', () => {
  const value = explainFacts({ dict, config: { callsEnabled: false, seamEnabled: { assemble: false, draft: false }, sessions: ['*'], questionSet: '', turnEveryNTurns: 7, observeSubagents: true } })
  assert.equal(value.live.callsEnabled, false)
  // THE TEXTLESS SEAMS ARE NOT IN THE OFF LIST: `request` and `close` carry no text, so they are inapplicable rather
  // than switched off, and a list that could not tell those apart would report a decision nobody made.
  assert.deepEqual(value.live.seamsOff, ['assemble', 'draft'])
  assert.deepEqual(value.live.sessions, ['*'])
  assert.equal(value.live.questionSet, '')
  assert.equal(value.live.turnEveryNTurns, 7)
  assert.equal(value.live.observeSubagents, true)
})

test('it never throws, whatever it is handed', () => {
  // A tool whose purpose is to be safe to call FIRST must not be the one that fails on a half-built config.
  for (const config of [undefined, null, {}, { sessions: 'not an array' }, { seamEnabled: 42 }]) {
    assert.doesNotThrow(() => explainFacts({ dict, config }))
  }
  assert.deepEqual(explainFacts({}).agentWritable, [], 'no schema, no claims')
  assert.equal(explainFacts({}).live.seamsOff.length, 0)
})

test('the tool\'s value is one the harness ACCEPTS, and its render says the four things an agent needs', async () => {
  const tool = toolFor({ sessions: ['session-a'], seamEnabled: { admit: false }, questionSet: 'session@1', turnEveryNTurns: 5 })
  const value = await tool.execute({}, {})
  assertValidOutput(tool, value, 'the brief')
  assert.equal(tool.name, EXPLAIN_TOOL_NAME)
  const text = tool.output.render({}, value)[0].text
  assert.match(text, /WRITABLE LIVE \(42\)/)
  assert.match(text, /MOUNT-BOUND: probeQuestion/)
  assert.match(text, /SET NOW:/)
  assert.match(text, /set in force: session@1/)
  assert.match(text, /BEFORE YOU TRUST A READING:/)
  // THE CAUTIONS ARE THE POINT OF THE TOOL, so the ones a reading actually depends on are asserted by content.
  assert.match(text, /segmentChars: 57600/, 'the cap, and the way out of it')
  assert.match(text, /DISABLES THE PROBE/, 'a session-only set turns the seam probe off (F123)')
  assert.match(text, /DEPENDS ON THE SEAM MIX/, 'the probe pairs share a text (F121)')
})

test('every tool this plugin registers has a summary, and the name list is the plugin\'s own', () => {
  // The registered names come from the modules in `index.js`; this asserts the PROSE side is complete for them, so a
  // tenth tool cannot be added with an empty line where an agent would read what it is for.
  for (const name of Object.keys(TOOL_SUMMARIES)) {
    assert.match(name, /^system1_/, name + ' is in the system1_ namespace')
    assert.ok(TOOL_SUMMARIES[name].length > 30, name + ' says what it is for')
  }
  assert.equal(Object.keys(TOOL_SUMMARIES).length, 9, 'eight measured tools and this brief')
  assert.match(TOOL_SUMMARIES[EXPLAIN_TOOL_NAME], /brief|what/i)
})

test('the cancellation contract is honoured at the entry', async () => {
  await assert.rejects(() => toolFor().execute({}, { signal: { aborted: true } }), /cancelled before it started/)
})
