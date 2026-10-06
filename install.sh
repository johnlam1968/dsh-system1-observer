#!/usr/bin/env bash
#
# Install the System One observer into a dsh profile, from a clone of this repository.
#
#   ./install.sh                    # profile "web"
#   ./install.sh my-profile         # another profile
#   ./install.sh web --check-only   # do everything except touch the profile
#
# Deploying ANOTHER profile to test this stack beside a running one, rather than adding this plugin to an
# existing profile: see DEPLOY-A-PROFILE.md (the prompt, the acceptance criteria and the traps).
#
# Dependencies are PUBLIC now, and the decision runtime is source in this repository under `lib/`:
# `npm install` needs no git credentials, and nothing is fetched from GitHub to mount the plugin.
set -euo pipefail

PROFILE=web
CHECK_ONLY=no
for arg in "$@"; do
  case "$arg" in
    --check-only) CHECK_ONLY=yes ;;
    -h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "unknown option: $arg" >&2; exit 2 ;;
    *) PROFILE="$arg" ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
step() { printf '\n==> %s\n' "$*"; }
warn() { printf '  WARNING: %s\n' "$*"; }
die() { printf '\nFAILED: %s\n' "$*" >&2; exit 1; }
PROFILE_PKG="${DSH_HOME:-$HOME/.dsh}/profiles/${PROFILE}/package.json"

step "prerequisites"
for tool in node npm git; do command -v "$tool" >/dev/null || die "$tool is not on PATH"; done
command -v dsh >/dev/null || die "the dsh CLI is not on PATH; install the DeepSeek Harness first"
echo "  node $(node -v) · npm $(npm -v) · profile '${PROFILE}'"

step "installing dependencies"
npm install || die "npm install failed (the dependencies are the public @deepseek-ai/schemastery and yaml; check your network and registry)."

# THE RUNTIME IS LOCAL, SO WHAT IS PROBED IS THAT IT LOADS. This replaces a check for a git dependency
# whose fetch could fail silently and leave a dangling symlink the import only hit at run time: `lib/`
# cannot dangle, but a copy missing a file or a specifier fails exactly the same way -- inside a listener,
# on the first turn.
node -e "import('./lib/seams.js').then(m => console.log('  runtime loads ·', m.PROBE_SEAMS.length, 'seams, probe question:', m.PROBE_QUESTION?.type)).catch(e => { console.error('  runtime import failed:', e.code || e.message); process.exit(1) })" \
  || die "the runtime source in lib/ does not import."

step "adding the bundle to profile '${PROFILE}'"
listed() {
  node -e '
    const fs = require("fs")
    try {
      const d = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
      process.exit((d?.dsh?.profile?.bundles ?? []).includes("dsh-system1-observer") ? 0 : 1)
    } catch { process.exit(1) }' "$PROFILE_PKG"
}
if [ "$CHECK_ONLY" = yes ]; then
  echo "  --check-only: skipping 'dsh plugin add'"
elif listed; then
  echo "  already listed in ${PROFILE_PKG}; leaving the bundle list alone"
  echo "  (to re-add from a new path: dsh plugin --profile ${PROFILE} remove dsh-system1-observer, then re-run)"
else
  dsh plugin --profile "$PROFILE" add "$ROOT"
fi

step "what is composed now"
if command -v dsh >/dev/null && [ "$CHECK_ONLY" = no ]; then
  if dsh --profile "$PROFILE" --dump-config 2>/dev/null | grep -q 'id: system1-observer'; then
    echo "  row 'system1-observer' is in the composed config"
  else
    warn "row 'system1-observer' is not in --dump-config; it may be PENDING or have failed to mount"
  fi
fi
node -e '
  const fs = require("fs")
  try {
    const d = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
    console.log("  bundles: " + (d?.dsh?.profile?.bundles ?? []).join(", "))
  } catch { console.log("  bundles: (no profile package.json yet)") }' "$PROFILE_PKG"

cat <<'NOTE'

Notes:

  * The observer needs a decision model to call. It prefers the profile's `system1` service and
    falls back to the HTTP endpoint at `wireUrl` (default http://127.0.0.1:8766) when no service
    is mounted. With neither, every call is an error line in the trace.
  * Its trace is written to `<DSH_HOME>/logs/system1-observer.jsonl`, or to the package's `data/`
    directory when DSH_HOME is unset; `SYSTEM1_OBSERVER_TRACE` overrides both.
  * `dsh plugin add` MERGES into the profile's bundle list rather than rewriting it, carrying existing entries
  *  forward and dropping a name only when it is a dependency that no longer declares `dsh.bundle`. The
    line above shows what survived — if something is missing, re-add it.

A newly added bundle needs no restart. A bundle whose package was REPLACED does: the metadata is
cached per loader specifier until the process restarts.

A SETTINGS CHANGE IS NOT LIKE THAT, and this note said the opposite until it was measured: every
field the card offers is VOLATILE -- read at the point of use -- so a save reaches the RUNNING row
immediately (measured live on this deployment: seamEnabled, sessions, observeSubagents, questionSet
and turnEveryNTurns all took effect in-process), AND it is written through the harness's
configEditor into the profile's patch, which is the initial value on the next boot. The write
re-serializes that file, so anything else hand-edited in it is re-flowed: that is why the recorded
copy in deploy/profile/ goes byte-stale after a testing session and `npm run check:deploy` asks to
be re-recorded. The two MOUNT-BOUND fields -- probeQuestion and tracePath -- are the exception: not
in the card, YAML only, and a change to either needs a restart.
NOTE
