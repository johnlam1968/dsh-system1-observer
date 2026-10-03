// THE SETTINGS TOOL: one tool with an action, so an agent can retune what this plugin measures.
//
// WHY ONE TOOL AND NOT FIVE. A series of tools means five names to keep unique across a profile -- and a duplicate
// tool name THROWS in the registry, which is a failure this session has already paid for -- for one capability.
// One parameterised tool also makes the read/write boundary explicit at a single place, which is the property the
// next paragraph depends on.
//
// THE OPERATOR'S DECISION, RECORDED IN THE PLAN AND HONOURED HERE: the agent may control EVERY knob of this plugin,
// including whether the scheduled measurement runs. Accountability comes from the record, not from withholding the
// knob. That decision is only coherent if the record cannot be quietly moved, so the order in `execute` is the
// contract:
//
//     RECORD FIRST, THEN CHANGE. `record` is called and its line written BEFORE `write` is invoked, so there is no
//     window in which a knob moved without a line saying so. The test asserts the ORDER, not merely that both
//     happened -- a tool that recorded afterwards would satisfy a naive assertion and fail the requirement.
//
// READ-ONLY ACTIONS ARE FREE. `list` and `get` never call `record` and never call `write`; the test asserts that
// too, because a tool that logged its own reads would drown the record it exists to keep honest.
import { checkAgainst } from './tool-args.js'
import { configEvent, CONFIG_ACTIONS } from './config-event.js'
import { readConfigValue } from './config-value.js'

export const CONFIG_TOOL_NAME = 'system1_observe_config'

const ACTIONS = Object.freeze(['list', 'get', ...CONFIG_ACTIONS])

const DESCRIPTION = [
  'Read or change this observer plugin\'s own settings: which hooks it observes, which questions it asks, the provider and model it uses, and whether the scheduled turn measurement runs.',
  '',
  'Actions: `list` and `get` read, and change nothing. `set` assigns a value to a knob; `enable` and `disable` switch one on or off.',
  '',
  'Every change is recorded on the observer trace BEFORE it takes effect, with the knob, the value it had and the value it takes, so a measurement stays attributable to the configuration that produced it. That record is the reason the change is allowed at all: readings taken under different settings are not comparable, and a change nobody recorded would silently mix two experiments.',
].join('\n')

/**
 * @param read   () => the current knobs, as an object
 * @param write  ({ action, knob, value }) => void -- applies the change
 * @param record (line) => void -- writes the config line to the trace. Called BEFORE `write`.
 * @param knobs  optional list of writable names; anything else is refused rather than guessed at
 */
const parameters = {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: [...ACTIONS], description: 'What to do: `list`, `get`, `set`, `enable` or `disable`.' },
        knob: { type: 'string', description: 'The setting to read or change. EVERY field of this plugin\'s schema is a knob, and `list` reports each one with its type, its bounds and whether a live write can reach it. Required for every action but `list`.' },
        value: { description: 'The value for `set`. Ignored by every other action. It is checked against the setting\'s own type, bounds and choices before anything is written, so a wrong shape is a refusal naming the reason rather than a failure from the editor.' },
      },
      required: ['action'],
    }

/**
 * WHAT EACH SETTING IS, READ FROM THE SCHEMA RATHER THAN COPIED FROM IT.
 *
 * The absence of a knob list here is deliberate and `index.js` says why: *"the editor validates and reconciles a
 * plugin's next config itself, so an unknown field is refused by the thing that owns the schema instead of by a copy
 * of it that would drift."* That is right for **which** knobs exist. It left a model guessing at **what a knob is**:
 * a `set` with the wrong JSON type, a number below its minimum, or a write to a mount-bound field all came back as
 * whatever the editor said, one round trip later.
 *
 * So the schema is passed in as a function and digested here. Nothing is enumerated: a field added to the plugin
 * appears in `list` on the next call, and `test/config-tool.test.js` asserts this descriptor covers exactly the
 * schema it was handed -- the same "one home per fact" rule, applied to what a model needs before it calls `set`.
 */
export function describeKnobs(dict) {
  const out = {}
  for (const [name, field] of Object.entries(dict ?? {})) {
    const meta = field?.meta ?? {}
    const entry = { type: field?.type ?? 'any', writable: meta.volatile === true }
    if (meta.default !== undefined) entry.default = meta.default
    for (const bound of ['min', 'max', 'step']) if (typeof meta[bound] === 'number') entry[bound] = meta[bound]
    if (field?.inner?.type !== undefined) entry.itemType = field.inner.type
    if (field?.dict !== undefined) entry.keys = Object.keys(field.dict)
    // A UNION'S CHOICES ARE ITS CONST NODES. Schemastery keeps them as callable const schemas in `list`, whose string
    // form IS the literal, so they are read from there -- narrowly, and with a test pinning the real `pathMode`, so a
    // Schemastery change fails loudly instead of leaving a tool that silently stops checking. Found by an independent
    // review: without this, `set pathMode: "absolute"` was accepted by the tool and refused by the editor.
    if (Array.isArray(field?.list)) {
        const choices = field.list
            .map((option) => { try { return JSON.parse(String(option)) } catch { return undefined } })
            .filter((value) => value !== undefined)
        if (choices.length > 0) entry.choices = choices
    }
    out[name] = entry
  }
  return out
}

/**
 * THE VALUE, AGAINST THE SETTING'S OWN DESCRIPTION. Refuse rather than trim, and name the setting and the reason:
 * a value the schema will reject is a round trip the model does not need to spend, and a message it can act on is
 * worth more than a stack from the editor.
 */
function refuseValue(name, entry, value) {
  if (entry?.writable === false) {
    throw new Error(`${CONFIG_TOOL_NAME}: \`${name}\` is mount-bound -- it is read once when the row is applied, so it can only be changed in the profile's cordis.patch.yml. It can still be read with \`get\`.`)
  }
  const type = entry?.type
  if (type === 'boolean' && typeof value !== 'boolean') throw new Error(`${CONFIG_TOOL_NAME}: \`${name}\` is a boolean; got ${JSON.stringify(value)}. Use \`enable\` or \`disable\`.`)
  if (type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) throw new Error(`${CONFIG_TOOL_NAME}: \`${name}\` is a number; got ${JSON.stringify(value)}.`)
  if (type === 'number' && typeof entry.min === 'number' && value < entry.min) throw new Error(`${CONFIG_TOOL_NAME}: \`${name}\` must be at least ${entry.min}; got ${value}.`)
  if (type === 'number' && typeof entry.max === 'number' && value > entry.max) throw new Error(`${CONFIG_TOOL_NAME}: \`${name}\` must be at most ${entry.max}; got ${value}.`)
  if (type === 'string' && typeof value !== 'string') throw new Error(`${CONFIG_TOOL_NAME}: \`${name}\` is a string; got ${JSON.stringify(value)}.`)
  if (type === 'array' && !Array.isArray(value)) throw new Error(`${CONFIG_TOOL_NAME}: \`${name}\` is a list; got ${JSON.stringify(value)}.`)
  // THE ITEMS TOO, not only the container: `set hooks: ['admit', 42]` was accepted while the item schema would have
  // refused `42`. An `any` item type stays unchecked, which is what `sessions` declares on purpose.
  if (type === 'array' && typeof entry.itemType === 'string' && entry.itemType !== 'any') {
    const wrong = value.find((item) => typeof item !== entry.itemType)
    if (wrong !== undefined) throw new Error(`${CONFIG_TOOL_NAME}: \`${name}\` is a list of ${entry.itemType}; got ${JSON.stringify(wrong)} among its items.`)
  }
  if (type === 'object' && (value === null || typeof value !== 'object' || Array.isArray(value))) throw new Error(`${CONFIG_TOOL_NAME}: \`${name}\` is an object; got ${JSON.stringify(value)}.`)
  // AND A UNION IS ITS CHOICES, not merely "a string": the type check above accepted any string for `pathMode`.
  if (Array.isArray(entry?.choices) && !entry.choices.includes(value)) {
    throw new Error(`${CONFIG_TOOL_NAME}: \`${name}\` is one of ${entry.choices.map((choice) => JSON.stringify(choice)).join(', ')}; got ${JSON.stringify(value)}.`)
  }
}

export function createConfigTool({ read, write, record, knobs, schema, sets } = {}) {
  for (const [name, fn] of Object.entries({ read, write, record })) {
    if (typeof fn !== 'function') throw new TypeError(`${CONFIG_TOOL_NAME}: \`${name}\` must be a function.`)
  }
  if (schema !== undefined && typeof schema !== 'function') throw new TypeError(`${CONFIG_TOOL_NAME}: \`schema\` must be a function returning the plugin's schema.`)
  if (sets !== undefined && typeof sets !== 'function') throw new TypeError(`${CONFIG_TOOL_NAME}: \`sets\` must be a function returning the question sets it can see.`)
  const writable = Array.isArray(knobs) ? knobs : null
  // ONE DIGEST PER CALL, so a field added to the schema shows up without this file changing -- and cheap enough that
  // caching it would only add a way to go stale.
  const described = () => describeKnobs(schema?.())
  // THE SETS A MODEL CAN CHOOSE FROM, and their problems. Read per call like everything else here, and never thrown:
  // a directory that cannot be listed is a sentence the model can read, not a failed tool call.
  const safeSets = () => {
    if (sets === undefined) return undefined
    try {
      const listed = sets()
      return listed !== null && typeof listed === 'object' ? listed : { sets: [], problem: 'the set listing was not an object' }
    } catch (error) {
      return { sets: [], problem: 'listing the question sets failed: ' + (error instanceof Error ? error.message : String(error)) }
    }
  }

  // A KNOB MAP THAT CAN BE RETURNED. The live config holds `Volatile` ACCESSORS -- functions -- so returning it
  // verbatim failed the harness's own output validation with `value is not lossless JSON`. Each field is unwrapped
  // and anything still not a value is dropped, so a knob that cannot be read is absent rather than unrepresentable.
  const safeKnobs = () => {
    const current = read()
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return {}
    const out = {}
    for (const [key, value] of Object.entries(current)) {
      const plain = readConfigValue(value)
      if (plain === undefined || typeof plain === 'function') continue
      out[key] = plain
    }
    return out
  }

  const refuseKnob = (knob) => {
    if (typeof knob !== 'string' || knob.trim() === '') throw new Error(`${CONFIG_TOOL_NAME}: \`knob\` is required for this action.`)
    const trimmed = knob.trim()
    if (writable !== null && !writable.includes(trimmed)) {
      throw new Error(`${CONFIG_TOOL_NAME}: ${JSON.stringify(trimmed)} is not a knob of this plugin. Known: ${writable.join(', ')}.`)
    }
    return trimmed
  }

  return {
    name: CONFIG_TOOL_NAME,
    description: DESCRIPTION,
parameters,

    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          knobs: { type: 'object', description: 'The current settings, for `list`.' },
          sets: { type: 'object', description: 'The question sets this row can see -- each with its name, content hash, the seams it names and any problem -- for `list`.' },
          schema: { type: 'object', description: 'What each setting IS -- type, default, bounds, item type, keys, and whether a live write can reach it. Present for `list`, digested from the plugin schema rather than copied.' },
          knob: { type: 'string', description: 'The setting read or changed.' },
          value: { description: 'The value read, for `get`, or the value now in force.' },
          from: { description: 'The value the knob had, for a change.' },
          recorded: { type: 'boolean', description: 'Whether a config line was written for this call.' },
        },
      },
      render(_args, value) {
        if (value?.knobs !== undefined) {
          // A TABLE RATHER THAN RAW JSON: the question a model has is "what may I write, and what is it now", and
          // the type and the writability are half of that answer.
          const described = value.schema ?? {}
          const lines = Object.entries(value.knobs).map(([name, current]) => {
            const entry = described[name] ?? {}
            const bounds = entry.min === undefined && entry.max === undefined ? '' : ` ${entry.min ?? ''}..${entry.max ?? ''}`.trimEnd()
            return `${name} [${entry.type ?? '?'}${entry.writable === false ? ', YAML-only' : ''}${bounds}]: ${JSON.stringify(current)}`
          })
          if (value.sets !== undefined) {
            const listed = Array.isArray(value.sets.sets) ? value.sets.sets : []
            lines.push('')
            lines.push('question sets [' + (value.sets.problem === null || value.sets.problem === undefined ? listed.length + ' readable' : 'UNAVAILABLE: ' + value.sets.problem) + ']')
            for (const set of listed) {
              lines.push('  set ' + set.name + ' [' + (set.hash ?? '') + '] ' + (Array.isArray(set.seams) ? set.seams.join(', ') : '')
                + (set.problem === null || set.problem === undefined ? '' : ' -- ' + set.problem))
            }
          }
          return [{ type: 'text', text: lines.length === 0 ? '(no settings)' : lines.join('\n') }]
        }
        if (value?.from !== undefined) {
          return [{ type: 'text', text: `${String(value.knob)}: ${JSON.stringify(value.from)} -> ${JSON.stringify(value.value)}` }]
        }
        return [{ type: 'text', text: `${String(value?.knob)}: ${JSON.stringify(value?.value)}` }]
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
      checkAgainst(parameters, args, CONFIG_TOOL_NAME)

      const action = args?.action
      if (!ACTIONS.includes(action)) {
        throw new Error(`${CONFIG_TOOL_NAME}: action ${JSON.stringify(action)} is not one of ${ACTIONS.join(', ')}.`)
      }
      if (action === 'list') {
        const listed = safeSets()
        // OMITTED WHEN NO LISTING IS WIRED, so a tool built without one reports exactly what it did before sets existed.
        return Object.assign({ knobs: safeKnobs(), schema: described() }, listed === undefined ? {} : { sets: listed }, { recorded: false })
      }
      if (action === 'get') {
        const knob = refuseKnob(args.knob)
        return { knob, value: safeKnobs()[knob] ?? null, recorded: false }
      }
      const knob = refuseKnob(args.knob)
      // A CROSS-FIELD RULE THE SCHEMA CANNOT EXPRESS (`adding-a-tool.md:44`): `value` is untyped because its shape
      // depends on the knob, so "a `set` needs one" lives here. IT SITS AFTER `refuseKnob` ON PURPOSE: at the top of
      // `execute` it shadowed the tool's own refusals, so a bad knob and a missing knob were both reported as a
      // missing value -- the wrong sentence for the model to read. And without it the `to` line below turns a
      // valueless `set` into `to: null`: a write that reports success and changes the setting to nothing.
      if (args.action === 'set' && args.value === undefined) throw new Error(`${CONFIG_TOOL_NAME}: \`set\` needs a \`value\``)
      // CHECKED BEFORE THE RECORD, because the record is the contract: a line written for a change that cannot land
      // is a measurement of something that did not happen.
      const entry = described()[knob]
      if (args.action === 'set') refuseValue(knob, entry, args.value)
      if ((args.action === 'enable' || args.action === 'disable') && entry !== undefined && entry.type !== 'boolean') {
        throw new Error(`${CONFIG_TOOL_NAME}: \`${args.action}\` needs a boolean setting; \`${knob}\` is a ${entry.type}. Use \`set\` with the value you want.`)
      }
      const from = safeKnobs()[knob] ?? null
      const to = action === 'set' ? (args.value === undefined ? null : args.value) : action === 'enable'
      // THE ORDER IS THE CONTRACT, and it is asserted rather than described.
      record(configEvent({ action, knob, from, to, by: typeof args.by === 'string' ? args.by : undefined }))
      // AWAITED, and that is a correctness requirement rather than a style choice. The service this will be wired
      // to persists asynchronously (`configEditor.edit` returns a Promise), and an un-awaited write would report
      // `recorded: true` for a change that never landed -- a success claim contradicted by the state. The record
      // still goes first; awaiting only means the caller learns whether the change took.
      await write({ action, knob, value: to })
      return { knob, from, value: to, recorded: true }
    },
  }
}
