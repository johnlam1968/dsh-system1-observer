// G0 -- THE EXCHANGE: what the human asked, and what came back, and nothing between.
//
// WHY THIS EXISTS. Every measurement this plugin could take was the same subject: the working record -- narration,
// tool calls, tool results -- with a positional cut applied when it did not fit. So the ONE question a reader most
// often has ("did it answer me, and was the answer any good?") could only be asked through 1.4 million characters of
// machinery, and `docs/measurement-depth.md` prices what that costs: an exchange whose working record is 91,262
// characters was rendered down to 8,000 and scored LOW, for a turn that reads well whole, because the evidence that
// made its conclusion credible was the part the cut dropped.
//
// TWO THINGS THIS SELECTOR MUST GET RIGHT, and both are measured rather than assumed:
//
//  1. THE HUMAN IS NOT EVERY `user/message`. Of the 46 `operator` messages in the freeciv session, 38 are the human
//     (3,868 chars) and 8 are the HARNESS (15,521 chars -- four skill catalogues alone are 14,524). The event type is
//     identical; only `data.source.kind` separates them. A selector that took `user/message` naively would hand the
//     judge a skill catalogue as though it were the question.
//
//  2. THE ANSWER IS THE TURN'S LAST WORD, NOT ITS FIRST. An assistant turn is several messages: narration, tool-call
//     messages, and finally the text the human reads. G0 keeps only that last one; the rest is G1's evidence.
import { HUMAN_SOURCE_KIND, isAssistantMessage, isMessageEvent, isUserMessage, sourceKindOf, textOfEvent } from './host/session-format.js'

/** The groups named in `docs/measurement-depth.md`. G4 is provenance and is never selected off. */
export const GROUP_NAMES = Object.freeze(['G0', 'G1', 'G2', 'G3', 'G4'])

/**
 * WHICH GROUPS THIS BUILD CAN ACTUALLY COMPOSE. Named so a caller asking for G2 gets a REFUSAL naming what is
 * missing, rather than this build sending G1's evidence under G2's name -- which is the substitution the whole
 * register is about.
 */
export const BUILT_GROUPS = Object.freeze(['G0', 'G1'])

// G0 TAKES THE HUMAN'S MESSAGES, and which of the three kinds of `user/message` is the human's is the harness's
// declaration (`types.ts:309`), so the constant is re-exported from where that vocabulary lives rather than restated.
export { HUMAN_SOURCE_KIND }

export function isHumanMessage(event) {
  if (event === null || typeof event !== 'object') return false
  if (!isUserMessage(event)) return false
  // A MISSING SOURCE IS NOT THE HUMAN. Conservative on purpose: calling an injection the operator's input is a worse
  // error than dropping one message, and `excludedOperators` reports exactly what was dropped and why.
  return sourceKindOf(event) === HUMAN_SOURCE_KIND
}

/** The `user/message` events that are NOT the human, by source -- what a G0 reading left out, and how much text. */
export function excludedOperators(events = []) {
  const by = new Map()
  for (const event of events) {
    if (!isUserMessage(event) || isHumanMessage(event)) continue
    const kind = sourceKindOf(event) || '(no source)'
    const entry = by.get(kind) ?? { kind, count: 0, chars: 0 }
    entry.count += 1
    entry.chars += textOfEvent(event).length
    by.set(kind, entry)
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind))
}

/**
 * The session as a list of EXCHANGES: what was asked, and the turn's final word.
 *
 * A human message attaches to the NEXT turn that follows it, because that is what it is a question to. A trailing ask
 * with no turn after it is kept and marked `unanswered`, because "the session ended with a request unserved" is a
 * finding and dropping it would hide one.
 */
export function exchangesOf(events = []) {
  const list = []
  let pending = []
  let current = null
  for (const event of events) {
    if (isHumanMessage(event)) { pending.push(event); continue }
    if (!isAssistantMessage(event)) continue
    const turn = event?.data?.turn
    const label = turn === undefined ? null : turn
    if (current === null || current.turn !== label) {
      current = { turn: label, asked: pending, answered: null, firstSeq: pending[0]?.seq ?? event?.seq ?? 0, lastSeq: event?.seq ?? 0, unanswered: false }
      list.push(current)
      pending = []
    }
    // THE LAST TEXT OF THE TURN IS THE ANSWER; earlier assistant messages are narration between tool calls, which is
    // G1's evidence. Measured: turn 36 of the freeciv session has 29 assistant messages and the human reads the 29th.
    current.answered = event
    current.lastSeq = event?.seq ?? current.lastSeq
  }
  if (pending.length > 0) {
    list.push({ turn: null, asked: pending, answered: null, firstSeq: pending[0]?.seq ?? 0, lastSeq: pending[pending.length - 1]?.seq ?? 0, unanswered: true })
  }
  return list
}

/** A `turn` or a `turns` list, as a set of turn numbers -- or `null` for every exchange. */
export function wantedTurns({ turn = null, turns = null } = {}) {
  const list = []
  if (Number.isInteger(turn)) list.push(turn)
  if (Array.isArray(turns)) for (const value of turns) if (Number.isInteger(value)) list.push(value)
  return list.length === 0 ? null : [...new Set(list)].sort((a, b) => a - b)
}

/**
 * The G0 events: every asked message, and the answer to each, in sequence order.
 *
 * `turn` IS ONE EXCHANGE and `turns` IS SEVERAL -- "turn 37", or "turns 37 to 40". Both are the same group at a
 * different scope (`docs/measurement-depth.md`), which is why several turns need no group of their own.
 */
export function selectedEvents(events = [], { turn = null, turns = null } = {}) {
  const wanted = wantedTurns({ turn, turns })
  const all = exchangesOf(events)
  const chosen = wanted === null ? all : all.filter((exchange) => wanted.includes(exchange.turn))
  const kept = []
  for (const exchange of chosen) {
    kept.push(...exchange.asked)
    if (exchange.answered !== null) kept.push(exchange.answered)
  }
  kept.sort((a, b) => (a?.seq ?? 0) - (b?.seq ?? 0))
  return { events: kept, exchanges: chosen, total: all.length }
}

/**
 * The G1 events of ONE turn -- the working record of that exchange, plus what was asked. This is what the earlier
 * `lastMessages`/`offset` arithmetic approximated by hand, and it could not express at all when the ask and the answer
 * were separated by the working record.
 */
export function turnEvents(events = [], turns = null) {
  const wanted = Array.isArray(turns) ? turns : (Number.isInteger(turns) ? [turns] : null)
  const asked = new Set(selectedEvents(events, { turns: wanted }).events.filter(isHumanMessage).map((event) => event?.seq))
  return events.filter((event) => (wanted === null ? true : wanted.includes(event?.data?.turn)) || asked.has(event?.seq))
}

/** The message events inside an arbitrary window, for the count a reader is told. */
export function messageEventsOf(list = []) {
  return list.filter(isMessageEvent)
}

/**
 * Apply a group selection to a window, or refuse it.
 *
 * RETURNS A PROBLEM RATHER THAN THROWING, so the caller owns the message. And it REFUSES a group this build cannot
 * compose (G2, G3) instead of quietly sending G1's evidence under that name -- the substitution the register is about.
 */
export function applyGroups({ events = [], messages = null, groups = null, turn = null, turns = null } = {}) {
  const wanted = Array.isArray(groups) ? groups.map((g) => String(g).trim().toUpperCase()).filter((g) => g !== '') : []
  const unknown = wanted.filter((g) => !GROUP_NAMES.includes(g))
  if (unknown.length > 0) {
    return { problem: 'unknown evidence group ' + unknown.map((g) => '`' + g + '`').join(', ') + ' -- the groups are ' + GROUP_NAMES.join(', ') }
  }
  const notBuilt = wanted.filter((g) => !BUILT_GROUPS.includes(g))
  if (notBuilt.length > 0) {
    return { problem: notBuilt.join(', ') + ' cannot be composed by this build: only ' + BUILT_GROUPS.join(' and ') + ' are selectable, so this refuses rather than sending G1 evidence under another group\'s name' }
  }
  const askedTurns = wantedTurns({ turn, turns })
  const all = exchangesOf(events)
  const available = all.map((exchange) => exchange.turn).filter((t) => t !== null)
  if (askedTurns !== null) {
    const missing = askedTurns.filter((t) => !available.includes(t))
    if (missing.length > 0) {
      return { problem: 'this session has no turn ' + missing.join(' or ') + ' -- it has ' + all.length + ' exchange(s)' + (available.length === 0 ? '' : ', turns ' + available.join(', ')) }
    }
  }
  // G0 ALONE IS THE EXCHANGE. `G0 + G1` is the working record, which is what this tool took before this existed, so a
  // caller who names both keeps the previous behaviour exactly.
  if (wanted.includes('G0') && !wanted.includes('G1')) {
    const selection = selectedEvents(events, { turns: askedTurns })
    // AN ANSWER WITH NO ASK IS NOT AN EXCHANGE. Checking only that the selection is non-empty let a window of assistant
    // messages through as though it were one, so the test is whether a HUMAN message is in it -- and the refusal says
    // what was there instead, because a window full of injections is the case that will actually happen.
    if (!selection.events.some(isHumanMessage)) {
      const excluded = excludedOperators(events)
      return {
        problem: 'no exchange to judge at G0: the window holds no message from the human (a `user/message` whose `data.source.kind` is "user")'
          + (excluded.length === 0 ? '' : ' -- it holds ' + excluded.reduce((total, entry) => total + entry.count, 0) + ' harness `user/message`(s) instead (' + excluded.map((entry) => entry.kind + ' ' + entry.count).join(', ') + ')'),
      }
    }
    return {
      problem: null,
      events: selection.events,
      messages: selection.events,
      groups: wanted,
      turn: askedTurns !== null && askedTurns.length === 1 ? askedTurns[0] : null,
      ...(askedTurns === null || askedTurns.length <= 1 ? {} : { turns: askedTurns }),
      exchange: {
        turns: selection.exchanges.map((exchange) => exchange.turn),
        exchanges: selection.exchanges.length,
        of: selection.total,
        unanswered: selection.exchanges.filter((exchange) => exchange.unanswered).length,
        excluded: excludedOperators(events),
      },
    }
  }
  if (askedTurns !== null) {
    const window = turnEvents(events, askedTurns)
    return {
      problem: null, events: window, messages: messageEventsOf(window), groups: wanted.length === 0 ? null : wanted,
      turn: askedTurns.length === 1 ? askedTurns[0] : null,
      ...(askedTurns.length <= 1 ? {} : { turns: askedTurns }),
      exchange: null,
    }
  }
  return { problem: null, events, messages: messages ?? events, groups: wanted.length === 0 ? null : wanted, turn: null, exchange: null }
}

/** What the render says about the selection, so a reading names the evidence it was given. */
export function selectionNote(value) {
  const groups = Array.isArray(value?.groups) ? value.groups : null
  const turn = value?.turn ?? null
  const turns = Array.isArray(value?.turns) ? value.turns : null
  if (groups === null && turn === null && turns === null) return ''
  const where = turns === null ? (turn === null ? null : 'turn ' + turn) : 'turns ' + turns[0] + '-' + turns[turns.length - 1] + ' (' + turns.length + ')'
  const label = [groups === null ? null : groups.join('+'), where].filter((p) => p !== null).join(', ')
  const exchange = value?.exchange
  if (exchange === undefined || exchange === null) return '\n  EVIDENCE: ' + label
  const excluded = Array.isArray(exchange.excluded) ? exchange.excluded : []
  const count = excluded.reduce((total, entry) => total + entry.count, 0)
  const chars = excluded.reduce((total, entry) => total + entry.chars, 0)
  return '\n  EVIDENCE: ' + label + ' -- ' + exchange.exchanges + ' of ' + exchange.of + ' exchange(s)'
    + (exchange.unanswered > 0 ? ', ' + exchange.unanswered + ' unanswered' : '')
    + (count === 0 ? '' : '; EXCLUDED ' + count + ' harness `user/message`(s) worth ' + chars + ' chars (' + excluded.map((entry) => entry.kind + ' ' + entry.count).join(', ') + ')')
}
