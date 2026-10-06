// WHICH ARGUMENT OF A HARNESS SEAM CARRIES THE TEXT — the application's half of the point descriptor.
//
// WHY THIS IS NOT IN `lib/seams.js`. The instrument owns the loop's VOCABULARY: nine point ids, what is true of each,
// and the question the probe asks. The SHAPES OF THE ARGUMENTS are dsh's, per seam, and they are the last place the
// instrument would have carried the harness with it (`F110`). They live here, beside the event map
// (`lib/host-events.js`), because both answer the same question for the row: this point, in this harness, is that
// event, and that is where its text is.
//
// IT IS ALSO WHERE A SILENT '' WOULD COME FROM, and the notes below are the measurements that put that failure down:
// an empty excerpt cannot be told from a seam whose payload is empty, so every way of failing says which way it
// failed, and an inapplicable point returns '' on purpose for the caller to refuse on.
import { isRecord } from './is-record.js'

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
 * The last two return `''` on purpose, and `lib/observe.js` refuses to ask when the text is empty: a
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
