import { test } from 'node:test'
import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { resolveTracePath } from '../index.js'

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
