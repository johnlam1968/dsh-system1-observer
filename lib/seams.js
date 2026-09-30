// SEAM PROBES. A real decision-model call available at every point of the agent loop, and
// OFF at every point by default.
//
// Why this exists: the plugin calls the model at exactly one seam today (`llm/stream`), and the
// question "where else would a decision earn its place" has no way to answer itself. These put a
// call site at all nine points so each can be switched on alone and measured, instead of argued
// about.
//
// WHAT A PROBE DELIBERATELY IS NOT:
//   - It NEVER raises a ladder level. It records and traces and returns nothing. A scaffold whose
//     job is measurement must be structurally incapable of changing the outcome -- an unvalidated
//     question in `enforce` mode is how this project already withheld 306 faithful replies.
//   - It NEVER throws into the loop. A model outage, a timeout, a malformed body, or a throwing
//     trace are all caught and recorded. Nine probes sit in the loop's critical path.
//   - It NEVER ships a whole turn. The state is the seam name and a bounded excerpt.
import { choice } from './model/questions.js';
import { isRecord } from './is-record.js';
import { readConfigValue } from './config-value.js';
/** The nine points, in loop order. */
export const PROBE_SEAMS = Object.freeze([
    'assemble', 'admit', 'request', 'draft', 'pre_execute',
    'execute', 'post_execute', 'result', 'close',
]);
/**
 * Whether the model may be called at one seam.
 *
 * `!== false`, never `=== true`, and that is the whole safety property: an ABSENT key must mean ON. A
 * config written before this field existed has no `seamEnabled` at all, and a per-seam switch that read
 * `=== true` would turn the observer off everywhere on upgrade -- silently, and only for the installs that
 * did not ask for it. Measured: a plain boolean inside a volatile object materialises to an absent key
 * (`{}`), so an unset seam really is `undefined` rather than `false`.
 */
export function seamCallsEnabled(config, seam) {
    const map = readConfigValue(config?.seamEnabled);
    if (!isRecord(map))
        return true;
    return map[seam] !== false;
}
/**
 * The seams whose payload carries no text, so nothing can ever be asked at them.
 *
 * Named once here rather than sniffed from `probeText` at each call site. The card has its own copy (it cannot
 * import this module); this one is for the host, which uses it to keep these two out of the "seams off" list a
 * mount line prints -- they are not SWITCHED off, they are inapplicable, and a line that cannot tell those
 * apart reports a decision nobody made.
 */
export const TEXTLESS_SEAMS = Object.freeze(['request', 'close']);
/**
 * The seams whose subject is a TOOL, so a line there can name the tool and its exit code.
 *
 * `post_execute` and `result` carry only the RESULT text (`asText(list[1])`), with no name -- so a matrix keyed
 * on results alone cannot say which tool produced them. The name is recoverable at `pre_execute`/`execute` by
 * splitting on the first space, which is a heuristic; recording the field is a port.
 */
export const TOOL_SEAMS = Object.freeze(['pre_execute', 'execute', 'post_execute', 'result']);
/**
 * The exit code a tool appended to the END of its output, or `null`.
 *
 * ANCHORED ON THE LAST LINE, because that is where a wrapper puts it. Read from the text BEFORE any truncation
 * and before any whitespace handling, because collapsing the tail merges the code into the body it follows.
 * This repository does not collapse whitespace today, which is exactly why the read is placed where it cannot
 * be broken by adding that later.
 */
const EXIT_CODE = /(?:^|\[|,\s*)exit[ _]code[:=]?\s*(\d+)\)?\]?\.?$/iu;
export function exitCodeOf(value) {
    if (typeof value !== 'string')
        return null;
    // THE LAST LINE, not the whole text: the pattern anchors at `^` and `$`, which only mean "the segment the
    // wrapper appended" if the segment is a line of its own.
    const trimmed = value.trimEnd();
    const lastLine = trimmed.slice(trimmed.lastIndexOf('\n') + 1);
    const match = EXIT_CODE.exec(lastLine);
    return match === null ? null : Number(match[1]);
}
// The nine points, mapped to the host events they attach to. `ctx.tools.guard` is NOT among
// them and cannot be: it is synchronous, so it can never await an HTTP request.
const HOOKS = Object.freeze({
    assemble: 'system-prompt/assemble',
    admit: 'agent/pre-step',
    request: 'agent/request',
    draft: 'llm/stream',
    pre_execute: 'tools/pre-execute',
    execute: 'tools/execute',
    post_execute: 'tools/post-execute',
    result: 'tools/result',
    close: 'agent/turn-stopping',
});
function isProbeSeam(value) {
    return typeof value === 'string' && PROBE_SEAMS.includes(value);
}
// WHICH ARGUMENT CARRIES THE TEXT, PER SEAM. The first is right for most of them and WRONG for the
// three that do not receive a plain payload, and every one of those three was measured wrong on the
// first live probe run (2026-09-28, `scripts/ask.sh` with all nine on):
//
//   `tools/post-execute`  (exec, result, next)   shown the exec -> answered `during_a_tool_call`
//   `tools/result`        (exec, result)         shown the exec -> answered `model_output`
//
// Both seams exist precisely to carry a tool RESULT, and the probe's own question asks about "the
// result a tool returned", so neither answer could have been right: the question was asked about
// text the seam had not been given. `system-prompt/assemble` is the third -- its first argument is a
// `PromptAssembly`, `{sections, contexts, tools, variables}`, and stringifying that JSON blob got
// `model_output`. `renderPrompt` from `@deepseek-ai/dsh-system-prompt` would render it properly and
// is NOT resolvable from this bundle (only `@deepseek-ai/schemastery` is in `plugin/node_modules`),
// so this reads the two lists that carry text and says so.
//
// The signatures are from `docs/DSH_CORDIS_FIELD_GUIDE.md`, which took them from the installed
// `lib/types/**/*.d.ts` for 0.1.7-rc.2.
// A SILENT '' IS THE WORST ANSWER THIS FUNCTION CAN GIVE, and it gave it at two seams on the first
// corrected run: `tools/pre-execute` and `tools/execute` both sent an EMPTY excerpt, and because an
// empty string is a perfectly good string the probe answered anyway -- `before_a_tool_call` every
// time, from no text at all. That read as `pre_execute` scoring 4/4 and `execute` 0/4 when NEITHER
// seam had been measured. An empty excerpt cannot be told from a seam whose payload is empty, so
// every way of failing now says which way it failed.
function asText(value) {
    if (typeof value === 'string')
        return value;
    if (value === undefined)
        return '[no first argument: undefined]';
    if (value === null)
        return '[null]';
    try {
        const text = JSON.stringify(value);
        return text === undefined ? `[unserialisable ${typeof value}]` : text;
    }
    catch (error) {
        return `[unserialisable ${typeof value}: ${error instanceof Error ? error.message : String(error)}]`;
    }
}
/** The text of a `PromptAssembly`: its sections and its contexts. Not tools, not variables. */
function assemblyText(assembly) {
    const parts = [];
    const source = isRecord(assembly) ? assembly : {};
    for (const key of ['sections', 'contexts']) {
        const list = Array.isArray(source[key]) ? source[key] : [];
        for (const part of list) {
            const text = isRecord(part) ? part.text : undefined;
            if (typeof text === 'string' && text !== '')
                parts.push(text);
        }
    }
    return parts.join('\n\n');
}
/** The text of a `UserMessage[]`. Read field by field -- see the note on `asText`. */
function messagesText(messages) {
    const parts = [];
    for (const message of Array.isArray(messages) ? messages : []) {
        const given = isRecord(message) ? message : {};
        if (typeof given.text === 'string')
            parts.push(given.text);
        const content = Array.isArray(given.content) ? given.content : [];
        for (const block of content) {
            const blockText = isRecord(block) ? block.text : undefined;
            if (typeof blockText === 'string' && blockText !== '')
                parts.push(blockText);
        }
    }
    return parts.join('\n\n');
}
/** A tool call as text: its name and the arguments it was given. */
function toolText(exec) {
    const given = isRecord(exec) ? exec : {};
    const name = typeof given.name === 'string' ? given.name : '';
    let args = '';
    try {
        args = JSON.stringify(given.arguments) ?? '';
    }
    catch {
        args = '[arguments unserialisable]';
    }
    return `${name} ${args}`.trim();
}
/**
 * The text a seam is asked about.
 *
 * THERE IS A DIFFERENT ANSWER PER SEAM, and the first version used `args[0]` for all of them. On the
 * first run that could actually be seen (2026-09-28, all nine switched on through `scripts/ask.sh`)
 * FIVE of nine seams had sent an empty excerpt and TWO had no text to send at all, so the accuracy
 * figures were the model's answer to a question about nothing:
 *
 *   `tools/post-execute` `(exec, result, next)`   was shown the exec  -> "during a tool call"
 *   `tools/result`       `(exec, result)`         was shown the exec  -> "model output"
 *   `agent/request`      payload is `{agent, turn, step, signal}` and `next()` resolves to an
 *                        `LlmCallConfig` -- provider, model, temperature, stop. **No text exists at
 *                        this seam**, so nothing here can be classified.
 *   `agent/turn-stopping` payload is `{agent, turn, signal}`. **No text exists here either.**
 *
 * The last two return `''` on purpose, and `createProbe` refuses to ask when the text is empty: a
 * text-classification question with no text in it produces an answer, and an answer that looks like
 * a measurement is worse than no measurement. Every other signature here is from
 * `docs/DSH_CORDIS_FIELD_GUIDE.md` and the installed declaration files for 0.1.7-rc.2.
 */
export function probeText(seam, args, decision) {
    const list = Array.isArray(args) ? args : [];
    if (seam === 'assemble')
        return assemblyText(list[0]);
    if (seam === 'admit') {
        const payload = isRecord(list[0]) ? list[0] : {};
        return messagesText(payload.messages);
    }
    if (seam === 'request' || seam === 'close')
        return '';
    if (seam === 'pre_execute' || seam === 'execute')
        return toolText(list[0]);
    if (seam === 'post_execute' || seam === 'result')
        return asText(list[1]);
    return asText(list[0] ?? decision);
}
export class ProbeError extends Error {
}
export function probeHook(seam) {
    if (!isProbeSeam(seam)) {
        throw new ProbeError(`"${seam}" is not a probe seam; expected one of: ${PROBE_SEAMS.join(', ')}`);
    }
    return HOOKS[seam];
}
// ONE CONSTANT QUESTION, for two reasons. It is the same at every seam, so the seam is what
// varies in the measurement. And its answer is CHECKABLE -- we know which seam we are at -- so
// each probe yields an accuracy figure for free rather than only a latency.
//
// A `choice`, not a `noul`: measured on this server the noul channel is polarity-blind and
// returns a text-agreement score whatever it is asked, while choice respects the option text.
export const PROBE_QUESTION = Object.freeze(choice('Which part of an agent loop produced this text?', [
    { label: 'assembling_the_prompt', criterion: 'text being composed into the system prompt before the model reads it' },
    { label: 'admitting_a_step', criterion: "the operator's own message opening a step of the loop" },
    { label: 'requesting_from_the_model', criterion: 'the request about to be sent to the model' },
    { label: 'model_output', criterion: 'text the model has produced or is producing' },
    { label: 'before_a_tool_call', criterion: 'a tool call that is about to be made' },
    { label: 'during_a_tool_call', criterion: 'a tool call in flight' },
    { label: 'after_a_tool_call', criterion: "the result a tool returned" },
    { label: 'recording_a_tool_result', criterion: 'a tool result being written down for the record' },
    { label: 'closing_the_turn', criterion: 'the end of a turn' },
    { label: 'unclear', criterion: 'none of these fits the text', abstain: true },
]));
/**
 * Build a probe.
 *
 * A probe NEVER raises a level, NEVER changes a decision and NEVER throws into the loop: it
 * calls, traces, and returns. Everything it records is best-effort, which is why `note` swallows
 * a throwing trace.
 */
export function createProbe({ isEnabled, decide, trace, excerpt = 400, now = Date.now }) {
    function note(fields) {
        // A trace that throws must not be able to fail a turn either.
        try {
            trace('probe', fields);
        }
        catch { /* recording is best-effort, never load-bearing */ }
    }
    return {
        async run(seam, text) {
            probeHook(seam); // refuse a seam that does not exist rather than silently no-op
            if (!isEnabled(seam))
                return;
            const started = now();
            const state = { seam, text_excerpt: String(text ?? '').slice(0, excerpt) };
            const excerptOf = state.text_excerpt;
            // NO TEXT, NO QUESTION. Two seams carry no text at all (`agent/request` is routing
            // parameters and `agent/turn-stopping` is `{agent, turn, signal}`), and at five others the
            // first version sent an empty excerpt by accident. In both cases the model answered anyway --
            // it has a prior for what a nameless excerpt looks like -- and those answers were read as
            // accuracy figures. Refusing to ask turns a meaningless number into an explicit gap.
            if (excerptOf.trim() === '') {
                note({ seam, ms: 0, excerpt: excerptOf, skipped: 'no text at this seam' });
                return;
            }
            // THE EXCERPT GOES IN THE TRACE. Without it a wrong answer cannot be diagnosed, and the first
            // live probe run produced a wrong answer at four seams with no way to tell whether the model
            // had misread the text or the text had been taken from the wrong argument -- which is exactly
            // what turned out to be happening at `post_execute` and `result`. A trace that records a
            // verdict and not the evidence for it is the failure this repository has already paid for
            // once.
            try {
                const result = await decide({ state, questions: { probe: PROBE_QUESTION } });
                if (result.kind !== 'answers') {
                    note({ seam, ms: now() - started, excerpt: excerptOf, error: result.reason });
                    return;
                }
                const answer = result.answers.probe;
                // Which of the three answer shapes arrived is exactly what the probe is FOR, so the
                // label and the probability are both read and whichever the question produced is traced.
                note({
                    seam,
                    ms: now() - started,
                    excerpt: excerptOf,
                    answer: answer?.type === 'choice' ? answer.label : answer?.type === 'noul' ? answer.probability : null,
                    confidence: answer !== undefined && answer.type !== 'unreadable' ? answer.confidence : null,
                    answerConfidence: answer?.type === 'choice' ? answer.answerConfidence : null,
                    model: result.envelope?.model ?? null,
                });
            }
            catch (error) {
                note({ seam, ms: now() - started, excerpt: excerptOf, error: error instanceof Error ? error.message : String(error) });
            }
        },
    };
}
