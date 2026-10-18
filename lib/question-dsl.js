/**
 * A QUESTION AS ONE STRING, because a tool call cannot be trusted with a nested array.
 *
 * WHY THIS EXISTS, and the evidence. `system1_decide` takes questions inline, and every attempt to hand it a `choice`
 * or a `score` through that parameter failed the same way: the flat `options` array arrived as
 * `[{items:[{item:[...the real objects...]}]}]` -- length one, wrapped twice -- and the tool refused with "a choice
 * needs at least two options", which was an ACCURATE report of the length it received. `noul` took no array and
 * worked. A hypothesis that the item schema's missing `properties` caused the wrapping was tested live and REFUTED;
 * it is recorded in `lib/decide-tool.js` so it is not repeated.
 *
 * So the shape is not fought. A question becomes ONE string, and the strings cross the boundary because a string is
 * the one thing it carries intact. Staging is the actual fix: one `--question` per spec, one string each, so a mistake
 * is one line rather than a bracketed nest, and a human reading the call can see the question without reading JSON.
 *
 * THE GRAMMAR, in full, because a format nobody can state is not a format:
 *
 *   fields are separated by ` ;; ` (double semicolon, spaced -- prose contains semicolons but not this)
 *   every field is `key=value`
 *   `id` `type` `instructions` are common to all three kinds
 *   `option=label=criterion`   one per option, IN ORDER, and exactly one carries ` [abstain]`
 *   `level=...`                one per level, IN ORDER, and order is the ladder's meaning
 *   `true=...` `false=...`     a noul's two readings, optional and order-free
 *
 * Order matters for `option` and `level`, so it is carried by REPETITION rather than by a second array -- which is the
 * whole point: the fields are all strings, and a string survives.
 *
 * ROUND-TRIPS. `formatQuestion` is the inverse and is exact for anything `parseQuestion` accepts, because a format
 * that cannot be written back cannot be edited by the next person.
 *
 * @module lib/question-dsl
 */
import { isRecord } from './is-record.js'

/** The field separator, and the one thing in this module a prose question could collide with. */
export const SEPARATOR = ' ;; '

const PROBLEM = 'malformed question'

/** One `key=value` pair, split on the FIRST `=` so a criterion may contain its own. */
function pair(field) {
  const at = field.indexOf('=')
  if (at <= 0) return null
  return { key: field.slice(0, at).trim(), value: field.slice(at + 1).trim() }
}

/** The `[abstain]` marker, which a criterion's prose cannot produce by accident. */
const ABSTAIN = /\s*\[abstain\]\s*$/i

/**
 * Parse ONE question. Throws on anything malformed rather than guessing, and the message names the field.
 *
 * @param {string} text one question, fields separated by ` ;; `
 * @returns {object} a spec, in the shape `buildQuestions` accepts
 */
export function parseQuestion(text) {
  if (typeof text !== 'string' || text.trim() === '') throw new Error(`${PROBLEM}: empty`)
  const spec = { options: [], levels: [] }
  const keys = []
  for (const field of text.split(SEPARATOR)) {
    const read = pair(field.trim())
    if (read === null) throw new Error(`${PROBLEM}: a field is not \`key=value\` -- ${JSON.stringify(field.slice(0, 60))}`)
    keys.push(read.key)
    switch (read.key) {
      case 'id': spec.id = read.value; break
      case 'type': spec.type = read.value; break
      case 'instructions': spec.instructions = read.value; break
      case 'level': spec.levels.push(read.value); break
      case 'true': spec.criteria = { ...(isRecord(spec.criteria) ? spec.criteria : {}), true: read.value }; break
      case 'false': spec.criteria = { ...(isRecord(spec.criteria) ? spec.criteria : {}), false: read.value }; break
      case 'option': {
        const at = read.value.indexOf('=')
        if (at <= 0) throw new Error(`${PROBLEM}: an option is \`label=criterion\`, not ${JSON.stringify(read.value.slice(0, 40))}`)
        const criterion = read.value.slice(at + 1).replace(ABSTAIN, '').trim()
        const option = { label: read.value.slice(0, at).trim(), criterion }
        if (ABSTAIN.test(read.value)) option.abstain = true
        spec.options.push(option)
        break
      }
      default:
        throw new Error(`${PROBLEM}: unknown field \`${read.key}\`; this format takes id, type, instructions, option=, level=, true=, false=`)
    }
  }
  if (spec.id === undefined) throw new Error(`${PROBLEM}: no \`id\``)
  if (spec.type === undefined) throw new Error(`${PROBLEM}: \`${spec.id}\` has no \`type\``)
  if (spec.instructions === undefined) throw new Error(`${PROBLEM}: \`${spec.id}\` has no \`instructions\``)
  // Empty arrays are omitted rather than left as `[]`, because `[]` is a VALUE the loader reads -- an options list of
  // zero is a different question from no options list at all, and only the second one is what a `noul` means here.
  if (spec.options.length === 0) delete spec.options
  if (spec.levels.length === 0) delete spec.levels
  if (spec.criteria === undefined) delete spec.criteria
  return spec
}

/**
 * Parse a list of questions, one per string, naming the line that failed.
 *
 * @param {string|string[]} input one or more question strings
 * @returns {object[]} specs, in the order given
 */
export function parseQuestions(input) {
  const texts = Array.isArray(input) ? input : [input]
  if (texts.length === 0) return []
  return texts.map((text, index) => {
    try {
      return parseQuestion(text)
    } catch (error) {
      throw new Error(`question ${index + 1}: ${error instanceof Error ? error.message : String(error)}`)
    }
  })
}

/** The inverse of {@link parseQuestion}, exact for everything it accepts. */
export function formatQuestion(spec) {
  const fields = [`id=${spec.id}`, `type=${spec.type}`, `instructions=${spec.instructions}`]
  if (isRecord(spec.criteria)) {
    if (typeof spec.criteria.true === 'string') fields.push(`true=${spec.criteria.true}`)
    if (typeof spec.criteria.false === 'string') fields.push(`false=${spec.criteria.false}`)
  }
  for (const level of spec.levels ?? []) fields.push(`level=${level}`)
  for (const option of spec.options ?? []) fields.push(`option=${option.label}=${option.criterion}${option.abstain === true ? ' [abstain]' : ''}`)
  return fields.join(SEPARATOR)
}

