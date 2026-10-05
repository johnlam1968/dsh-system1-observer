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
import { isRecord } from './is-record.js'
import { resultEnvelope } from './model/result-envelope.js'
import { describeToolCut } from './tool-blocks.js'
import { aggregateReadings, firstAndLast, segmentsOf, DEFAULT_SEGMENT_CHARS } from './segment.js'
import { CONTEXT, stateBudgetChars, withinStateBudget } from './model/limits.js'
import { round } from './report.js'
import { applyGroups, selectionNote } from './exchange.js'
import { textOfEvent } from 'dsh-session-adapter/session-format'

export const EVALUATE_TOOL_NAME = 'system1_evaluate_session'

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
  type: 'object', additionalProperties: false,
  properties: {
    sessionId: { type: 'string', description: 'Which stored session to judge: an id, or `newest`. Defaults to the row\'s `subjectSession`.' },
    set: { type: 'string', description: 'NAME THE QUESTION SET FOR THIS CALL, e.g. `agent-helpfulness-session@1` or `human-conduct-session@1`, overriding the row\'s own `questionSet` for one measurement. WITHOUT THIS THE SET COMES FROM THE ROW, and an agent asked to measure with a particular instrument had to discover `system1_settings`, CHANGE THE LIVE ROW, run, and change it back -- four operations and a side effect on somebody else\'s configuration for what should be a parameter. The set must declare the `scope` asked for (default `session`); one that declares none is refused rather than silently ask nothing.' },
    scope: { type: 'string', description: 'For `set`: which scope of it to ask. Defaults to `session`, which is what a whole-conversation judgement needs.' },
    groups: { type: 'array', items: { type: 'string' }, description: 'WHICH EVIDENCE the judge is given, from `docs/measurement-depth.md`. `["G0"]` is THE EXCHANGE -- what the human asked and the turn\'s final word, with the narration, the tool calls and the results left out; that is the subject a "did it answer me, and was the answer any good" question needs, and it fits a budget that the working record does not. `["G0","G1"]` is the working record, which is what this tool took before groups existed. G2 (the harness\'s own acts) and G3 (pacing) are not composed yet and are REFUSED rather than approximated. G4 (provenance) is always attached.' },
    turns: { type: 'array', items: { type: 'number' }, description: 'SEVERAL EXCHANGES, by turn number -- "turns 37 to 40" is `[37,38,39,40]`. Several turns of G0 are still G0: the same evidence group at a larger scope. A run of turns is also a SEGMENT whose boundaries come from the harness\'s own turn numbering rather than from a character count, so unlike `segmentChars` it cannot split a thought in half and a reader can check it.' },
    turn: { type: 'number', description: 'WHICH EXCHANGE, by turn number, for `groups: ["G0"]`. Omitted, every exchange in the window is measured -- which is the whole session at G0 and needs segmentation on a long one. With `G1` it narrows the working record to that turn, which is what `lastMessages`/`offset` arithmetic used to approximate by hand.' },
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
    offset: { type: 'number', description: 'How many of the NEWEST messages to SKIP, so a SPAN of a long session can be judged whole instead of 3% of all of it: `lastMessages: 40, offset: 0` judges the newest forty exchanges, `offset: 40` the forty before those. Defaults to 0.' },
    package: { type: 'boolean', description: 'PERSIST THE MEASUREMENT AS A PACKAGE ON DISK, and answer with where it went. **OPT IN, AND ONLY WHEN A DURABLE ARTIFACT IS WANTED** -- a reading does not need one, and the answers come back whether or not this is set. Ask before setting it if the request was only for a report in the conversation: a package is written to disk, it is never overwritten, and it stays there. It carries the trace slice, the readings, a rendered report and a written interpretation slot, with every file\'s sha256 on its manifest. The INTERPRETATION is not written here -- prose cannot be derived from numbers -- so attach it with `system1_measurements { action: \'interpret\' }`.' },
    segmentChars: { type: 'number', description: 'SEGMENT a subject that does not fit one request, and combine the readings in code. Jev 1.13 takes at most 32k tokens of `state` plus the longest question (64k per request with all questions), and a 611-message session is roughly twice that, so one call comes back unreadable rather than failing. Above 0, the subject is split into contiguous message-aligned segments of about this many characters; each is composed with its own tool record and judged on its own; the per-question aggregate is arithmetic over those readings, NOT a second model call. Defaults to 0 (one call). `' + DEFAULT_SEGMENT_CHARS + '` is the value that leaves room for labels and the tool record inside the estimate.' },
  },
  // NO `required: []`: an empty array says the same as an absent key, and the real registry rejects it. Observed as
  // "system1_trace is registered while the row is mounted" -- a schema violation in ONE registration takes the whole
  // `ctx.inject(['tools'], ...)` callback down, so it looked like a MISSING tool rather than a bad schema.
}

export function createEvaluateTool({ settings, stored, liveEvents, compose, questions, decide, record, packageRun = null, toolId = 'system1-observer' } = {}) {
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
      // `render` TAKES (args, value) -- THE HOST'S ARGUMENT ORDER, NOT THIS FILE'S. Measured in the installed
      // harness: `dsh-tools/lib/index.js:3548` calls `tool.output.render(exec.arguments, value)`. This render
      // declared `(value)` alone, so it was handed the ARGUMENTS and rendered `? subject, 0 of 0 message(s), state
      // 0 chars [?]` for a call whose own trace line read `messages: 611` -- a measurement that happened, was paid
      // for, and was invisible to the agent that asked for it. The six sibling tools all declare `(_args, value)`;
      // this was the exception, and its test called `render(value)`, so the two mistakes agreed and every gate
      // stayed green. A one-parameter render is now refused by test/entry-apply.test.js.
      render: (_args, value) => {
        const subject = value?.subject ?? {}
        const segmented = subject.segmented
        if (segmented !== undefined) {
          const head = 'system1_evaluate_session: SEGMENTED ' + (subject.source ?? '?') + ' subject, ' + segmented.segments
            + ' segment(s) of up to ' + segmented.maxChars + ' chars, ' + (subject.messages ?? 0) + ' of ' + (subject.total ?? 0)
            + ' message(s), ' + (subject.chars ?? 0) + ' chars of conversation'
            + ' [budget ' + segmented.budgetChars + ' chars ~ ' + segmented.budgetTokens + ' tokens]'
            // SAID AT THE TOP, because "the tool decided to segment" is the one thing a reader must know before the
            // numbers: without it a self-segmented run is indistinguishable from one the caller sized.
            + (value?.autoSegmented === true
              ? '\n  AUTO-SEGMENTED: ' + value.windowChars + ' characters of conversation is over the ' + segmented.budgetChars + '-character estimate, so the subject was judged in parts without being asked. Pass `segmentChars` to choose the size yourself, or `lastMessages` to judge a smaller window.'
              : '')
          const lines = []
          for (const [id, entry] of Object.entries(value?.answers ?? {})) {
            const where = entry.failed > 0 ? ', ' + entry.failed + ' segment(s) FAILED' : ''
            const unread = entry.unreadable > 0 ? ', ' + entry.unreadable + ' unreadable' : ''
            if (entry.type === 'noul' || entry.type === 'score') {
              lines.push('  ' + id + ' [' + entry.type + ']: n=' + entry.n + where + unread
                + ' median=' + (entry.median === null ? '?' : Math.round(entry.median * 1000) / 1000)
                + ' range ' + entry.min + '..' + entry.max
                + (entry.type === 'noul'
                  ? ' true in ' + (entry.aboveHalf === null ? '?' : Math.round(entry.aboveHalf * 100) + '%') + ' of segments'
                  : (isRecord(value?.scales) && typeof value.scales[id] === 'number' ? ' of ' + value.scales[id] : '')))
            } else {
              lines.push('  ' + id + ' [choice]: n=' + entry.n + where + unread + ' modal=' + entry.modal
                + ' (' + (entry.agreement === null ? '?' : Math.round(entry.agreement * 100) + '%') + ') '
                + (entry.labels ?? []).map((row) => row.label + '=' + row.n).join(' '))
            }
          }
          lines.push('  THESE ARE SEGMENT READINGS, COMBINED IN CODE -- not a session-level judgement: "true in 5 of 7 segments" is not "true of the session", and a question about the OUTCOME is answered by the LAST segment.')
          // THE LIST IS CAPPED, AND IT SAYS SO. An independent agent read a 12-row list for a 16-segment run as "the
          // tool output was TRUNCATED" and went to the package to recover the rest -- which is the right instinct and
          // the wrong bill: a silent cap reads as a transport failure when it is a display choice.
          const rows = value.segments ?? []
          for (const row of rows.slice(0, 12)) {
            lines.push('    seg ' + row.index + ': messages ' + (row.from + 1) + '-' + row.to + ' (' + row.messages + '), ' + row.chars + ' chars'
              + (row.truncated === true ? ' TRUNCATED' : '') + (row.overBudget === undefined ? '' : ' OVER BUDGET') + (row.failure === undefined ? '' : ' FAILED: ' + row.failure.reason))
          }
          if (rows.length > 12) lines.push('  ... and ' + (rows.length - 12) + ' more segment(s), NOT truncated -- the rows above are capped at 12 for readability, and every segment is in the package\'s readings.json')
          if (segmented.failed > 0) lines.push('  ' + segmented.failed + ' segment(s) produced no reading at all; they are in the rows above and excluded from every n.')
          return [{ type: 'text', text: head + (lines.length === 0 ? '' : '\n' + lines.join('\n')) + selectionNote(value) }]
        }
        // THE DENOMINATOR, ON THE HEADLINE. `state 8000 chars (truncated)` with no total is the shape register row O26
        // records: a reading of 3.1% of a conversation rendered exactly like a reading of all of it.
        const seen = Number.isInteger(subject.chars) && subject.chars > 0
          ? ', ' + subject.chars + ' chars of conversation'
          : ''
        const head = 'system1_evaluate_session: ' + (subject.source ?? '?') + ' subject, ' + (subject.messages ?? 0) + ' of '
          + (subject.total ?? 0) + ' message(s)' + seen + ', state ' + (value?.stateChars ?? 0) + ' chars'
          + (value?.truncated === true ? ' (TRUNCATED -- the judge saw a cut of the text above)' : '') + ' [' + (value?.stateHash ?? '?') + ']'
        // THE OTHER CAP, ON ITS OWN LINE, because it is a different cut: `toolBlockMaxChars` trims the TOOL CALLS
        // section from its start, so the calls it drops are the LATER ones -- and a question about what happened after
        // a failed lookup is about a later one.
        const toolLine = '\n  TOOL CALLS shown to the judge: ' + describeToolCut(subject.toolCalls)
        if (value?.failure !== undefined) {
          return [{ type: 'text', text: head + '\ncould not answer: ' + String(value.failure.reason ?? 'unknown reason') }]
        }
        const lines = Object.entries(value?.answers ?? {}).map(([id, answer]) => {
          const record = answer !== null && typeof answer === 'object' ? answer : {}
          // THE KEYS THE TRANSPORT PRODUCES, not the one it consumes. A narrowed noul is
          // `{ type: 'noul', probability, confidence }` and a choice is `{ type: 'choice', choice, probabilities }`;
          // `noul` is the key `narrowAnswers` reads on the way IN, so reading it here rendered every real answer as
          // "(no label)" -- measured by `test/evaluate-live.test.js`, and register row O20.
          const probability = typeof record.probability === 'number' ? record.probability : undefined
          const label = record.label ?? record.level ?? record.choice ?? record.score
            ?? (probability === undefined ? undefined : 'p=' + probability)
            ?? (record.type === 'unreadable' ? 'unreadable' : '(no label)')
          // ROUNDED, because a confidence interpolated from a distribution printed as `0.5900000000000001` -- a
          // precision the judge never reported. The one rounding lives in `lib/report.js`.
          const confidence = typeof record.confidence === 'number' ? ' (' + round(record.confidence) + ')' : ''
          const unreadable = record.type === 'unreadable' ? ' [unreadable: ' + String(record.reason ?? 'no reason') + ']' : ''
          // `OF N`, ALWAYS, for a score: the number is a position on the question's own levels, and a bare `1.85` is
          // not a reading anybody can act on.
          const scale = isRecord(value?.scales) ? value.scales[id] : undefined
          return '  ' + id + ': ' + String(label) + (typeof scale === 'number' ? ' of ' + scale : '') + confidence + unreadable
        })
        const packaged = value?.package === undefined ? ''
          : '\n  ' + (value.package.problem === undefined
            ? 'PACKAGE written to ' + value.package.dir + ' (' + value.package.files.join(', ') + '). Read report.md for the numbers; attach a reading with system1_measurements { action: \'interpret\' }.'
            : 'PACKAGE NOT written: ' + value.package.problem)
        const auto = value?.autoSegmented === true
          ? '\n  AUTO-SEGMENTED: ' + value.windowChars + ' characters of conversation is over the ' + stateBudgetChars + '-character estimate, so the subject was judged in parts without being asked. Pass `segmentChars` to choose the size yourself, or `lastMessages` to judge a smaller window.'
          : ''
        const provenance2 = selectionNote(value) + (value?.executed === undefined ? '' : '\nanswered by ' + JSON.stringify(value.executed)) + packaged + auto
        return [{ type: 'text', text: head + toolLine + (lines.length === 0 ? '\n(no answers)' : '\n' + lines.join('\n')) + provenance2 }]
      },
      // WHAT THE CLIENT CARD RENDERS. `output.presentationMeta` is the tool contract's own channel: the harness
      // persists it verbatim on `tool/result` as `block.meta`, for Host presenters and Client renderers -- so the card
      // reads structured data rather than re-parsing the model-facing text, and the two cannot drift.
      presentationMeta(_args, value) {
        const out = {
          subject: value?.subject ?? null,
          stateHash: typeof value?.stateHash === 'string' ? value.stateHash : '',
          stateChars: typeof value?.stateChars === 'number' ? value.stateChars : 0,
          truncated: value?.truncated === true,
          answers: value?.answers ?? {},
        }
        if (value?.failure !== undefined) out.failure = value.failure
        if (value?.executed !== undefined) out.executed = value.executed
        return out
      },
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          answers: { type: 'object', additionalProperties: false, description: 'One entry per question id, as the decision model returned it.' },
          subject: {
            type: 'object', additionalProperties: false,
            description: 'What was judged: the source, the session, the slice, and how much of the session it covered.',
            properties: {
              source: { type: 'string', description: '`live` or `stored`.' },
              sessionId: { type: 'string', description: 'The stored session id, or empty for the live subject.' },
              kinds: { type: 'array', items: { type: 'string' }, description: 'The message kinds included.' },
              lastMessages: { type: 'number', description: 'How many newest messages were asked for; 0 is all of them.' },
              offset: { type: 'number', description: 'How many of the newest messages were skipped, so a judgement of a SPAN is recognisable as one.' },
              messages: { type: 'number', description: 'How many messages the slice actually carried.' },
              total: { type: 'number', description: 'How many messages the session had before slicing.' },
              chars: { type: 'number', description: 'Characters of message text in the WHOLE session, so `stateChars` can be read as a fraction of it rather than in isolation.' },
              events: { type: 'number', description: 'Every event in the session, of which `total` are messages.' },
              toolEvents: { type: 'number', description: '`tool/call` and `tool/result` events. They travel with the messages into the composer, so the TOOL CALLS section carries results and not just calls.' },
              segmented: {
                type: 'object', additionalProperties: false,
                description: 'Present when the subject was SEGMENTED (`segmentChars` > 0). The `answers` are then an ARITHMETIC aggregate over per-segment readings, not one model answer, and the two ends are the informative readings for a question whose evidence sits at the start or the end of a session.',
                properties: {
                  segments: { type: 'number' },
                  maxChars: { type: 'number' },
                  budgetChars: { type: 'number', description: 'The estimated `state` budget this segmentation obeys, from the published token limit.' },
                  budgetTokens: { type: 'number' },
                  failed: { type: 'number' },
                },
              },
              toolCalls: {
                type: 'object', additionalProperties: false,
                description: 'What the composer actually SHOWED of the tool record: `toolBlockMaxChars` cuts the TOOL CALLS section from its start, so a reading taken from 3 of 529 calls is not a reading of the trajectory.',
                properties: {
                  calls: { type: 'number', description: 'Tool calls collected.' },
                  results: { type: 'number', description: 'Tool results collected.' },
                  shown: { type: 'object', additionalProperties: false, properties: { calls: { type: 'number' }, results: { type: 'number' } } },
                  kept: { type: 'string', description: 'Which ends survived the cut: `all`, `head`, or `both ends`. A cut that keeps only the head drops the newest calls, which is where a question about what followed a failed lookup points.' },
                  truncated: { type: 'boolean', description: 'Whether the section was cut at all.' },
                },
              },
            },
            required: ['source', 'sessionId', 'kinds', 'lastMessages', 'messages', 'total'],
          },
          package: {
            type: 'object', additionalProperties: false,
            description: 'For `package`: true: what was written, and where. ABSENT unless a package was asked for.',
            properties: {
              dir: { type: 'string' },
              files: { type: 'array', items: { type: 'string' } },
              bytes: { type: 'number' },
              problem: { type: 'string' },
            },
          },
          segments: {
            type: 'array',
            description: 'For a SEGMENTED run: one row per segment, so a reading can be traced to the part of the session it came from.',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                index: { type: 'number' },
                from: { type: 'number' },
                to: { type: 'number' },
                messages: { type: 'number' },
                chars: { type: 'number' },
                stateHash: { type: 'string' },
                truncated: { type: 'boolean' },
                overBudget: { type: 'string' },
                failure: { type: 'object', additionalProperties: false, properties: { reason: { type: 'string' } } },
              },
            },
          },
          first: { type: 'object', additionalProperties: false, properties: { index: { type: 'number' }, from: { type: 'number' }, to: { type: 'number' } } },
          last: { type: 'object', additionalProperties: false, properties: { index: { type: 'number' }, from: { type: 'number' }, to: { type: 'number' } } },
          stateHash: { type: 'string', description: 'A short hash of the composed state, so two evaluations of the same input are recognisable as the same. For a segmented run it is the segments\' hashes joined, because there is no single state.' },
          groups: { type: 'array', items: { type: 'string' }, description: 'The evidence groups this reading was given, or absent when no group was named (which is G0 and G1 together).' },
          turn: { type: 'number', description: 'The turn measured, when one was named.' },
          turns: { type: 'array', items: { type: 'number' }, description: 'The turns measured, when several were named -- "turns 37 to 40" is four turns of G0: still one group, at a larger scope.' },
          exchange: {
            type: 'object', additionalProperties: false,
            description: 'For a G0 reading: which exchange(s) were measured, and what the selection left out.',
            properties: {
              turns: { type: 'array', items: { type: 'number' } },
              exchanges: { type: 'number' },
              of: { type: 'number' },
              unanswered: { type: 'number', description: 'Exchanges where the human asked and no turn followed, so the selection holds a question with no answer.' },
              excluded: {
                type: 'array',
                description: 'The `user/message` events that were NOT the human, by source kind, with their count and characters -- what a G0 reading left out, because 8 of one session\'s 46 operator messages were harness injections carrying 80% of that stream\'s volume.',
                items: { type: 'object', additionalProperties: false, properties: { kind: { type: 'string' }, count: { type: 'number' }, chars: { type: 'number' } } },
              },
            },
          },
          scales: {
            type: 'object', additionalProperties: false,
            description: 'For a `score` question, the TOP LEVEL of the scale it was answered on, by question id -- so `1.85` can be read as `1.85 of 2`. Absent when no question asked was a score.',
          },
          autoSegmented: { type: 'boolean', description: 'Set when the subject was over the estimate and the call SEGMENTED IT without being asked, so a long session cannot be judged from a few thousand characters by omission.' },
          windowChars: { type: 'number', description: 'How many characters of conversation were in the window, before composition.' },
          stateChars: { type: 'number', description: 'How long the composed state was before it was sent.' },
          truncated: { type: 'boolean', description: 'Whether the state was cut to fit the budget.' },
          executed: { type: 'object', additionalProperties: false, description: 'The provider, model and revision that actually answered.' },
          usage: { type: 'object', additionalProperties: false, description: 'Token usage, when the transport reported it.' },
          durationMs: { type: 'number', description: 'How long the judgement took.' },
          failure: {
            type: 'object', additionalProperties: false,
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
      // A PAGE OF A LONG SESSION, not a percentage of the whole. Measured: the default cap showed a judge 8,000 of a
      // 259,445-character conversation (3.1%), where forty whole exchanges are both smaller and answerable.
      const offset = Number.isInteger(given.offset) && given.offset > 0 ? given.offset : 0
      const useStored = configured.source === 'stored' || asked !== '' || sessionId !== ''

      // ONE PLACE THAT FINISHES AN EVALUATION, so the package is attached on every path that produced a reading --
      // and so a run that failed still gets its package, because a package records what HAPPENED.
      const finish = async (value) => {
        if (given.package !== true) return value
        if (typeof packageRun !== 'function') return Object.assign({}, value, { package: { problem: 'no package writer is wired to this row, so the measurement was NOT saved' } })
        // AWAITED: the writer reads and writes files, and a promise recorded as `package` would be a package nobody
        // can find. A writer that throws is a NAMED problem, because the reading itself already happened.
        try {
          // THE SUBJECT TRAVELS WITH THE REQUEST, so the package holds THIS conversation's calls and not every
          // measurement the process has taken since it started.
          const written = await packageRun({ sessionId })
          return Object.assign({}, value, { package: written })
        } catch (error) {
          return Object.assign({}, value, { package: { problem: 'packaging failed: ' + messageOf(error) } })
        }
      }

      const subject = useStored
        ? await stored({ sessionId, kinds, lastMessages, offset })
        : { events: await liveEvents(), messages: null, slice: null, coverage: null, session: null, problem: null }
      if (typeof subject?.problem === 'string' && subject.problem !== '') {
        throw new Error(`${EVALUATE_TOOL_NAME}: ${subject.problem}`)
      }
      // `events` IS THE WINDOW THE COMPOSER TAKES -- messages with the tool calls and results between them -- while
      // the COUNT a reader is told is the messages. A stored subject supplies both; the live path supplies only
      // events, where the two are the same list. Reading `events.length` as the message count reported the tool
      // traffic as conversation, and dropping the window cost every tool RESULT (see `lib/session-subject.js`).
      const window = Array.isArray(subject?.events) ? subject.events : []
      const windowMessages = Array.isArray(subject?.messages) ? subject.messages : window
      if (windowMessages.length === 0) {
        throw new Error(`${EVALUATE_TOOL_NAME}: the subject carries no messages, so there is no conversation to judge`)
      }

      // WHICH EVIDENCE, and it is refused rather than approximated when this build cannot compose it. Applied HERE,
      // after the window is read and before anything is asked, so segmentation, composition and the counts below all
      // describe the selection rather than the session.
      const evidence = applyGroups({ events: window, messages: windowMessages, groups: given.groups, turn: given.turn, turns: given.turns })
      if (typeof evidence.problem === 'string' && evidence.problem !== '') {
        throw new Error(`${EVALUATE_TOOL_NAME}: ${evidence.problem}`)
      }
      const events = evidence.events
      const messages = evidence.messages
      if (messages.length === 0) {
        throw new Error(`${EVALUATE_TOOL_NAME}: the selection carries no messages, so there is nothing to judge`)
      }

      // THE SET IS NAMED IN THE CALL WHEN THE CALLER NAMES IT, so measuring with a second instrument is one call
      // rather than a settings change somebody else has to undo.
      // THE CALLER'S NAME, AND ONLY THAT: the fallback chain -- the row's set, then the plugin's own default -- lives
      // where sets are resolved, so there is one answer to "which set was asked" rather than two.
      const built = questions({ set: given.set, scope: given.scope })
      // THE SCALE A SCORE IS ON, carried to the render so a reading can never be quoted as a bare number. `1.85` says
      // nothing; `1.85 of 2` is a position on the levels the question declared. The operator asked for this after a
      // reading was reported without it -- which is the second time a FORMAT was left to prose when the tool could
      // carry it (see `docs/measurement-depth.md` on why the form belongs in the tool).
      const scales = scoreScales(built.questions)
      if (Array.isArray(built?.problems) && built.problems.length > 0) {
        // REFUSE, DO NOT TRIM: a quietly shortened question files a measurement of one thing under another.
        throw new Error(`${EVALUATE_TOOL_NAME}: ${built.problems[0]}`)
      }

      // ---------------------------------------------------------------------------------------------
      // SEGMENTED: the subject does not fit ONE request, so it is judged in parts and combined in code.
      // See `lib/segment.js` for why the segmentation is contiguous and why the aggregate is arithmetic.
      // ---------------------------------------------------------------------------------------------
      // A LONG SUBJECT SEGMENTS ITSELF, and this is the failure it prevents: without `segmentChars` a whole session is
      // composed down to the row's cap, the judge answers about a few thousand characters, and the report reads like a
      // session-level judgement. Measured on this repository's own sessions: 855,812 characters of conversation were
      // composed to 8,000 and answered anyway. THE CALLER CAN STILL CHOOSE the size, and `lastMessages` paging still
      // wins -- a window the caller narrowed on purpose is only segmented if that window is itself too big.
      const askedChars = Number.isInteger(given.segmentChars) && given.segmentChars > 0 ? given.segmentChars : 0
      const windowChars = messages.reduce((total, message) => total + textOfEvent(message).length, 0)
      const autoSegmented = askedChars === 0 && windowChars > stateBudgetChars
      const segmentChars = askedChars > 0 ? askedChars : (autoSegmented ? DEFAULT_SEGMENT_CHARS : 0)
      if (segmentChars > 0) {
        const parts = segmentsOf(events, messages, { maxChars: segmentChars })
        const rows = []
        for (const part of parts) {
          // THE SEGMENT IS COMPOSED WITH THE STATE BUDGET, NOT THE ROW'S WHOLE-SESSION CAP -- see `index.js`. The
          // segmentation already decided the size; this is the ceiling it was measured against.
          const piece = await compose(part.events, stateBudgetChars, sessionId)
          if (piece?.refused === true) {
            rows.push({ index: part.index, from: part.from, to: part.to, messages: part.messages, chars: 0, stateHash: '', failure: { reason: piece.reason } })
            continue
          }
          const text = String(piece.state ?? '')
          const hash = createHash('sha256').update(text).digest('hex').slice(0, 12)
          const budget = withinStateBudget(text.length)
          let reply
          try {
            reply = await decide({ state: text, questions: built.questions }, { signal: exec?.signal })
          } catch (error) {
            rows.push({ index: part.index, from: part.from, to: part.to, messages: part.messages, chars: text.length, stateHash: hash, failure: { reason: messageOf(error) } })
            continue
          }
          if (reply === null || typeof reply !== 'object' || reply.kind === 'error') {
            rows.push({ index: part.index, from: part.from, to: part.to, messages: part.messages, chars: text.length, stateHash: hash, failure: { reason: String(reply?.reason ?? 'the model returned no result') } })
            continue
          }
          rows.push({
            index: part.index, from: part.from, to: part.to, messages: part.messages,
            chars: text.length, stateHash: hash, truncated: piece.truncated === true,
            // A SEGMENT OVER THE ESTIMATED BUDGET IS REPORTED, NOT HIDDEN: it is the one reading most likely to be
            // about nothing, and it is here because a single message can exceed the budget on its own.
            ...(budget.ok === false ? { overBudget: budget.problem } : {}),
            answers: isRecord(reply.answers) ? reply.answers : {},
          })
          // ONE LINE PER SEGMENT, because each IS a reading -- about that part of the session, under this hook.
          if (typeof record === 'function') {
            record({
              event: 'call', hook: REVIEW_HOOK, tool: toolId,
              subject: { source: useStored ? 'stored' : 'live', sessionId: useStored ? sessionId : '', kinds, lastMessages, offset, groups: evidence.groups, turn: evidence.turn, messages: part.messages, total: messages.length },
              segment: { index: part.index, from: part.from, to: part.to, of: parts.length },
              stateHash: hash,
              questionIds: Object.keys(built.questions),
              answers: isRecord(reply.answers) ? reply.answers : {},
            })
          }
        }
        const aggregate = aggregateReadings(rows, built.questions)
        const ends = firstAndLast(rows)
        const failed = rows.filter((row) => row.failure !== undefined).length
        return await finish({
          autoSegmented,
          windowChars,
          groups: evidence.groups,
          ...(evidence.turn === null ? {} : { turn: evidence.turn }),
          ...(evidence.turns === undefined ? {} : { turns: evidence.turns }),
          ...(evidence.exchange === null ? {} : { exchange: evidence.exchange }),
          ...(Object.keys(scales).length === 0 ? {} : { scales }),
          answers: aggregate,
          subject: {
            source: useStored ? 'stored' : 'live',
            sessionId: useStored ? sessionId : '',
            kinds, lastMessages, offset,
            messages: messages.length,
            total: Number.isInteger(subject?.coverage?.messages) ? subject.coverage.messages : messages.length,
            autoSegmented,
            windowChars,
            ...(Number.isInteger(subject?.coverage?.chars) ? { chars: subject.coverage.chars } : {}),
            segmented: {
              segments: parts.length,
              maxChars: segmentChars,
              // THE BUDGET THIS WAS SEGMENTED AGAINST, so a reader can see the number the technique obeys.
              budgetChars: stateBudgetChars,
              budgetTokens: CONTEXT.statePlusLongestQuestionTokens,
              failed,
            },
          },
          segments: rows.map((row) => ({
            index: row.index, from: row.from, to: row.to, messages: row.messages, chars: row.chars,
            ...(row.stateHash === '' ? {} : { stateHash: row.stateHash }),
            ...(row.truncated === true ? { truncated: true } : {}),
            ...(row.overBudget === undefined ? {} : { overBudget: row.overBudget }),
            ...(row.failure === undefined ? {} : { failure: row.failure }),
          })),
          first: ends.first === null ? null : { index: ends.first.index, from: ends.first.from, to: ends.first.to },
          last: ends.last === null ? null : { index: ends.last.index, from: ends.last.from, to: ends.last.to },
          stateHash: rows.map((row) => row.stateHash).join('+').slice(0, 64),
          stateChars: rows.reduce((total, row) => total + row.chars, 0),
          truncated: rows.some((row) => row.truncated === true || row.overBudget !== undefined),
        })
      }

      // AT THE JUDGE'S BUDGET, NOT THE ROW'S CAP. The segmented path has always composed each segment against
      // `stateBudgetChars`; this path composed against the row's `composeMaxChars`, which defaults to 8,000 -- so
      // EVERY non-segmented measurement this plugin ever took was cut to 8,000 characters regardless of what fitted,
      // and "measure the level whole" was impossible while a legacy display cap silently decided otherwise. Measured:
      // the G0 exchange of a freeciv turn is 10,885 characters whole and was cut to 8,000 at the row's cap. The row's
      // knob still governs the seam and reading paths, where a smaller state per firing is the point.
      const composed = await compose(events, stateBudgetChars, sessionId)
      if (composed?.refused === true) throw new Error(`${EVALUATE_TOOL_NAME}: ${composed.reason}`)
      const state = String(composed.state ?? '')
      const stateHash = createHash('sha256').update(state).digest('hex').slice(0, 12)
      const coverage = subject?.coverage ?? null
      const out = {
        autoSegmented,
        windowChars,
        groups: evidence.groups,
        ...(evidence.turn === null ? {} : { turn: evidence.turn }),
        ...(evidence.turns === undefined ? {} : { turns: evidence.turns }),
        ...(evidence.exchange === null ? {} : { exchange: evidence.exchange }),
        ...(Object.keys(scales).length === 0 ? {} : { scales }),
        answers: {},
        subject: {
          source: useStored ? 'stored' : 'live',
          sessionId: useStored ? sessionId : '',
          kinds,
          lastMessages,
          offset,
          groups: evidence.groups,
          turn: evidence.turn,
          messages: messages.length,
          // THE DECLARED MEANING OF `total`, which the code did not honour: the schema below says "how many messages
          // the session had before slicing", and this read the EVENT count, so the render said "611 of 2995
          // message(s)" about 2,995 events. Register row O26 is the other half of the same silence.
          total: Number.isInteger(coverage?.messages) ? coverage.messages : messages.length,
          // HOW MUCH THERE WAS TO SEE. `stateChars` and `truncated` already said the state was cut; without a
          // denominator nothing on the line said 8,000 was 3.1% of it. This is the number that makes it a ratio.
          ...(Number.isInteger(coverage?.chars) ? { chars: coverage.chars } : {}),
          ...(Number.isInteger(coverage?.events) ? { events: coverage.events } : {}),
          ...(Number.isInteger(coverage?.toolEvents) ? { toolEvents: coverage.toolEvents } : {}),
          // AND THE SECOND CAP, WHICH IS NOT `composeMaxChars`. `toolBlockMaxChars` cuts the TOOL CALLS section from
          // its START, independently of the state cut, and measured on a real session it held 3 of 529 calls. The
          // composer now counts what it showed, so a reading taken from 3 tool calls is not read as 3 tool calls.
          // ABSENT MEANS NO TOOL CALLS, not "unmeasured": a subject with none has nothing to report here, and every
          // seam line in the trace would otherwise carry a zero object.
          ...(composed?.toolCalls === undefined || composed.toolCalls.calls === 0 ? {} : { toolCalls: composed.toolCalls }),
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
      return await finish(out)
    },
  }
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/** `{id: topLevel}` for every `score` question, so the render can print `1.85 of 2` rather than a bare number. */
function scoreScales(questions) {
  const out = {}
  for (const [id, spec] of Object.entries(questions ?? {})) {
    const levels = spec?.levels
    if (spec?.type === 'score' && Array.isArray(levels) && levels.length > 1) out[id] = levels.length - 1
  }
  return out
}
