// OUR TOOL DECLARATIONS -> THE AUTHORED FORM (`defineTool`).
//
// WHY THIS EXISTS. A compliance audit (`F107`) found every tool in this plugin hand-built rather than authored with
// `defineTool`, and the reason recorded in `lib/tool.js` -- "a `link:` install does not install a plugin's
// dependencies for it" -- was measured to be stale: `@deepseek-ai/dsh-tools` resolved from THIS repository all along
// (it was a devDependency), so the honest fix was to declare it as a dependency, which this repository now does.
//
// WHAT IT CHANGES, AND WHAT IT DOES NOT. `defineTool` takes the IMPLICIT parameter root -- a map of properties -- where
// our declarations write a raw `{type: 'object', additionalProperties: false, properties: {…}}` wrapper, so the wrapper
// is unwrapped here and a raw `required: [...]` list is folded onto the properties it names. That also RETIRES the
// raw-root `additionalProperties` deviation the audit found (tools.md 3.4): there is no root wrapper left to declare
// anything on. The rest -- name, description, output schema and render, and the execute body -- is passed through.
//
// WHAT IT BUYS. The framework validates arguments against the schema BEFORE `execute` (tools.md 4), so a malformed
// argument is now refused by the harness with its own teaching error (`ToolArgsError`, `code: 'INVALID_ARGS'`) instead
// of by a sentence of ours. Our own `checkAgainst` still answers for what the DSL cannot express -- an UNKNOWN key,
// because the authored root is an open object by design -- and for every domain refusal.
//
// ONE HOME: every tool in this plugin goes through `asToolDefinition`, so the shape is decided once.
//
// AND ONE THING THE OUTPUT DSL DOES NOT HAVE: `required`. `output.schema` is a VALUE schema, and the compiler refuses
// it verbatim -- "schema.required is not supported by the value schema DSL" -- so the four `required: [...]` arrays
// this plugin used to carry in its OUTPUT schemas were removed when the tools were authored. What a value must carry
// is asserted by the tests that walk each render's output instead (`test/sessions-tool.test.js` and friends).

import { defineTool } from '@deepseek-ai/dsh-tools'

/** A raw `{type:'object', properties}` declaration as the authored property map. */
export function asParameterMap(parameters) {
    if (parameters === undefined || parameters === null) return {}
    if (parameters.type !== 'object' || parameters.properties === undefined) return parameters
    const required = Array.isArray(parameters.required) ? parameters.required : []
    const map = {}
    for (const [key, spec] of Object.entries(parameters.properties)) {
        map[key] = required.includes(key) ? { ...spec, required: true } : spec
    }
    return map
}

/** One hand-written declaration, authored through `defineTool`. */
export function asToolDefinition(definition) {
    const authored = {
        name: definition.name,
        description: definition.description,
        parameters: asParameterMap(definition.parameters),
        output: definition.output,
        execute: definition.execute,
    }
    if (definition.timeoutMs !== undefined) authored.timeoutMs = definition.timeoutMs
    if (definition.isConcurrencySafe !== undefined) authored.isConcurrencySafe = definition.isConcurrencySafe
    if (definition.presentationMeta !== undefined) authored.output = { ...definition.output, presentationMeta: definition.presentationMeta }
    return defineTool(authored)
}
