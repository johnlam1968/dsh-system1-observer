// peer-bridge -- DURABLE HOST ROW.
//
// Promoted from `~/.dsh/plugins/peer-bridge.dynamic-host.js` (the sandbox body that ran 2026-09-20). That file is
// the origin record of what the sandbox executed; this is what runs now. The conversion is the one documented in
// `~/.dsh/plugins/README.md` "Promoting a dynamic body to a durable row":
//
//   harness.defineTool(def)          -> defineTool(def) from @deepseek-ai/dsh-tools
//   harness.registerTool(ctx, tool)  -> ctx.tools.register(tool), called DIRECTLY: it installs its own fiber
//                                       effect and returns the exact disposer, so wrapping it in ctx.effect()
//                                       would install a second one
//   ctx.get(name)                    -> unchanged, and still preferred over inject for an optional seam
//
// It lives beside the profile because `@deepseek-ai/dsh-tools` resolves from the profile's parent node_modules and
// NOT from `~/.dsh/plugins` (measured: ERR_MODULE_NOT_FOUND there).
//
// ---------------------------------------------------------------------------------------------------------------
// WHAT CHANGED FROM THE ORIGIN BODY, and why
//
// The guards. The origin had one cwd substring for reading and one for sending, tuned to a single pairing
// (`dsh-telegram` sending, `docdrift` readable). The send guard is now an EXPLICIT LIST, because the reason the
// bridge is being promoted is that a session in `dsh-system1-observer` needed to reach a sibling in the same
// workspace and was refused by construction:
//
//   refused: peer_send is limited to the session that owns this bridge (dsh-telegram);
//   caller cwd is /home/john/CodingProjects/dsh-system1-observer
//
// Both lists are operator-tunable by environment, so widening them is a config change rather than an edit:
//
//   PEER_BRIDGE_SEND_MARKS=dsh-telegram,some-other-workspace
//   PEER_BRIDGE_READ_MARKS=docdrift,dsh-system1-observer
//
// IT IS STILL AUTHORIZATION BY PATH SUBSTRING, which the README flags as the thing a durable version should stop
// doing ("a durable version should key on an explicit allowlist (or a session/team identity), not a path
// substring"). A list of substrings is not a session identity, and a session whose cwd happens to contain one of
// these marks is authorized whether or not anyone intended it. The honest fix is identity, and session ids are
// per-session and therefore not a stable key; the workspace mark is what this deployment actually has. Recorded
// here rather than presented as solved.
//
// REGISTRATION IS PROCESS-GLOBAL: `ctx.tools.register` puts these three tools in front of EVERY agent in the
// process, the peer included. The guards are the only thing standing between a tool call and another session's
// inbox. The README's recommendation for a bridge is an agent-preset row so only opted-in sessions see it; this
// row is on the profile instead, which means every session in this profile has it.
// ---------------------------------------------------------------------------------------------------------------

import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'peer-bridge'
export const inject = ['tools']

/**
 * Workspace markers whose sessions may SEND through this bridge.
 *
 * `dsh-telegram` keeps the original bridge working; `dsh-system1-observer` is the workspace that was refused.
 */
const SEND_MARKS = marksFrom(process.env.PEER_BRIDGE_SEND_MARKS) ?? ['dsh-telegram', 'dsh-system1-observer']

/**
 * Workspace markers whose sessions may be READ through this bridge.
 *
 * `dsh-system1-observer` is here so the conversation can be two-way: the send guard alone fixes telling a peer
 * something, and without this the reply comes back `refused: peer_transcript only reads peer workspaces`.
 */
const READ_MARKS = marksFrom(process.env.PEER_BRIDGE_READ_MARKS) ?? ['docdrift', 'dsh-system1-observer']


/** The last path segment of a cwd, for a label that says which workspace a sender is in. */
function basenameOf(path) {
    const text = String(path ?? '').replace(/[\\/]+$/u, '')
    const cut = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'))
    return cut === -1 ? text : text.slice(cut + 1)
}

/** Parse a comma-separated environment override. `undefined` means "no override", not "empty list". */
function marksFrom(value) {
    if (typeof value !== 'string' || value.trim() === '') return undefined
    const marks = value.split(',').map(part => part.trim()).filter(part => part.length > 0)
    return marks.length === 0 ? undefined : marks
}

const matchesAny = (cwd, marks) => marks.some(mark => cwd.indexOf(mark) !== -1)
const show = (cwd) => (cwd === '' || cwd === undefined ? '(none)' : cwd)

// Read only leaf fields off live DSH objects; never stringify or copy them.
const sessionFacts = (agent) => {
    const session = agent && agent.session ? agent.session : undefined
    const header = session && session.header ? session.header : undefined
    return {
        id: agent && agent.id !== undefined ? String(agent.id) : 'unknown',
        status: agent && typeof agent.status === 'string' ? agent.status : 'unknown',
        cwd: header && typeof header.cwd === 'string' ? header.cwd : '',
        createdAt: header && typeof header.createdAt === 'number' ? header.createdAt : 0,
        seq: session && typeof session.seq === 'number' ? session.seq : -1,
    }
}

const clip = (value, max) => {
    const text = typeof value === 'string' ? value : String(value === undefined ? '' : value)
    return text.length <= max ? text : text.slice(0, max) + '\n...[clipped ' + (text.length - max) + ' chars]'
}

const blockText = (blocks) => {
    if (!Array.isArray(blocks)) return { text: '', other: 0 }
    let out = ''
    let other = 0
    for (const block of blocks) {
        if (block && block.type === 'text' && typeof block.text === 'string') out += block.text
        else other += 1
    }
    return { text: out, other }
}

const messageOf = (event) => {
    const data = event && event.data ? event.data : undefined
    // EITHER SHAPE, and the declared one was being dropped. `SessionEventMap` says `'user/message': UserMessage` --
    // `data` IS the message -- while `assistant/message` and `tool/result` say `data.message`. Reading only the latter
    // meant EVERY operator message was skipped: a live transcript reported "user/message without data.message 19",
    // and a reader that cannot see the operator cannot audit any operator_* question.
    if (data === null || data === undefined) return undefined
    if (data.message !== undefined) return data.message
    if (data.content !== undefined) return data
    return undefined
}

const newMessageId = () => 'peer-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)

const renderText = (_args, value) => [{ type: 'text', text: String(value) }]

export function apply(ctx) {
    const agentsOf = () => ctx.get('agents')
    // THE SESSION QUERY, FOR A SESSION THAT IS NOT LIVE. `session.snapshotEvents` requires a RUNNING agent -- this
    // reader refuses with "is not live in this process" otherwise -- while `sessionQuery.readSession` reads "one
    // complete logical session log WITHOUT MAKING IT LIVE". Optional access, like every other service here, so a
    // deployment without it keeps the path it had.
    const sessionQueryOf = () => (typeof ctx.get === 'function' ? ctx.get('sessionQuery') : undefined)

    const callerFacts = (exec) => {
        const agent = exec && exec.agent ? exec.agent : undefined
        if (agent === undefined) return undefined
        return sessionFacts(agent)
    }

    const findAgent = (agents, sessionId) => {
        const direct = typeof agents.get === 'function' ? agents.get(sessionId) : undefined
        if (direct !== undefined) return direct
        if (typeof agents.list !== 'function') return undefined
        for (const agent of agents.list()) {
            if (agent && String(agent.id) === sessionId) return agent
        }
        return undefined
    }

    ctx.tools.register(defineTool({
        name: 'peer_sessions',
        description:
            'List the live agent sessions in this dsh process (id, working directory, status, latest log seq).\n'
            + 'Use it to find a peer session to read or message. Pass cwdContains to filter by workspace path.',
        parameters: {
            cwdContains: { type: 'string', description: 'Only show sessions whose working directory contains this text.' },
        },
        output: { schema: { type: 'string' }, render: renderText },
        async execute(args) {
            const agents = agentsOf()
            if (agents === undefined || typeof agents.list !== 'function') return 'no agents service in this deployment'
            const filter = typeof args.cwdContains === 'string' && args.cwdContains.length > 0 ? args.cwdContains : undefined
            const rows = []
            for (const agent of agents.list()) {
                const facts = sessionFacts(agent)
                if (filter !== undefined && facts.cwd.indexOf(filter) === -1) continue
                rows.push(facts)
            }
            if (rows.length === 0) return filter === undefined ? 'no live sessions' : 'no live session whose cwd contains ' + filter
            rows.sort((a, b) => a.createdAt - b.createdAt)
            return rows.length + ' live session(s):\n' + rows.map((r) => {
                return '  ' + r.id + '  [' + r.status + ']  seq=' + r.seq + '  cwd=' + show(r.cwd)
            }).join('\n')
        },
    }))

    ctx.tools.register(defineTool({
        name: 'peer_transcript',
        description:
            'Read the committed transcript of a peer session from its live log: user and assistant text blocks with their seq numbers.\n'
            + 'Restricted to peer workspaces; pass sinceSeq to fetch only what is new, and reuse the returned latest seq next time.',
        parameters: {
            sessionId: { type: 'string', required: true, description: 'Peer session id from peer_sessions.' },
            sinceSeq: { type: 'number', description: 'Only return events with seq >= this value.' },
            limit: { type: 'number', description: 'Maximum number of messages to return, newest last. Default 12.' },
        },
        output: { schema: { type: 'string' }, render: renderText },
        async execute(args) {
            const agents = agentsOf()
            if (agents === undefined) return 'no agents service in this deployment'
            const target = typeof args.sessionId === 'string' ? args.sessionId : ''
            if (target.length === 0) return 'sessionId is required'
            const agent = findAgent(agents, target)
            const since = typeof args.sinceSeq === 'number' && args.sinceSeq >= 0 ? args.sinceSeq : 0
            const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.min(args.limit, 50) : 12

            // AUTHORIZE FIRST, ON THE TARGET'S OWN CWD, BEFORE ANY LOG IS READ. This guard is, in this file's own
            // words, "the only thing standing between a tool call and another session's row" -- and the first attempt
            // at this change read the log and refused afterwards, which is the same refusal message with the guard
            // turned into an afterthought. The smoke test caught it because it asserts the behaviour, not the string.
            const query = sessionQueryOf()
            let facts = agent === undefined ? undefined : sessionFacts(agent)
            if (facts === undefined && query !== undefined && query !== null && typeof query.listSessions === 'function') {
                // NO LIVE AGENT: the RECORD carries the cwd, and it is a header-bearing listing rather than the log --
                // so the authorization still happens before the conversation is fetched.
                try {
                    const records = await query.listSessions()
                    const record = Array.isArray(records)
                        ? records.find((one) => one !== null && one !== undefined && (one.id === target || one.sessionId === target || one?.header?.id === target))
                        : undefined
                    const cwd = record?.header?.cwd !== undefined ? record.header.cwd : record?.cwd
                    if (typeof cwd === 'string') facts = { id: target, status: record?.status ?? 'not live', cwd, createdAt: 0, seq: -1 }
                } catch {
                    facts = undefined
                }
            }
            if (facts === undefined) return 'session ' + target + ' is not live in this process, and no session record could be read to authorize it'
            if (!matchesAny(facts.cwd, READ_MARKS)) {
                return 'refused: peer_transcript only reads peer workspaces (' + READ_MARKS.join(', ') + '), and ' + target + ' has cwd ' + show(facts.cwd)
            }

            // AND ONLY NOW THE LOG. The service reads one that is not live -- the wall this bridge hit whenever a peer
            // had been restarted -- while the live snapshot stays as the fallback for a deployment without it.
            let events = null
            let sessionHeader = null
            if (query !== undefined && query !== null && typeof query.readSession === 'function') {
                try {
                    const read = await query.readSession(target)
                    if (read !== null && read !== undefined && Array.isArray(read.events)) {
                        // THE WHOLE LOG COMES BACK, so the window is applied here; `snapshotEvents(since)` filters at
                        // the source and needs nothing. That asymmetry is why this is a change, not a substitution.
                        events = read.events.filter((event) => (event?.seq ?? 0) >= since)
                        sessionHeader = read.session ?? null
                    }
                } catch {
                    events = null
                }
            }
            if (events === null) {
                if (agent === undefined) return 'session ' + target + ' is not live in this process, and no sessionQuery can read a closed one'
                const session = agent.session
                if (session === undefined || typeof session.snapshotEvents !== 'function') return 'this session exposes no event snapshot'
                events = session.snapshotEvents(since)
            }
            if (sessionHeader !== null && typeof sessionHeader.cwd === 'string') facts = { ...facts, cwd: sessionHeader.cwd }
            const lines = []
            // WHAT WAS SKIPPED, BY TYPE. Measured: this reader returned nine assistant messages and ZERO operator
            // messages for one session, and there was no way to tell from the output whether the operator never
            // wrote, wrote under a type this reader skips, or wrote in a shape `messageOf` does not recognise.
            // A transcript that silently omits half a conversation is worse than one that says what it left out --
            // so the types are counted and reported rather than dropped.
            const skipped = {}
            const count = (key) => { skipped[key] = (skipped[key] ?? 0) + 1 }
            let latest = facts.seq
            for (const event of events) {
                if (event === undefined || typeof event.seq !== 'number') continue
                if (event.seq > latest) latest = event.seq
                if (event.type !== 'user/message' && event.type !== 'assistant/message') {
                    count(typeof event.type === 'string' ? event.type : '(no type)')
                    continue
                }
                const message = messageOf(event)
                if (message === undefined) { count(event.type + ' with no readable message'); continue }
                const body = blockText(message.content)
                const role = event.type === 'user/message' ? 'user' : 'assistant'
                const extra = body.other > 0 ? ' [+' + body.other + ' non-text block(s)]' : ''
                lines.push({ seq: event.seq, line: '  #' + event.seq + ' ' + role + ': ' + clip(body.text, 1500) + extra })
            }
            const kept = lines.length > limit ? lines.slice(lines.length - limit) : lines
            const skippedText = Object.entries(skipped)
                .sort((a, b) => b[1] - a[1])
                .map(([type, n]) => type + ' ' + n)
                .join(', ')
            const header = 'session ' + target + ' [' + facts.status + '] cwd=' + facts.cwd + ' latestSeq=' + latest
                + ' (' + lines.length + ' message(s) since seq ' + since + ')'
                + (skippedText === '' ? '' : ' [skipped: ' + skippedText + ']')
            if (kept.length === 0) return header + '\n  (no messages in range)'
            return header + '\n' + kept.map((entry) => entry.line).join('\n')
        },
    }))

    ctx.tools.register(defineTool({
        name: 'peer_send',
        description:
            'Deliver a message to a peer agent as a properly-formed user message and wake it into a turn.\n'
            + '- mode followup (default): the message becomes its own ordinary turn.\n'
            + '- mode steer: consumed at the running turn\'s next step boundary.\n'
            + '- mode inject: model-facing context for the next pre-step, without waking the driver.\n'
            + 'Restricted to allowlisted workspaces (' + SEND_MARKS.join(', ') + '); the peer sees the provenance prefix in the text.',
        parameters: {
            sessionId: { type: 'string', required: true, description: 'Peer session id from peer_sessions.' },
            text: { type: 'string', required: true, description: 'Message body to deliver.' },
            mode: { type: 'string', description: 'followup (default) | steer | inject' },
            from: { type: 'string', description: 'Provenance label shown to the peer. Default "dsh-telegram session".' },
        },
        output: { schema: { type: 'string' }, render: renderText },
        async execute(args, exec) {
            const me = callerFacts(exec)
            if (me === undefined) return 'refused: no calling agent on this tool call'
            if (!matchesAny(me.cwd, SEND_MARKS)) {
                return 'refused: peer_send is limited to allowlisted workspaces (' + SEND_MARKS.join(', ') + '); caller cwd is ' + show(me.cwd) + ' [' + me.id + ']'
            }
            const agents = agentsOf()
            if (agents === undefined) return 'no agents service in this deployment'
            const target = typeof args.sessionId === 'string' ? args.sessionId : ''
            if (target.length === 0) return 'sessionId is required'
            const body = typeof args.text === 'string' ? args.text : ''
            if (body.length === 0) return 'text is required'
            const agent = findAgent(agents, target)
            if (agent === undefined) return 'session ' + target + ' is not live in this process'
            const mode = typeof args.mode === 'string' && args.mode.length > 0 ? args.mode : 'followup'
            if (mode !== 'followup' && mode !== 'steer' && mode !== 'inject') return 'mode must be followup, steer or inject'
            // THE DEFAULT LABEL IS DERIVED, NOT HARD-CODED. It was the string 'dsh-telegram session' -- correct
            // for the one pairing this bridge was first written for, and WRONG for everyone else now that the
            // row is profile-wide. Measured: the 3B replied without a `from`, and its message arrived attributed
            // to the telegram session, i.e. to a session that had nothing to do with it. A provenance label that
            // names the wrong origin is worse than no label, because it is believed.
            // `from` IS DECORATION, NEVER IDENTITY. It was doing both jobs, and identity lost: the 3B was told
            // to reply to session-91d07b68 and also saw that id on the messages it received, so it passed
            // "session-91d07b68" as its OWN `from` -- and its reply arrived labelled with the id of the session
            // it was answering. A sender that can set its own provenance is not provenance. The origin is now
            // printed from `me.id`, which no argument can change.
            const label = typeof args.from === 'string' && args.from.length > 0 ? ' ("' + args.from + '")' : ''
            const id = newMessageId()
            const message = {
                id: id,
                role: 'user',
                // THE RECEIVER MUST BE ABLE TO REPLY, and before this it could not: the message named the
                // sender only in free text, so answering required the sender to have happened to write its own
                // session id into the label. Measured -- the 3B finished a delegated task and reported into its
                // OWN session, because nothing told it how to reach back. The address now travels with the
                // message, and the instruction is explicit rather than a hint, for the same reason the task it
                // was given had to spell out its method.
                content: [{
                    type: 'text',
                    text: '[peer-bridge: from ' + me.id + label + '] ' + body
                        // THE RECEIVER IS TOLD ITS OWN ID, because it has no other way to know it. Three
                        // times a sender labelled itself with the id of the session it was ANSWERING -- the only
                        // id it had ever seen -- and each time the reply arrived attributed to the wrong session.
                        // Told "you are X; reply to Y", both fields are present and correctly named, and the
                        // conflation stops being the model's fault. Same rule as the label fix: an identity must
                        // be derived from the runtime, never inferred by the caller.
                        + '\n\n[you are ' + String(args.sessionId)
                        + '; to reply, call peer_send with sessionId "' + me.id + '"]',
                }],
                source: { kind: 'user' },
            }
            try {
                if (mode === 'followup') agent.followup(message)
                else if (mode === 'steer') agent.steer(message)
                else agent.inject(message)
            }
            catch (error) {
                return 'delivery failed: ' + (error && error.message ? error.message : String(error))
            }
            const after = sessionFacts(agent)
            return 'delivered ' + mode + ' to ' + target + ' as message ' + id + '; peer status ' + after.status + ', latestSeq ' + after.seq
        },
    }))
}
