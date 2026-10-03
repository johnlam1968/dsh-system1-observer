// SYSTEM1_SESSIONS: let an AGENT find a session and read its content.
//
// DSH gives an agent `peer_sessions`/`peer_transcript`, which reach LIVE sessions in this process, and it gives a PLUGIN
// `ctx.sessionQuery` (`listSessions`, `readSession`, `readTitleSnapshots`) and `ctx.sessionPersistence` (`inspect`,
// `readFrom`). Nothing in between: an agent had no way to name a stored session, so every historical read in this
// repository had to be done with a shell script and a hand-rolled decoder -- which is exactly how I mis-read three
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
import { readStoredSubject, SUBJECT_KINDS } from './session-subject.js'

export const SESSIONS_TOOL_NAME = 'system1_sessions'

const DESCRIPTION = [
  'Find a session and read its content -- stored or live, this profile or another. `list` finds them by `cwd`,',
  '`availability` (live or persisted) or a `search` substring of the title or id, newest first, with titles folded from',
  'the log. `read` returns one session\'s operator and assistant messages, sliced by `kinds` and `lastMessages` exactly',
  'as `system1_evaluate_session` would slice them -- so an agent can see what would be judged BEFORE spending a model',
  'call. `newest` is accepted as a session id. Reads the harness\'s own `sessionQuery` service, so multi-frame session',
  'logs are the harness\'s problem and not the caller\'s. THIS IS NOT A SEARCH TOOL: full-text search over the session',
  'library, recall as @ references and the tab bar belong to the session-library plugins a human uses (dsh-session-workbench,',
  'dsh-advancesearch -- both UI-first, neither exposing a host tool). What only this plugin can return is the SUBJECT an',
  'evaluation composes, which is why `read` offers it.',
].join(' ')

const parameters = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', enum: ['list', 'read'], description: 'What to do: `list` finds sessions, `read` returns one session\'s content.' },
    limit: { type: 'number', description: 'For `list`: how many sessions to return. Defaults to 20.' },
    cwd: { type: 'string', description: 'For `list`: only sessions whose working directory equals this.' },
    availability: { type: 'string', enum: ['live', 'persisted'], description: 'For `list`: only sessions that are live now, or only those on disk.' },
    search: { type: 'string', description: 'For `list`: a case-insensitive substring of the title or the id.' },
    sessionId: { type: 'string', description: 'For `read`: the session to read, or `newest` for the most recently created one.' },
    kinds: { type: 'array', items: { type: 'string' }, description: 'For `read`: which message kinds to include. Known: operator, assistant.' },
    lastMessages: { type: 'number', description: 'For `read`: how many of the newest messages to include. 0 is all of them.' },
    format: { type: 'string', enum: ['messages', 'subject'], description: 'For `read`: `messages` returns the operator and assistant text; `subject` returns the COMPOSED STATE an evaluation would judge, through the same composer and session scope `system1_evaluate_session` uses -- so an agent can see exactly what would be judged before spending a model call. Defaults to `messages`.' },
  },
}

/** The text of one message event, as the harness records it: a string, or content blocks carrying `text`. */
export function textOf(event) {
  const content = event?.data?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((block) => (typeof block === 'string' ? block : (block?.text ?? ''))).join(' ').trim()
  return ''
}

/** One row per session, joined with its folded title when the caller can supply titles. */
export function rowsOf(records, titleById = new Map(), { cwd = null, availability = null, search = null, limit = 20 } = {}) {
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
    if (wanted !== null && !id.toLowerCase().includes(wanted) && !String(title ?? '').toLowerCase().includes(wanted)) continue
    const row = { id, live: record?.live === true, persisted: record?.persisted === true }
    if (header.cwd !== undefined) row.cwd = String(header.cwd)
    if (header.createdAt !== undefined) row.createdAt = Number(header.createdAt)
    if (title !== undefined) row.title = title
    rows.push(row)
  }
  rows.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
  const bounded = typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? rows.slice(0, Math.floor(limit)) : rows
  return { rows: bounded, total: rows.length }
}

export function createSessionsTool({ query, read = readStoredSubject, settings = () => ({}), compose = null } = {}) {
  const empty = { action: 'list', count: 0, total: 0, sessions: [], problems: [] }
  const ok = () => query !== undefined && query !== null && typeof query.listSessions === 'function'

  /** `newest` resolved against the service, never passed through: a parameter must not promise a value it rejects. */
  async function resolveId(asked) {
    if (asked !== 'newest') return { id: asked }
    try {
      const records = await query.listSessions()
      const newest = (records ?? []).slice().sort((a, b) => (b?.header?.createdAt ?? 0) - (a?.header?.createdAt ?? 0))[0]?.header?.id
      return newest === undefined ? { problem: 'no session is available to resolve `newest` against' } : { id: String(newest) }
    } catch (error) {
      return { problem: 'listing sessions failed: ' + (error instanceof Error ? error.message : String(error)) }
    }
  }

  async function titlesFor(ids) {
    const byId = new Map()
    if (typeof query.readTitleSnapshots !== 'function' || ids.length === 0) return byId
    try {
      for (const result of await query.readTitleSnapshots(ids)) {
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
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', description: 'What was done.' },
          count: { type: 'number', description: 'For `list`: how many rows are returned.' },
          total: { type: 'number', description: 'For `list`: how many sessions matched before the limit.' },
          sessions: {
            type: 'array',
            description: 'For `list`: the sessions, newest first.',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                cwd: { type: 'string' },
                createdAt: { type: 'number' },
                title: { type: 'string' },
                live: { type: 'boolean' },
                persisted: { type: 'boolean' },
              },
            },
          },
          session: {
            type: 'object',
            description: 'For `read`: which session was read.',
            properties: { id: { type: 'string' }, cwd: { type: 'string' }, createdAt: { type: 'number' }, title: { type: 'string' } },
          },
          slice: {
            type: 'object',
            description: 'For `read`: how the messages were sliced -- `matched` of `total` events, and any kind name that matched nothing.',
            properties: {
              matched: { type: 'number' },
              total: { type: 'number' },
              unknownKinds: { type: 'array', items: { type: 'string' } },
            },
          },
          messages: {
            type: 'array',
            description: 'For `read`: the operator and assistant messages, oldest first.',
            items: { type: 'object', properties: { role: { type: 'string' }, text: { type: 'string' } } },
          },
          state: { type: 'string', description: 'For `read` with `format`: `subject`: the composed state, exactly as `system1_evaluate_session` composes it.' },
          problems: { type: 'array', description: 'Anything that could not be done, named rather than silent.', items: { type: 'string' } },
          problem: { type: 'string', description: 'Set when the call could not be made at all.' },
        },
      },
      render(_args, value) {
        if (typeof value.problem === 'string' && value.problem !== '') return [{ type: 'text', text: 'UNAVAILABLE: ' + value.problem }]
        const lines = []
        if (value.action === 'list') {
          lines.push(`${value.count} of ${value.total} session(s)`)
          for (const row of value.sessions ?? []) {
            lines.push(`  ${row.id} ${row.live ? 'live' : ''}${row.persisted ? 'persisted' : ''} ${row.createdAt === undefined ? '' : new Date(row.createdAt).toISOString().slice(0, 16)} ${row.cwd ?? ''} ${row.title === undefined ? '(no title)' : '"' + row.title + '"'}`)
          }
        } else {
          lines.push(`session ${value.session?.id ?? '?'} ${value.session?.title === undefined ? '' : '"' + value.session.title + '"'} ${value.session?.cwd ?? ''}`)
          lines.push(`  ${value.slice?.matched ?? 0} of ${value.slice?.total ?? 0} event(s) matched`)
          if (value.session?.id !== undefined && (value.messages ?? []).length === 0 && (value.slice?.total ?? 0) === 0) {
            // THE STUB CASE, NAMED: a created-but-never-appended session has a header and nothing else, and "0 messages"
            // without that sentence reads as a bug in this tool rather than a fact about the session.
            lines.push('  this session has NO event log: it was created and never appended to, so there is no content to read')
          }
          if (value.state !== undefined) {
            lines.push(`  state: ${value.state.length} chars (composed from the whole log, as an evaluation composes it)`)
            lines.push(value.state.slice(0, 400).split('\n').map((l) => '    ' + l).join('\n'))
          }
          for (const message of value.messages ?? []) lines.push(`  ${message.role}: ${message.text.slice(0, 400)}`)
        }
        for (const problem of value.problems ?? []) lines.push('PROBLEM: ' + problem)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args) {
      let asked
      try {
        checkAgainst(parameters, args ?? {}, SESSIONS_TOOL_NAME)
        asked = args ?? {}
      } catch (error) {
        return { ...empty, problem: error instanceof Error ? error.message : String(error) }
      }
      if (!ok()) return { ...empty, action: String(asked.action ?? 'list'), problem: 'no session-query service is mounted, so sessions cannot be listed or read' }
      const action = String(asked.action ?? 'list')

      if (action === 'list') {
        let records
        try {
          records = await query.listSessions()
        } catch (error) {
          return { ...empty, problem: 'listing sessions failed: ' + (error instanceof Error ? error.message : String(error)) }
        }
        const trimmed = rowsOf(records, await titlesFor((records ?? []).map((r) => String(r?.header?.id ?? '')).filter((id) => id !== '')), {
          cwd: asked.cwd ?? null,
          availability: asked.availability ?? null,
          search: asked.search ?? null,
          limit: typeof asked.limit === 'number' ? asked.limit : 20,
        })
        return { action, count: trimmed.rows.length, total: trimmed.total, sessions: trimmed.rows, problems: [] }
      }

      const resolved = await resolveId(String(asked.sessionId ?? ''))
      if (resolved.problem !== undefined) return { ...empty, action, problems: [resolved.problem] }
      if (resolved.id === undefined || resolved.id === '') return { ...empty, action, problems: ['`sessionId` is required for `read`'] }
      const configured = settings() ?? {}
      const kinds = Array.isArray(asked.kinds) && asked.kinds.length > 0 ? asked.kinds : (Array.isArray(configured.kinds) ? configured.kinds : Object.keys(SUBJECT_KINDS))
      const lastMessages = typeof asked.lastMessages === 'number' ? asked.lastMessages : (typeof configured.lastMessages === 'number' ? configured.lastMessages : 10)
      const subject = await read({ sessionQuery: query, sessionId: resolved.id, kinds, lastMessages })
      const problems = subject.problem === null || subject.problem === undefined ? [] : [subject.problem]
      const session = { id: resolved.id }
      const header = subject.session ?? {}
      if (header.cwd !== undefined) session.cwd = String(header.cwd)
      if (header.createdAt !== undefined) session.createdAt = Number(header.createdAt)
      const titles = await titlesFor([resolved.id])
      if (titles.has(resolved.id)) session.title = titles.get(resolved.id)
      const format = String(asked.format ?? 'messages')
      let state
      if (format === 'subject') {
        if (typeof compose !== 'function') {
          problems.push('no composer is wired, so the subject cannot be composed here -- read `messages` instead')
        } else {
          // THE SUBJECT IS COMPOSED FROM THE WHOLE LOG, which is what an evaluation does: `lastMessages` bounds what
          // `messages` SHOWS, and must not silently bound what a judgement would be SHOWN.
          const whole = await read({ sessionQuery: query, sessionId: resolved.id, kinds, lastMessages: 0 })
          const composed = compose(whole.events ?? [])
          state = typeof composed === 'string' ? composed : String(composed?.text ?? composed?.state ?? '')
        }
      }
      const messages = (subject.events ?? []).map((event) => ({
        role: event?.type === 'assistant/message' ? 'AGENT' : 'OPERATOR',
        text: textOf(event),
      })).filter((message) => message.text !== '')
      return {
        action,
        session,
        slice: { matched: subject.slice?.matched ?? 0, total: subject.slice?.total ?? 0, unknownKinds: subject.slice?.unknownKinds ?? [] },
        messages,
        ...(state === undefined ? {} : { state }),
        count: messages.length,
        total: subject.slice?.total ?? 0,
        sessions: [],
        problems,
      }
    },
  }
}
