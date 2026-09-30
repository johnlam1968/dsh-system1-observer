// THE EGRESS CONTRACT: what leaves, where it goes, and what the row will not admit to by omission.
//
// The plugin sends operator text and raw tool output to a third party at up to seven seams per turn, and the
// mount line used to record everything about the run EXCEPT that. An operator could not answer "what does
// turning this on send?" without reading the source.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EGRESS_SEAMS, egressFacts, egressLines, egressSummary } from '../lib/egress.js'
import { PROBE_SEAMS } from '../lib/seams.js'

const BASE = {
  transport: 'service', endpoint: 'provider:typesafe', model: 'jev-latest',
  callsEnabled: true, maxFieldChars: 20000, maxQuestionChars: 4000,
  hooks: ['assemble', 'admit', 'draft'], seamsOff: ['assemble'],
  sessions: ['*'], observeSubagents: false, includeNonOperatorFacing: false,
}

test('the contract covers the seven seams that can send, not the nine that exist', () => {
  assert.equal(EGRESS_SEAMS.length, 7)
  assert.deepEqual(PROBE_SEAMS.filter(seam => !EGRESS_SEAMS.includes(seam)), ['request', 'close'])
  const facts = egressFacts(BASE)
  assert.equal(facts.seams.length, 7)
  assert.equal(facts.transport, 'service')
  assert.equal(facts.endpoint, 'provider:typesafe')
  assert.equal(facts.egress, true)
})

// THREE WAYS A SEAM CAN BE OFF, AND THE CONTRACT NAMES WHICH ONE. "Not sending" for the wrong reason is how an
// operator concludes the row is broken when it is merely switched off -- or vice versa.
test('each seam says whether it sends, and why not when it does not', () => {
  const facts = egressFacts(BASE)
  const of = seam => facts.seams.find(entry => entry.seam === seam)
  assert.equal(of('draft').sends, true)
  assert.match(of('draft').fields, /state\.hook<=12c state\.text<=20000c questions<=4000c/)
  assert.equal(of('assemble').sends, false, 'switched off at this seam')
  assert.match(of('assemble').because, /switched off at this seam/)
  assert.equal(of('execute').sends, false, 'not in this run’s hooks at all')
  assert.match(of('execute').because, /not in `hooks`/)
})

// WHETHER A SEAM ACTUALLY ASKS ANYTHING IS DECIDED PER FIRING, and the contract must not imply otherwise: a seam
// with no configured question records a skip. The per-firing `reason` stays the authority.
test('a sending seam is marked conditional, because the question is decided per firing', () => {
  const facts = egressFacts(BASE)
  const draft = facts.seams.find(entry => entry.seam === 'draft')
  assert.match(draft.conditional, /if a question is configured/)
})

// THE UNBOUNDED TERM IS THE POINT. A contract that lists only the fields under control is a contract designed to
// look good -- `maxFieldChars` bounds `state.text` alone, and the question text was unbounded until the cap.
test('an uncapped question text reads UNBOUNDED rather than being omitted', () => {
  const unbounded = egressFacts({ ...BASE, maxQuestionChars: null })
  assert.equal(unbounded.questionCapChars, null)
  assert.match(unbounded.seams.find(entry => entry.seam === 'draft').fields, /questions<=UNBOUNDED/)
  assert.match(egressSummary(unbounded), /questions UNBOUNDED/)
  assert.match(egressSummary(egressFacts(BASE)), /questions<=4000c/, 'and the capped case says the cap')
})

test('the master switch produces an OFF contract that still names what it is suppressing', () => {
  const off = egressFacts({ ...BASE, callsEnabled: false })
  assert.equal(off.egress, false)
  assert.match(off.reason, /no request is made/)
  assert.equal(off.seams.every(seam => seam.sends === false), true)
  assert.equal(off.seams.every(seam => seam.because === 'callsEnabled=false'), true)
  const rendered = egressLines(off).join('\n')
  assert.match(rendered, /egress=OFF \(calls disabled: no request is made; every seam records a skip\)/)
  assert.doesNotMatch(rendered, /SENDS/, 'an OFF contract must not contain SENDS')
})

test('the rendered contract has the four shapes, and says what it cannot do', () => {
  const on = egressLines(egressFacts(BASE)).join('\n')
  assert.match(on, /^\[system1-observer\] transport=service endpoint=provider:typesafe model=jev-latest egress=ON$/m)
  assert.match(on, /SENDS {2}seam:draft +\{ state\.hook<=12c/)
  assert.match(on, /off {4}seam:assemble +\(switched off at this seam\)/)
  assert.match(on, /sessions=\* {2}subagents=no {2}non-operator streams=no/)
  assert.match(on, /redacted \(fields whose key names a secret/)
  assert.match(on, /the model still receives the raw text/)
  assert.match(on, /cannot recognise an unlabelled secret in free text/)
  // The switch that turns redaction off must be visible here, not only in the config.
  assert.match(egressLines(egressFacts({ ...BASE, redactEnabled: false })).join('\n'), /NO REDACTION/)
})

test('an emptied session list is NONE, not an omission', () => {
  const rendered = egressLines(egressFacts({ ...BASE, sessions: [] })).join('\n')
  assert.match(rendered, /sessions=NONE/)
  const unknown = egressLines(egressFacts({ ...BASE, sessions: null })).join('\n')
  assert.match(unknown, /sessions=\(not recorded\)/)
})

test('a renderer given nothing says so instead of throwing', () => {
  assert.deepEqual(egressLines(null), [])
  assert.match(egressSummary(undefined), /not recorded/)
})
