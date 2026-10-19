#!/usr/bin/env node
//
// Ask a System One model about a state, from a question set, WITHOUT the harness.
//
//   node scripts/ask.mjs --list
//   node scripts/ask.mjs --set news-claim-check@2 --scope admit --state 'CLAIM: ...'
//   node scripts/ask.mjs --set news-claim-check@2 --scope admit --file claim.txt
//   node scripts/ask.mjs --set news-claim-check@2 --scope admit --url https://example.org/news/2024/03/03/
//   node scripts/ask.mjs --set news-claim-check@2 --lint          # check the set, spend nothing
//   node scripts/ask.mjs --set news-claim-check@2 --scope admit --state '...' --json
//
// WHY THIS EXISTS. The instrument -- composing questions, reading a set, calling the model -- reaches a decision
// service over HTTP and needs nothing else. That was measured rather than argued: `core/model/wire.js` is `fetch` and
// a key, `core/question-lint.js` and the question builders import nothing outside `node:*`, and
// `test/instrument-boundary.test.js` now asserts the instrument has NO host edge. So this script runs in a directory
// with no `node_modules` at all, and the same script works inside dsh as `system1_decide`.
//
// WHAT IT IS NOT. It is not a reader, a prompt engineer, or a pipeline: it composes nothing and stores nothing. The
// questions are the ones a question set already declares, and `--lint` reports what the authoring rules say about
// them. Writing a set is `system1_question_sets { action: 'write' }` inside dsh, or an editor.
//
// THE STATE IS UNTRUSTED INPUT, and that is the point of the exercise: a pasted article argues for itself. A
// `--url` fetch strips markup with a REGULAR EXPRESSION and nothing more -- no readability algorithm, no
// JavaScript, no images -- so a page whose text lives in a script renders as nearly nothing. That limitation is
// stated rather than hidden, and `--raw` prints exactly what was sent so a reader can see what was judged.
//
// THE KEY IS READ FROM THE ENVIRONMENT and named by `--key-env`, never taken as an argument: a key on a command line
// is a key in the shell history, in the process table, and in every `ps` on the host.
import { readFileSync } from 'node:fs'
import { validateSpecs } from '../core/questions.js'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
// THE THREE OPERATIONS, from the one module every surface uses. `scripts/ask.mjs` has no question code of its own:
// what it adds is a STATE (a file, a URL, stdin), a credential, and a place to print -- and none of that is a rule
// about questions, so none of it is written here.
import { composeQuestions, listQuestionSets, askQuestions, wireTransport, writeQuestionSet, renderAnswerLines } from '../core/system1.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const SETS = resolve(ROOT, 'criteria')

const argv = process.argv.slice(2)
const flag = (name, fallback = null) => {
  const i = argv.indexOf(name)
  return i === -1 ? fallback : (argv[i + 1] ?? fallback)
}
const has = (name) => argv.includes(name)
/**
 * EVERY value of a repeated flag, not the first.
 *
 * Found by composing three questions as three `--question` flags and storing ONE of them. `flag` returns
 * `argv[indexOf(name) + 1]`, so a second `--question` was not ignored -- it was never read, and the composition it
 * belonged to was written without it. Silent, and the count was right: one question was asked and one was stored.
 * A flag whose whole purpose is repetition has to collect; `flag` stays for the flags that are single-valued.
 */
const flags = (name) => argv.reduce((all, value, index) => (value === name ? [...all, argv[index + 1]].filter(Boolean) : all), [])

const USAGE = `ask.mjs -- a question set and a state, answered by a System One model, with no harness

  --list                     the sets this repository declares
  --set NAME                 the composition, e.g. news-claim-check@2 (or skip it and use --question)
  --scope SCOPE              which scope of the set, e.g. admit, turn, session
  --question TEXT            ONE question inline, as key=value fields separated by ' ;; ' -- the same
                             format system1_question_sets writes and system1_decide accepts.
                             REPEAT the flag per question: every occurrence is read, not just the first.
  --state TEXT               the state, as text
  --file PATH                the state, from a file ("-" reads stdin)
  --url HTTPS://...          the state, fetched and stripped of markup
  --compose NAME             STORE the composed questions as a composition, then stop
  --force                    allow --compose to rewrite a scope file that already exists
  --lint                     check the set against the authoring rules, spend nothing
  --json                     machine-readable answers
  --raw                      print exactly what was sent, beside the answers
  --wire-url URL             the endpoint's root; /v1/systemone is appended
  --key-env NAME             the variable holding the key (default OPENROUTER_API_KEY)
  --timeout MS               per-call bound (default 20000)
`

function die(message, code = 1) {
  process.stderr.write(`ask.mjs: ${message}\n\n${USAGE}`)
  process.exit(code)
}

/** The state, however it arrived. A URL is fetched; markup is stripped naively and that is disclosed. */
async function readState() {
  const inline = flag('--state')
  if (inline !== null) return { text: inline, from: '--state' }
  const file = flag('--file')
  if (file !== null) {
    const text = file === '-' ? readFileSync(0, 'utf8') : readFileSync(resolve(file), 'utf8')
    return { text, from: file }
  }
  const url = flag('--url')
  if (url !== null) {
    const response = await fetch(url)
    if (response.ok !== true) die(`${url} answered ${response.status}`)
    const html = await response.text()
    // MARKUP OUT, TEXT IN. A regular expression and nothing else: no readability algorithm, no scripts, no images.
    // A page whose content is rendered by JavaScript therefore arrives as its chrome, which is a limitation of this
    // script rather than a property of the claim -- so `--raw` prints what was judged, and a reader can see it.
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim()
    if (text === '') die(`${url} yielded no text: it is probably rendered by JavaScript, which this script does not run`)
    return { text, from: url }
  }
  return null
}

if (has('--help') || has('-h')) { process.stdout.write(USAGE); process.exit(0) }

if (has('--list')) {
  const listed = listQuestionSets(SETS)
  if (!listed.ok) die(listed.reason)
  process.stdout.write(`${listed.sets.length} set(s) in ${SETS}\n`)
  for (const row of listed.sets) process.stdout.write(`  ${row.name.padEnd(36)} [${row.hash}]  ${(row.seams ?? []).join(', ') || '(none)'}\n`)
  process.exit(0)
}

// `--set` is OPTIONAL here, which it is not in the tool's own gating: `--question` is an equally good route and the
// resolver is the thing that decides. Forcing a set would mean this script could only ever ask questions somebody had
// already stored, which is not the same capability the tool has.
const name = flag('--set')

// ONE CALL, THREE ROUTES: a stored set by name, questions inline as DSL strings, or nothing at all. The module that
// answers it is the same one `system1_decide` answers with, so a question means the same thing in both -- which is the
// point of this script existing beside the tool rather than beside a copy of it.
const repeated = flags('--question')
const composed = composeQuestions({
  set: name,
  scope: flag('--scope'),
  // `--compose` has no scope of its own unless the caller names one, and `call` is the seam name the loader wants.
  question: repeated,
  setsDir: () => SETS,
})
if (!composed.ok) die(composed.reason)

// COMPOSE: store what was just composed, and stop. The set becomes a NAME that `system1_decide`, `system1_battery`,
// `system1_evaluate_session` and this script can all ask by -- which is the point of storing it rather than passing
// questions around, and the reason a stored set has a HASH: two runs are comparable only while the instrument's bytes
// are the same. An existing scope file is refused unless `--force`, and the refusal says to write `@next` instead.
if (has('--compose')) {
  const target = flag('--compose')
  if (composed.source !== 'question' && composed.source !== 'specs') {
    die('`--compose` needs questions to store: give `--question` (or `--set`, which is already stored)')
  }
  const scopeForWrite = flag('--scope') ?? 'call'
  const written = writeQuestionSet({
    dir: SETS, name: target, scope: scopeForWrite, specs: composed.specs,
    replace: has('--force'), validate: validateSpecs,
  })
  if (!written.ok) die(written.reason)
  process.stdout.write(`stored ${written.written}\n  hash ${written.hash}${written.created ? ' (new composition)' : written.replaced ? ' (REPLACED -- earlier runs are no longer comparable)' : ''}\n`)
  process.stdout.write(`  ask it: --set ${written.setName} --scope ${written.scope}\n`)
  process.exit(0)
}

// `--lint` COSTS NOTHING AND ANSWERS A DIFFERENT QUESTION from `--state`: whether the questions are well formed, not
// whether they separate. It reports the rules no machine can check too, because a clean report must not read as a pass.
if (has('--lint')) {
  if (composed.source !== 'set') die('`--lint` reads a SET on disk; without `--set` there is nothing on disk to read')
  const lint = composed.lint
  process.stdout.write(`${composed.setLabel}  ${lint.checked} spec(s) across ${lint.scopes.length} scope(s)\n`)
  for (const item of lint.findings) process.stdout.write(`  ${item.level.toUpperCase()} [${item.rule}]${item.id ? ' ' + item.id : ''}: ${item.message}\n`)
  for (const gap of lint.machineUncovered) process.stdout.write(`  NOT CHECKED: ${gap}\n`)
  process.exit(lint.ok ? 0 : 1)
}

const state = await readState()
if (state === null) die('one of `--state`, `--file` or `--url` is required')

// THE CREDENTIAL, read by NAME through the module that owns that decision.
const wireUrl = flag('--wire-url', 'https://openrouter.ai/api')
let transport
try {
  transport = wireTransport({ baseUrl: wireUrl, model: flag('--model', 'jev-latest'), keyEnv: flag('--key-env', 'OPENROUTER_API_KEY'), timeoutMs: Number(flag('--timeout', 20000)) })
} catch (error) {
  die((error instanceof Error ? error.message : String(error)).replace('pass a different variable name', 'pass `--key-env NAME`'))
}

if (has('--raw')) {
  process.stdout.write(`--- state, exactly as it will be judged (from ${state.from}) ---\n${state.text}\n\n`)
}

// OPERATION THREE, whole: load the set and call the model with it.
const asked = await askQuestions({ set: name, scope: flag('--scope'), question: repeated.length === 0 ? undefined : repeated, setsDir: () => SETS, state: state.text }, transport)
if (!asked.ok) die(asked.reason)
const result = asked.result

if (result.kind === 'error') die(result.reason)
if (result.kind !== 'answers') die(`the model answered in a shape this script does not read: ${JSON.stringify(result).slice(0, 200)}`)

const envelope = asked.envelope
if (has('--json')) {
  process.stdout.write(JSON.stringify({ set: asked.setLabel, hash: asked.setHash, source: asked.source, answers: result.answers, envelope }, null, 2) + '\n')
  process.exit(0)
}

process.stdout.write(`${asked.setLabel ?? '(inline)'}  [${asked.setHash ?? '-'} from ${asked.source}]\n`)
process.stdout.write(`  ${asked.ids.length} question(s), answered by ${JSON.stringify(envelope.executed ?? null)}\n\n`)
for (const line of renderAnswerLines(result.answers, asked.scales)) process.stdout.write(`  ${line}\n`)
