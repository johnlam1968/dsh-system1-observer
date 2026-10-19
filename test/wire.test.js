// THE TRANSPORT'S CANCELLATION, WHICH NOTHING TESTED.
//
// `core/model/wire.js` has honoured an external signal since it was written -- it forwards the caller's abort to its
// own controller and, at line 31, deliberately tells a cancellation from a timeout. `adding-a-tool.md:49` makes
// honouring `exec.signal` the tool's obligation, and delta 6b was about the wiring between them; these two tests pin
// the transport end of it, because the distinction is load-bearing: a caller's cancel reported as "timed out" sends
// an operator looking for a slow backend that is not there.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { postSystemone } from '../core/model/wire.js'

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

// THE ENDPOINT, OR A NAMED REFUSAL.
//
// `baseUrl` used to be stringified straight into the URL, so a caller that named none posted to `undefined/v1/systemone`
// and the answer was `Failed to parse URL from undefined/v1/systemone` -- which arrived as a PER-QUESTION error and
// read like the model had declined. A missing endpoint is a configuration fault, and it is named as one now, at the
// layer that would otherwise have posted it. The string "undefined" must never reach `fetch`.
test('a missing endpoint is refused BY NAME, and nothing is posted', async () => {
  for (const baseUrl of [undefined, null, '', '   ']) {
    let asked = null
    const result = await postSystemone({
      baseUrl, state: 'x', questions: [],
      fetch: async (url) => { asked = url; return { ok: true, json: async () => ({ answers: {} }) } },
    })
    assert.equal(result.kind, 'error', `a blank endpoint is refused: ${JSON.stringify(baseUrl)}`)
    assert.match(String(result.reason), /no endpoint was named/, 'the fault is named: ' + result.reason)
    assert.equal(asked, null, `nothing was posted for ${JSON.stringify(baseUrl)}`)
  }
})

test('the endpoint the wire posts to is the one the caller named, with the path appended', async () => {
  let asked = null
  const result = await postSystemone({
    baseUrl: 'http://127.0.0.1:9/', state: 'x', questions: {},
    fetch: async (url) => { asked = url; return { ok: true, json: async () => ({ answers: {} }) } },
  })
  assert.equal(result.kind, 'ok')
  assert.equal(asked, 'http://127.0.0.1:9/v1/systemone', 'one trailing slash does not become two')
})
