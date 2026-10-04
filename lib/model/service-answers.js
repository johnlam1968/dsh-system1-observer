/**
 * THE SERVICE'S ANSWER SHAPE, NARROWED TO THE WIRE'S.
 *
 * `dsh-system1`'s `system1` service answers with a different envelope from the raw
 * `/v1/systemone` route, and the difference is not cosmetic. Captured live 2026-09-29 (Jev through
 * OpenRouter, all three question types in one call):
 *
 *   service:  {"n":{"status":"ok","answer":{"type":"noul","probabilityTrue":0.9}}}
 *   wire:     {"n":{"type":"noul","noul":0.9}}
 *
 *   service:  {"c":{"status":"ok","answer":{"type":"choice","value":"limit","probabilities":{...},"confidence":1}}}
 *   wire:     {"c":{"type":"choice","choice":"limit","probabilities":{...},"confidence":1}}
 *
 *   service:  {"s":{"status":"ok","answer":{"type":"score","value":1,"levels":["vague","specific"],"probabilities":[0,1]}}}
 *   wire:     {"s":{"type":"score","score":1,"probabilities":{"vague":0,"specific":1}}}
 *
 * Three renames and one reshape, and none of them is discoverable from the wire's own code: the
 * service renames the value (`probabilityTrue`/`value` -> `noul`/`choice`/`score`), nests everything
 * under `answer`, and returns score probabilities as an ARRAY INDEXED BY THE LEVELS rather than as a
 * record. `narrowAnswers` reads the flat shape, and it is the module every gate's correctness rests
 * on -- so the adaptation happens HERE, at the boundary, rather than by making `narrowAnswers`
 * polymorphic over two shapes.
 *
 * An answer the service could not produce carries `status: 'error'` and no `answer`. IT IS CARRIED THROUGH AS AN
 * UNREADABLE ANSWER NAMING THAT STATUS, and it used to be erased into an EMPTY RECORD instead -- on the reasoning
 * that `narrowAnswers` would then produce "its precise reason". The reason it produced was "the answer for <id> is
 * not a score", which names the SHAPE of an answer that is missing rather than the fact that the provider declined to
 * produce one. Measured on a 291,137-character state against `jev-1.13`: all eight answers came back that way, the
 * reply carried no `executed` provenance at all, and the real cause -- a request over the documented 64k-token limit
 * -- was stated nowhere in the record. The status is the cause, so it travels.
 */
import { isRecord } from '../is-record.js';
/** One service answer object, flattened for `narrowAnswers`, or `undefined` if unreadable. */
function flattenOne(raw) {
    if (!isRecord(raw))
        return undefined;
    // `status` is the service's own verdict on producing this answer, and it is the CAUSE. See the header: erasing
    // it into `{}` made the reader blame the question's shape for a refusal it could not see.
    if (raw.status !== 'ok') {
        const status = typeof raw.status === 'string' ? raw.status : String(raw.status ?? 'unknown');
        const detail = typeof raw.error === 'string' ? ': ' + raw.error : (typeof raw.reason === 'string' ? ': ' + raw.reason : '');
        return { type: 'unreadable', reason: 'the provider reported status "' + status + '" for this answer' + detail };
    }
    const answer = raw.answer;
    if (!isRecord(answer))
        return {};
    const type = answer.type;
    const confidence = answer.confidence;
    if (type === 'noul') {
        const probability = answer.probabilityTrue;
        if (typeof probability !== 'number')
            return undefined;
        return confidence === undefined
            ? { type, noul: probability }
            : { type, noul: probability, confidence };
    }
    if (type === 'choice') {
        const label = answer.value;
        if (typeof label !== 'string')
            return undefined;
        return confidence === undefined
            ? { type, choice: label, probabilities: answer.probabilities }
            : { type, choice: label, probabilities: answer.probabilities, confidence };
    }
    if (type === 'score') {
        const score = answer.value;
        if (typeof score !== 'number')
            return undefined;
        const flat = { type, score };
        if (confidence !== undefined)
            flat.confidence = confidence;
        // ARRAY INDEXED BY LEVELS -> record keyed by label. `narrowAnswers` reads a record, and a score
        // without its distribution is a level with no confidence, which it refuses.
        const levels = answer.levels;
        const probabilities = answer.probabilities;
        if (Array.isArray(levels) && Array.isArray(probabilities) && levels.length === probabilities.length) {
            const keyed = {};
            for (let index = 0; index < levels.length; index += 1) {
                const label = levels[index];
                if (typeof label !== 'string')
                    return undefined;
                keyed[label] = probabilities[index];
            }
            flat.probabilities = keyed;
        }
        else if (isRecord(probabilities)) {
            // Some servers answer with a record already; accept it rather than lose the distribution.
            flat.probabilities = probabilities;
        }
        return flat;
    }
    return undefined;
}
/**
 * The service reply, in the wire's shape. Returns the body unchanged when it carries no `answers`
 * object, so the caller's own "no answers object" error is the one reported.
 *
 * Every answer that cannot be flattened is passed through as `undefined`, which `narrowAnswers`
 * reports as missing rather than as a number nobody produced.
 */
export function serviceAnswers(body) {
    if (!isRecord(body) || !isRecord(body.answers))
        return body;
    const answers = {};
    for (const [qid, raw] of Object.entries(body.answers)) {
        const flat = flattenOne(raw);
        if (flat !== undefined)
            answers[qid] = flat;
    }
    return { ...body, answers };
}
