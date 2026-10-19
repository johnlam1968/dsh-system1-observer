// THE STANDALONE, TESTED WITHOUT A KEY AND WITHOUT A MODEL.
//
// `scripts/ask.mjs` exists because the instrument needs nothing but `node:*` and a credential, and that is a claim
// about the CODE, not about the plugin's deployment. It is therefore run here as a SUBPROCESS from the repository --
// with no key in the environment, so every path that would spend a call is refused rather than exercised -- and the
// things worth testing are the refusals and the free paths: what it lists, what it lints, and what it says when the
// credential is missing.
//
// WHAT IS NOT HERE, and why: no test drives a real call. That was done by hand against the live endpoint and the
// measurement is in the script's header; a test that spent money on every run of the suite is not a test, it is a bill.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)
const SCRIPT = fileURLToPath(new URL('../scripts/ask.mjs', import.meta.url))

/** Run the script with a credential-free environment, so a path that would spend cannot quietly do so. */
async function ask(args, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv }
  for (const name of ['OPENROUTER_API_KEY', 'TYPESAFE_API_KEY', 'LAYA_API_KEY']) delete env[name]
  try {
    const { stdout, stderr } = await run(process.execPath, [SCRIPT, ...args], { env })
    return { code: 0, stdout, stderr }
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }
  }
}

test('it lists the sets, in a directory with no node_modules', async () => {
  const value = await ask(['--list'])
  assert.equal(value.code, 0)
  assert.match(value.stdout, /set\(s\) in .*criteria/)
  // NOT `name \[hash\] scope`: that asserts the column widths too, and a `padEnd` change would fail a test about
  // LISTING. What matters is that the row carries a set, a hash and its scope, because a name alone cannot be
  // pinned to an instrument -- that hash is how a reading is attributed.
  assert.match(value.stdout, /news-claim-check@2\s+\[be7c47c78ba0\]\s+admit/)
})

test('`--lint` reports findings AND the rules it cannot check, and spends nothing', async () => {
  const clean = await ask(['--set', 'news-claim-check@2', '--lint'])
  assert.equal(clean.code, 0)
  assert.match(clean.stdout, /0? ?spec\(s\)/)
  assert.match(clean.stdout, /NOT CHECKED:.*ONE spec is ONE narrow judgement/, 'a clean report must not read as a pass on the rules no machine can check')

  // AND A SET THAT BREAKS A RULE SAYS SO AND EXITS NON-ZERO, so a script can gate on it.
  const broken = await ask(['--set', 'helpfulness-set-merged@1', '--scope', 'turn', '--lint'])
  assert.equal(broken.code, 0, 'this corpus is lint-clean; the assertion below is about the SHAPE of the report')
  assert.match(broken.stdout, /NOT CHECKED:/)
})

test('a missing credential is refused BY NAME, before any call is attempted', async () => {
  const value = await ask(['--set', 'news-claim-check@2', '--scope', 'admit', '--state', 'a claim'])
  assert.notEqual(value.code, 0)
  assert.match(value.stderr, /OPENROUTER_API_KEY` is not set/)
  // AND IT NAMES WHY, because "not set" with no next step is a refusal that wastes the caller's time.
  assert.match(value.stderr, /Export it, or pass `--key-env NAME`/)
  assert.match(value.stderr, /never an argument here/, 'and says where a key must NOT go')
})

test('a state is required, and `--scope` is required when a set declares several', async () => {
  const noState = await ask(['--set', 'news-claim-check@2', '--scope', 'admit'])
  assert.notEqual(noState.code, 0)
  assert.match(noState.stderr, /`--state`, `--file` or `--url`/)

  const ambiguous = await ask(['--set', 'agent-helpfulness-seams@1', '--state', 'text'])
  assert.notEqual(ambiguous.code, 0)
  assert.match(ambiguous.stderr, /`scope` is required/, 'a set with several scopes must not be guessed at')
})

test('a set that does not exist, and a scope it does not declare, are refused by name', async () => {
  const noSet = await ask(['--set', 'no-such-set@9', '--lint'])
  assert.notEqual(noSet.code, 0)
  const wrongScope = await ask(['--set', 'news-claim-check@2', '--scope', 'turn', '--lint'])
  assert.match(wrongScope.stderr, /is not a scope/)
})

test('`--help` prints the usage and exits zero', async () => {
  const value = await ask(['--help'])
  assert.equal(value.code, 0)
  for (const flag of ['--set', '--scope', '--state', '--file', '--url', '--lint', '--json', '--key-env']) {
    assert.match(value.stdout, new RegExp(flag.replace('--', '\\-\\-')), `${flag} is documented`)
  }
})

test('the script imports nothing outside `node:*` and this repository -- the portability claim, checked', async () => {
  const { readFileSync } = await import('node:fs')
  const source = readFileSync(SCRIPT, 'utf8')
  const external = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1])
    .filter((specifier) => !specifier.startsWith('.') && !specifier.startsWith('node:'))
  assert.deepEqual(external, [], 'the standalone depends on something it would have to install:\n  ' + external.join('\n  '))
})

// ---------------------------------------------------------------------------------------------------------------
// THE MEASUREMENT ROUTE, AGAINST A FAKE ENDPOINT. No model, no harness, no money.
//
// THE HEADER ABOVE SAYS "no test drives a real call", and that is still true -- but it was read as "the measurement
// route is untested", and the route was BROKEN in six separate ways while the suite was green:
//
//   1. the rows cut returned no `events`, so the composer read `undefined` and every measurement threw;
//   2. the cut was called with the chain's three-argument shape and a two-argument function, so the budget was ignored;
//   3. `buildSkeleton` was used three lines above the import that named it;
//   4. the judge was `askQuestions(transport)`, which calls the function with the transport where the INPUT goes, so
//      every segment failed -- and the failure was written into the package as a refusal, so a measurement with NO
//      ANSWERS looked like a measurement that was complete;
//   5. the terminal rendered an AGGREGATE with the renderer for ANSWERS, and printed an ARRAY to stdout;
//   6. the output object carried `session` twice, and the second silently won.
//
// Every one of those is a plain shape or reference error, and every one of them is caught by driving the route against
// a local server that answers the wire protocol. So the test below is not a bill: it spends nothing, and it is the
// difference between a route that is tested and a route that is merely described.
// ---------------------------------------------------------------------------------------------------------------

/** An index holding one small session, in the shape `dsh-session-index` writes. */
async function indexWith() {
  const { DatabaseSync } = await import('node:sqlite')
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'ask-script-'))
  const path = join(dir, 'index.db')
  const db = new DatabaseSync(path)
  db.exec(`CREATE TABLE sessions(id TEXT PRIMARY KEY, format TEXT, path TEXT, bytes INTEGER, source_sha256 TEXT, high_water INTEGER, created_at INTEGER, cwd TEXT);
    CREATE TABLE messages(session_id TEXT, seq INTEGER, turn INTEGER, exchange INTEGER, role TEXT, kind TEXT, text TEXT, reasoning TEXT, shadowed INTEGER DEFAULT 0);
    CREATE TABLE tool_calls(session_id TEXT, call_id TEXT, name TEXT, args TEXT, seq INTEGER);
    CREATE TABLE turns(session_id TEXT, ordinal INTEGER, ask_seq INTEGER, ask_chars INTEGER, answer_seq INTEGER, answer_chars INTEGER, exchanges INTEGER, shadowed INTEGER DEFAULT 0);`)
  db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?)').run('s1', 'v4', '/logs/s1.jsonl', 10, 'ab'.repeat(32), 4, null, null)
  const message = (seq, exchange, role, text) => db.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?,?)')
    .run('s1', seq, null, exchange, role, role, text, null, 0)
  message(1, 0, 'user', 'the ask')
  message(2, 0, 'assistant', 'the answer')
  db.prepare('INSERT INTO turns VALUES (?,?,?,?,?,?,?,?)').run('s1', 0, 1, 6, 2, 11, 1, 0)
  db.close()
  return path
}

test('a session is MEASURED from an index, and the answers reach the output', async () => {
  const { createServer } = await import('node:http')
  const { DatabaseSync } = await import('node:sqlite')
  const seen = []
  // THE FAKE ENDPOINT, which answers the wire protocol and records what it was asked.
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      const asked = JSON.parse(body)
      seen.push(asked)
      // ONE ANSWER PER QUESTION, in the shape `narrowAnswers` reads: a `noul` is a probability, a `score` is a level
      // with a distribution, a `choice` is a label the question offered.
      const answers = {}
      // THE QUESTIONS ARRIVE AS A MAP, keyed by id -- which is what `buildQuestions` produces and what the wire posts.
      // THE ID IS THE KEY, not a field of the question: a fixture that read `question.id` answered a question called
      // `undefined`, and every question came back unreadable.
      for (const [id, question] of Object.entries(asked.questions ?? {})) {
        if (question.type === 'noul') answers[id] = { noul: 0.75 }
        else if (question.type === 'score') answers[id] = { score: 1.5, probabilities: { 0: 0.25, 1: 0.5, 2: 0.25 } }
        // A CHOICE IS ANSWERED WITH A LABEL THE QUESTION OFFERED, and the built question carries them as `criteria`
        // -- the loader turns `options` into `criteria` -- so the label has to come from there or the answer is
        // "a label the question never offered", which is an unreadable answer and not a wrong one.
        else answers[id] = { choice: Object.keys(question.criteria ?? {})[0] ?? 'unknown', confidence: 0.6 }
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ answers, usage: { input: 10, output: 10 }, revision: 'fake-1' }))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  try {
    const dbPath = await indexWith()
    const value = await ask(
      ['session', '--from-sqlite', dbPath, '--session-id', 's1', '--set', 'session@1',
        '--wire-url', `http://127.0.0.1:${port}`, '--key-env', 'ASK_SCRIPT_TEST_KEY'],
      { ASK_SCRIPT_TEST_KEY: 'test-key-not-a-credential' },
    )
    assert.equal(value.code, 0, `the route failed: ${value.stderr}`)
    // IT ASKED. The endpoint was reached, with the questions and the state.
    assert.equal(seen.length, 1, 'the endpoint was called once')
    assert.ok(Object.keys(seen[0].questions ?? {}).length > 0, 'and it was asked the questions')
    assert.match(String(seen[0].state ?? ''), /the ask/, 'about the session that was read')
    // AND IT ANSWERED. A measurement with no answers is not a measurement, and this is the assertion that would have
    // caught the judge call being made with the arguments in the wrong places.
    assert.match(value.stdout, /median 0\.75/, 'the noul answer is in the output')
    assert.doesNotMatch(value.stdout, /undefined/, 'and nothing printed as undefined')
    assert.doesNotMatch(value.stdout, /nothing summarisable/, 'and no cell said it had nothing to summarise')
  } finally {
    server.close()
  }
})
