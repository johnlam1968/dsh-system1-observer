// SYSTEM1_SESSIONS: let an AGENT find a session and read its content.
//
// DSH gives an agent `peer_sessions`/`peer_transcript`, which reach LIVE sessions in this process, and it gives a PLUGIN
// `ctx.sessionQuery` (`listSessions`, `readSession`, `readTitleSnapshots`) and `ctx.sessionPersistence` (`inspect`,
// `readFrom`). CORRECTION (F97): there IS one in between -- `@deepseek-ai/dsh-tool-session-query`, five read-only
// agent tools, OPT-IN and not mounted here, and none composes the SUBJECT a judgement would see: that is this tool's
// reason to exist. Every historical read otherwise had to be a shell script and a hand-rolled decoder -- how I mis-read three
// scans in a row, one of them because `zstdDecompressSync` decodes only the FIRST frame of a multi-frame log.
//
// So this is the missing half of the plugin's session story:
//   `list` -- find a session by cwd, availability or a title/id substring.
//   `read` -- get its content: the operator/assistant messages, sliced the same way `system1_evaluate_session` slices
//            them, so an agent can SEE what would be judged before spending a model call.
//
// TWO RULES, both learned the hard way in this repository:
//   1. `checkAgainst` THROWS on a bad argument; it does not return a problem. An earlier tool read `.problem` off its
//      `undefined` return and failed every call.
//   2. The runtime's enforced schema subset takes a SCALAR `type`, so a field that is absent half the time is OMITTED
//      rather than declared as nullable.
import { checkAgainst } from './tool-args.js'
import { readStoredSubject, SUBJECT_KINDS } from 'dsh-session-adapter/reader'
import { displayTextOfEvent, isAssistantMessage } from 'dsh-session-adapter/session-format'
import { runSearch } from './sessions-search.js'
import { OUTPUT_SCHEMA } from './sessions-tool-output.js'
import { refreshIndex } from 'dsh-session-index/refresh'

// `textOf` IS DEFINED WHERE THE HARNESS'S SHAPES ARE -- `dsh-session-adapter/session-format` -- and it is re-exported under
// its old name because this module's public surface has always carried it. THIS READER is the display one: a line
// shown to a person joins a message's text blocks with a space, where the judge's text joins them with nothing.
export { displayTextOfEvent as textOf }

export const SESSIONS_TOOL_NAME = 'system1_sessions'

const DESCRIPTION = [
  'Find a session and read its content -- stored or live, this profile or another. `list` finds them by `cwd`,',
  '`availability` (live or persisted) or a `search` substring of the title or id, newest first, with titles folded from',
  'the log. `read` returns one session\'s operator and assistant messages, sliced by `kinds` and `lastMessages` exactly',
  'as `system1_evaluate_session` would slice them -- so an agent can see what would be judged BEFORE spending a model',
  'call. `newest` is accepted as a session id. Reads the harness\'s own `sessionQuery` service, so multi-frame session',
  'logs are the harness\'s problem and not the caller\'s. `list` marks which rows are in the OBSERVE ALLOW-LIST -- the',
  'sessions the observer will actually measure. `search` is FULL TEXT over message text, REASONING, tool results and',
  'tool arguments -- through the harness\'s own session index when it answers, and through this repository\'s hand-rolled',
  'store when it does not (this deployment leaves that index at `openAt: never`), with WHICH ONE ANSWERED stated in the',
  'result and the first one\'s failure carried as a problem. `list`\'s `search` argument is only a substring of a title,',
  'an id or a directory, which cannot find a phrase inside a conversation. CORRECTION (F97):',
  '`@deepseek-ai/dsh-tool-session-query` ships five read-only agent tools -- OPT-IN, not mounted here -- and what only',
  'this plugin returns is the SUBJECT an evaluation composes. `refresh` rebuilds the store behind `search`,',
  'incrementally and in its own process, for the sessions that CHANGED since the last build (a living session is only',
  'as fresh as that build, and the rebuild reports how many files it re-read).',
].join(' ')

const parameters = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', enum: ['list', 'read', 'search', 'refresh'], description: 'What to do: `list` finds sessions, `read` returns one session\'s content, `search` scans message text, `refresh` brings the store behind `search` up to date.' },
    limit: { type: 'number', description: 'For `list`: how many sessions to return. Defaults to 20.' },
    cwd: { type: 'string', description: 'For `list`: only sessions whose working directory equals this.' },
    availability: { type: 'string', enum: ['live', 'persisted'], description: 'For `list`: only sessions that are live now, or only those on disk.' },
    search: { type: 'string', description: 'For `list`: a case-insensitive substring of the title, the id or the WORKING DIRECTORY. The directory is often the reliable handle -- a title is a summary of the work (the session in ~/CodingProjects/zeroclaw-voice-proxy is titled "Push repo to GitHub account"). For text INSIDE a conversation use `action: "search"` instead.' },
    query: { type: 'string', description: 'For `search`: the full-text query. It is passed to the harness as DATA, never as FTS syntax, so quotes and operators in it are literal characters.' },
    sessionId: { type: 'string', description: 'For `read`: the session to read, or `newest` for the most recently created one.' },
    kinds: { type: 'array', items: { type: 'string' }, description: 'For `read`: which message kinds to include. Known: operator, assistant.' },
    lastMessages: { type: 'number', description: 'For `read`: how many of the newest messages to include. 0 is all of them.' },
    offset: { type: 'number', description: 'For `read`: how many of the NEWEST messages to SKIP, so a session larger than any prompt can be read a page at a time with `lastMessages` as the page size. `lastMessages: 20, offset: 20` is the twenty before the newest twenty. Defaults to 0.' },
    messageChars: { type: 'number', description: 'For `read`: how many characters of EACH message to show. Defaults to 400. 0 shows every message whole, which on a long session is far more than a prompt holds -- page with `offset` instead when the answer is no.' },
    timeoutMs: { type: 'number', description: 'For `refresh`: how long to WAIT for the rebuild before reporting it as still running. Defaults to 120000. One living 33 MB session measured 110 s to refold, so a SHORTER value is a way to start a refresh and come back to it -- the child keeps working either way, and the store stays readable.' },
    format: { type: 'string', enum: ['messages', 'subject'], description: 'For `read`: `messages` returns the operator and assistant text; `subject` returns the COMPOSED STATE an evaluation would judge, through the same composer and session scope `system1_evaluate_session` uses -- so an agent can see exactly what would be judged before spending a model call. Defaults to `messages`.' },
  },
}

/** One row per session, joined with its folded title when the caller can supply titles. */
export function rowsOf(records, titleById = new Map(), { cwd = null, availability = null, search = null, limit = 20, observed = null } = {}) {
  const wanted = typeof search === 'string' && search.trim() !== '' ? search.trim().toLowerCase() : null
  const rows = []
  for (const record of records ?? []) {
    const header = record?.header ?? {}
    const id = String(header.id ?? '')
    if (id === '') continue
    if (cwd !== null && String(header.cwd ?? '') !== cwd) continue
    if (availability === 'live' && record?.live !== true) continue
    if (availability === 'persisted' && record?.persisted !== true) continue
    const title = titleById.get(id)
    // THE PROJECT IS A HANDLE; THE TITLE IS NOT. A title is a fallback or an LLM summary of the WORK -- the session in
    // `~/CodingProjects/zeroclaw-voice-proxy` is titled "Push repo to GitHub account" -- so an agent looking for "the
    // session in project X" reaches for a name no title contains. `cwd` is stable and is what the search must include.
    const where = String(header.cwd ?? '').toLowerCase()
    if (wanted !== null && !id.toLowerCase().includes(wanted) && !String(title ?? '').toLowerCase().includes(wanted) && !where.includes(wanted)) continue
    const row = { id, live: record?.live === true, persisted: record?.persisted === true }
    // THE OBSERVED SET IS THE ONE THAT WILL BE MEASURED. It is the row's own allow-list -- written by the session's
    // "..." menu in the UI -- and its matching rule lives in `lib/sessions.js`, never here: a second implementation of
    // a scoping gate is a second answer to "which conversation reaches a model".
    if (observed !== null) row.observed = observed(id) === true
    if (header.cwd !== undefined) row.cwd = String(header.cwd)
    if (header.createdAt !== undefined) row.createdAt = Number(header.createdAt)
    if (title !== undefined) row.title = title
    rows.push(row)
  }
  rows.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
  const bounded = typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? rows.slice(0, Math.floor(limit)) : rows
  return { rows: bounded, total: rows.length }
}

export function createSessionsTool({ query, read = readStoredSubject, settings = () => ({}), compose = null, observed = null, indexPath = null, refresh = refreshIndex } = {}) {
  // `query` MAY BE THE SERVICE OR A THUNK. The registration passes a thunk on purpose -- `sessionQuery` is captured by
  // a `ctx.inject` callback that may run AFTER the tools block, so reading it at apply time would freeze `undefined`.
  // This is the bug the first live call found: `UNAVAILABLE: no session-query service is mounted`, because the factory
  // read `query.listSessions` off the thunk itself.
  const service = () => (typeof query === 'function' ? query() : query)
  const empty = { action: 'list', count: 0, total: 0, sessions: [], problems: [] }
  const ok = () => service() !== undefined && service() !== null && typeof service().listSessions === 'function'

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

  async function titlesFor(ids) {
    const byId = new Map()
    if (typeof service().readTitleSnapshots !== 'function' || ids.length === 0) return byId
    try {
      for (const result of await service().readTitleSnapshots(ids)) {
        const title = result?.value?.title?.title
        if (typeof title === 'string' && title !== '') byId.set(String(result.sessionId), title)
      }
    } catch {
      // A TITLE IS A CONVENIENCE, NEVER A GATE: a backend that cannot fold titles still lists sessions.
    }
    return byId
  }

  return {
    name: SESSIONS_TOOL_NAME,
    description: DESCRIPTION,
    parameters,
    output: OUTPUT_SCHEMA,
    async execute(args) {
      let asked
      try {
        checkAgainst(parameters, args ?? {}, SESSIONS_TOOL_NAME)
        asked = args ?? {}
      } catch (error) {
        return { ...empty, problem: error instanceof Error ? error.message : String(error) }
      }
      const action = String(asked.action ?? 'list')
      // `search` AND `refresh` CAN BE ANSWERED WITHOUT THE SERVICE, because the hand-rolled store is a file on disk and
      // the rebuild is a script. `list` and `read` need `sessionQuery`, and say so rather than returning nothing.
      if (!ok() && action !== 'search' && action !== 'refresh') {
        return { ...empty, action, problem: 'no session-query service is mounted, so sessions cannot be listed or read' }
      }

      if (action === 'refresh') {
        // THE STORE IS A SNAPSHOT, so `search` is only as fresh as the last build. This is how an agent closes that gap
        // from inside the conversation. It runs in a CHILD PROCESS (see the `dsh-session-index` package): a rebuild
        // refolds tens of megabytes of logs, and doing that here would block the harness -- including the very session
        // being measured.
        const refreshOptions = indexPath === null ? {} : { out: indexPath }
        if (typeof asked.timeoutMs === 'number' && asked.timeoutMs > 0) refreshOptions.timeoutMs = Math.floor(asked.timeoutMs)
        const refreshed = await refresh(refreshOptions)
        return { action, ...refreshed }
      }

      if (action === 'search') {
        const query = typeof asked.query === 'string' ? asked.query.trim() : ''
        if (query === '') return { ...empty, action, query: '', problems: ['`query` is required for `search`'] }
        // TWO BACKENDS, ONE POLICY, AND IT SAYS WHICH ANSWERED: see `lib/sessions-search.js`.
        return await runSearch({
          query,
          limit: typeof asked.limit === 'number' && asked.limit > 0 ? Math.floor(asked.limit) : 20,
          service: service(),
          titlesFor,
          indexPath,
        })
      }

      if (action === 'list') {
        let records
        try {
          records = await service().listSessions()
        } catch (error) {
          return { ...empty, problem: 'listing sessions failed: ' + (error instanceof Error ? error.message : String(error)) }
        }
        const scope = typeof observed === 'function' ? observed() : null
        const trimmed = rowsOf(records, await titlesFor((records ?? []).map((r) => String(r?.header?.id ?? '')).filter((id) => id !== '')), {
          cwd: asked.cwd ?? null,
          availability: asked.availability ?? null,
          search: asked.search ?? null,
          limit: typeof asked.limit === 'number' ? asked.limit : 20,
          observed: scope === null ? null : (id) => scope.match(id) === true,
        })
        return {
          action,
          count: trimmed.rows.length,
          total: trimmed.total,
          sessions: trimmed.rows,
          observesEverySession: scope !== null && scope.every === true,
          observedCount: trimmed.rows.filter((row) => row.observed === true).length,
          problems: [],
        }
      }

      const resolved = await resolveId(String(asked.sessionId ?? ''))
      if (resolved.problem !== undefined) return { ...empty, action, problems: [resolved.problem] }
      if (resolved.id === undefined || resolved.id === '') return { ...empty, action, problems: ['`sessionId` is required for `read`'] }
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
      const titles = await titlesFor([resolved.id])
      if (titles.has(resolved.id)) session.title = titles.get(resolved.id)
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
          // THE PREVIEW REPORTS THE TOOL CUT TOO, so an agent can see that a judgement would carry 3 of 529 calls
          // BEFORE spending a model call -- which is the whole reason this tool exists.
          // ABSENT MEANS NO TOOL CALLS rather than unmeasured, matching `lib/evaluate-tool.js`.
          if (composed !== null && typeof composed === 'object') {
            if ((composed.toolCalls?.calls ?? 0) > 0) toolCalls = composed.toolCalls
            // WHETHER THE PREVIEW WAS CUT, which is the one thing a preview must not hide: `state: 8000 chars` with no
            // marker reads as the whole subject. Measured at the live defaults, a stored judgement fits FIVE messages
            // whole (6.9k-char pages are cut); the tool section's own bound is reported above.
            stateTruncated = composed.truncated === true
          }
        }
      }
      // THE MESSAGES A CALLER LISTS ARE `subject.messages`, NOT `subject.events`. `events` is the WINDOW the composer
      // is handed -- messages with the tool calls and results between them -- and listing it here would have shown a
      // tool result as a message with role OPERATOR, because a tool result arrives on the user channel.
      const messages = (subject.messages ?? []).map((event) => ({
        role: isAssistantMessage(event) ? 'AGENT' : 'OPERATOR',
        text: displayTextOfEvent(event),
      })).filter((message) => message.text !== '')
      // HOW MANY MESSAGES THE RENDER CUT, counted rather than left to be noticed: a message shown to 400 of 9,000
      // characters reads as a short message. `0` for `messageChars` means show them whole and clip nothing.
      const clipped = messageChars === 0 ? 0 : messages.filter((message) => message.text.length > messageChars).length
      return {
        action,
        session,
        slice: {
          matched: subject.slice?.matched ?? 0,
          total: subject.slice?.total ?? 0,
          unknownKinds: subject.slice?.unknownKinds ?? [],
          page: subject.slice?.page ?? { offset, from: 0, to: 0, of: 0 },
        },
        messageChars,
        clipped,
        // HOW MUCH CONVERSATION THERE IS AGAINST HOW MUCH WAS READ. Without it "611 of 2995 event(s)" said nothing
        // about the 259,439 characters a judgement is cut from -- register row O26.
        coverage: {
          events: subject.coverage?.events ?? 0,
          messages: subject.coverage?.messages ?? 0,
          chars: subject.coverage?.chars ?? 0,
          toolEvents: subject.coverage?.toolEvents ?? 0,
        },
        messages,
        ...(state === undefined ? {} : { state }),
        ...(toolCalls === undefined ? {} : { toolCalls }),
        ...(state === undefined ? {} : { stateTruncated }),
        count: messages.length,
        total: subject.slice?.total ?? 0,
        sessions: [],
        problems,
      }
    },
  }
}
