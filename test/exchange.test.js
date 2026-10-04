// G0 -- THE EXCHANGE. See `docs/measurement-depth.md`: what the human asked and what came back, with the working
// record left out. Two things make it non-trivial and both are measured: the human is not every `user/message`, and
// the answer is the turn's LAST word rather than its first.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyGroups, exchangesOf, excludedOperators, isHumanMessage, messageEventsOf, selectedEvents, selectionNote, turnEvents } from '../lib/exchange.js'

const human = (seq, text) => ({ seq, type: 'user/message', data: { content: [{ type: 'text', text }], source: { kind: 'user' } } })
const injected = (seq, text, kind) => ({ seq, type: 'user/message', data: { content: [{ type: 'text', text }], source: { kind } } })
const said = (seq, turn, text) => ({ seq, type: 'assistant/message', data: { turn, message: { content: [{ type: 'text', text }] } } })
const called = (seq, turn) => ({ seq, type: 'tool/call', data: { turn, name: 'bash', arguments: '{"command":"ls"}' } })
const returned = (seq, turn, text) => ({ seq, type: 'tool/result', data: { turn, message: { content: [{ type: 'text', text }] } } })

const SESSION = [
  injected(1, 'The approval policy changed from ask to never', 'user-approval'),
  human(2, 'I am playing, check the game saved. Review my cities.'),
  injected(3, '<system-reminder> a skill is a reusable set ...', 'skill-catalog'),
  said(4, 36, 'Let me find the most recent save.'),
  called(5, 36),
  returned(6, 36, 'save parsed: 24 cities'),
  said(7, 36, 'Wait, those numbers do not add up.'),
  said(8, 36, '🎯 Found it. city_population() is size x (size+1) x 5.'),
  human(9, 'now do the units'),
]

test('the human is NOT every user/message: the harness injects on the same event type', () => {
  assert.equal(isHumanMessage(human(1, 'x')), true)
  assert.equal(isHumanMessage(injected(1, 'x', 'skill-catalog')), false)
  assert.equal(isHumanMessage(injected(1, 'x', 'user-approval')), false)
  // A MISSING SOURCE IS NOT THE HUMAN, and it is reported rather than silently dropped.
  assert.equal(isHumanMessage({ seq: 1, type: 'user/message', data: { content: [{ type: 'text', text: 'x' }] } }), false)
  assert.equal(isHumanMessage({ seq: 1, type: 'assistant/message', data: {} }), false)
})

test('what a G0 reading LEAVES OUT is counted and sized, so the reading can say so', () => {
  const excluded = excludedOperators(SESSION)
  assert.deepEqual(excluded.map((e) => e.kind), ['skill-catalog', 'user-approval'])
  // THE CHARACTERS MATTER: in a live session 8 harness messages carried 15,521 chars against the human's 3,868.
  assert.equal(excluded.reduce((n, e) => n + e.chars, 0) > 50, true)
  assert.equal(excludedOperators([human(1, 'hello')]).length, 0)
})

test('the ANSWER is the turn\'s LAST word, and an ask with no turn after it is kept as unanswered', () => {
  const exchanges = exchangesOf(SESSION)
  assert.equal(exchanges.length, 2)
  assert.deepEqual(exchanges[0].asked.map((e) => e.seq), [2], 'the ask attaches to the turn that answers it')
  assert.equal(exchanges[0].answered.seq, 8, 'the 8th event, not the 4th: narration is G1 evidence')
  assert.equal(exchanges[0].turn, 36)
  assert.equal(exchanges[1].unanswered, true, 'a trailing request is a finding, not a dropped row')
  assert.deepEqual(exchanges[1].asked.map((e) => e.seq), [9])
})

test('the G0 selection is the exchange and nothing between', () => {
  assert.deepEqual(selectedEvents(SESSION).events.map((e) => e.seq), [2, 8, 9])
  assert.deepEqual(selectedEvents(SESSION, { turn: 36 }).events.map((e) => e.seq), [2, 8])
  assert.deepEqual(selectedEvents(SESSION, { turn: 36 }).total, 2, 'the count of ALL exchanges, so a reading knows what it did not measure')
  // AND G1 FOR ONE TURN is the working record of that exchange -- what the old lastMessages/offset arithmetic could
  // not express when the ask and the answer were separated by 27 messages of machinery.
  assert.deepEqual(turnEvents(SESSION, 36).map((e) => e.seq), [2, 4, 5, 6, 7, 8])
  assert.deepEqual(messageEventsOf(turnEvents(SESSION, 36)).map((e) => e.seq), [2, 4, 7, 8])
})

test('a group this build cannot compose is REFUSED, not approximated', () => {
  // THE REFUSAL IS THE FEATURE. Sending G1 evidence under G2's name would be the substitution this repository refuses
  // everywhere else, and the reading would look exactly like a real one.
  assert.match(applyGroups({ events: SESSION, groups: ['G2'] }).problem, /G2 cannot be composed by this build/)
  assert.match(applyGroups({ events: SESSION, groups: ['G3'] }).problem, /only G0 and G1 are selectable/)
  assert.match(applyGroups({ events: SESSION, groups: ['g9'] }).problem, /unknown evidence group `G9`/)
  // A TURN THAT DOES NOT EXIST NAMES THE ONES THAT DO, rather than measuring an empty window.
  assert.match(applyGroups({ events: SESSION, groups: ['G0'], turn: 99 }).problem, /no turn 99 .*exchange\(s\), turns 36/)
  // AND A WINDOW WITH NO HUMAN MESSAGE AT ALL SAYS WHY.
  assert.match(applyGroups({ events: [said(1, 1, 'hi')], groups: ['G0'] }).problem, /no message from the human/)
})

test('G0 + G1 is the working record, so naming both keeps the previous behaviour exactly', () => {
  const both = applyGroups({ events: SESSION, groups: ['G0', 'G1'] })
  assert.equal(both.problem, null)
  assert.equal(both.events.length, SESSION.length, 'every event: nothing is dropped when the caller asks for the record')
  const none = applyGroups({ events: SESSION })
  assert.equal(none.events.length, SESSION.length, 'and naming no group is the same thing')
  assert.equal(none.groups, null)
})

test('the render names the evidence and the exclusions', () => {
  const out = applyGroups({ events: SESSION, groups: ['G0'], turn: 36 })
  const note = selectionNote({ groups: out.groups, turn: out.turn, exchange: out.exchange })
  assert.match(note, /EVIDENCE: G0, turn 36 -- 1 of 2 exchange\(s\)/)
  assert.match(note, /EXCLUDED 2 harness `user\/message`\(s\) worth \d+ chars \(skill-catalog 1, user-approval 1\)/)
  // WITH NO GROUP NAMED THERE IS NOTHING TO SAY, rather than a line about the default.
  assert.equal(selectionNote({ groups: null, turn: null, exchange: null }), '')
})
