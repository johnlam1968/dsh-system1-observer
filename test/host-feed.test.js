// THE FEED'S CONTRACT, tested away from the harness: bounded, attributable, and never throwing on junk -- because it
// runs inside a listener the harness awaits, where a throw is a broken turn rather than a failed test.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createEventFeed } from '../lib/host/feed.js'

const ev = (seq) => ({ seq, type: 'user/message', data: { message: { role: 'user', content: [] } } })

test('the feed holds events per session, oldest first, and hands back a copy that cannot corrupt it', () => {
  const feed = createEventFeed()
  feed.record('s1', ev(1)); feed.record('s1', ev(2)); feed.record('s2', ev(9))
  assert.deepEqual(feed.events('s1').map((e) => e.seq), [1, 2], 'in order, and only this session')
  assert.deepEqual(feed.events('s2').map((e) => e.seq), [9])
  assert.deepEqual(feed.events('unknown'), [], 'an unknown session is an empty list, never undefined')
  assert.equal(feed.size('s1'), 2)
})

test('the feed is BOUNDED, dropping the oldest rather than growing without limit', () => {
  const feed = createEventFeed({ maxPerSession: 3 })
  for (let i = 1; i <= 6; i += 1) feed.record('s', ev(i))
  assert.deepEqual(feed.events('s').map((e) => e.seq), [4, 5, 6], 'the newest survive, because the composer reads those')
  assert.equal(feed.size('s'), 3)
})

test('junk is refused rather than stored or thrown on', () => {
  const feed = createEventFeed()
  assert.equal(feed.record(null, ev(1)), false)
  assert.equal(feed.record('s', null), false)
  assert.equal(feed.record('s', 'not an event'), false)
  assert.equal(feed.record('', ev(1)), false)
  assert.deepEqual(feed.events('s'), [], 'nothing was stored by any of them')
  assert.equal(feed.size(null), 0)
  assert.deepEqual(feed.events(undefined), [])
})

// DELETED, NOT TESTED: `claim`/`reactionFor` and the `claimed` map they held. An independent review called them dead
// surface and it was right -- the only callers in the repository were this file's own test. The row keeps its own copy
// of the announced request, and its readers go through the session store; a second, unwired holder of the same fact
// is a thing a future reader has to rule out.

test('clear forgets one session and leaves the others alone', () => {
  const feed = createEventFeed()
  feed.record('a', ev(1)); feed.record('b', ev(1))
  assert.equal(feed.clear('a'), true)
  assert.deepEqual(feed.events('a'), [])
  assert.equal(feed.size('b'), 1, 'b is untouched')
  assert.equal(feed.clear(null), false)
})
