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
 * An answer the service could not produce carries `status: 'error'` and no `answer`. This deliberately
 * maps it to an object with no value field, so `narrowAnswers` refuses it with its own reason rather
 * than this module inventing a probability. A refusal downstream is the honest outcome: an unreadable
 * judge answer must not become a number.
 */
import { isRecord } from '../is-record.js';
/** One service answer object, flattened for `narrowAnswers`, or `undefined` if unreadable. */
function flattenOne(raw) {
    if (!isRecord(raw))
        return undefined;
    // `status` is the service's own verdict on producing this answer. Anything but 'ok' has no answer
    // to flatten -- but it is returned as an EMPTY RECORD rather than dropped, deliberately: dropping
    // it makes `narrowAnswers` report "the response carried no answer for <id>", which names the wrong
    // cause. An empty record reaches the reader's own check and produces its precise reason, which is
    // what a person debugging a failed judgement needs to see.
    if (raw.status !== 'ok')
        return {};
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
