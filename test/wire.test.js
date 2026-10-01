// THE TRANSPORT'S CANCELLATION, WHICH NOTHING TESTED.
//
// `lib/model/wire.js` has honoured an external signal since it was written -- it forwards the caller's abort to its
// own controller and, at line 31, deliberately tells a cancellation from a timeout. `adding-a-tool.md:49` makes
// honouring `exec.signal` the tool's obligation, and delta 6b was about the wiring between them; these two tests pin
// the transport end of it, because the distinction is load-bearing: a caller's cancel reported as "timed out" sends
// an operator looking for a slow backend that is not there.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { postSystemone } from '../lib/model/wire.js'

/** A fetch that never answers on its own, and rejects when the signal it was given aborts. */
const untilAborted = (_url, init) => new Promise((_resolve, reject) => {
  init.signal.addEventListener('abort', () => {
    const error = new Error('the operation was aborted')
    error.name = 'AbortError'
    reject(error)
  })
})

test('an external abort ends the request, and is NOT reported as a timeout', async () => {
  const controller = new AbortController()
  const call = postSystemone({
    baseUrl: 'http://127.0.0.1:1', state: 'x', questions: [], fetch: untilAborted,
    timeoutMs: 60_000, signal: controller.signal,
  })
  setTimeout(() => controller.abort(), 10)
  const result = await call
  assert.equal(result.kind, 'error')
  assert.doesNotMatch(String(result.reason), /timed out/,
    'a caller cancel must not read as a slow backend: ' + result.reason)
})

test('a timeout still reads as a timeout', async () => {
  const result = await postSystemone({
    baseUrl: 'http://127.0.0.1:1', state: 'x', questions: [], fetch: untilAborted, timeoutMs: 20,
  })
  assert.equal(result.kind, 'error')
  assert.match(String(result.reason), /timed out after 20 ms/, 'the timeout keeps its own message: ' + result.reason)
})
