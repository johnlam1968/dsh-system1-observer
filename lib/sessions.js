// WHICH SESSIONS THE OBSERVER WATCHES.
//
// The observer is ONE host row shared by every conversation in the profile, so without this it observes
// whatever happens to fire -- including a session nobody asked about. `sessions` is the allow-list, and it is
// the only gate here that is about WHO rather than about what is asked.
//
// AN EMPTY LIST OBSERVES NOTHING. Observation is opt-in per session, and the only way to turn it on is the
// session's own "..." menu in the Web UI.
//
// THE CONSEQUENCE, STATED PLAINLY BECAUSE IT IS A CHOICE AND NOT AN ACCIDENT: `Schema.array` MATERIALISES to
// `[]` for a field nobody has written, so a row that has never been configured observes nothing. This plugin
// therefore does nothing at all until someone points it at a session. That is the intended reading of a
// per-session switch -- but it is the opposite of how every other gate in this row behaves, where absence
// means ON, and a deployment that upgrades and sees no calls should look HERE first.
//
// PREFIX MATCHING, not equality, for two reasons: a session id is 36 characters of uuid that nobody wants to
// retype, and the Web UI's own session menu writes the full id while a hand-edit can carry a short prefix.
//
// AN ENTRY MAY CARRY A TITLE, and only ever for display. `session-01234567-89ab-4cde-8f01-23456789abcd` is a
// key, not something a person reads, so the session menu stores the headline it was handed beside the id:
// `- id: session-fb6a…` / `  title: test session`. THE TITLE IS A CACHE AND IS NEVER MATCHED ON -- a rename
// would otherwise silently stop a session being observed, and this decides whether text reaches a model.
// Both shapes are accepted, so a list written before titles existed keeps working and a hand-edit may be
// either.
import { isRecord } from './is-record.js'
import { readConfigValue } from './config-value.js'

/** The id an entry names, from either the plain-string shape or the `{ id, title }` one. */
function idOf(entry) {
  if (typeof entry === 'string') return entry.trim()
  if (isRecord(entry) && typeof entry.id === 'string') return entry.id.trim()
  return ''
}

/**
 * The one entry that is not a session id: it names EVERY session.
 *
 * It exists so that "observe everything" is a state a person can SEE and remove, rather than the meaning of an
 * empty list -- which had to become "observe nothing" the moment per-session opt-in was wanted, and cannot be
 * both. It is also what the schema DEFAULTS to, so a row nobody has configured observes everything, exactly as
 * an absent `callsEnabled` or an absent `seamEnabled` does, and the one gate whose absence meant OFF stops
 * being the odd one out.
 */
export const WILDCARD = '*'

/** The configured allow-list: trimmed, non-empty ids, in order, deduplicated. The title is dropped here. */
export function readSessions(config) {
  const given = readConfigValue(config?.sessions)
  if (!Array.isArray(given)) return []
  const out = []
  for (const entry of given) {
    const id = idOf(entry)
    if (id === '' || out.includes(id)) continue
    out.push(id)
  }
  return out
}

/**
 * Whether one agent's firings are observed.
 *
 * @param config  the row's config, as Cordis passed it
 * @param agentId the seam's agent id, which is the session id (`Agent.id`)
 * @returns true for the wildcard or a matching prefix; false for an empty list or an unattributable firing
 */
export function sessionObserved(config, agentId) {
  // AN ABSENT FIELD IS THE SCHEMA'S DEFAULT, which is the wildcard: this mirrors `index.js` so a caller that
  // bypasses Cordis' resolution cannot get a different answer from the one a running row gives. Only an
  // EXPLICIT empty list observes nothing -- and a malformed value fails closed, because a scoping gate should
  // not fall open on a value it cannot read.
  if (readConfigValue(config?.sessions) === undefined) return true
  const sessions = readSessions(config)
  if (sessions.length === 0) return false
  if (sessions.includes(WILDCARD)) return true
  // FAIL CLOSED WHEN THE AGENT IS UNKNOWN. `draft` reads `ctx.agents.currentInitiator()`, which answers
  // `undefined` outside an initiator boundary. Observing an unattributable firing would defeat the point of
  // a session-scoped row, and the skip line names the reason rather than leaving a silent gap.
  if (typeof agentId !== 'string' || agentId === '') return false
  return sessions.some(session => agentId.startsWith(session))
}

/** Whether every session is observed, so a caller can tell "all of them" from "these ones". */
export function observesEverySession(config) {
  return readConfigValue(config?.sessions) === undefined || readSessions(config).includes(WILDCARD)
}

/**
 * WHICH CONFIGURED SESSION CANNOT FIRE, if any -- null when none is missing.
 *
 * WHY THIS EXISTS. A skip that says only `session not observed` is indistinguishable from a scope working as
 * intended, and that is measured rather than imagined: this row was scoped to one session, a restart did not resume
 * it, and 145 consecutive boundaries skipped identically. The row knows which sessions are LIVE, so it can say which
 * of the two it is.
 *
 * THE RULE LIVES HERE, beside the gate it explains, and takes the live ids as an ARGUMENT. A module that reached for
 * a context could not be tested and could not be called from the seam path, which has no context of its own -- and a
 * second copy of a rule is how the envelope rule went wrong twice.
 */
export function scopeNotLiveNote(config, liveIds) {
    const live = (Array.isArray(liveIds) ? liveIds : []).filter((id) => typeof id === 'string')
    const missing = readSessions(config)
        .filter((id) => id !== WILDCARD && !live.includes(id) && !live.some((liveId) => liveId.startsWith(id)))
    return missing.length === 0 ? null : `${missing.join(', ')} configured, not live in this process`
}
