import { isRecord } from '../is-record.js';
export class QuestionShapeError extends Error {
    constructor(message) {
        super(message);
        this.name = 'QuestionShapeError';
    }
}
function text(value, what) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new QuestionShapeError(`${what} must be a non-empty string`);
    }
    return value.trim();
}
function optionCriteria(options) {
    if (!Array.isArray(options) || options.length < 2) {
        throw new QuestionShapeError('a choice needs at least two options');
    }
    const criteria = {};
    let abstains = 0;
    for (const option of options) {
        const given = isRecord(option) ? option : {};
        const label = text(given.label, 'every option needs a label');
        if (Object.hasOwn(criteria, label))
            throw new QuestionShapeError(`duplicate option label: ${label}`);
        criteria[label] = text(given.criterion, `option "${label}" needs a criterion`);
        if (given.abstain === true)
            abstains += 1;
    }
    if (abstains !== 1) {
        throw new QuestionShapeError(`exactly one option must be the abstain option, found ${abstains}`);
    }
    return criteria;
}
export function choice(instructions, options) {
    return { type: 'choice', instructions: text(instructions, 'instructions'), criteria: optionCriteria(options) };
}
// `score` is NOT `choice` with numbers. Measured: the container rejects a map --
// "a score question takes 'criteria' as a list of level descriptions, index 0 first".
// So this takes an ordered list of descriptions and returns them as a list. An
// ordered rubric has no abstain option by construction: every level is a position.
export function score(instructions, levels) {
    if (!Array.isArray(levels) || levels.length < 2) {
        throw new QuestionShapeError('a score needs at least two ordered levels');
    }
    return {
        type: 'score',
        instructions: text(instructions, 'instructions'),
        criteria: levels.map((level, i) => text(level, `level ${i}`)),
    };
}
export function noul(instructions, criteria) {
    const question = { type: 'noul', instructions: text(instructions, 'instructions') };
    if (criteria !== undefined) {
        const given = isRecord(criteria) ? criteria : {};
        question.criteria = {
            true: text(given.true, 'criteria.true'),
            false: text(given.false, 'criteria.false'),
        };
    }
    return question;
}
