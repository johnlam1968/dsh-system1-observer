// THE INGESTER'S OWN FACTS, PINNED -- because all three of its first bugs were shape errors that produced a
// COMPLETE-LOOKING index: 498 sessions indexed, and every one of them with no cwd, no title provenance, and zero
// shadowed messages. Each assertion below is one of those failures.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildIndex, findSessions, foldSession, sessionFiles, sessionLines } from '../scripts/session-index.mjs'

/** A fixture session: header at the RECORD level, a title event whose `source` is an object, and a replace op. */
function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'session-index-'))
    const id = 'session-abc'
    const dir = join(root, '--home-john-CodingProjects-zeroclaw-voice-proxy--', id)
    mkdirSync(dir, { recursive: true })
    const lines = [
        { type: 'session', version: 4, id, createdAt: 1789873194109, cwd: '/home/john/CodingProjects/zeroclaw-voice-proxy' },
        { type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } },
        { type: 'user/message', seq: 2, time: 2, data: { turn: 1, source: { kind: 'user' }, content: [{ type: 'text', text: 'push this repo' }] } },
        { type: 'assistant/message', seq: 3, time: 3, data: { turn: 1, message: { content: [{ type: 'reasoning', text: 'think' }, { type: 'text', text: 'done' }] } } },
        { type: 'tool/call', seq: 4, time: 4, data: { callId: 'c1', name: 'bash', arguments: '{"command":"git push"}' } },
        // a compaction replaces the opening span, so seq 2 is withdrawn from the surface
        { type: 'user/message', seq: 9, time: 9, surfaceOp: { op: 'replace', startSeq: 2, endSeq: 4 }, data: { source: { kind: 'compact-checkpoint' }, content: 'summary of the above' } },
        { type: 'session/title', seq: 10, time: 10, data: { title: 'Push repo to GitHub account', messageSeqs: [2], source: { kind: 'provider', provider: 'session-title-first-prompt-llm' } } },
    ]
    writeFileSync(join(dir, 'session.v4.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
    return { root, id, dir }
}

test('the header record carries cwd and createdAt at the TOP level, and it is where a session gets them', () => {
    const f = fixture()
    try {
        const { text, sha256 } = sessionLines(join(f.dir, 'session.v4.jsonl'))
        const { row } = foldSession({ id: f.id, path: 'x', version: 4, text, sha256, bytes: 1 })
        assert.equal(row.cwd, '/home/john/CodingProjects/zeroclaw-voice-proxy')
        assert.equal(row.created_at, 1789873194109)
    } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test('a title event keeps its TEXT, its set of asks and its provenance, which is an OBJECT on a real log', () => {
    const f = fixture()
    try {
        const { text, sha256 } = sessionLines(join(f.dir, 'session.v4.jsonl'))
        const { row } = foldSession({ id: f.id, path: 'x', version: 4, text, sha256, bytes: 1 })
        assert.equal(row.title, 'Push repo to GitHub account')
        assert.equal(row.has_title, 1)
        assert.deepEqual(JSON.parse(row.title_seqs), [2])
        assert.match(row.title_source, /provider/)
        assert.equal(row.explicit_rename, 0, 'a provider title is not an operator rename')
    } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test('a REPLACED event is shadowed even though the replace op comes AFTER it', () => {
    const f = fixture()
    try {
        const { text, sha256 } = sessionLines(join(f.dir, 'session.v4.jsonl'))
        const { row, messages } = foldSession({ id: f.id, path: 'x', version: 4, text, sha256, bytes: 1 })
        // seq 2 (the ask) and seq 4 (the tool call is not a message; seq 3 the assistant message) are inside 2..4
        assert.equal(row.shadowed, 2, 'the ask at seq 2 and the assistant message at seq 3 are withdrawn')
        assert.equal(messages.filter((m) => m[7] === 1).length, 2)
        assert.equal(row.asks, 1, 'a withdrawn ask is still an ask that happened')
    } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test('reasoning is counted separately from visible text -- the 4.5x distinction, at the row level', () => {
    const f = fixture()
    try {
        const { text, sha256 } = sessionLines(join(f.dir, 'session.v4.jsonl'))
        const { row } = foldSession({ id: f.id, path: 'x', version: 4, text, sha256, bytes: 1 })
        assert.equal(row.reasoning_chars, 5)
        assert.equal(row.visible_chars, 'push this reposummary of the abovedone'.length)
    } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test('the index answers "the session in project X" BY CWD, in one query', () => {
    const f = fixture()
    const out = join(f.root, 'index.db')
    try {
        const built = buildIndex({ sessionsDir: f.root, out })
        assert.equal(built.sessions, 1)
        assert.equal(built.titled, 1)
        // the handle that works: the project, not the title -- the title is a summary of the WORK
        const byCwd = findSessions('zeroclaw-voice-proxy', { out })
        assert.equal(byCwd.length, 1)
        assert.equal(byCwd[0].id, f.id)
        assert.equal(byCwd[0].title, 'Push repo to GitHub account')
        // and the title is findable too, which is the capability the service cannot provide
        assert.equal(findSessions('GitHub account', { out }).length, 1)
        assert.equal(findSessions('nothing-like-this', { out }).length, 0)
    } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test('one session held in two format versions is indexed once, from the newer file', () => {
    const f = fixture()
    try {
        writeFileSync(join(f.dir, 'session.v3.jsonl'), '{}\n')
        const files = sessionFiles(f.root)
        assert.equal(files.length, 1)
        assert.equal(files[0].version, 4)
    } finally { rmSync(f.root, { recursive: true, force: true }) }
})
