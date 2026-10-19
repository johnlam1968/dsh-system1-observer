// THE LOOP'S VOCABULARY, AND THE PROBE'S OWN QUESTION.
//
// What is here: the nine POINTS in loop order, what is true of each (a point whose payload carries no text, a point
// whose subject is a tool), whether the row allows a call at one, the exit-code reader a tool's output ends with, and
// the ONE question the probe asks with its fixed answer set.
//
// WHAT IS DELIBERATELY NOT HERE, and each of the two was measured:
//   - THE HARNESS EVENT each point attaches to. That map is the application's (`lib/host-events.js`), because it is
//     dsh's and changes with dsh; this file imported the session-adapter package for exactly one event name (`F110`).
//   - THE SHAPE OF EACH SEAM'S ARGUMENTS. Which argument carries the text is dsh's layout, per seam, and lives in
//     `lib/host-payload.js` with that module's notes.
//   - THE ROW'S SWITCHES. `seamCallsEnabled` takes the map as a PARAMETER; the application unwraps it
//     (`lib/instrument-input.js`), so nothing here reads a config field.
//
// WHY THE POINTS EXIST AT ALL: the plugin calls the model at exactly one place by default, and the question "where
// else would a decision earn its place" has no way to answer itself. Nine points, each switchable alone, make that a
// measurement instead of an argument.
//
// WHAT A PROBE DELIBERATELY IS NOT:
//   - It NEVER raises a ladder level. It records and traces and returns nothing. A scaffold whose
//     job is measurement must be structurally incapable of changing the outcome -- an unvalidated
//     question in `enforce` mode is how this project already withheld 306 faithful replies.
//   - It NEVER throws into the loop. A model outage, a timeout, a malformed body, or a throwing
//     trace are all caught and recorded. Nine probes sit in the loop's critical path.
//   - It NEVER ships a whole turn. The state is the seam name and a bounded excerpt.
// WHAT ENFORCES THE LAST TWO NOW is `lib/observe.js` -- the call, the containment and the line -- rather than a probe
// runner in this file: `createProbe` was a complete second implementation that nothing imported, and it is deleted
// (`ECOSYSTEM_STUDY.md` §2.8, work item 25 — a working note kept off-repository, not a file in this clone), so there is one path and it is the live one.
import { choice } from './model/questions.js';
import { isRecord } from './is-record.js';
/**
 * THE NINE POINTS OF THE LOOP, AS ONE TABLE.
 *
 * This module owns the loop's VOCABULARY, and the vocabulary is ours: the dsh EVENT each point attaches to is NOT
 * here. It was, and that single field was the whole of this file's dependency on the harness -- `register.js` now
 * keeps the id-to-event map (`lib/host-events.js`), which is the application's business, and a line's `hostEvent`
 * travels to the observer on the input object. What is left is a point's ID and its properties, which is what a
 * package with no dsh import can own.
 *
 * WHY ONE TABLE: `textless` and `tool` were three exported lists (`PROBE_SEAMS`, `TEXTLESS_SEAMS`, `TOOL_SEAMS`) plus
 * a fourth map of event names, all carrying the same nine names. A point added to one and not the others was a silent
 * disagreement -- an inapplicable seam reported as switched off, or a tool seam whose exit code was never read -- so
 * the properties of a point are fields of the point and the lists are DERIVED from them.
 *
 * `textless` is not "switched off": nothing can be asked where the payload carries no text, and a line that cannot
 * tell that apart from a decision reports a decision nobody made.
 *
 * `ctx.tools.guard` is NOT among the nine and cannot be: it is synchronous, so it can never await an HTTP request,
 * and a point there could only ever record a timeout.
 */
export const POINTS = Object.freeze([
    Object.freeze({ id: 'assemble' }),
    Object.freeze({ id: 'admit' }),
    Object.freeze({ id: 'request', textless: true }),
    Object.freeze({ id: 'draft' }),
    Object.freeze({ id: 'pre_execute', tool: true }),
    Object.freeze({ id: 'execute', tool: true }),
    Object.freeze({ id: 'post_execute', tool: true }),
    Object.freeze({ id: 'result', tool: true }),
    Object.freeze({ id: 'close', textless: true }),
]);
/** The nine point ids, in loop order. */
export const PROBE_SEAMS = Object.freeze(POINTS.map((point) => point.id));
/**
 * The points whose payload carries no text, so nothing can ever be asked at them.
 *
 * DERIVED, and the host uses it to keep these two out of the "seams off" list a mount line prints.
 */
export const TEXTLESS_SEAMS = Object.freeze(POINTS.filter((point) => point.textless === true).map((point) => point.id));
/**
 * The points whose subject is a TOOL, so a line there can name the tool and its exit code.
 *
 * `post_execute` and `result` carry only the RESULT text (`asText(list[1])`), with no name -- so a matrix keyed
 * on results alone cannot say which tool produced them. The name is recoverable at `pre_execute`/`execute` by
 * splitting on the first space, which is a heuristic; recording the field is a port.
 */
export const TOOL_SEAMS = Object.freeze(POINTS.filter((point) => point.tool === true).map((point) => point.id));
/**
 * Whether the model may be called at one point.
 *
 * THE SWITCH MAP IS A PARAMETER, never a config read: this module is the instrument, and the row's own settings are
 * unwrapped by the application before they arrive (see `lib/instrument-input.js`). What stays here is the RULE,
 * which is a safety property rather than a preference: `!== false`, never `=== true`, so an ABSENT key means ON. A
 * config written before the field existed has no map at all, and a per-point switch that read `=== true` would turn
 * the observer off everywhere on upgrade -- silently, and only for the installs that did not ask for it. Measured: a
 * plain boolean inside a volatile object materialises to an absent key (`{}`), so an unset point really is
 * `undefined` rather than `false`.
 */
export function seamCallsEnabled(switches, seam) {
    if (!isRecord(switches))
        return true;
    return switches[seam] !== false;
}
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
export class ProbeError extends Error {
}
/**
 * The descriptor for one point, or a throw naming every point there is.
 *
 * THE THROW IS A FEATURE, not an inconvenience: an unknown seam must refuse rather than silently no-op, because a
 * seam nobody attached to records nothing and looks like a quiet loop. `observe.js` evaluates this INSIDE its trace
 * thunk for exactly that reason -- the throw becomes a `fields_unavailable` line rather than no line at all.
 */
export function pointOf(seam) {
    const point = POINTS.find((one) => one.id === seam);
    if (point === undefined) {
        throw new ProbeError(`"${seam}" is not a probe seam; expected one of: ${PROBE_SEAMS.join(', ')}`);
    }
    return point;
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
