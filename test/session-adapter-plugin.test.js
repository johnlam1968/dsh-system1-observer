// THE ADAPTER AS A PLUGIN: the same functions, provided as a service for a consumer that injects rather than imports.
//
// Two forms of one implementation is deliberate and measured (`F104`): the in-band path must IMPORT (a composer inside a
// synchronous seam cannot await a service), and a second consumer should be able to inject. The host arrives as a
// parameter either way, so nothing here calls `ctx`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SESSION_ADAPTER_SERVICE, apply, createSessionAdapter, name } from 'dsh-session-adapter'

function fakeCtx({ query } = {}) {
  const provided = new Map()
  return {
    provided,
    provide: (serviceName, value) => { provided.set(serviceName, value); return () => provided.delete(serviceName) },
    get: (serviceName) => (serviceName === 'sessionQuery' ? query : undefined),
  }
}

const event = (seq, text) => ({ type: 'assistant/message', seq, time: seq, data: { message: { content: [{ type: 'text', text }] } } })

function fakeQuery() {
  const calls = []
  return {
    calls,
    async readSession(sessionId) { calls.push(['readSession', sessionId]); return { session: { id: sessionId, cwd: '/tmp', createdAt: 1 }, inheritedEventCount: 0, events: [event(1, 'hello')] } },
    async listSessions() { calls.push(['listSessions']); return [{ header: { id: 's1', cwd: '/tmp' } }] },
    async filterEvents(sessionId, filters) { calls.push(['filterEvents', sessionId, filters]); return [{ seq: 1 }] },
    async searchSessions(request) { calls.push(['searchSessions', request]); return { items: [{ header: { id: 's1' } }] } },
  }
}

test('the adapter is a PLUGIN, and the service is registered as a CLASS', async () => {
  assert.equal(name, 'session-adapter')
  assert.equal(SESSION_ADAPTER_SERVICE, 'sessionAdapter')
  const { Context, Service } = await import('@deepseek-ai/cordis')
  // WHAT `apply` MOUNTS: a class, and one the harness recognises as a service.
  const mounted = []
  apply({ plugin: (plugin) => { mounted.push(plugin); return { dispose() {} } }, get: () => undefined }, {})
  assert.equal(mounted.length, 1, 'apply mounts exactly one thing')
  assert.equal(typeof mounted[0], 'function', 'and it is a class, not a plain object')
  assert.ok(mounted[0].prototype instanceof Service, 'which IS a Service subclass -- what the catalogue needs (F107)')
  // AND REGISTRATION, on a real Context: the constructor is what puts it under its documented name.
  const ctx = new Context()
  new (mounted[0])(ctx)
  const service = ctx.get(SESSION_ADAPTER_SERVICE)
  assert.ok(service !== undefined, 'registered under its documented name')
  for (const method of ['readSession', 'listSessions', 'currentSurfaceSeqs', 'search', 'available']) {
    assert.equal(typeof service[method], 'function', method + ' is part of the capability')
  }
  // AND THE VOCABULARY IS ON IT, so a consumer that injects needs no second import to read what it got
  for (const member of ['SUBJECT_KINDS', 'DEFAULT_KINDS', 'eventTypesOf', 'sliceEvents', 'coverageOf']) {
    assert.ok(service[member] !== undefined, member + ' travels with the service')
  }
  // AND THE INVENTORY IS TRUE OF THE SOURCE: the services this package reaches are the ones it declares.
  const { HOST_SERVICES } = await import('dsh-session-adapter')
  const source = await (await import('node:fs/promises')).readFile(new URL('../packages/session-adapter/index.js', import.meta.url), 'utf8')
  const reached = [...source.matchAll(/ctx\.get\('([A-Za-z]+)'\)/g)].map((m) => m[1])
  assert.deepEqual([...new Set(reached)].sort(), [...HOST_SERVICES].sort(), 'HOST_SERVICES is exactly what the source reaches')
})

test('every method delegates to the host, read AT CALL TIME', async () => {
  const query = fakeQuery()
  const service = createSessionAdapter({ getQuery: () => query })
  assert.equal(service.available(), true)
  const read = await service.readSession('s1', { kinds: ['assistant'] })
  assert.equal(read.session.id, 's1')
  assert.equal(read.messages.length, 1)
  assert.equal((await service.listSessions()).sessions[0].id, 's1')
  assert.deepEqual(await service.currentSurfaceSeqs('s1'), [1])
  assert.deepEqual((await service.search({ query: 'x', limit: 5 })).items.length, 1)
  assert.deepEqual(query.calls.map((call) => call[0]), ['readSession', 'listSessions', 'filterEvents', 'searchSessions'])
  assert.deepEqual(query.calls[2], ['filterEvents', 's1', [{ kind: 'surface', values: ['current'] }]], 'the documented filter, not a guess')
  // READ AT CALL TIME: a host that mounts AFTER this service is found, because nothing captured it at apply
  let late
  const lateService = createSessionAdapter({ getQuery: () => late })
  assert.equal(lateService.available(), false)
  late = query
  assert.equal(lateService.available(), true)
})

test('a deployment with NO host service gets named absences, never a silent empty', async () => {
  const service = createSessionAdapter({ getQuery: () => undefined })
  assert.equal(service.available(), false)
  const read = await service.readSession('s1')
  assert.match(read.problem, /no session-query service is mounted/)
  assert.equal(await service.search({ query: 'x' }), null, 'null, not an empty result: the caller decides what to fall back to')
  assert.equal(await service.currentSurfaceSeqs('s1'), null, 'and null leaves the fold in charge')
})
