import { test } from 'node:test'
import assert from 'node:assert/strict'
import { observesEverySession, readSessions, sessionObserved } from '../lib/sessions.js'

const accessor = (value) => ({ get: () => value })

test('an absent, non-array or junk list reads as no restriction', () => {
  assert.deepEqual(readSessions({}), [])
  assert.deepEqual(readSessions({ sessions: accessor(undefined) }), [])
  assert.deepEqual(readSessions({ sessions: 'session-aaa' }), [], 'a bare string is not a list')
  assert.deepEqual(readSessions({ sessions: 42 }), [])
  assert.deepEqual(readSessions({ sessions: [] }), [])
})

// ABSENT AND EMPTY ARE DIFFERENT ANSWERS, and the schema default is what makes that possible: `Schema.array`
// MATERIALISES to `[]` for a field nobody has written, so without a default "never configured" and "configured
// to observe nothing" would be the same value and one of them would have to be wrong. The default is the
// wildcard, and this mirrors it at the library level so a caller that bypasses resolution gets the same answer
// a running row does.
test('an ABSENT field observes everything (the schema default); an EMPTY list observes nothing', () => {
  assert.equal(sessionObserved({}, 'session-anything'), true, 'absent = the declared default = the wildcard')
  assert.equal(observesEverySession({}), true)
  assert.equal(sessionObserved({ sessions: [] }, 'session-anything'), false, 'emptied = the one explicit way to observe nothing')
  assert.equal(sessionObserved({ sessions: accessor([]) }, 'session-anything'), false)
  assert.equal(observesEverySession({ sessions: [] }), false)
})

test('a non-empty list observes only matching sessions, by full id or prefix', () => {
  const config = { sessions: ['session-fedcba98-7654-4321'] }
  assert.equal(sessionObserved(config, 'session-fedcba98-7654-4321-0fed-cba987654321'), true, 'a prefix matches')
  assert.equal(sessionObserved(config, 'session-fedcba98-7654-4321'), true, 'and so does the whole id')
  assert.equal(sessionObserved(config, 'session-other'), false)
  assert.equal(sessionObserved(config, 'session-fedcba98-7654-4322'), false, 'a prefix is not a fuzzy match')
})

test('entries are trimmed, deduplicated, and blanks dropped', () => {
  const config = { sessions: ['  session-aaa  ', 'session-aaa', '', '   ', 'session-bbb', 7, null] }
  assert.deepEqual(readSessions(config), ['session-aaa', 'session-bbb'])
  assert.equal(sessionObserved(config, 'session-bbb-1'), true)
})

// FAIL CLOSED. `draft` reads `ctx.agents.currentInitiator()`, which answers `undefined` outside an initiator
// boundary. Observing an unattributable firing would defeat the point of a session-scoped row -- and now that
// an empty list observes nothing, there is no state in which an unknown agent is observed.
test('an unknown agent is never observed once a specific list is in force', () => {
  for (const unknown of [undefined, null, '', 42]) {
    assert.equal(sessionObserved({ sessions: ['session-aaa'] }, unknown), false, `${String(unknown)} must not pass a filter`)
    assert.equal(sessionObserved({ sessions: [] }, unknown), false, 'and an empty list observes nothing at all')
    assert.equal(sessionObserved({ sessions: ['*'] }, unknown), true, 'the wildcard is the one thing that covers it')
  }
})

test('the config field may arrive as a volatile accessor', () => {
  assert.equal(sessionObserved({ sessions: accessor(['session-aaa']) }, 'session-aaa'), true)
  assert.equal(sessionObserved({ sessions: accessor(['session-aaa']) }, 'session-bbb'), false)
})

// AN ENTRY MAY CARRY A TITLE, AND THE TITLE IS NEVER MATCHED ON. It exists so the settings card can show
// "test session" instead of a uuid. If matching ever consulted it, renaming a session would silently stop it
// being observed -- and this decides whether text reaches a model.
test('an entry may be `{ id, title }`, and only the id is matched or listed', () => {
  const config = { sessions: [{ id: 'session-aaa', title: 'test session' }] }
  assert.deepEqual(readSessions(config), ['session-aaa'], 'the title is dropped from the list the gate uses')
  assert.equal(sessionObserved(config, 'session-aaa-1'), true)
  assert.equal(sessionObserved(config, 'session-bbb'), false)
})

test('the title cannot make a session observed: matching is on the id alone', () => {
  const config = { sessions: [{ id: 'session-aaa', title: 'session-bbb' }] }
  assert.equal(sessionObserved(config, 'session-bbb'), false, 'a title that looks like another id must not match')
  assert.equal(sessionObserved(config, 'session-aaa'), true)
})

test('both shapes may be mixed, and a malformed entry is ignored rather than trusted', () => {
  const config = { sessions: ['session-one', { id: 'session-two', title: 'two' }, { title: 'no id' }, { id: '' }, 42, null, { id: '  session-two  ' }] }
  assert.deepEqual(readSessions(config), ['session-one', 'session-two'], 'deduplicated across shapes, trimmed, junk dropped')
})

// THE WILDCARD. `[]` could not mean both "nobody has configured this" and "configured to observe nothing", and
// per-session opt-in needed the second -- so "everything" became a state a person can SEE and remove, and the
// schema defaults to it. This is the one gate in the row whose absence would otherwise mean OFF.
test('the wildcard observes every session, whatever the id, and is the schema default', () => {
  const config = { sessions: ['*'] }
  assert.equal(sessionObserved(config, 'session-anything'), true)
  assert.equal(sessionObserved(config, undefined), true, 'every session includes an unattributable firing')
  assert.equal(observesEverySession(config), true)
})

test('the wildcard beside a specific entry still observes everything, and lists only that entry', () => {
  const config = { sessions: ['*', { id: 'session-aaa', title: 'a' }] }
  assert.equal(sessionObserved(config, 'session-zzz'), true, 'the wildcard wins')
  assert.deepEqual(readSessions(config), ['*', 'session-aaa'])
})

test('an emptied list is the one state that observes nothing, and the wildcard is how you leave it', () => {
  assert.equal(sessionObserved({ sessions: [] }, 'session-anything'), false)
  assert.equal(observesEverySession({ sessions: [] }), false)
  assert.equal(sessionObserved({ sessions: ['*'] }, 'session-anything'), true)
  assert.equal(observesEverySession({ sessions: ['*'] }), true)
})
