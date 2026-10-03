// THE STORED-SESSION SUBJECT: a session that is already over, read as state.
//
// The live modes the plugin has always had -- the per-loop seams and the scheduled turn measurement -- read the window
// the plugin holds while a session is running. This module is the other source: a session read back from the harness's
// own store, whole or as a slice, so an existing human/LLM conversation can be judged to improve it.
//
// IT IS AN ADAPTER AND NOTHING MORE. The harness already locates, decodes and hands back the events
// (`ctx.sessionQuery.readSession(id)` -> `{ session, events }`), and the plugin already has exactly one thing that
// turns events into the text a judge is shown (`composeTurnState`). So this module's whole job is: ask for the
// events, slice them the way the row asked, and hand them over. There is deliberately no second composer here -- two
// composers would be two answers to "what is the judge shown", which is the drift this repository keeps recording.
//
// WHY THE HARNESS SERVICE AND NOT THE FILE. A stored archive on this machine is 23 MB holding 10,939 concatenated
// zstd frames, and BOTH of Node's decoders stop after the first frame -- the harness ships a multi-frame adapter
// inside its session-persistence package for that reason. Walking those frames from a plugin would be reimplementing
// an internal format that is not a plugin's contract.
//
// NOTHING HERE THROWS. A stored evaluation is on demand rather than in the critical path of a turn, so a throw would
// not fail a turn -- but it would still be the wrong shape for a caller that has to explain what went wrong. Every
// failure comes back as a named problem beside an empty or partial event list.
import { readConfigValue } from './config-value.js'

/**
 * THE KINDS A SLICE CAN BE MADE OF, as a name a person chooses mapped to the event type the harness writes.
 *
 * TWO, AND NOT A THIRD GUESSED ONE. `lib/turn-state.js:35`'s `isMessage` is where these two are verifiable
 * (`event.type === 'user/message' || event.type === 'assistant/message'`), and a tool-result kind must NOT be added
 * here until the harness's own event type name for it has been read rather than assumed -- a filter that matches
 * nothing is a slice that silently judges less than the row asked for.
 */
export const SUBJECT_KINDS = Object.freeze({
  operator: 'user/message',
  assistant: 'assistant/message',
})

/** The default slice: everything, which is what a row that has configured nothing should get. */
export const DEFAULT_KINDS = Object.freeze(['operator', 'assistant'])

/** The event types a set of kind names selects, and the names that selected nothing. */
export function eventTypesOf(kinds) {
  const wanted = Array.isArray(kinds) && kinds.length > 0 ? kinds : DEFAULT_KINDS
  const types = []
  const unknown = []
  for (const kind of wanted) {
    const type = SUBJECT_KINDS[String(kind)]
    if (type === undefined) unknown.push(String(kind))
    else if (!types.includes(type)) types.push(type)
  }
  return { types, unknown }
}

/**
 * THE SLICE: the events this row asked for, newest-last, exactly as the composer expects them.
 *
 * `lastMessages` counts the MATCHED MESSAGES -- and for the two kinds below, one message IS one event, because that
 * is how the composer reads them (`lib/turn-state.js:34`'s `isMessage` tests the event type and takes the message out
 * of `event.data`). The distinction matters the moment a third kind is added whose event is not a whole message, so
 * it is stated here rather than left to be discovered. Zero (or absent) is the whole session, the honest default for
 * a feature whose point is judging a conversation as a whole.
 */
export function sliceEvents(events, { kinds, lastMessages } = {}) {
  const list = Array.isArray(events) ? events : []
  const { types, unknown } = eventTypesOf(kinds)
  const matched = list.filter((event) => types.includes(event?.type))
  const limit = Number.isInteger(lastMessages) && lastMessages > 0 ? lastMessages : 0
  const sliced = limit === 0 ? matched : matched.slice(-limit)
  return { events: sliced, unknownKinds: unknown, matched: matched.length, total: list.length }
}

/**
 * The stored sessions a row may choose from, as the picker needs them.
 *
 * `listSessions()` returns `{ header, live, persisted }` records and the header carries the id, so the id is the one
 * field this can promise. Titles come from a separate call in the harness (`readTitle`/`readTitleSnapshots`), which
 * is where a caller should get them rather than from here.
 */
export async function listStoredSessions(sessionQuery) {
  if (sessionQuery === undefined || typeof sessionQuery.listSessions !== 'function') {
    return { sessions: [], problem: 'no session-query service is mounted, so no stored session can be listed' }
  }
  try {
    const records = await sessionQuery.listSessions()
    const sessions = (Array.isArray(records) ? records : [])
      .map((record) => {
        const header = record?.header ?? {}
        const id = typeof header.id === 'string' ? header.id : null
        return id === null ? null : { id, cwd: typeof header.cwd === 'string' ? header.cwd : null, live: record?.live === true }
      })
      .filter((entry) => entry !== null)
    return { sessions, problem: null }
  } catch (error) {
    return { sessions: [], problem: 'listing stored sessions failed: ' + messageOf(error) }
  }
}

/**
 * ONE STORED SESSION, READY FOR THE COMPOSER.
 *
 * @returns `{ events, slice, session, title, problem }` -- `events` is what `composeTurnState` takes, `problem` is a
 *          sentence rather than a throw, and an empty event list is a legitimate answer (a session with nothing in it).
 */
export async function readStoredSubject({ sessionQuery, sessionId, kinds, lastMessages } = {}) {
  const empty = { events: [], slice: { matched: 0, total: 0, unknownKinds: [] }, session: null, problem: null }
  if (sessionQuery === undefined || typeof sessionQuery.readSession !== 'function') {
    return Object.assign({}, empty, { problem: 'no session-query service is mounted, so a stored session cannot be read' })
  }
  if (typeof sessionId !== 'string' || sessionId.trim() === '') {
    return Object.assign({}, empty, { problem: 'no stored session is selected' })
  }
  let snapshot
  try {
    snapshot = await sessionQuery.readSession(sessionId.trim())
  } catch (error) {
    return Object.assign({}, empty, { problem: 'reading session ' + sessionId.trim() + ' failed: ' + messageOf(error) })
  }
  const events = Array.isArray(snapshot?.events) ? snapshot.events : []
  const slice = sliceEvents(events, { kinds, lastMessages })
  // AN UNKNOWN KIND IS NAMED. A slice that matches nothing because a kind name is wrong is a judgement over less than
  // the row asked for, and silence there is the failure this repository keeps recording.
  const problem = slice.unknownKinds.length === 0
    ? null
    : 'unknown kind(s) in `subjectKinds`: ' + slice.unknownKinds.join(', ') + ' -- known: ' + Object.keys(SUBJECT_KINDS).join(', ')
  return {
    events: slice.events,
    slice: { matched: slice.matched, total: slice.total, unknownKinds: slice.unknownKinds },
    session: snapshot?.session ?? null,
    problem,
  }
}

/** The row's own settings, as the reader needs them. Read live, like every other setting in this plugin. */
export function subjectSettings(config) {
  const source = readConfigValue(config?.subjectSource)
  const sessionId = readConfigValue(config?.subjectSession)
  const kinds = readConfigValue(config?.subjectKinds)
  const last = readConfigValue(config?.subjectLastMessages)
  return {
    source: source === 'stored' ? 'stored' : 'live',
    sessionId: typeof sessionId === 'string' ? sessionId : '',
    kinds: Array.isArray(kinds) && kinds.length > 0 ? kinds : [...DEFAULT_KINDS],
    lastMessages: Number.isInteger(last) && last > 0 ? last : 0,
  }
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}
