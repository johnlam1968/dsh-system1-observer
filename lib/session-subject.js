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
import { EVENT, isToolTraffic, textOfEvent } from './host/session-format.js'

/**
 * THE KINDS A SLICE CAN BE MADE OF, as a name a person chooses mapped to the event type the harness writes.
 *
 * TWO, AND NOT A THIRD GUESSED ONE. The harness's own `SessionEventMap` declares the pair
 * (`packages/core/session/src/types.ts`), and a tool-result kind must NOT be added here: `tool/result` is NOT a
 * message type, so a filter that added it would count traffic as conversation.
 */
export const SUBJECT_KINDS = Object.freeze({
  operator: EVENT.USER_MESSAGE,
  assistant: EVENT.ASSISTANT_MESSAGE,
})

/** The default slice: everything, which is what a row that has configured nothing should get. */
export const DEFAULT_KINDS = Object.freeze(['operator', 'assistant'])

/** The event types that ARE a message, as a set, for the one place that counts conversation rather than events. */
const MESSAGE_TYPES = new Set(Object.values(SUBJECT_KINDS))

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
 * THE SLICE, AND THE WINDOW -- TWO DIFFERENT THINGS, and conflating them lost the whole tool record.
 *
 * `events` is the WINDOW: what `composeTurnState` is handed. `messages` is the selected messages, which is what a
 * caller LISTS and counts. The distinction is not tidiness. Measured on a real session ("Assisted freeciv play",
 * 2,996 events): the 529 tool CALLS arrive inside the assistant messages' `content` blocks, so filtering to messages
 * keeps them -- but all 529 tool RESULTS are separate `tool/result` events, and a slice of messages alone drops every
 * one. The composed `TOOL CALLS` section then reads `call 1: bash({...})` with no `-> ` line beneath it, for all 529,
 * and `lib/tool-blocks.js:59-62` already said what that costs: "a window built only from blocks inside messages sees
 * nothing ... the result dropped". It was right, and this module was the window it was describing.
 *
 * WHY THE WINDOW IS A CONTIGUOUS RUN. The messages choose the range; everything between the first and the last
 * chosen message travels with them, because a tool result belongs to the exchange it answered. `lastMessages` still
 * counts MESSAGES (`lib/turn-state.js:35`'s `isMessage` is what makes one message one event for the two kinds below),
 * and zero is the whole session.
 *
 * THE COST, STATED: a window is bounded by POSITION in the list the harness returned, not by `seq`, so it assumes the
 * events arrive in the order they happened. That is what `readSession` gives, and the alternative -- trusting a `seq`
 * field some events carry and others do not -- would build the window from the one field this module cannot verify.
 *
 * `offset` PAGES BACKWARDS FROM THE NEWEST, which is the direction a session is read in: `lastMessages: 20, offset: 0`
 * is the newest twenty, `lastMessages: 20, offset: 20` the twenty before those. Without it the only way to read a deep
 * part of a long conversation was `lastMessages` large enough to include it -- which drags every message since into
 * the window and, measured on a 611-message session, into a state capped at 8,000 characters. A page is the honest
 * way to read a session larger than any prompt.
 */
export function sliceEvents(events, { kinds, lastMessages, offset } = {}) {
  const list = Array.isArray(events) ? events : []
  const { types, unknown } = eventTypesOf(kinds)
  const matched = []
  const indices = []
  for (let index = 0; index < list.length; index += 1) {
    if (!types.includes(list[index]?.type)) continue
    matched.push(list[index])
    indices.push(index)
  }
  const limit = Number.isInteger(lastMessages) && lastMessages > 0 ? lastMessages : 0
  // THE PAGE, TAKEN FROM THE END. `offset` counts messages to SKIP from the newest, so a page composes with
  // `lastMessages` rather than competing with it, and an offset past the start is an empty page rather than a throw.
  const skip = Number.isInteger(offset) && offset > 0 ? offset : 0
  const end = Math.max(0, indices.length - skip)
  const start = limit === 0 ? 0 : Math.max(0, end - limit)
  const kept = indices.slice(start, end)
  const selected = matched.slice(start, end)
  const window = kept.length === 0 ? [] : list.slice(kept[0], kept[kept.length - 1] + 1)
  return {
    events: window,
    messages: selected,
    matched: matched.length,
    total: list.length,
    page: { offset: skip, from: start, to: end, of: matched.length },
    unknownKinds: unknown,
  }
}

/**
 * HOW MUCH CONVERSATION THERE IS, against however much of it a caller kept.
 *
 * Register row O26 is why this exists: a judgement reported `state 8000 chars (truncated)` with no denominator, so a
 * reading taken from 3.1% of a conversation rendered exactly like a reading of the whole thing. A bound nothing states
 * is the failure class this repository keeps recording, and the fix for it is a number, not a paragraph.
 *
 * `chars` counts the text of the MESSAGE events -- the conversation -- and deliberately not the tool traffic, so it is
 * the denominator for "how much of what was said did the judge see". Both were measured on the real session above:
 * 611 messages / 259,439 chars of text / 2,385 other events.
 */
export function coverageOf(events) {
  const list = Array.isArray(events) ? events : []
  let messages = 0
  let chars = 0
  for (const event of list) {
    if (!MESSAGE_TYPES.has(event?.type)) continue
    messages += 1
    chars += textOfEvent(event).length
  }
  const toolEvents = list.filter(isToolTraffic).length
  return { events: list.length, messages, chars, toolEvents }
}

// `textOf` USED TO LIVE HERE, and it was the second of two readers of the same shapes (`lib/turn-state.js` had the
// other) which disagreed about both block kinds and separators. It is now `textOfEvent` in
// `lib/host/session-format.js`, where the harness's vocabulary has one home. Callers import it from there.

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
 * @returns `{ events, messages, slice, coverage, session, problem }` -- `events` is the WINDOW and is what
 *          `composeTurnState` takes, `messages` is what a caller lists, `coverage` is how much conversation there was,
 *          `problem` is a sentence rather than a throw, and an empty event list is a legitimate answer (a session with
 *          nothing in it).
 */
export async function readStoredSubject({ sessionQuery, sessionId, kinds, lastMessages, offset } = {}) {
  const empty = {
    events: [], messages: [], slice: { matched: 0, total: 0, unknownKinds: [], page: { offset: 0, from: 0, to: 0, of: 0 } },
    coverage: { events: 0, messages: 0, chars: 0, toolEvents: 0 }, session: null, problem: null,
  }
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
  const slice = sliceEvents(events, { kinds, lastMessages, offset })
  // AN UNKNOWN KIND IS NAMED. A slice that matches nothing because a kind name is wrong is a judgement over less than
  // the row asked for, and silence there is the failure this repository keeps recording.
  const problem = slice.unknownKinds.length === 0
    ? null
    : 'unknown kind(s) in `subjectKinds`: ' + slice.unknownKinds.join(', ') + ' -- known: ' + Object.keys(SUBJECT_KINDS).join(', ')
  return {
    // THE WINDOW, NOT THE MESSAGES: it carries the tool results that sit between the messages a caller selected.
    events: slice.events,
    messages: slice.messages,
    slice: { matched: slice.matched, total: slice.total, unknownKinds: slice.unknownKinds, page: slice.page },
    coverage: coverageOf(events),
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
