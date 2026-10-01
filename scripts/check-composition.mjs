// PROVE THE PLUGIN LOADS THROUGH THE DOCUMENTED ROUTE.
//
// publish.md:105-110 documents the check -- `dsh --profile <name> --dump-config` shows the layers -- and the
// dsh-plugin-settings-card skill's trap list notes that an applied bundle leaves a `# == <name>` marker, while a
// bundle whose `dsh.bundle.patch` is `true` "reads no patch at all -- no error, no warning, no overrides".
//
// WHEN IT CANNOT CHECK, IT SAYS SO RATHER THAN PASSING QUIETLY, which is the posture `check:compat` already takes
// in this repo: a machine without `dsh` is a machine that has not run this check, not a machine that passed it.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const profile = process.env.DSH_PROFILE ?? 'docdrift'

let dump
try {
  dump = execFileSync('dsh', ['--profile', profile, '--dump-config'], {
    encoding: 'utf8', timeout: 180_000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  })
} catch (error) {
  if (error?.code === 'ENOENT') {
    console.log(`check:composition -- NOT CHECKED: no \`dsh\` on PATH, so the documented route was not exercised.`)
    console.log(`  To run it: install dsh, or set DSH_PROFILE to a profile that lists ${pkg.name}.`)
    process.exit(0)
  }
  console.error(`check:composition -- FAILED: \`dsh --profile ${profile} --dump-config\` exited non-zero.`)
  console.error(String(error?.stderr ?? error?.message ?? error).slice(0, 2000))
  process.exit(1)
}

const problems = []
const layer = `# == ${pkg.name}`
if (!dump.includes(layer)) {
  problems.push(`no "${layer}" layer marker: the bundle contributed no patch, so its rows are not in the composition`)
}
const row = `- id: ${pkg.dsh?.system1ObserverRowId ?? 'system1-observer'}`
if (!dump.includes(row)) problems.push(`no "${row}" row in the composed configuration`)

if (problems.length > 0) {
  console.error(`check:composition -- FAILED against profile \`${profile}\`:`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}
const rows = (dump.match(/^- id: /gm) ?? []).length
console.log(`check:composition -- ok: profile \`${profile}\` composes ${rows} rows, and ${pkg.name} contributes a layer.`)
