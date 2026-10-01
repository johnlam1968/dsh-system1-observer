// DELTA 3: A TRACE PATH NOBODY CAN WRITE MUST FAIL THE LOAD, NOT RECORD NOTHING QUIETLY.
//
// config.md:96-98 makes configuration errors loud; framework/index.md:24 makes the documented outcome FAILED; and
// extra/testing.md:40 gives the documented test -- "assert a genuinely-missing config exits non-zero". In-process
// this asserts the half that decides the exit code: `apply` REJECTS. Before the probe existed, `mkdirSync` ran
// inside the sink's own catch, so a wrong path produced a row that looked healthy and recorded nothing at all --
// the worst outcome this plugin has, because its whole purpose is the record.
//
// The blocker is a FILE where a DIRECTORY must be. That needs no permissions and no root, so the test behaves the
// same on every machine and says the same thing whichever filesystem it runs on.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import plugin from '../index.js'

const AGENT = { id: 'session-a', session: { snapshotEvents: () => [] } }

function context() {
  return {
    on: () => () => {},
    inject: () => {},
    provide: () => () => {},
    get: () => undefined,
    agents: { currentInitiator: () => AGENT },
  }
}

const configFor = (tracePath) => ({ hooks: [], sessions: ['*'], turnEveryNTurns: 0, questions: { turn: [] }, tracePath })

test('apply refuses a trace path it cannot write, naming the path', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'trace-path-'))
  const blocker = join(dir, 'blocker')
  writeFileSync(blocker, 'a file where a directory must be\n')
  const tracePath = join(blocker, 'trace.jsonl')

  await assert.rejects(plugin.apply(context(), configFor(tracePath)), (error) => {
    assert.match(error.message, /cannot write the trace/, 'the failure says what failed')
    assert.ok(error.message.includes(tracePath), 'and names the path, so an operator can fix it: ' + error.message)
    return true
  })
})

test('apply proves the path by creating the file, and loads when it can', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'trace-path-ok-'))
  const tracePath = join(dir, 'nested', 'trace.jsonl')
  await plugin.apply(context(), configFor(tracePath))
  assert.ok(existsSync(tracePath), 'a probe that reports writable is worth less than one that has written')
})
