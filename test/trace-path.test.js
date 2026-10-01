// WHERE THE TRACE GOES, AND WHAT HAPPENS WHEN IT CANNOT GO THERE.
//
// THIS FILE WAS OVERWRITTEN ONCE, BY ME, WITHOUT BEING READ. `test/trace-path.test.js` already existed and held
// five tests for `resolveTracePath` -- the precedence of DSH_HOME, an explicit tracePath, and the rule that the
// PACKAGE DIRECTORY is never the answer, because a published plugin's own directory is read-only on a global
// install and a write that fails there was once swallowed into a trace nobody received. Writing this file from
// scratch destroyed all five and replaced them with two. They are restored above the new ones, and the rule that
// was broken is the plainest one there is: read a file before overwriting it.
//
// The additions below are delta 3: a trace path nobody can write must FAIL THE LOAD rather than record nothing
// quietly. config.md:96-98 makes configuration errors loud, framework/index.md:24 makes the outcome FAILED, and
// extra/testing.md:40 gives the documented test -- a genuinely-missing configuration exits non-zero.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import plugin, { resolveTracePath } from '../index.js'

test('DSH_HOME wins, and lands the trace beside the harness’s own logs', () => {
  assert.equal(resolveTracePath({}, '/pkg', { DSH_HOME: '/home/x/.dsh' }), '/home/x/.dsh/logs/system1-observer.jsonl')
})

// THE PACKAGE DIRECTORY IS NEVER THE ANSWER. For a published plugin that path is inside `node_modules` --
// read-only on a global install, wiped by the next `npm install` otherwise -- and a write that fails there is
// swallowed by the best-effort evidence sink, so the failure mode was a plugin that silently produced no
// trace at all. The harness's own default home stands in for an unset DSH_HOME instead.
test('an unset DSH_HOME falls back to the harness’s default home, never the package directory', () => {
  const resolved = resolveTracePath({}, '/pkg', {})
  assert.equal(resolved, join(homedir(), '.dsh', 'logs', 'system1-observer.jsonl'))
  assert.doesNotMatch(resolved, /^\/pkg/, 'the package directory must not be written to')
})

test('a bare run with no home at all falls back to a writable temporary directory', () => {
  // `homedir()` throws when neither HOME nor the platform lookup can answer, which is the only case left.
  const resolved = resolveTracePath({}, '/pkg', { DSH_HOME: '' })
  assert.ok(resolved.endsWith(join('logs', 'system1-observer.jsonl')) || resolved.endsWith('system1-observer.jsonl'))
  assert.doesNotMatch(resolved, /^\/pkg/)
})

test('an explicit tracePath wins over DSH_HOME', () => {
  assert.equal(resolveTracePath({ tracePath: '/tmp/t.jsonl' }, '/pkg', { DSH_HOME: '/home/x/.dsh' }), '/tmp/t.jsonl')
})

test('a blank tracePath is not a path', () => {
  assert.equal(resolveTracePath({ tracePath: '   ' }, '/pkg', { DSH_HOME: '/h' }), '/h/logs/system1-observer.jsonl')
})

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
