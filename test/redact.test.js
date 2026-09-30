// REDACTION, PROVEN RATHER THAN CLAIMED.
//
// The upstream test this is modelled on proves a secret is gone from a REAL captured record rather than from a
// unit call, because a unit call can only show that a function returns what its author expected. The
// observe-level half of this proof -- that the model still receives the raw text while the line does not -- is in
// `test/observe.test.js`, because it needs the whole seam.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ALWAYS_REDACT_KEYS, MAX_DEPTH, REDACTED, TAIL_CHARS,
  PATH_MODES, basenameOf, cutHeadTail, isRedactedKey, minimisePaths, redactPolicy, redactText, sanitizeField,
  sanitizeJson, sanitizeToolText, tokenizeKey,
} from '../lib/redact.js'

const ON = redactPolicy({})
const OFF = redactPolicy({ redactEnabled: false })

test('a key is matched by its WORDS, not by containment', () => {
  assert.deepEqual(tokenizeKey('apiKey'), ['api', 'key'])
  assert.deepEqual(tokenizeKey('API-KEY'), ['api', 'key'])
  assert.deepEqual(tokenizeKey('plain_title'), ['plain', 'title'])
  for (const key of ['apiKey', 'api_key', 'API-KEY', 'Authorization', 'client_secret', 'user_password']) {
    assert.equal(isRedactedKey(key, ON), true, `${key} names a secret`)
  }
  // THE MEASURED OVER-REDACTION THIS DEPARTURE AVOIDS. Upstream also redacts any key CONTAINING one of the six
  // names, which was measured to redact `monkey`, `keyboard` and `turkey` -- while the tokenizer alone already
  // catches every name above.
  for (const key of ['monkey', 'keyboard', 'turkey', 'design', 'signature_of_intent']) {
    assert.equal(isRedactedKey(key, ON), false, `${key} does not name a secret`)
  }
})

test('the six built-in shapes survive an empty user config', () => {
  // A SHAPE, not a key: the `sk-` rule requires 16+ alphanumerics and no internal dash, so it is the unbroken
  // token that matches. `sk-live-abc12345xyz99` from the spec's own tool-argument test has a dash in it and is
  // caught by the KEY rule instead -- which is a different mechanism and has its own test below.
  const cases = [
    'sk-abcdefghijklmnop1234',
    'ghp_abcdefghijklmnopqrstuvwxyz012345',
    'gho_abcdefghijklmnopqrstuvwxyz012345',
    'AKIAIOSFODNN7EXAMPLE',
    'Bearer abc123xyz789',
  ]
  for (const secret of cases) {
    const out = redactText(`before ${secret} after`, ON)
    assert.doesNotMatch(out, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')), `${secret} must be gone`)
    assert.match(out, /\[REDACTED\]/)
    assert.match(out, /before /, 'and the text around it is kept')
  }
  const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----'
  assert.equal(redactText(`key: ${pem}`, ON), `key: ${REDACTED}`)
  assert.equal(ALWAYS_REDACT_KEYS.length, 6, 'six names, not the seven the upstream README claims')
})

// The two the port adds.
test('a JWT and a Basic credential are redacted, and Basic is the hole neither upstream closes', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk'
  assert.equal(redactText(`token ${jwt}`, ON), `token ${REDACTED}`)
  // MEASURED UPSTREAM: 'Authorization: Basic Zm9vOmJhcg==' -> 'Authorization: *** Zm9vOmJhcg=='. The base64
  // credential survived, because the bare-header value class stops at the first space and the Bearer rule does
  // not match `Basic` at all.
  assert.equal(redactText('Authorization: Basic Zm9vOmJhcg==', ON), `Authorization: ${REDACTED}`)
})

test('headers, environment assignments and URL parameters keep the NAME and lose the value', () => {
  assert.equal(redactText('api_key: "sk-live-abc12345xyz99"', ON), `api_key: "${REDACTED}"`)
  assert.equal(redactText('DSH_SOMETHING_SECRET=hunter2 rest', ON), `DSH_SOMETHING_SECRET=${REDACTED} rest`)
  assert.equal(redactText('401 at https://x/?token=SECRETVALUE', ON), `401 at https://x/?token=${REDACTED}`)
  assert.equal(redactText('&access_token=abc123&page=2', ON), `&access_token=${REDACTED}&page=2`)
})

// The query rule asks the SAME key question the JSON walk asks, which is why it cannot make the mistake
// upstream's substring pattern makes.
test('ordinary query parameters are left alone', () => {
  const url = 'see http://x/?design=modern&monkey=1&ok=2&page=3'
  assert.equal(redactText(url, ON), url)
})

test('the JSON walk redacts by key, never walks into a redacted child, and survives what JSON cannot carry', () => {
  const out = sanitizeJson({ api_key: { nested: 'sk-live-abc12345xyz99' }, note: 'kept', count: 3, when: new Date(0) }, ON)
  assert.equal(out.api_key, REDACTED, 'the child is replaced wholesale, not walked')
  assert.equal(out.note, 'kept')
  assert.equal(out.count, 3)
  assert.equal(out.when, '[non-plain]', 'a Date is not silently emptied into {}')

  // A CYCLE IS AN OBSERVATION-LOSS BUG, NOT A REDACTION BUG: upstream stack-overflows, and this repository's
  // sink degrades a throwing thunk to `fields_unavailable`, so the whole observation would be lost.
  const cyclic = { a: 1 }
  cyclic.self = cyclic
  assert.deepEqual(sanitizeJson(cyclic, ON), { a: 1, self: '[circular]' })

  let deep = 'leaf'
  for (let i = 0; i <= MAX_DEPTH + 2; i += 1) deep = { down: deep }
  assert.match(JSON.stringify(sanitizeJson(deep, ON)), /\[too deep\]/)
})

// THE TRAP THE PORT AVOIDS. Structural key redaction happens only if the string parses as JSON -- and tool
// arguments arrive as `name {json}`, which does not.
test('a tool argument is redacted by KEY even though the whole string is not JSON', () => {
  const text = 'bash {"api_key":"sk-live-abc12345xyz99","cmd":"ls"}'
  const out = sanitizeToolText(text, ON)
  assert.doesNotMatch(out, /sk-live-abc12345xyz99/, 'the secret is gone')
  assert.match(out, /"api_key":"\[REDACTED\]"/, 'and it went by KEY, not by shape')
  assert.match(out, /"cmd":"ls"/, 'the rest of the argument is intact')
  assert.equal(JSON.parse(out.slice('bash '.length)).cmd, 'ls')
})

test('a string that only looks like JSON is still redacted by shape', () => {
  const out = sanitizeToolText('note {not json at all} gh_placeholder', ON)
  assert.match(out, /note \{not json at all\} gh_placeholder/, 'unbalanced braces are left as prose')
})

// THE ORDERING RULE. Redact first, cut second: the `ghp_` rule needs its full minimum length, so a cut landing
// inside the token would leave a prefix that matches nothing and persist the partial secret.
test('redaction runs before the cut, so no partial token can survive', () => {
  const secret = 'ghp_abcdefghijklmnopqrstuvwxyz012345'
  const straddling = sanitizeField(`${'x'.repeat(15)} ${secret}`, 18, ON)
  assert.doesNotMatch(straddling.text, /ghp_/, 'no partial prefix survives')
  assert.equal(straddling.text.length, 18, 'and the cut still lands exactly on the budget')

  const whole = sanitizeField(`${'x'.repeat(15)} ${secret}`, 200, ON)
  assert.equal(whole.text, `${'x'.repeat(15)} ${REDACTED}`)
  assert.equal(whole.cut, false)
})

// A KILL SWITCH THAT ALSO REMOVED THE SIZE CAP WOULD BE A FOOT-GUN.
test('redactEnabled false keeps truncation and lets the secret through, on purpose', () => {
  const secret = 'ghp_abcdefghijklmnopqrstuvwxyz012345'
  const out = sanitizeField(secret, 10, OFF)
  assert.equal(out.text, secret.slice(0, 10), 'the secret survives, truncated')
  assert.equal(out.cut, true, 'and truncation still applies')
  assert.equal(redactText(secret, OFF), secret)
  assert.equal(isRedactedKey('api_key', OFF), false)
})

test('the policy defaults to ON, because a record that leaks because nobody set a switch is the failure', () => {
  assert.equal(redactPolicy({}).enabled, true)
  assert.equal(redactPolicy({ redactEnabled: undefined }).enabled, true)
  assert.equal(redactPolicy({ redactEnabled: false }).enabled, false)
})

test('extra keys are added to the six, and junk in the list is ignored', () => {
  const policy = redactPolicy({ redactKeys: ['passphrase', '', 42, null] })
  assert.deepEqual(policy.redactKeys, ['passphrase'])
  assert.equal(isRedactedKey('passphrase', policy), true)
  assert.equal(isRedactedKey('api_key', policy), true, 'the six are never replaced, only extended')
})

// --- HEAD+TAIL: the tail is where a tool's failure marker lives ------------------------------------------
// HEAD-ONLY TRUNCATION BREAKS TAIL DETECTION. A wrapper appends its stderr section last, so the exit code and
// the error text hug the END -- and on this deployment's own trace the old cut put the "tail" window at
// characters 19,000-20,000 of the HEAD on 221 post_execute and 47 result calls, silently degrading a head+tail
// rule to a head-only one on precisely the long outputs it exists for.
test('a truncation keeps the head AND the tail, in exactly the budget', () => {
  const failure = 'Error: ENOSPC: no space left on device\nexit code: 1'
  const body = `build output\n${'noise '.repeat(600)}`
  const out = cutHeadTail(`${body}${failure}`, 2000)
  assert.equal(out.cut, true)
  assert.equal(out.text.length, 2000, 'exactly the budget, as this repository has always counted it')
  assert.match(out.text, /^build output/, 'the head is kept')
  assert.match(out.text, /exit code: 1$/, 'AND the tail, which is the whole point')
  assert.match(out.text, /…/, 'with the join visible')
})

test('a budget too small for a meaningful tail stays head-only', () => {
  const out = cutHeadTail('x'.repeat(100), 20)
  assert.equal(out.text, 'x'.repeat(20))
  assert.equal(out.cut, true)
  assert.equal(cutHeadTail('short', 20).cut, false, 'under the budget, nothing is cut at all')
})

test('the tail window is the documented size, not a number chosen per call site', () => {
  assert.equal(TAIL_CHARS, 1000)
  const out = cutHeadTail('a'.repeat(5000), 3000)
  assert.equal(out.text.slice(-TAIL_CHARS), 'a'.repeat(TAIL_CHARS))
})

// --- PATH MINIMISATION: export less rather than scrub more ----------------------------------------------
// MEASURED ON THIS DEPLOYMENT: 2,453 of 4,369 call lines carry an absolute path. The reference this is ported
// from defaults to `omit`, and this one defaults to `full` -- because a telemetry exporter ships records OFF THE
// MACHINE, while this trace is local evidence whose whole purpose is that a wrong judgement is diagnosable. The
// switch is the operator's to set; the default is argued in the module header rather than assumed.
test('the three path modes reduce an absolute path, and leave everything else alone', () => {
  const text = 'read /home/john/CodingProjects/private/config.yml then /tmp/x.log'
  assert.equal(minimisePaths(text, 'full'), text, 'the default preserves the evidence')
  assert.equal(minimisePaths(text, 'basename'), 'read config.yml then x.log')
  assert.equal(minimisePaths(text, 'omit'), 'read [PATH] then [PATH]')
})

// ANCHORED ON REAL ROOTS, so prose and URLs survive. A rule that mangled `https://host/a/b` would corrupt the
// thing it is meant to protect.
test('a URL is not an absolute path, and neither is a relative one', () => {
  const urls = 'see https://host/a/b and http://x/Users/y and lib/model/narrow.js'
  for (const mode of ['basename', 'omit']) {
    assert.equal(minimisePaths(urls, mode), urls, `${mode} must not touch a URL`)
  }
})

test('the Windows form and a trailing separator are handled', () => {
  assert.equal(minimisePaths('C:\\Users\\john\\notes.txt', 'basename'), 'notes.txt')
  assert.equal(minimisePaths('C:\\Users\\john\\notes.txt', 'omit'), '[PATH]')
  assert.equal(minimisePaths('/home/john/project/', 'basename'), 'project')
  assert.equal(basenameOf('/a/b/c'), 'c')
  assert.equal(basenameOf(''), '')
})

test('an unknown mode falls back to keeping the path, not to guessing', () => {
  const policy = redactPolicy({ pathMode: 'redact-everything-please' })
  assert.equal(policy.pathMode, 'full')
  assert.equal(minimisePaths('/home/x/y', policy.pathMode), '/home/x/y')
})

// REDACT, THEN MINIMISE, THEN CUT -- all three before the cut, because a cut landing inside a credential or a
// path leaves a fragment that matches nothing and is written verbatim.
test('minimisation happens before the cut, so no half-path survives', () => {
  const long = `${'x'.repeat(15)} /home/john/a-very-long-directory-name/file.txt`
  const cut = sanitizeField(long, 20, redactPolicy({ pathMode: 'omit' }))
  assert.equal(cut.cut, true)
  assert.doesNotMatch(cut.text, /\/home/, 'no prefix of the path is left behind')
  // THE CUT CONVENTION IS THIS REPOSITORY'S: exactly `max` characters, with no ellipsis (the ellipsis belongs to
  // the head+tail path, which a budget this small does not reach).
  const based = sanitizeField(long, 12, redactPolicy({ pathMode: 'basename' }))
  assert.equal(based.text, 'x'.repeat(12), 'and the reduced text is cut like any other text')
})

test('minimisation never touches the MODEL’s copy, which is the whole design', async () => {
  const { createObserver } = await import('../lib/observe.js')
  const lines = []
  let handed = null
  const observer = createObserver({
    decide: async (request) => { handed = request; return { kind: 'answers', answers: {} } },
    trace: (event, fields) => lines.push({ event, ...(typeof fields === 'function' ? fields() : fields) }),
    readConfig: () => ({ transport: 'service', provider: 'p', model: 'm', maxFieldChars: 5000, sessions: ['session-test'], pathMode: 'omit' }),
  })
  await observer.observe('pre_execute', 'bash {"cmd":"cat /home/john/private/notes.txt"}', { agentId: 'session-test' })
  assert.match(handed.state.text, /\/home\/john\/private\/notes\.txt/, 'the judge still sees the real path')
  assert.doesNotMatch(lines[0].excerpt, /\/home\/john/, 'and the record does not')
  assert.match(lines[0].excerpt, /\[PATH\]/)
})

// FOUND BY THE MODEL REVIEW (minimax-cn/MiniMax-M3), and these are leaks, not cosmetics: the mode whose entire
// purpose is to stop leaking left real paths untouched.
test('the root list is gone, so paths outside it are reduced too', () => {
  for (const [text, expected] of [
    ['/data/secrets/key.pem', 'key.pem'],
    ['/workspace/repo/x.js', 'x.js'],
    ['/nix/store/abc123-foo', 'abc123-foo'],
    ['/snap/bin/tool', 'tool'],
    ['/System/Library/CoreServices/x', 'x'],
    ['/Volumes/External/x', 'x'],
    ['~/private/x', 'x'],
    ['$HOME/private/x', 'x'],
  ]) {
    assert.equal(minimisePaths(text, 'basename'), expected, text)
    assert.equal(minimisePaths(text, 'omit'), '[PATH]', text)
  }
})

// A FORWARD-SLASHED WINDOWS PATH, which BOTH reviewers found independently: the drive pattern only accepted a
// backslash, so `C:/Users/john/file.txt` reduced to `C:file.txt` -- a mangled path with the drive left attached
// to a basename that no longer had a directory.
test('a drive path is reduced cleanly with either separator', () => {
  assert.equal(minimisePaths('C:/Users/john/file.txt', 'basename'), 'file.txt')
  assert.equal(minimisePaths('C:\\Users\\john\\file.txt', 'basename'), 'file.txt')
  assert.equal(minimisePaths('C:/Users/john/file.txt', 'omit'), '[PATH]')
})

// SYNTAX IS PRESERVED, NOT SWALLOWED. The continuation class used to run through `:?{}|<>#`, so a compiler error
// reduced to a filename that never existed with the line number glued to it. `omit` is what makes the difference
// visible: swallowing gives `[PATH]`, preserving gives `[PATH]:5`.
test('surrounding syntax is not swallowed into the path token', () => {
  assert.equal(minimisePaths('error at /home/john/x:5', 'omit'), 'error at [PATH]:5')
  assert.equal(minimisePaths('visit /home/john/x?q=1', 'omit'), 'visit [PATH]?q=1')
  assert.equal(minimisePaths('brace /home/john/{a,b}', 'omit'), 'brace [PATH]{a,b}')
})

// AND THE URL EXCLUSION IS NOW STRUCTURAL rather than a list of roots: the path must begin with a SINGLE slash.
test('the structural URL exclusion still holds, including a scheme-relative //', () => {
  for (const text of ['https://example.com/home/foo', 'http://host/tmp/x', '//host/home/x', 'lib/model/narrow.js', 'and / or', 'a / b']) {
    assert.equal(minimisePaths(text, 'omit'), text, `${text} must survive`)
  }
})

// THE PLACEBO SHAPE, AND THIS FILE HAD TWELVE OF THEM.
//
// Every redaction assertion above checks that a `[REDACTED]` token APPEARED. None checked that the SECRET WAS
// GONE, and every one used a long, obviously-token-like value. The reviewer session asked which of my tests pin
// an upper bound where the property is an upper bound; this is the redaction version of that question, and it
// found three leaks in thirteen shapes: the unquoted `name: value` rule carried an 8-character floor while the
// QUOTED rule and the ENVIRONMENT rule carried none, so `api_key: "s"` was redacted and `api_key: 2f8a9c` was
// written to the trace verbatim.
//
// Asserting absence is the whole point. A presence assertion passes for a rule that redacts the scheme word and
// leaves the credential behind it -- the exact upstream defect this module's own comment describes.
const CREDENTIAL_SHAPES = [
  ['key=sk-abcdefghijklmnop1234', 'sk-abcdefghijklmnop1234'],
  ['token ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
  ['id AKIAIOSFODNN7EXAMPLE', 'AKIAIOSFODNN7EXAMPLE'],
  ['Authorization: Bearer abcdefghijklmnop', 'abcdefghijklmnop'],
  ['Authorization: Basic dXNlcjpwYXNzd29yZA==', 'dXNlcjpwYXNzd29yZA=='],
  ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVP', 'dBjftJeZ4CVP'],
  ['api_key: 2f8a9c1b4d7e', '2f8a9c1b4d7e'],
  ['api_key: 2f8a9c', '2f8a9c'],
  ['apikey: 2f8a9c', '2f8a9c'],
  ['password: abcde', 'abcde'],
  ['token: 8f2a1b', '8f2a1b'],
  ['MY_API_KEY=abc', 'abc'],
  ['https://h/p?token=2f8a9c1b4d7e&x=1', '2f8a9c1b4d7e'],
]

test('every credential shape: the secret is GONE, not merely accompanied by a token', () => {
  for (const [input, secret] of CREDENTIAL_SHAPES) {
    const out = sanitizeToolText(input, redactPolicy({}))
    assert.equal(out.includes(secret), false, `${secret} survived redaction as ${JSON.stringify(out)}`)
    assert.match(out, /\[REDACTED\]/, `${input} must say something was removed`)
  }
})

test('the JSON walk removes a short value too, by key rather than by shape', () => {
  const out = sanitizeJson({ apiKey: 's', password: 'p', nested: { authorization: 'a' } }, redactPolicy({}))
  assert.deepEqual(out, { apiKey: '[REDACTED]', password: '[REDACTED]', nested: { authorization: '[REDACTED]' } })
})

// THE COST OF DROPPING THE FLOOR, PAID DOWN WHERE IT IS WORTH PAYING. `token: none` is how a log says there is no
// secret; redacting it mangles diagnostic prose for nothing. A short LIST, not a length: measured, there is no
// length that separates `abcde` (a value) from `answer` (a word).
test('the values that are explicitly not credentials are left alone', () => {
  for (const text of ['token: none', 'key: null', 'password: undefined', 'secret: n/a', 'token: ???', 'key: nil']) {
    assert.equal(sanitizeToolText(text, redactPolicy({})), text, `${text} should survive`)
  }
})

test('a scheme word is never redacted on its own, leaving the credential behind it', () => {
  // The Bearer and Basic rules replace the whole `scheme value` pair, so the header rule must not touch them.
  for (const scheme of ['Bearer abcdefghijklmnop', 'Basic dXNlcjpwYXNzd29yZA==']) {
    const out = sanitizeToolText(`Authorization: ${scheme}`, redactPolicy({}))
    assert.equal(out, 'Authorization: [REDACTED]')
    assert.equal(out.includes(scheme.split(' ')[1]), false)
  }
  // And a scheme with NO pattern of its own is left whole rather than half-redacted: losing the word `Digest` and
  // keeping the credential is strictly worse than leaving both.
  for (const text of ['Authorization: Digest xyz', 'auth: Negotiate abc']) {
    assert.equal(sanitizeToolText(text, redactPolicy({})), text)
  }
})
