// JUDGE A README WITH THE TWELVE QUESTIONS IN `docs/readme-standards.md`.
//
// WHY THIS EXISTS. That document is a measured answer to "what must a repository README do", and it names the
// instrument: twelve question specs, a model revision, and readings taken on the front page. **A reading nobody can
// repeat is an opinion with decimals on it**, and this script is the repeat.
//
// THE SPECS ARE READ OUT OF THE DOCUMENT, NOT COPIED HERE, because a second copy is a second instrument: it drifts,
// and then the two disagree and nobody knows which one the record used. The same rule the row contract follows, for
// the same reason.
//
// THE REVISION IS NAMED IN THE OUTPUT, because the alias is not the fact -- `jev-latest` is a moving target and a
// number without the revision that produced it is a number nobody can argue with.
//
// USAGE:
//   node scripts/judge-readme.mjs                    # the front page, two runs
//   node scripts/judge-readme.mjs path/to/page.md    # any page
//   node scripts/judge-readme.mjs --runs 3           # more runs, to price the noise
//
// The key is read from the environment BY NAME, never as an argument: `OPENROUTER_API_KEY`.
//
// AND THE LIMITS ARE THE DOCUMENT'S LIMITS, not this script's: two of the twelve questions are calibrated with
// repeats, the rest are directional, and there is no labelled truth anywhere in this -- no battery says a good
// README from a bad one. The script measures and prints; it does not decide.
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { askQuestions, wireTransport } from 'system1-measure'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const STANDARDS = join(ROOT, 'docs', 'readme-standards.md')

/** The twelve specs, read out of the document that holds them. */
function readSpecs() {
    const text = readFileSync(STANDARDS, 'utf8')
    for (const block of text.matchAll(/```json\n([\s\S]*?)```/g)) {
        let parsed
        try {
            parsed = JSON.parse(block[1])
        } catch {
            continue
        }
        if (Array.isArray(parsed) && parsed.some((s) => s?.id === 'primary_audience')) return parsed
    }
    throw new Error(`the twelve questions are not in ${STANDARDS} -- the instrument is missing, not the page`)
}

const args = process.argv.slice(2)
const runsIndex = args.indexOf('--runs')
const runs = runsIndex === -1 ? 2 : Number(args[runsIndex + 1] ?? 2)
const target = resolve(ROOT, args.find((a) => !a.startsWith('--') && a !== String(runs)) ?? 'README.md')

const specs = readSpecs()
const state = readFileSync(target, 'utf8')
const transport = wireTransport({ model: 'typesafe/jev-1.13-20260917', keyEnv: 'OPENROUTER_API_KEY', timeoutMs: 120000 })

/** One reading of one question. */
function read(answer) {
    if (!answer) return null
    if (answer.type === 'noul') return answer.probability
    // The label is shortened for the table: `a_first_time_visitor` is 21 characters wide and the table is a table.
    if (answer.type === 'choice') return `${answer.label.replace(/^a_/, '')} ${(answer.probabilities?.[answer.label] ?? 0).toFixed(2)}`
    if (answer.type === 'score') return answer.level
    return null
}

console.log(`judging ${target.replace(ROOT + '/', '')}  (${state.split('\n').length} lines, ${runs} runs)\n`)

const cells = []
let revision = null
for (let run = 1; run <= runs; run++) {
    const asked = await askQuestions({ specs, state }, transport)
    if (asked.ok !== true) {
        console.error(`run ${run}: ${asked.reason}`)
        process.exit(1)
    }
    revision = asked.envelope?.executed?.model ?? asked.envelope?.model ?? revision
    cells.push(asked.result.answers)
}

const pad = (s, n) => String(s).padEnd(n)
console.log(`${pad('question', 30)}${cells.map((_, i) => `run ${i + 1}`.padStart(18)).join('')}`)
console.log('-'.repeat(30 + 18 * cells.length))
for (const spec of specs) {
    const values = cells.map((c) => read(c[spec.id]))
    console.log(`${pad(spec.id, 30)}${values.map((v) => String(v ?? '-').padStart(18)).join('')}`)
}
console.log(`\nmodel: ${revision ?? 'unknown'}`)

// The two questions this repository's own record calls calibrated. The rest are directional, and a number without
// its question is not a claim.
console.log('\nthe two calibrated questions are `install_present` and `getting_started_scope`; the rest are '
    + 'directional, and there is no labelled truth for any of them -- see docs/readme-standards.md.')
