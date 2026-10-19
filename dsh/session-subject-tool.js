// SYSTEM1_SESSION_SUBJECT: the SUBJECT a judgement is composed from -- and nothing else.
//
// WHY THIS IS A NEW NAME AND A SMALLER TOOL. It used to be `system1_sessions`, with four actions. Three of them
// (`list`, `search`, `refresh`) answered questions `dsh-session-index` already answers from a SQLite store in
// milliseconds, while this tool's `list` went through the harness's `sessionQuery` and resolved a title for every
// row -- measured at ~54 s against the store's 78 ms, on a library of 834 sessions. That is not a faster path, it is
// a second answer to the same question, and two answers is the failure class this repository keeps recording.
//
// SO: FINDING moved out, and this tool kept the one thing the store cannot do.
//
//   FIND a session    -> `session_index_list` (id, title, cwd), `session_index_search` (full text over message text,
//                        reasoning, tool results and tool arguments), `session_index_refresh` (bring the store
//                        current, incrementally, in a child process)
//   READ ITS SUBJECT  -> this tool
//
// WHY READING IS NOT THE STORE'S JOB. `session_index_read` returns messages as `{role, text}` plus counts, and it is
// right to: a session library that carried a judge's budget, a composer and an observe allow-list would be useless to
// a deployment that measures nothing. What a judgement needs is the WINDOW -- the events, `tool/call` and
// `tool/result` included -- because the composer hands `assembleToolCalls` the surface and not the messages: filtering
// to messages first discards the whole tool record, which is the defect `lib/tool-blocks.js` was written about.
//
// TWO FACTS THIS TOOL OWNS AND CANNOT DELEGATE:
//   * `newest` is resolved against the harness service and sorted by `header.createdAt`, because a parameter must not
//     promise a value it then rejects;
//   * the SURFACE. `composeTurnState` filters to what survived `surfaceOp: replace`, and a stored subject asks the host
//     which seqs are current (`currentSurfaceSeqs`). The store excludes replaced ranges too, but by its own rule and
//     without the host's answer -- so the two are adjacent, not interchangeable, and this one keeps the host's.
//
// TWO RULES, both learned the hard way in this repository:
//   1. `checkAgainst` THROWS on a bad argument; it does not return a problem.
//   2. The runtime's enforced schema subset takes a SCALAR `type`, so a field that is absent half the time is OMITTED
//      rather than declared as nullable.
import { checkAgainst } from '../core/tool-args.js'
import { describeToolCut } from './tool-blocks.js'
import { readStoredSubject, SUBJECT_KINDS } from 'dsh-session-adapter/reader'
import { displayTextOfEvent, isAssistantMessage } from 'dsh-session-adapter/session-format'

export const SUBJECT_TOOL_NAME = 'system1_session_subject'

const DESCRIPTION = [
  'Read the SUBJECT a judgement is composed from: one stored session\'s operator and assistant messages, sliced by',
  '`kinds` and `lastMessages` EXACTLY as `system1_evaluate_session` slices them -- so an agent can see what would be',
  'judged before spending a model call. `format: "subject"` returns the composed state itself, through the same',
  'composer, with the tool cut reported, so a preview never reads as complete. This tool does NOT find sessions:',
  '`session_index_list` finds them by title, id or working directory, `session_index_search` runs full text over message',
  'text, reasoning, tool results and tool arguments, and `session_index_refresh` brings that store current -- all three',
  'answered from a SQLite index rather than the harness service, which is why they are milliseconds where a listing',
  'here was tens of seconds.',
  '`sessionId` accepts `newest`, resolved against the harness by `createdAt`. `offset` pages BACKWARDS from the newest,',
  'so a session larger than any prompt is read a page at a time: `lastMessages: 20, offset: 20` is the twenty before the',
  'newest twenty. Every answer carries `coverage` -- how much conversation the session holds against how much was read,',
  'because a slice with no denominator reads like the whole thing. Multi-frame session logs are the harness\'s problem',
  'and not the caller\'s: this reads through the harness\'s own `sessionQuery` service.',
].join(' ')

const parameters = {
  type: 'object',
  additionalProperties: false,
  properties: {
    sessionId: { type: 'string', description: 'The stored session to read, or `newest` for the most recently created one. Find one with `session_index_list` or `session_index_search` first.' },
    kinds: { type: 'array', items: { type: 'string' }, description: 'Which message kinds to include. Known: operator, assistant.' },
    lastMessages: { type: 'number', description: 'How many of the newest messages to include. 0 is all of them.' },
    offset: { type: 'number', description: 'How many of the NEWEST messages to SKIP, so a session larger than any prompt can be read a page at a time with `lastMessages` as the page size. `lastMessages: 20, offset: 20` is the twenty before the newest twenty. Defaults to 0.' },
    messageChars: { type: 'number', description: 'How many characters of EACH message to show. Defaults to 400. 0 shows every message whole, which on a long session is far more than a prompt holds -- page with `offset` instead when the answer is no.' },
    format: { type: 'string', enum: ['messages', 'subject'], description: '`messages` returns the operator and assistant text; `subject` returns the COMPOSED STATE an evaluation would judge, through the same composer and session scope `system1_evaluate_session` uses. Defaults to `messages`.' },
  },
}

/**
 * THE OUTPUT CONTRACT.
 *
 * Every field the tool emits is declared, which a test enforces: an undeclared field is a value the runtime's schema
 * cannot describe, and the enforced subset takes a SCALAR `type`, so a field absent half the time is OMITTED rather
 * than declared as nullable. The `list`/`search`/`refresh` fields this schema used to declare are gone with those
 * actions -- a schema that still described a `subagents` breakdown would describe a question this tool no longer answers.
 */
const OUTPUT_SCHEMA = {
  schema: {
    type: 'object', additionalProperties: false,
    properties: {
      session: {
        type: 'object', additionalProperties: false,
        description: 'Which session was read.',
        properties: { id: { type: 'string' }, cwd: { type: 'string' }, createdAt: { type: 'number' }, title: { type: 'string' } },
      },
      slice: {
        type: 'object', additionalProperties: false,
        description: 'THE WINDOW: what was matched, out of what the session holds, and which page of it this is. `unknownKinds` names a kind the row asked for that this repository does not read -- silence there would be a judgement over less than was asked for.',
        properties: {
          matched: { type: 'number' },
          total: { type: 'number' },
          unknownKinds: { type: 'array', items: { type: 'string' } },
          page: { type: 'object', additionalProperties: false, properties: { offset: { type: 'number' }, from: { type: 'number' }, to: { type: 'number' }, of: { type: 'number' } } },
        },
      },
      coverage: {
        type: 'object', additionalProperties: false,
        description: 'HOW MUCH CONVERSATION THERE IS AGAINST HOW MUCH WAS READ. Without it, "611 of 2995 event(s)" said nothing about the 259,439 characters a judgement is cut from (register row O26).',
        properties: { events: { type: 'number' }, messages: { type: 'number' }, chars: { type: 'number' }, toolEvents: { type: 'number' } },
      },
      messages: {
        type: 'array',
        description: 'The messages a CALLER lists. NOT the event window: a tool result arrives on the user channel, so listing events would show it as an operator message.',
        items: { type: 'object', additionalProperties: false, properties: { role: { type: 'string' }, text: { type: 'string' } } },
      },
      messageChars: { type: 'number', description: 'The per-message cap that was applied.' },
      clipped: { type: 'number', description: 'How many messages the render cut. A message shown to 400 of 9,000 characters reads as a short message, so the count is reported rather than left to be noticed.' },
      count: { type: 'number', description: 'How many messages are returned.' },
      total: { type: 'number', description: 'How many events the whole session holds.' },
      state: { type: 'string', description: 'For `format: "subject"`: the composed state a judgement would be shown.' },
      toolCalls: {
        type: 'object', additionalProperties: false,
        description: 'For `format: "subject"`: what the composer ACTUALLY showed of the tool record, because `toolBlockMaxChars` cuts it from the START -- so a judgement may carry 3 of 529 calls and the last ones are the ones missing.',
        properties: {
          calls: { type: 'number' },
          results: { type: 'number' },
          shown: { type: 'object', additionalProperties: false, properties: { calls: { type: 'number' }, results: { type: 'number' } } },
          kept: { type: 'string' },
          truncated: { type: 'boolean' },
        },
      },
      stateTruncated: { type: 'boolean', description: 'For `format: "subject"`: whether the state was cut. `state: 8000 chars` with no marker reads as the whole subject.' },
      problems: { type: 'array', items: { type: 'string' }, description: 'Named problems. An empty list is a real answer, not an absence of one.' },
    },
  },

  /**
   * THE RENDER, carried over from the `read` branch of the retired four-action tool.
   *
   * It is not decoration: a tool whose value is a JSON blob costs an agent the same reading either way, and the
   * three lines that matter most are the ones a schema cannot say -- the DENOMINATOR (`the whole session: …`), the
   * tool cut, and whether the preview was truncated. Each of those is a number a caller would otherwise have to
   * compute before it could trust the page it is looking at.
   */
  render(_args, value) {
    const lines = []
    lines.push(`session ${value.session?.id ?? '?'} ${value.session?.title === undefined ? '' : '"' + value.session.title + '"'} ${value.session?.cwd ?? ''}`)
    lines.push(`  ${value.slice?.matched ?? 0} of ${value.slice?.total ?? 0} event(s) matched`)
    // THE DENOMINATOR, SAID OUT LOUD -- register row O26. A judgement is cut from this text, so a reader who cannot
    // see it cannot tell a reading of the conversation from a reading of its first and last pages.
    const cov = value.coverage
    if (cov !== undefined && cov.events > 0) {
      lines.push(`  the whole session: ${cov.events} event(s), ${cov.messages} message(s), ${cov.chars} char(s) of message text, ${cov.toolEvents} tool event(s)`)
      lines.push('  the slice carries the tool calls AND their results, so a question about what a lookup returned has the result to read')
    }
    if (value.session?.id !== undefined && (value.messages ?? []).length === 0 && (value.slice?.total ?? 0) === 0) {
      // THE STUB CASE, NAMED: a created-but-never-appended session has a header and nothing else, and "0 messages"
      // without that sentence reads as a bug in this tool rather than a fact about the session.
      lines.push('  this session has NO event log: it was created and never appended to, so there is no content to read')
    }
    if (value.toolCalls !== undefined && value.toolCalls.calls > 0) {
      lines.push('  TOOL CALLS the judge would see: ' + describeToolCut(value.toolCalls))
    }
    if (value.state !== undefined) {
      lines.push(`  state: ${value.state.length} chars (composed from the whole log, as an evaluation composes it)`
        + (value.stateTruncated === true ? ' -- TRUNCATED at `composeMaxChars`, so the judge would see this cut; a smaller `lastMessages` page fits whole' : ''))
      lines.push(value.state.slice(0, 400).split('\n').map((l) => '    ' + l).join('\n'))
    }
    const budget = typeof value.messageChars === 'number' ? value.messageChars : 400
    for (const message of value.messages ?? []) {
      lines.push(`  ${message.role}: ${budget === 0 ? message.text : message.text.slice(0, budget)}${budget === 0 || message.text.length <= budget ? '' : '\u2026 (' + (message.text.length - budget) + ' more chars)'}`)
    }
    if ((value.clipped ?? 0) > 0) lines.push(`  ${value.clipped} message(s) are longer than \`messageChars\` ${budget}: raise it, or read them whole with \`messageChars: 0\``)
    const page = value.slice?.page
    if (page !== undefined && page.of > 0) {
      lines.push(`  page: messages ${page.from + 1}-${page.to} of ${page.of}${page.offset > 0 ? ' (the newest ' + page.offset + ' skipped -- raise `offset` to read further back)' : ''}`)
    }
    for (const problem of value.problems ?? []) lines.push('PROBLEM: ' + problem)
    return [{ type: 'text', text: lines.join('\n') }]
  },
}

export function createSessionSubjectTool({ query, read = readStoredSubject, settings = () => ({}), compose = null } = {}) {
  // `query` MAY BE THE SERVICE OR A THUNK. The registration passes a thunk on purpose -- `sessionQuery` is captured by
  // a `ctx.inject` callback that may run AFTER the tools block, so reading it at apply time would freeze `undefined`.
  // That is the bug the first live call found: `UNAVAILABLE: no session-query service is mounted`.
  const service = () => (typeof query === 'function' ? query() : query)
  const ok = () => service() !== undefined && service() !== null && typeof service().readSession === 'function'

  /** `newest` resolved against the service, never passed through: a parameter must not promise a value it rejects. */
  async function resolveId(asked) {
    if (asked !== 'newest') return { id: asked }
    try {
      const records = await service().listSessions()
      const newest = (records ?? []).slice().sort((a, b) => (b?.header?.createdAt ?? 0) - (a?.header?.createdAt ?? 0))[0]?.header?.id
      return newest === undefined ? { problem: 'no session is available to resolve `newest` against' } : { id: String(newest) }
    } catch (error) {
      return { problem: 'listing sessions failed: ' + (error instanceof Error ? error.message : String(error)) }
    }
  }

  async function titleOf(id) {
    if (typeof service().readTitleSnapshots !== 'function') return undefined
    try {
      for (const result of await service().readTitleSnapshots([id])) {
        const title = result?.value?.title?.title
        if (typeof title === 'string' && title !== '') return title
      }
    } catch {
      // A TITLE IS A CONVENIENCE, NEVER A GATE: a service that cannot fold titles still reads the session.
    }
    return undefined
  }

  return {
    name: SUBJECT_TOOL_NAME,
    description: DESCRIPTION,
    parameters,
    output: OUTPUT_SCHEMA,
    async execute(args, exec) {
      // THE CALLER'S CANCELLATION, HONOURED BEFORE ANY WORK (`reference/cookbook/adding-a-tool.md`). What this does
      // cannot be interrupted mid-flight, so the entry check is the honest maximum -- stated rather than left to silence.
      if (exec?.signal?.aborted === true) throw new Error('the call was cancelled before it started')
      let asked
      try {
        checkAgainst(parameters, args ?? {}, SUBJECT_TOOL_NAME)
        asked = args ?? {}
      } catch (error) {
        return { problems: [error instanceof Error ? error.message : String(error)] }
      }
      if (!ok()) return { problems: ['no session-query service is mounted, so a stored session cannot be read'] }

      const resolved = await resolveId(String(asked.sessionId ?? ''))
      if (resolved.problem !== undefined) return { problems: [resolved.problem] }
      if (resolved.id === undefined || resolved.id === '') return { problems: ['`sessionId` is required'] }

      const configured = settings() ?? {}
      const kinds = Array.isArray(asked.kinds) && asked.kinds.length > 0 ? asked.kinds : (Array.isArray(configured.kinds) ? configured.kinds : Object.keys(SUBJECT_KINDS))
      const lastMessages = typeof asked.lastMessages === 'number' ? asked.lastMessages : (typeof configured.lastMessages === 'number' ? configured.lastMessages : 10)
      const offset = typeof asked.offset === 'number' && asked.offset > 0 ? Math.floor(asked.offset) : 0
      const messageChars = typeof asked.messageChars === 'number' && asked.messageChars >= 0 ? Math.floor(asked.messageChars) : 400
      const subject = await read({ sessionQuery: service(), sessionId: resolved.id, kinds, lastMessages, offset })
      const problems = subject.problem === null || subject.problem === undefined ? [] : [subject.problem]

      const session = { id: resolved.id }
      const header = subject.session ?? {}
      if (header.cwd !== undefined) session.cwd = String(header.cwd)
      if (header.createdAt !== undefined) session.createdAt = Number(header.createdAt)
      const title = await titleOf(resolved.id)
      if (title !== undefined) session.title = title

      const format = String(asked.format ?? 'messages')
      let state
      let toolCalls
      let stateTruncated = false
      if (format === 'subject') {
        if (typeof compose !== 'function') {
          problems.push('no composer is wired, so the subject cannot be composed here -- read `messages` instead')
        } else {
          // THE SUBJECT IS COMPOSED FROM THE WHOLE LOG, which is what an evaluation does: `lastMessages` bounds what
          // `messages` SHOWS, and must not silently bound what a judgement would be SHOWN.
          const whole = await read({ sessionQuery: service(), sessionId: resolved.id, kinds, lastMessages: 0, offset })
          // AWAITED AND WITH THE SESSION ID: the composer asks the host which events are in the CURRENT surface
          // before falling back to the fold, and only a caller that can await may do that.
          const composed = await compose(whole.events ?? [], undefined, resolved.id)
          state = typeof composed === 'string' ? composed : String(composed?.text ?? composed?.state ?? '')
          if (composed !== null && typeof composed === 'object') {
            if ((composed.toolCalls?.calls ?? 0) > 0) toolCalls = composed.toolCalls
            // WHETHER THE PREVIEW WAS CUT, which is the one thing a preview must not hide.
            stateTruncated = composed.truncated === true
          }
        }
      }

      const messages = (subject.messages ?? []).map((event) => ({
        role: isAssistantMessage(event) ? 'AGENT' : 'OPERATOR',
        text: displayTextOfEvent(event),
      })).filter((message) => message.text !== '')
      const clipped = messageChars === 0 ? 0 : messages.filter((message) => message.text.length > messageChars).length

      return {
        session,
        slice: {
          matched: subject.slice?.matched ?? 0,
          total: subject.slice?.total ?? 0,
          unknownKinds: subject.slice?.unknownKinds ?? [],
          page: subject.slice?.page ?? { offset, from: 0, to: 0, of: 0 },
        },
        coverage: {
          events: subject.coverage?.events ?? 0,
          messages: subject.coverage?.messages ?? 0,
          chars: subject.coverage?.chars ?? 0,
          toolEvents: subject.coverage?.toolEvents ?? 0,
        },
        messages,
        messageChars,
        clipped,
        count: messages.length,
        total: subject.slice?.total ?? 0,
        ...(state === undefined ? {} : { state }),
        ...(toolCalls === undefined ? {} : { toolCalls }),
        ...(state === undefined ? {} : { stateTruncated }),
        problems,
      }
    },
  }
}
