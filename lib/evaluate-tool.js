// SYSTEM1_EVALUATE: judge a WHOLE CONVERSATION -- live, or one that is already over.
//
// The seams judge a turn as it happens; this judges a session. The subject is either the live session's events or a
// stored session read through the harness's own `sessionQuery` service (whole, or as a slice the row configured), and
// it goes into the ONE composer with `scope: 'session'` -- so there is still exactly one answer to "what the judge is
// shown" (`lib/turn-state.js`).
//
// ITS CALL LINE CARRIES A HOOK THAT IS NOT A PROBE SITE (`session-review`), and that is load-bearing rather than
// cosmetic: a whole-session judgement is not a measurement of the row's probe question, so `lib/probe-score.js`
// refuses to score it BY RULE. The register row O17 is the case where a measurement was recorded and silently never
// read; this tool is the case where the exclusion is a decision with a test.
//
// EVERY COLLABORATOR IS INJECTED, which is what makes it testable without a harness and what keeps the row's settings
// out of this file: `settings`, `stored`, `liveEvents`, `compose`, `questions`, `decide`, `record`.
import { createHash } from 'node:crypto'
import { checkAgainst } from './tool-args.js'
import { resultEnvelope } from './model/result-envelope.js'

export const EVALUATE_TOOL_NAME = 'system1_evaluate'

/**
 * The hook a stored evaluation's call line carries.
 *
 * NOT one of `lib/seams.js`'s seams and not the turn hook, so `lib/probe-score.js`'s `SCORABLE_SITES` excludes it and
 * no calibration ever counts it -- asserted in `test/evaluate-tool.test.js`.
 */
export const REVIEW_HOOK = 'session-review'

const DESCRIPTION = [
  'Evaluate a whole conversation with System One -- the decision model this profile configures -- and get probabilities',
  'back about it, rather than about one turn. The subject is the session this row is configured to judge: the live one,',
  'or a stored session (`subjectSession`), whole or as the slice `subjectKinds` and `subjectLastMessages` describe.',
  'Arguments override the row\'s settings for one call. The judgement is recorded on the trace with the hook',
  '`session-review`, which is deliberately NOT a probe site: a whole-session opinion is not this row\'s probe',
  'measurement, so it never enters the calibration.',
].join(' ')

const parameters = {
  type: 'object',
  additionalProperties: false,
  properties: {
    sessionId: { type: 'string', description: 'Which stored session to judge: an id, or `newest`. Defaults to the row\'s `subjectSession`.' },
    kinds: {
      type: 'array',
      // `items` IS REQUIRED BY THE REGISTRY'S KEYWORD SUBSET, and omitting it made registration THROW -- so the whole
      // `ctx.inject(['tools'], ...)` callback aborted and NO tool was registered at all, including the trace tool.
      // Two tests named it ("the REAL tool registry registers the row's tools" and "its schema stays inside the
      // registry subset"), and the failure looked like a missing tool rather than a bad schema.
      items: { type: 'string' },
      description: 'Which message kinds to include, overriding `subjectKinds`: `operator`, `assistant`.',
    },
    lastMessages: { type: 'number', description: 'How many of the newest messages to include. 0 is the whole session.' },
  },
  // NO `required: []`: an empty array says the same as an absent key, and the real registry rejects it. Observed as
  // "system1_trace is registered while the row is mounted" -- a schema violation in ONE registration takes the whole
  // `ctx.inject(['tools'], ...)` callback down, so it looked like a MISSING tool rather than a bad schema.
}

export function createEvaluateTool({ settings, stored, liveEvents, compose, questions, decide, record, toolId = 'system1-observer' } = {}) {
  for (const [name, fn] of Object.entries({ settings, stored, liveEvents, compose, questions, decide })) {
    if (typeof fn !== 'function') throw new TypeError(`${EVALUATE_TOOL_NAME}: \`${name}\` must be a function.`)
  }
  if (record !== undefined && typeof record !== 'function') throw new TypeError(`${EVALUATE_TOOL_NAME}: \`record\` must be a function when given.`)

  return {
    name: EVALUATE_TOOL_NAME,
    description: DESCRIPTION,
    parameters,

    output: {
      // `render` IS MANDATORY, and omitting it was O19: the registry refuses a tool that declares `output { schema }`
      // alone with "must declare output { schema, render, presentationMeta? }" -- and because a refusal in one
      // registration takes the whole `ctx.inject(['tools'], ...)` callback down, the symptom was a MISSING tool
      // (`system1_trace` absent) with no error anywhere. One run of the registry against this schema alone said so.
      render: (value) => {
        const subject = value?.subject ?? {}
        const head = 'system1_evaluate: ' + (subject.source ?? '?') + ' subject, ' + (subject.messages ?? 0) + ' of '
          + (subject.total ?? 0) + ' message(s), state ' + (value?.stateChars ?? 0) + ' chars'
          + (value?.truncated === true ? ' (truncated)' : '') + ' [' + (value?.stateHash ?? '?') + ']'
        if (value?.failure !== undefined) {
          return [{ type: 'text', text: head + '\ncould not answer: ' + String(value.failure.reason ?? 'unknown reason') }]
        }
        const lines = Object.entries(value?.answers ?? {}).map(([id, answer]) => {
          const record = answer !== null && typeof answer === 'object' ? answer : {}
          const label = record.label ?? record.level ?? '(no label)'
          const confidence = typeof record.confidence === 'number' ? ' (' + record.confidence + ')' : ''
          return '  ' + id + ': ' + String(label) + confidence
        })
        const provenance = value?.executed === undefined ? '' : '\nanswered by ' + JSON.stringify(value.executed)
        return [{ type: 'text', text: head + (lines.length === 0 ? '\n(no answers)' : '\n' + lines.join('\n')) + provenance }]
      },
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          answers: { type: 'object', description: 'One entry per question id, as the decision model returned it.' },
          subject: {
            type: 'object',
            description: 'What was judged: the source, the session, the slice, and how much of the session it covered.',
            properties: {
              source: { type: 'string', description: '`live` or `stored`.' },
              sessionId: { type: 'string', description: 'The stored session id, or empty for the live subject.' },
              kinds: { type: 'array', items: { type: 'string' }, description: 'The message kinds included.' },
              lastMessages: { type: 'number', description: 'How many newest messages were asked for; 0 is all of them.' },
              messages: { type: 'number', description: 'How many messages the slice actually carried.' },
              total: { type: 'number', description: 'How many messages the session had before slicing.' },
            },
            required: ['source', 'sessionId', 'kinds', 'lastMessages', 'messages', 'total'],
          },
          stateHash: { type: 'string', description: 'A short hash of the composed state, so two evaluations of the same input are recognisable as the same.' },
          stateChars: { type: 'number', description: 'How long the composed state was before it was sent.' },
          truncated: { type: 'boolean', description: 'Whether the state was cut to fit the budget.' },
          executed: { type: 'object', description: 'The provider, model and revision that actually answered.' },
          usage: { type: 'object', description: 'Token usage, when the transport reported it.' },
          durationMs: { type: 'number', description: 'How long the judgement took.' },
          failure: {
            type: 'object',
            description: 'Present when the model could not answer. A failure is not an exception: the subject may have been read and the call paid for.',
            properties: { reason: { type: 'string', description: 'Why there is no answer.' } },
            required: ['reason'],
          },
        },
        required: ['answers', 'subject', 'stateHash', 'stateChars', 'truncated'],
      },
    },

    async execute(args, exec) {
      if (exec?.signal?.aborted === true) throw new Error('the call was cancelled before it started')
      checkAgainst(parameters, args, EVALUATE_TOOL_NAME)
      const given = args !== null && typeof args === 'object' ? args : {}
      const configured = settings()

      // THE ARGUMENTS OVERRIDE THE ROW FOR ONE CALL, and an override is what makes the subject `stored` even when the
      // row is watching the live session: asking about a named session cannot mean the live one.
      const asked = typeof given.sessionId === 'string' ? given.sessionId.trim() : ''
      const sessionId = asked !== '' ? asked : configured.sessionId
      const kinds = Array.isArray(given.kinds) && given.kinds.length > 0 ? given.kinds : configured.kinds
      const lastMessages = Number.isInteger(given.lastMessages) ? given.lastMessages : configured.lastMessages
      const useStored = configured.source === 'stored' || asked !== '' || sessionId !== ''

      const subject = useStored
        ? await stored({ sessionId, kinds, lastMessages })
        : { events: await liveEvents(), slice: null, session: null, problem: null }
      if (typeof subject?.problem === 'string' && subject.problem !== '') {
        throw new Error(`${EVALUATE_TOOL_NAME}: ${subject.problem}`)
      }
      const events = Array.isArray(subject?.events) ? subject.events : []
      if (events.length === 0) {
        throw new Error(`${EVALUATE_TOOL_NAME}: the subject carries no messages, so there is no conversation to judge`)
      }

      const composed = compose(events)
      if (composed?.refused === true) throw new Error(`${EVALUATE_TOOL_NAME}: ${composed.reason}`)
      const built = questions()
      if (Array.isArray(built?.problems) && built.problems.length > 0) {
        // REFUSE, DO NOT TRIM: a quietly shortened question files a measurement of one thing under another.
        throw new Error(`${EVALUATE_TOOL_NAME}: ${built.problems[0]}`)
      }

      const state = String(composed.state ?? '')
      const stateHash = createHash('sha256').update(state).digest('hex').slice(0, 12)
      const out = {
        answers: {},
        subject: {
          source: useStored ? 'stored' : 'live',
          sessionId: useStored ? sessionId : '',
          kinds,
          lastMessages,
          messages: events.length,
          total: Number.isInteger(subject?.slice?.total) ? subject.slice.total : events.length,
        },
        stateHash,
        stateChars: state.length,
        truncated: composed.truncated === true,
      }

      // THE LINE IS WRITTEN FOR BOTH OUTCOMES, and that is a correction rather than a nicety. Written only on success
      // it would be absent exactly when it matters most: a judgement that timed out was still ATTEMPTED, and on a
      // metered backend very probably still PAID FOR. `lib/decide-tool.js` records after its error returns
      // (`:183-184` against `:209`), so a failed decide leaves no line at all -- recorded as register row O18, because
      // a call that leaves no trace is the same class as O17: present in the world and invisible in the record.
      const writeLine = (failure) => {
        if (typeof record !== 'function') return
        record({
          event: 'call',
          hook: REVIEW_HOOK,
          tool: toolId,
          // THE SUBJECT AND THE INPUT'S IDENTITY GO ON THE LINE: which session, which slice, and the hash of what was
          // actually sent -- so two evaluations of the same conversation are recognisable as the same measurement.
          subject: out.subject,
          stateHash,
          questionIds: Object.keys(built?.questions ?? {}),
          answers: out.answers,
          ...(failure === undefined ? {} : { failure }),
          ...(out.executed === undefined ? {} : { executed: out.executed }),
          ...(out.durationMs === undefined ? {} : { durationMs: out.durationMs }),
          ...(exec?.signal?.aborted === true ? { cancelled: true } : {}),
        })
      }

      let result
      try {
        result = await decide({ state, questions: built.questions }, { signal: exec?.signal })
      } catch (error) {
        const failure = { reason: messageOf(error) }
        writeLine(failure)
        return Object.assign(out, { failure })
      }
      if (result === null || typeof result !== 'object') {
        const failure = { reason: 'the model returned no result' }
        writeLine(failure)
        return Object.assign(out, { failure })
      }
      if (result.kind === 'error') {
        const failure = { reason: String(result.reason ?? 'the model could not answer') }
        writeLine(failure)
        return Object.assign(out, { failure })
      }
      const envelope = resultEnvelope(result)
      if (result.answers !== null && typeof result.answers === 'object' && !Array.isArray(result.answers)) {
        out.answers = result.answers
      }
      // EVERY EMITTED FIELD IS DECLARED ABOVE, because the harness validates a tool's output against its own schema --
      // the lesson `lib/decide-tool.js:185` records from a live call that failed on exactly that.
      if (envelope.executed !== null && typeof envelope.executed === 'object') out.executed = envelope.executed
      if (envelope.usage !== null && typeof envelope.usage === 'object') out.usage = envelope.usage
      if (typeof envelope.durationMs === 'number' && Number.isFinite(envelope.durationMs)) out.durationMs = envelope.durationMs

      writeLine(undefined)
      return out
    },
  }
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}
