// CHECKING A MODEL'S ARGUMENTS AGAINST THE TOOL'S OWN DECLARATION.
//
// `reference/cookbook/adding-a-tool.md:44`: `defineTool` validates the model's arguments before `execute` runs, and
// "a raw JSON-Schema tool registered directly is responsible for its own input validation." These three tools are
// registered raw (lib/tool.js:8 gives the reason), so this is that responsibility, discharged.
//
// THE DECLARATION IS THE ONLY SOURCE. `parameters` is the literal the registry hands the model; this function walks
// it. A second list of checks beside it would be the same fault the whole conventions record keeps finding -- two
// places holding one fact, and the audit can only see the one it reads.
//
// WHAT IT DOES NOT DO, ON PURPOSE: a cross-field rule like "`set` needs a value" is not expressible in the schema,
// and `adding-a-tool.md:44` says so -- "you still have to check by hand the constraints the schema DSL cannot
// express". Those stay at their call sites, where the semantics are visible.
//
// TWO CONVENTIONS, BOTH DELIBERATE:
//   * `null` reads as NOT SUPPLIED, not as a wrong type. The tools themselves treat it that way (`?? null`), and a
//     model that fills an omitted optional with `null` is doing something ordinary, not something to be refused.
//   * an unknown key is REFUSED, because every one of these schemas declares `additionalProperties: false`. The raw
//     path gets no enforcement from the registry, so a declaration nobody enforces is a lie the model is told.

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

const TYPE_CHECKS = {
  string: (value) => typeof value === 'string',
  number: (value) => typeof value === 'number' && Number.isFinite(value),
  integer: (value) => typeof value === 'number' && Number.isInteger(value),
  boolean: (value) => typeof value === 'boolean',
  object: isRecord,
  array: (value) => Array.isArray(value),
}

/**
 * Refuse arguments that do not match what this tool declared, before any of its work happens.
 *
 * @param schema the tool's own `parameters` literal, exactly as the registry received it
 * @param args   what the model sent
 * @param tool   the tool's name, so the refusal says which tool refused
 * @throws {Error} naming the parameter and what was expected, because the message is what the model reads
 */
export function checkAgainst(schema, args, tool) {
  if (!isRecord(schema)) return
  if (!isRecord(args)) throw new Error(`${tool}: arguments must be an object`)
  const properties = isRecord(schema.properties) ? schema.properties : {}

  if (schema.additionalProperties === false) {
    for (const key of Object.keys(args)) {
      if (!Object.hasOwn(properties, key)) throw new Error(`${tool}: unknown parameter \`${key}\``)
    }
  }

  for (const key of Array.isArray(schema.required) ? schema.required : []) {
    if (args[key] === undefined) throw new Error(`${tool}: \`${key}\` is required`)
  }

  for (const [key, declared] of Object.entries(properties)) {
    const value = args[key]
    if (value === undefined || value === null || !isRecord(declared)) continue
    const check = TYPE_CHECKS[declared.type]
    if (check !== undefined && !check(value)) {
      throw new Error(`${tool}: \`${key}\` must be ${declared.type}, got ${Array.isArray(value) ? 'array' : typeof value}`)
    }
    if (Array.isArray(declared.enum) && !declared.enum.includes(value)) {
      throw new Error(`${tool}: \`${key}\` is not one of ${declared.enum.join(', ')}`)
    }
  }
}
