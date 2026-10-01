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
        knob: { type: 'string', description: 'The setting to read or change. Required for every action but `list`.' },
        value: { description: 'The value for `set`. Ignored by every other action.' },
      },
      required: ['action'],
    }

export function createConfigTool({ read, write, record, knobs } = {}) {
  for (const [name, fn] of Object.entries({ read, write, record })) {
    if (typeof fn !== 'function') throw new TypeError(`${CONFIG_TOOL_NAME}: \`${name}\` must be a function.`)
  }
  const writable = Array.isArray(knobs) ? knobs : null

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
          knob: { type: 'string', description: 'The setting read or changed.' },
          value: { description: 'The value read, for `get`, or the value now in force.' },
          from: { description: 'The value the knob had, for a change.' },
          recorded: { type: 'boolean', description: 'Whether a config line was written for this call.' },
        },
      },
      render(_args, value) {
        if (value?.knobs !== undefined) return [{ type: 'text', text: JSON.stringify(value.knobs, null, 2) }]
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
      if (action === 'list') return { knobs: safeKnobs(), recorded: false }
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
