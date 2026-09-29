import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveTracePath } from '../index.js'

test('the trace default follows the spec: DSH_HOME logs, else the package data directory', () => {
  assert.equal(resolveTracePath({}, '/pkg', { DSH_HOME: '/home/x/.dsh' }), '/home/x/.dsh/logs/system1-observer.jsonl')
  assert.equal(resolveTracePath({}, '/pkg', {}), '/pkg/data/system1-observer.jsonl')
})

test('an explicit tracePath wins over DSH_HOME', () => {
  assert.equal(resolveTracePath({ tracePath: '/tmp/t.jsonl' }, '/pkg', { DSH_HOME: '/home/x/.dsh' }), '/tmp/t.jsonl')
})

test('a blank tracePath is not a path', () => {
  assert.equal(resolveTracePath({ tracePath: '   ' }, '/pkg', { DSH_HOME: '/h' }), '/h/logs/system1-observer.jsonl')
})
