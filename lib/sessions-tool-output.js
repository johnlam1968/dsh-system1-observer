// THE TOOL'S OUTPUT CONTRACT AND ITS RENDERING -- the schema it declares, and how a value becomes lines.
//
// WHY IT IS ITS OWN MODULE: `lib/sessions-tool.js` reached its declared size budget, and its own note said the split to
// make was by CONCERN. This is that seam -- the tool dispatches, this file says what a value looks like and how it
// reads -- and it is what paid for the `refresh` action without raising a budget for it.
//
// THE SCHEMA MUST DECLARE EVERY FIELD THE TOOL EMITS, which a test enforces: a field that arrives undeclared is a
// value the runtime's schema cannot describe, and the enforced subset takes a SCALAR `type`, so a field that is absent
// half the time is OMITTED rather than declared as nullable.

import { describeToolCut } from './tool-blocks.js'

export const OUTPUT_SCHEMA = {
    schema: {
        type: 'object', additionalProperties: false,
        properties: {
            action: { type: 'string', description: 'What was done.' },
            count: { type: 'number', description: 'For `list`: how many rows are returned.' },
            total: { type: 'number', description: 'For `list`: how many sessions matched before the limit.' },
            query: { type: 'string', description: 'For `search`: the query as it was sent, so the render echoes what was actually asked.' },
            usedService: { type: 'string', description: 'For `search`: the service method that answered, stated so a reader knows the text of conversations was scanned rather than a title compared.' },
            observesEverySession: { type: 'boolean', description: 'For `list`: whether the allow-list holds `*`, so "these rows" and "all of them" are never confused.' },
            textIndexed: { type: 'boolean', description: 'For `search` from the local store: whether that store holds message text at all. FALSE means only titles, ids and directories were compared, and "no matches" does not mean the phrase is absent from the conversations.' },
            indexPath: { type: 'string', description: 'For `search` from the local store: which file answered.' },
            observedCount: { type: 'number', description: 'For `list`: how many of the returned rows the observer will measure.' },
            subagents: { type: 'object', additionalProperties: false, description: 'For `list`: WHAT THIS LIST IS A LIST OF. Measured on this host: 318 of 499 sessions are subagent runs, so a list of 20 rows says nothing about the mixture unless the answer does.', properties: { subagentRuns: { type: 'number' }, ofTotal: { type: 'number' }, shown: { type: 'string' } } },
            refreshing: { type: 'boolean', description: 'For `refresh`: TRUE means the rebuild was STILL RUNNING when this answered -- an incremental rebuild refolds whatever changed, and a living session of 33 MB takes tens of seconds. Search again when it finishes; the store is readable throughout.' },
            refolded: { type: 'number', description: 'For `refresh`: how many session files were re-read. Zero means nothing had changed, so the store was already current.' },
            skipped: { type: 'number', description: 'For `refresh`: how many session files were left alone because their mtime and size were unchanged -- the receipt that makes a refresh cheap.' },
            storeSizeMb: { type: 'number', description: 'For `refresh`: the store\'s size on disk, so a caller can see the price of the mirror it asked to maintain.' },
            elapsedMs: { type: 'number', description: 'For `refresh`: how long the rebuild took, or how long it has been running.' },
            pid: { type: 'number', description: 'For `refresh`: the rebuild runs in its OWN PROCESS, so it cannot block this harness; the pid is reported so a caller can tell a still-running rebuild from a finished one.' },
            tokenizer: { type: 'string', description: 'For `refresh`: which tokenizer the store was rebuilt with -- `trigram` (substring search), `unicode61` (words) or `none`.' },
            searchMode: { type: 'string', description: 'For `refresh`: `fts5` when the store has a search mirror, `like` when text is matched by scan.' },
            summary: { type: 'array', description: 'For `refresh`: the rebuild\'s own last lines, kept verbatim because a parsed number is not the same as the output it came from.', items: { type: 'string' } },
            sessions: {
                type: 'array',
                description: 'For `list`: the sessions, newest first.',
                items: {
                    type: 'object', additionalProperties: false,
                    properties: {
                        id: { type: 'string' },
                        cwd: { type: 'string' },
                        createdAt: { type: 'number' },
                        title: { type: 'string' },
                        live: { type: 'boolean' },
                        persisted: { type: 'boolean' },
                        observed: { type: 'boolean', description: 'For `list`: whether this session is in the row\'s observe allow-list -- the sessions the observer will actually MEASURE. The rule lives in `lib/sessions.js`: a prefix match, `*` for every session, an empty list for none.' },
                        origin: { type: 'string', description: 'For `list`: the harness\'s own classification of the session -- `subagent` for a worker run created as a child. ABSENT on a conversation, so an absent field and an empty one are different facts.' },
                        parentSession: { type: 'string', description: 'For `list`: the session this one was FORKED from (seed lineage). NOT the same fact as `origin` -- a forked conversation is not a worker run.' },
                        snippet: { type: 'string', description: 'For `search`: the text around the match, as the harness selected it.' },
                        hits: { type: 'number', description: 'For `search` from the local store: how many stored rows matched in this session.' },
                        matchedIn: { type: 'string', description: 'For `search` from the local store: WHICH source matched -- text, reasoning, tool-result, tool-call -- or title/cwd/id. A reader can tell a phrase that was SAID from one a tool printed.' },
                    },
                },
            },
            session: {
                type: 'object', additionalProperties: false,
                description: 'For `read`: which session was read.',
                properties: { id: { type: 'string' }, cwd: { type: 'string' }, createdAt: { type: 'number' }, title: { type: 'string' } },
            },
            slice: {
                type: 'object', additionalProperties: false,
                description: 'For `read`: how the messages were sliced -- `matched` of `total` events, and any kind name that matched nothing.',
                properties: {
                    matched: { type: 'number' },
                    total: { type: 'number' },
                    unknownKinds: { type: 'array', items: { type: 'string' } },
                    page: {
                        type: 'object', additionalProperties: false,
                        description: 'For `read`: which messages of the matched set this page covers -- `offset` is how many of the newest were skipped, `from`/`to` index into the match list, and `of` is how many matched.',
                        properties: { offset: { type: 'number' }, from: { type: 'number' }, to: { type: 'number' }, of: { type: 'number' } },
                    },
                },
            },
            messageChars: { type: 'number', description: 'For `read`: the per-message budget this call used.' },
            clipped: { type: 'number', description: 'For `read`: how many returned messages are LONGER than `messageChars`, so a reader knows the text below is cut rather than short.' },
            messages: {
                type: 'array',
                description: 'For `read`: the operator and assistant messages, oldest first.',
                items: { type: 'object', additionalProperties: false, properties: { role: { type: 'string' }, text: { type: 'string' } } },
            },
            coverage: {
                type: 'object', additionalProperties: false,
                description: 'For `read`: HOW MUCH SESSION THERE IS, against however much the slice returned. Without it a reading of 3% of a conversation is indistinguishable from a reading of all of it.',
                properties: {
                    events: { type: 'number', description: 'Every event in the session.' },
                    messages: { type: 'number', description: 'The message events among them.' },
                    chars: { type: 'number', description: 'Characters of message text -- the conversation, not the tool traffic.' },
                    toolEvents: { type: 'number', description: '`tool/call` and `tool/result` events. These travel with the messages in the slice, and a slice of messages alone would drop every result.' },
                },
            },
            state: { type: 'string', description: 'For `read` with `format`: `subject`: the composed state, exactly as `system1_evaluate_session` composes it.' },
            stateTruncated: { type: 'boolean', description: 'For `read` with `format`: `subject`: whether that state was CUT to `composeMaxChars`. A cut preview reads as the whole subject, and measured at the live defaults a stored judgement fits five messages whole.' },
            toolCalls: {
                type: 'object', additionalProperties: false,
                description: 'For `read` with `format`: `subject`: what the composer ACTUALLY showed of the tool record, because `toolBlockMaxChars` cuts it from the START -- so a judgement may carry 3 of 529 calls and the last ones are the ones missing.',
                properties: {
                    calls: { type: 'number' },
                    results: { type: 'number' },
                    shown: { type: 'object', additionalProperties: false, properties: { calls: { type: 'number' }, results: { type: 'number' } } },
                    kept: { type: 'string' },
                    truncated: { type: 'boolean' },
                },
            },
            problems: { type: 'array', description: 'Anything that could not be done, named rather than silent.', items: { type: 'string' } },
            problem: { type: 'string', description: 'Set when the call could not be made at all.' },
        },
    },
    render(_args, value) {
        if (typeof value.problem === 'string' && value.problem !== '') return [{ type: 'text', text: 'UNAVAILABLE: ' + value.problem }]
        const lines = []
        if (value.action === 'refresh') {
            lines.push(value.refreshing === true
                ? `the store is being rebuilt in pid ${value.pid ?? '?'}, running ${Math.round((value.elapsedMs ?? 0) / 1000)} s so far -- it reads the sessions that CHANGED, and the store stays readable while it runs`
                : `the store is current: refolded ${value.refolded ?? 0}, skipped ${value.skipped ?? 0} unchanged, ${value.storeSizeMb ?? '?'} MB, in ${Math.round((value.elapsedMs ?? 0) / 1000)} s (pid ${value.pid ?? '?'})`)
            if (value.refolded === 0 && value.refreshing !== true) {
                lines.push('  nothing had changed since the last build, so no session file was re-read')
            }
            if (value.searchMode !== undefined) lines.push(`  search: ${value.searchMode}${value.tokenizer === undefined ? '' : ` (${value.tokenizer})`}`)
            for (const line of value.summary ?? []) lines.push('  ' + line)
        } else if (value.action === 'search') {
            lines.push(`${value.count} session(s) matching ${JSON.stringify(value.query ?? '')} -- via ${value.usedService ?? '?'} (a TITLE, id or directory match is included, and each row says which)`)
            for (const row of value.sessions ?? []) {
                lines.push(`  ${row.id} ${row.cwd ?? ''} ${row.title === undefined ? '' : '"' + row.title + '"'}`)
                if (row.matchedIn !== undefined) lines.push(`    matched in: ${row.matchedIn}${row.hits === undefined ? '' : ` (${row.hits} row(s))`}`)
                if (row.snippet !== undefined) lines.push(`    ${row.snippet.split('\n').join(' ').slice(0, 300)}`)
            }
            if (value.textIndexed === false) {
                lines.push('  THE LOCAL STORE HOLDS NO MESSAGE TEXT, so only titles, ids and directories were compared:'
                    + ' "no matches" here does NOT mean the phrase is absent from the conversations. Rebuild with'
                    + ' `node scripts/session-index.mjs build --text`.')
            }
        } else if (value.action === 'list') {
            lines.push(`${value.count} of ${value.total} session(s)`)
            // WHAT THE LIST IS A LIST OF. Measured on this host: 318 of 499 sessions are subagent runs, and a filtered
            // list that did not say so would look like the index contained only what it showed.
            if (value.subagents !== undefined) {
                lines.push(`  ${value.subagents.subagentRuns} of ${value.subagents.ofTotal} session(s) in the index are SUBAGENT runs; this list is \`subagents: ${value.subagents.shown}\``)
            }
            for (const row of value.sessions ?? []) {
                // `origin` AND `parentSession` ARE TWO DIFFERENT FACTS, and the harness type says so: `origin` is "a
                // session created as a subagent child", while `parentSession` is "the session this one was forked from
                // (seed lineage)" -- a writer ALSO sets it to the spawning session for a child, which is exactly why it
                // cannot decide "is this a worker" and why this line names the field instead of calling it a parent.
                const lineage = row.parentSession === undefined ? '' : ` | parentSession: ${row.parentSession}`
                lines.push(`  ${row.id} ${row.live ? 'live' : ''}${row.persisted ? 'persisted' : ''} ${row.observed === true ? 'OBSERVED' : ''} ${row.createdAt === undefined ? '' : new Date(row.createdAt).toISOString().slice(0, 16)} ${row.cwd ?? ''} ${row.title === undefined ? '(no title)' : '"' + row.title + '"'}${row.origin === undefined ? '' : ` [${row.origin}${lineage}]`}`)
            }
            if (value.observesEverySession === true) {
                lines.push('  the observe allow-list holds `*`, so EVERY session is measured')
            } else if (value.observedCount !== undefined) {
                lines.push(`  ${value.observedCount} of these ${value.count} row(s) are in the observe allow-list; the rest are NOT measured (the session's "..." menu in the UI is the way in)`)
            }
        } else {
            lines.push(`session ${value.session?.id ?? '?'} ${value.session?.title === undefined ? '' : '"' + value.session.title + '"'} ${value.session?.cwd ?? ''}`)
            lines.push(`  ${value.slice?.matched ?? 0} of ${value.slice?.total ?? 0} event(s) matched`)
            // THE DENOMINATOR, SAID OUT LOUD -- register row O26. A judgement is cut from this text, so a reader who
            // cannot see it cannot tell a reading of the conversation from a reading of its first and last pages.
            const cov = value.coverage
            if (cov !== undefined && cov.events > 0) {
                lines.push(`  the whole session: ${cov.events} event(s), ${cov.messages} message(s), ${cov.chars} char(s) of message text, ${cov.toolEvents} tool event(s)`)
                lines.push('  the slice carries the tool calls AND their results, so a question about what a lookup returned has the result to read')
            }
            if (value.session?.id !== undefined && (value.messages ?? []).length === 0 && (value.slice?.total ?? 0) === 0) {
                // THE STUB CASE, NAMED: a created-but-never-appended session has a header and nothing else, and "0
                // messages" without that sentence reads as a bug in this tool rather than a fact about the session.
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
        }
        for (const problem of value.problems ?? []) lines.push('PROBLEM: ' + problem)
        return [{ type: 'text', text: lines.join('\n') }]
    },
}
