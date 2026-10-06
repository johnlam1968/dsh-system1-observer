#!/usr/bin/env node
// HAS THE DEPLOYMENT MOVED AWAY FROM WHAT THIS REPOSITORY RECORDS?
//
// `ROADMAP.md` §14.6 (e): the profile is not under version control, and it holds three things that exist nowhere else
// -- the bundle list, the patch, and `peer-bridge`'s source. `deploy/profile/` carries a copy; this says whether the
// copy still describes the machine.
//
// WHEN IT CANNOT CHECK, IT SAYS SO RATHER THAN PASSING QUIETLY, which is the posture `check:composition` and
// `check:compat` already take: a machine with no such profile has not run this check.
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compareDeploy, readDeploy } from '../lib/deploy-drift.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const profile = process.env.DSH_PROFILE ?? 'docdrift'
const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const live = readDeploy(join(dshHome, 'profiles', profile))
const recorded = readDeploy(join(root, 'deploy', 'profile'))

if (!live.exists) {
  console.log(`check:deploy -- NOT CHECKED: no profile at ${join(dshHome, 'profiles', profile)}, so there is nothing to compare.`)
  console.log(`  To run it: set DSH_PROFILE (or DSH_HOME) to a machine that boots this composition.`)
  process.exit(0)
}

const { problems, pins, bundles } = compareDeploy(recorded, live)
if (problems.length > 0) {
  console.error(`check:deploy -- FAILED: deploy/profile no longer describes \`${profile}\`:`)
  for (const problem of problems) console.error(`  - ${problem}`)
  console.error('  Re-record it (`cp` the named files into deploy/profile/) as part of the change that moved it.')
  process.exit(1)
}
console.log(`check:deploy -- ok: deploy/profile matches \`${profile}\` (${bundles.length} bundles, ${pins.length} machine-local pin(s)).`)
for (const pin of pins) console.log(`  NOT REPRODUCIBLE ELSEWHERE: ${pin.name} -> ${pin.spec}`)
