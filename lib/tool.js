// THE AGENT'S WAY IN.
//
// An agent asked to tune the questions has no way to see what the questions did: the trace is a JSONL file
// whose path depends on the deployment, and a path nobody knows is a path nobody reads. So the observer
// registers a TOOL, and the tool's own description is the hint -- it is in the agent's tool list from the
// moment the row mounts, which is the only place a hint cannot be missed.
//
// WHY THE DEFINITION IS HAND-BUILT rather than `defineTool` from `@deepseek-ai/dsh-tools`: this package
// ships with two dependencies (`@deepseek-ai/schemastery`, `yaml`) and a profile's `link:` does not install
// a plugin's dependencies for it, so importing the harness's tool helper would make the row fail to load on
// a machine that has the harness but not that package beside us. `registry.register` accepts a plain
// definition (measured: it requires `name`, `description`, `parameters`, and an `output` with a `render`),
// and `defineTool`'s only other job is validating arguments against the schema -- which this tool does with
// property checks, the way the rest of this repository narrows untrusted input.
//
// THE PARAMETER SCHEMA MUST STAY INSIDE THE REGISTRY'S SUBSET: type, oneOf, properties, required,
// additionalProperties, items, enum, const, plus annotations. There is deliberately no `minimum` on `tail`,
// because that keyword is not in the subset and would make `register` throw.
import { checkAgainst } from './tool-args.js'
import { DEFAULT_TAIL, TRACE_SEAMS, reportTrace } from './trace-report.js'
import { traceData } from './trace-data.js'

export const TRACE_TOOL_NAME = 'system1_trace'

const DESCRIPTION = [
  'Read the System One observer trace: what question the decision model was asked at each point of the agent loop,',
  'what it answered with what probability, how long it took, and every seam that was skipped and why.',
  'The observer calls a model at these seams: ' + TRACE_SEAMS.join(', ') + '.',
  'Use it to check that a configured question actually separates -- a label that never changes, or one that keeps',
  'landing on the abstain option, is a question that needs rewriting rather than a model that is wrong.',
  'It also lists the session ids the trace has seen and the sessions live right now, which is what a session-scoped',
  'observer is configured with. Read-only: it never changes the configuration or the trace.',
].join(' ')

/**
 * The trace tool, as the registry wants it.
 *
 * @param options.path        the trace file this row writes, captured at mount (it is mount-bound)
 * @param options.runId       the run this row is writing, so the default is "what is happening now"
 * @param options.liveAgents  `() => string[]`, the sessions live in this process right now
 * @returns a plain `ToolDefinition`, ready for `ctx.tools.register`
 */
const parameters = {
      type: 'object', additionalProperties: false,
      properties: {
        run: {
          type: 'string',
          description: 'Which run to read: omit for the current one, `all` for every run in the window, or a run id or its prefix (for example `2026-09-30T02-26`).',
        },
        hook: {
          type: 'string',
          enum: [...TRACE_SEAMS],
          description: 'Restrict to one seam.',
        },
        tail: {
          type: 'integer',
          description: `How many of the most recent events to list, ${1}-${200}. Default ${DEFAULT_TAIL}. The summary counts always cover every event, not only the listed ones.`,
        },
        full: {
          type: 'boolean',
          description: 'Also print the question as it was sent, with its options or levels, and the full answer distribution rather than only the chosen label.',
        },
      },
    }

export function createTraceTool({ path, runId, liveAgents, price, idleGap, compareLanes, calibrationBins, probe } = {}) {
  return {
    name: TRACE_TOOL_NAME,
    description: DESCRIPTION,
parameters,

    output: {
      schema: {
        type: 'object', additionalProperties: false,
        required: ['text'],
        properties: {
          text: { type: 'string', description: 'The rendered trace report.' },
          // Declared because the schema is enforced against the returned value; NOT model-visible, because
          // `render` never reads it. A bare `object` on purpose: the shape is the renderer's business, and a
          // fully spelled-out nested schema would have to stay inside the registry's keyword subset.
          data: { type: 'object', additionalProperties: false, description: 'Structured trace data for the conversation card. Not model-visible.' },
        },
      },
      render(_args, value) {
        const text = value !== null && typeof value === 'object' && typeof value.text === 'string' ? value.text : ''
        return [{ type: 'text', text }]
      },
      // THE CARD'S COPY OF THE REPORT, and never the model's: `render` above returns only `text`, and this
      // leaves through `presentationMeta`, which the tool contract persists on `tool/result` as `meta` --
      // "for Host presenters and Client renderers to narrow independently". It is how the shipped `read` tool
      // gets line numbers to the UI without putting them in the model's context.
      //
      // IT IS A SEPARATE PROJECTION, not a serialisation of the text, because a renderer wants numbers it can
      // lay out and a model wants prose it can argue with. Neither should parse the other's output.
      // NEVER `undefined`, AND THAT HALF IS ENFORCED BY SHAPE: both branches return `data` or `null`, and the
      // registry fails the whole call on an `undefined` snapshot -- so a decision that succeeded must not become
      // a tool error merely because the card had nothing to draw.
      //
      // THE LOSSLESS-JSON HALF IS INHERITED, NOT DEFENDED HERE. `data` comes from `traceData`, which builds
      // everything from `JSON.parse` of the trace's own lines plus primitive coercions, so it is snapshottable by
      // construction. This function does NOT sanitise an arbitrary value: hand it `{ data: <cyclic> }` and the
      // snapshot would throw. Both the reviewer session and the MiniMax-M3 review reached this independently,
      // both agreed it is unreachable through `execute` today, and both suggested a cycle-marker test.
      //
      // I HAVE DELIBERATELY NOT ADDED ONE, which is a judgement rather than an oversight: a test pinning a
      // boundary nothing can reach is a test the next reader deletes, and it would make the contract look
      // defended when the real defence is that the data has one source. What would change the answer is
      // `traceData` gaining an input that is not JSON -- if that happens, this is the comment that should have
      // stopped you.
      presentationMeta(_args, value) {
        const data = value !== null && typeof value === 'object' ? value.data : undefined
        return data !== null && typeof data === 'object' ? data : null
      },
    },
    async execute(args, exec) {
      // THE CALLER'S CANCELLATION, HONOURED BEFORE ANY WORK. `reference/cookbook/adding-a-tool.md:49` requires it:
      // "honour `exec.signal`; cancel in-flight work when it fires". What this tool does cannot be interrupted
      // mid-flight, so the entry check is the honest maximum -- stated here rather than implied by silence.
      if (exec?.signal?.aborted === true) throw new Error('the call was cancelled before it started')
      // THE ARGUMENTS, AGAINST THIS TOOL'S OWN DECLARATION. A raw registration gets no validation from the
      // registry (adding-a-tool.md:44), so this is where the model's call is checked -- and it checks the same
      // literal the model was shown.
      checkAgainst(parameters, args, TRACE_TOOL_NAME)
      // A CROSS-FIELD RULE THE SCHEMA CANNOT EXPRESS, and the schema deliberately cannot: `minimum` is outside the
      // registry's keyword subset (lib/tool.js:17), so a non-positive window is refused here instead.
      if (Number.isInteger(args.tail) && args.tail < 1) throw new Error(`${TRACE_TOOL_NAME}: \`tail\` must be a positive number of entries`)

      // PROPERTY CHECKS, not a cast: `execute` receives whatever the model sent, and a tool that threw on a
      // stray argument would surface as a failed call rather than as the report the caller asked for.
      const given = args !== null && typeof args === 'object' ? args : {}
      const asked = {
        path,
        run: typeof given.run === 'string' && given.run !== '' ? given.run : runId,
        hook: typeof given.hook === 'string' ? given.hook : undefined,
        tail: typeof given.tail === 'number' ? given.tail : DEFAULT_TAIL,
        full: given.full === true,
        liveAgents: typeof liveAgents === 'function' ? liveAgents() : undefined,
        // Read live, so a rate edited in the card re-prices the next read with no restart.
        pricePerMTokInput: typeof price === 'function' ? price() : undefined,
        // Read live for the same reason: the gap decides what the report's `activeMs` means.
        idleGapMs: typeof idleGap === 'function' ? idleGap() : undefined,
        // And the lane limit, for the same reason.
        maxCompareLanes: typeof compareLanes === 'function' ? compareLanes() : undefined,
        calibrationBins: typeof calibrationBins === 'function' ? calibrationBins() : undefined,
        // And the question text in force, so a reworded probe is still scored as the probe it was.
        probeInstructions: typeof probe === 'function' ? probe() : undefined,
      }
      // THE TEXT FOR THE MODEL, THE DATA FOR THE CARD, both from the same request. `traceData` reads the
      // window independently -- the text report is the model's contract and rewriting it to be structured
      // would change what every agent reads, so the small cost of a second read is the right trade.
      return { text: reportTrace(asked), data: traceData(asked) }
    },
  }
}
