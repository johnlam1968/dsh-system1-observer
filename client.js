/**
 * The CLIENT half: the settings card on the Plugins page.
 *
 * A card is REGISTERED, not generated. Three things make it appear, and each failure is silent:
 *   1. the manifest exports `./client` and declares `dsh.client`;
 *   2. the factory id equals the PACKAGE NAME;
 *   3. it registers into a slot the page DECLARES, under a key the page dispatches.
 *
 * TWO SEATS, because they are different rooms. `plugins.bundle.config` is keyed by PACKAGE and puts a
 * card on the bundle's page; `plugins.row.config` is keyed `<package>#<row id>` and puts the configure
 * control on the row in the Components list. Nothing is passed as `form` on the bundle page and a
 * `ConfigPageForm` is passed on the row page, so the card accepts both.
 *
 * THE PLUMBING IS THE LIVE REFERENCE'S, at `~/.dsh/profiles/web/node_modules/dsh-system1/lib/client.js`
 * `:178-186` and `:266-300`: SUBSCRIBE to the entry form with `useSyncExternalStore`, keep the drafts
 * in `useState` seeded by an effect on the snapshot's status/revision/value, build the `SettingsForm`
 * shell yourself, and render PLAIN DOM controls. The shipped `SettingsFormModel`/`SettingsValueField`
 * pair is deliberately NOT used here. It stages correctly, but its shell reads
 * `scope.getSnapshot().writable`, and a form store that has not derived yet answers `writable: false`
 * (`config-form.ts:84`) -- so a one-shot read disabled every control permanently and nothing could be
 * typed or clicked. `SettingsForm` is chrome only; it draws no field.
 */
window.__ModuleLoader__.load({
  id: 'dsh-system1-observer',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    // THE CHROME ONLY: the availability line and the Save/Discard buttons for the card, and the menu row the
    // session list uses. The value plumbing is the card's own, so `SettingsFormModel` and `SettingsValueField`
    // are still deliberately ABSENT -- a card that required them would throw here, which is the boundary the
    // original defect crossed. `MenuItemButton` is the shipped row the sidebar's own ⋯ entries use, so an
    // observer row sits among pin/rename/fork/archive rather than beside them.
    const { MenuItemButton, SettingsForm } = require('@deepseek-ai/dsh-client-ui-primitives')

    const PACKAGE = 'dsh-system1-observer'
    // THE ROW AS `cordis.patch.yml` DECLARES IT. The row seat's key is `<package>#<row id>`, and a row
    // id that does not match the patch is a registration nothing dispatches -- silent, like all of them.
    const ROW_ID = 'system1-observer'
    // THE NAMESPACE IS THE PROFILE ENTRY ID, NOT THE PACKAGE NAME: `describe()` is keyed by unique
    // profile entry ids, so the spelling depends on how the profile composed this bundle -- bare when
    // the row sits in the profile, `include:<rowId>` when it arrives through the patch. Accept both.
    const NAMESPACES = ['system1-observer', 'include:system1-observer']

    // SEVEN OF THE TWENTY-SIX FIELDS A SAVE CAN WRITE TODAY, and the number is worth stating because the sentence
    // that stood here said four: the schema marks 26 `.volatile()`, this card renders these seven, and the other
    // nineteen are reachable only through YAML until the panels in `docs/settings.md` §6 are built. One field --
    // `tracePath` -- is mount-bound, and a write against it is refused with `Config field "x" is not volatile`,
    // which is why §6 shows it read-only rather than omitting it.
    //
    // THE SCHEMA'S OWN DEFAULT, not a number invented here: `index.js` declares `maxFieldChars` with no
    // `.default()`, `lib/observe.js` falls back to 20000, and the README's table says 20000. This constant
    // said 4096, so the reset button silently restored a value the host never uses.
    const MAX_FIELD_CHARS_DEFAULT = 20000
    // THE WIRE TOOL NAME, restated because the browser half cannot import `lib/tool.js`. A mismatch is silent:
    // the seat renders the generic row and nothing says why.
    const TRACE_TOOL_NAME = 'system1_trace'

    // ---------------------------------------------------------------------------------------------
    // THE SETTINGS THE CARD OWNS, IN ONE TABLE.
    //
    // Every field here is `.volatile()` in `index.js`, and the card must carry a control for each one:
    // the host projects a schema and never draws a form, so a setting with no entry here is a setting
    // nobody can reach. This table is the single source for FOUR things that were four hand-written
    // lists -- the draft seed, the dirty check, the save ops, and the controls -- and the card test
    // asserts it covers every volatile field the schema declares, so a setting added to `index.js` and
    // not to this table fails the suite instead of shipping a knob with no way to turn it.
    //
    // `fallback` is the SCHEMA'S OWN DEFAULT, and it matters most for a switch that defaults ON: a
    // boolean field nobody has written must read as its default, not as `false`, or the card reports a
    // setting that is on as off. `callsEnabled` has the same rule and is not in this table because it
    // is `!== false` on both sides of the wire.
    const SETTINGS = [
      // `choices` IS A FUNCTION HERE, and not for style: this table is defined ABOVE the `SEAMS` array (line 56
      // against line 300), so reading it eagerly is a temporal-dead-zone throw that takes the whole factory down
      // -- every card test failed with 'Cannot access SEAMS before initialization'. Resolved where it is used.
      { panel: 'observe', field: 'hooks', kind: 'multi', choices: () => SEAMS.map(seam => seam.name), label: 'Call at these seams',
        hint: 'Points of the loop to call, from the list the host accepts. Every hook you add costs one judge call per firing; the per-seam switches below decide which of them may actually fire.' },
      { panel: 'send', field: 'provider', kind: 'text', label: 'Provider',
        hint: 'The System One provider id the wire client posts to. Read at each call, so a change reaches the next firing.' },
      { panel: 'send', field: 'model', kind: 'text', label: 'Model',
        hint: 'The model name sent with each judgement.' },
      { panel: 'send', field: 'timeoutMs', kind: 'number', min: 1, fallback: 8000, label: 'Timeout (ms)',
        hint: 'How long one judgement may take before it is abandoned and recorded as a timeout.' },
      { panel: 'send', field: 'wireUrl', kind: 'text', label: 'Wire URL',
        hint: 'The endpoint the HTTP transport posts to. Only used when the wire transport is the one mounted.' },
      // FOUND BY THE UI RATCHET, not by reading: this field had no control anywhere in the card, so the fallback
      // question was writable from YAML and from the agent's config tool and from nowhere a person would look.
      { panel: 'send', field: 'question', kind: 'longtext', label: 'Probe question',
        hint: 'The question asked at a seam that has no question of its own, and the text a new question starts from. Write it as a sentence, and say in it what each answer would mean.' },
      { panel: 'send', field: 'maxQuestionChars', kind: 'number', min: 1, fallback: 4000, label: 'Max question characters',
        hint: 'The ceiling on one composed question before it is sent. A question over the cap is refused and said so on the line, never silently trimmed.' },
      { panel: 'see', field: 'composeMaxChars', kind: 'number', min: 1, fallback: 8000, label: 'Composed state (chars)',
        hint: 'How much of the held state the judge is shown.' },
      { panel: 'see', field: 'toolBlockMaxChars', kind: 'number', min: 1, fallback: 4000, label: 'Tool block (chars)',
        hint: 'How much of one tool block survives into the state the judge sees.' },
      { panel: 'see', field: 'tailChars', kind: 'number', min: 0, fallback: 1000, label: 'Tail kept (chars)',
        hint: 'Characters of the END that a truncated value always keeps, so the newest part survives the cut. Zero keeps the head only.' },
      { panel: 'see', field: 'feedMaxPerSession', kind: 'number', min: 1, fallback: 500, label: 'Feed events per session',
        hint: 'Events kept per session in the in-memory feed the session menu reads.' },
      { panel: 'see', field: 'fsJournalMaxPaths', kind: 'number', min: 1, fallback: 200, label: 'Journal paths',
        hint: 'Distinct paths the file journal keeps per session.' },
      { panel: 'see', field: 'fsJournalMaxPerPath', kind: 'number', min: 1, fallback: 4, label: 'Journal entries per path',
        hint: 'Entries kept per path in the file journal.' },
      { panel: 'turn', field: 'turnEveryNTurns', kind: 'number', min: 0, fallback: 0, label: 'Measure every N turn boundaries',
        hint: 'Fire the scheduled turn measurement every N turn boundaries. 0 switches it off entirely, which is the default.' },
      { panel: 'keep', field: 'redactEnabled', kind: 'switch', fallback: true, label: 'Redact credentials',
        hint: 'Whether the record is scrubbed of credential-looking values before it is written.' },
      { panel: 'keep', field: 'redactKeys', kind: 'list', label: 'Extra field names to redact',
        hint: 'Comma-separated field names, added to the built-in list. Additions only: the built-in names cannot be removed.' },
      // A REGEX CAN CONTAIN A COMMA (`{1,3}`), so this is `lines` and not `list`: one pattern per line, which is the
      // only separator a regular expression cannot contain.
      { panel: 'keep', field: 'redactPatterns', kind: 'lines', compile: 'regex', label: 'Extra redaction patterns',
        hint: 'One regular expression per line, applied to the record AFTER the shipped rules. Additions only -- the built-in rules cannot be switched off. A pattern that does not compile is refused here and dropped at the point of use, never thrown.' },
      { panel: 'keep', field: 'pathMode', kind: 'select', choices: ['full', 'basename', 'omit'], fallback: 'full', label: 'Paths in the trace',
        hint: 'How much of an absolute path the TRACE keeps. It never touches what the model is asked.' },
      { panel: 'keep', field: 'redactSessionTelemetry', kind: 'switch', fallback: false, label: 'Redact session telemetry',
        hint: 'Whether session-level telemetry lines are redacted as well as call lines.' },
      { panel: 'keep', field: 'maxTraceBytes', kind: 'number', min: 0, fallback: 33554432, label: 'Rotate at (bytes)',
        hint: 'Rotate the trace when the next line would cross this many bytes. 0 disables rotation.' },
      // FRACTIONAL, and the flag is load-bearing: the first version of this table demanded a WHOLE number from every
      // numeric field, so the price (0.042) failed validation and the card refused to save anything at all --
      // including the fields beside it. A count and a rate are different kinds of number.
      { panel: 'numbers', field: 'pricePerMTokInput', kind: 'number', fractional: true, min: 0, fallback: 0.042, label: 'Price (USD per MTok input)',
        hint: 'The rate used to price the JUDGEMENT only. The subject model tokens are never captured.' },
      { panel: 'numbers', field: 'idleGapMs', kind: 'number', min: 0, fallback: 60000, label: 'Idle gap (ms)',
        hint: 'Within this gap, two judge calls count as ONE active stretch. It decides what the report activeMs means.' },
      { panel: 'numbers', field: 'calibrationBins', kind: 'number', min: 2, fallback: 10, label: 'Calibration bins',
        hint: 'How many equal-width bins the calibration report slices the probability scale into.' },
      // THE NUDGE VOCABULARY BELONGS IN NUMBERS: it decides what a number in the report MEANS. Each of the three
      // says in its hint that it changes a measurement, because that is what a person has to know before editing it.
      { panel: 'numbers', field: 'nudgeExtraMarkers', kind: 'lines', label: 'Extra correction markers',
        hint: 'One phrase per line, matched case-insensitively. Adds to the shipped list, cannot remove from it. This changes the nudge MEASUREMENT: more turns will read as corrections.' },
      { panel: 'numbers', field: 'nudgeExtraStopwords', kind: 'lines', label: 'Extra words to ignore',
        hint: 'One word per line, ignored when comparing two messages. Additions only. Adding one makes the recurrence test LOOSER. This changes the nudge MEASUREMENT.' },
      { panel: 'numbers', field: 'nudgeRecurrenceThreshold', kind: 'number', fractional: true, min: 0, max: 1, fallback: 0.5, label: 'Recurrence threshold',
        hint: 'How much of the request must come back, in different words, before a turn counts as a nudge. Raising it makes the test stricter. This changes the nudge MEASUREMENT.' },
      { panel: 'numbers', field: 'maxCompareLanes', kind: 'number', min: 1, fallback: 5, label: 'Comparison lanes',
        hint: 'How many runs a comparison may show side by side.' },
    ]
    // THE PANELS, in reading order. `Act` is absent on purpose: it is designed (`docs/settings.md` §8) and
    // not built, and a panel that opens onto nothing is worse than no panel.
    const PANELS = [
      { id: 'observe', title: 'Observe' },
      { id: 'send', title: 'Send' },
      { id: 'see', title: 'See' },
      { id: 'turn', title: 'Turn' },
      { id: 'keep', title: 'Keep' },
      { id: 'numbers', title: 'Numbers' },
    ]

    /** The draft a table entry starts from: the stored value, or the SCHEMA'S default when none is stored. */
    function seedTable(valueObject) {
      const out = {}
      for (const entry of SETTINGS) {
        const raw = valueObject[entry.field]
        if (entry.kind === 'number') out[entry.field] = numberText(raw === undefined ? entry.fallback : raw)
        else if (entry.kind === 'switch') out[entry.field] = raw === undefined ? entry.fallback === true : raw === true
        else if (entry.kind === 'list' || entry.kind === 'multi') out[entry.field] = Array.isArray(raw) ? raw.slice() : []
        // A `lines` FIELD DRAFTS AS TEXT: a textarea holds a string, and a regex can contain a comma, so the lines
        // are the one separator that survives. The array comes back on save.
        else if (entry.kind === 'lines') out[entry.field] = Array.isArray(raw) ? raw.join('\n') : ''
        else out[entry.field] = raw === undefined || raw === null ? '' : String(raw)
      }
      return out
    }

    /** A `lines` draft is text on the way in and a list on the way out: one place does the conversion. */
    function toLines(value) {
      if (Array.isArray(value)) return value
      if (typeof value !== 'string') return []
      return value.split('\n').map((line) => line.trim()).filter((line) => line !== '')
    }

    function storedValue(entry, draftValue) {
      if (entry.kind === 'number') return Number(draftValue)
      if (entry.kind === 'lines') return toLines(draftValue)
      return draftValue
    }

    /**
     * The ops for every table entry that moved. Scalars compare by value, lists and `lines` by their canonical
     * JSON -- and this is the ONLY comparison: a panel decides whether to open itself from the same function, so a
     * panel cannot call itself clean while a save would write it.
     */
    function tableOps(draftValues, currentValues) {
      const ops = []
      for (const entry of SETTINGS) {
        const next = storedValue(entry, draftValues[entry.field])
        const before = storedValue(entry, currentValues[entry.field])
        const moved = Array.isArray(next) || Array.isArray(before)
          ? JSON.stringify(next ?? null) !== JSON.stringify(before ?? null)
          : next !== before
        if (!moved) continue
        ops.push({ op: 'set', path: [entry.field], value: next })
      }
      return ops
    }

    function tableDirty(draftValues, currentValues) {
      return tableOps(draftValues, currentValues).length > 0
    }

    /** Whole numbers, or a sentence naming the field. The card refuses to SEND; it never trims a value. */
    function tableProblems(draftValues) {
      const out = []
      for (const entry of SETTINGS) {
        // A PATTERN THE LIBRARY WOULD DROP IS REFUSED HERE FIRST. `compilePatterns` drops and reports rather than
        // throwing, because it sits in the path of every line -- but a person editing one should be told before
        // they save, not left to find the reason on a line later.
        if (entry.compile === 'regex') {
          for (const line of toLines(draftValues[entry.field])) {
            try { new RegExp(line, 'giu') } catch (error) {
              out.push(entry.label + ': ' + (error instanceof Error ? error.message : String(error)))
            }
          }
          continue
        }
        if (entry.kind !== 'number') continue
        const text = String(draftValues[entry.field] ?? '').trim()
        const parsed = Number(text)
        const floor = entry.min ?? 0
        const shapeOk = entry.fractional === true
          ? Number.isFinite(parsed)
          : Number.isInteger(parsed)
        const ceiling = entry.max
        const above = typeof ceiling === 'number' && parsed > ceiling
        if (text === '' || !shapeOk || parsed < floor || above) {
          const shape = entry.fractional === true ? 'a number' : 'a whole number'
          const range = typeof ceiling === 'number' ? 'between ' + floor + ' and ' + ceiling : floor + ' or more'
          out.push(entry.label + ': ' + shape + ', ' + range + '.')
        }
      }
      return out
    }

    const styles = {
      wrap: { display: 'grid', gap: '12px', maxWidth: '680px', color: 'var(--dsw-alias-label-primary)' },
      title: { margin: 0, fontSize: '14px', fontWeight: 600 },
      note: { margin: 0, fontSize: '12px', lineHeight: 1.5, color: 'var(--dsw-alias-label-secondary)' },
      field: { display: 'grid', gap: '4px' },
      label: { fontSize: '13px', fontWeight: 500 },
      row: { display: 'flex', alignItems: 'center', gap: '8px' },
      error: { margin: 0, fontSize: '12px', lineHeight: 1.5, color: 'var(--dsw-alias-label-error, #c0392b)' },
      // The per-seam editor. Plain `details` so nine seams do not fill the page at once, and a neutral
      // border rather than an invented theme token.
      questions: { display: 'grid', gap: '8px' },
      seam: { border: '1px solid rgba(127,127,127,0.35)', borderRadius: '6px', padding: '6px 8px' },
      summary: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' },
      seamName: { fontSize: '13px', fontWeight: 600, minWidth: '90px' },
      seamEvent: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' },
      badge: { fontSize: '11px', marginLeft: 'auto', color: 'var(--dsw-alias-label-secondary)' },
      seamBody: { display: 'grid', gap: '8px', paddingTop: '8px' },
      question: { display: 'grid', gap: '4px', borderLeft: '2px solid rgba(127,127,127,0.35)', paddingLeft: '8px' },
      sub: { display: 'grid', gap: '4px', paddingLeft: '8px' },
      // Guidance rather than chrome: dimmer than a note, and never a control.
      hint: { margin: 0, fontSize: '12px', lineHeight: 1.5, color: 'var(--dsw-alias-label-secondary)', fontStyle: 'italic' },
      rules: { border: '1px solid rgba(127,127,127,0.35)', borderRadius: '6px', padding: '6px 10px' },
      rulesList: { margin: '6px 0 0', paddingLeft: '18px', fontSize: '12px', lineHeight: 1.6, color: 'var(--dsw-alias-label-secondary)' },
      switchGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '4px 12px', marginTop: '6px' },
      switchRow: { display: 'flex', alignItems: 'center', gap: '6px' },
      // The observed-session list: a headline a person reads, the id it is matched by, and a way to drop it.
      sessions: { display: 'grid', gap: '4px' },
      // The one line that says which gate is actually stopping things. Not a note: it is the answer to "why is
      // nothing happening", so it is styled to be read rather than skimmed.
      effective: { margin: 0, fontSize: '12px', lineHeight: 1.5, padding: '6px 8px', borderRadius: '6px', background: 'rgba(127,127,127,0.12)', color: 'var(--dsw-alias-label-primary)' },
      // THE TRACE CARD, in the conversation. Same restraint as the settings card: plain DOM, inline styles,
      // and the theme's own tokens, so it is legible in both themes without shipping a stylesheet.
      card: { display: 'grid', gap: '8px', fontSize: '12px', color: 'var(--dsw-alias-label-primary)' },
      cardHead: { display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' },
      cardTitle: { margin: 0, fontSize: '13px', fontWeight: 600 },
      mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '11px' },
      chips: { display: 'flex', gap: '6px', flexWrap: 'wrap' },
      chip: { padding: '2px 7px', borderRadius: '999px', background: 'rgba(127,127,127,0.14)', whiteSpace: 'nowrap' },
      chipOff: { padding: '2px 7px', borderRadius: '999px', background: 'rgba(192,57,43,0.16)', color: 'var(--dsw-alias-label-error, #c0392b)', whiteSpace: 'nowrap' },
      strip: { padding: '6px 8px', borderRadius: '6px', background: 'rgba(127,127,127,0.10)', display: 'grid', gap: '2px' },
      grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '8px' },
      panel: { border: '1px solid rgba(127,127,127,0.22)', borderRadius: '6px', padding: '6px 8px', display: 'grid', gap: '3px' },
      panelHead: { fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--dsw-alias-label-secondary)' },
      kv: { display: 'flex', justifyContent: 'space-between', gap: '10px' },
      // PREFIXED, because a bare `row` COLLIDED with the settings card's own `row` (a flex line) and silently
      // replaced it: two keys of the same name in one object literal, and the later one wins. The settings
      // switches rendered as a four-column grid from the day the card was added, and nothing said so.
      // PROPORTION BARS. The competitor's are hard-coded hex, and its own comment says why: "the host's design
      // tokens are an internal contract that may move between releases". This card already uses tokens
      // everywhere else, so a hard-coded fill would be the one element that ignores the theme -- and the whole
      // point of a bar is that a person reads it at a glance in whichever theme they are in.
      barRow: { display: 'grid', gridTemplateColumns: '78px 1fr 40px', gap: '6px', alignItems: 'center', padding: '1px 0' },
      barLabel: { fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--dsw-alias-label-secondary)' },
      barTrack: { background: 'var(--dsw-alias-bg-layer-2)', borderRadius: '999px', height: '6px', overflow: 'hidden' },
      barReadout: { fontSize: '11px', textAlign: 'right', color: 'var(--dsw-alias-label-secondary)' },
      barNote: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' },
      barStack: { display: 'grid', gap: '1px', minWidth: '190px' },
      barsHead: { display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'baseline' },
      traceRows: { display: 'grid', gap: '0px', borderTop: '1px solid rgba(127,127,127,0.22)' },
      traceRow: { display: 'grid', gridTemplateColumns: '58px 52px 84px 1fr', gap: '6px', padding: '3px 0', borderBottom: '1px solid rgba(127,127,127,0.14)', alignItems: 'baseline' },
      traceCall: { background: 'rgba(46,160,67,0.10)' },
      traceError: { background: 'rgba(192,57,43,0.12)' },
      dim: { color: 'var(--dsw-alias-label-secondary)' },
      answer: { color: 'var(--dsw-alias-label-secondary)' },
      sessionRow: { display: 'flex', alignItems: 'center', gap: '8px' },
    }

    // The control the three fields share: label above, control, hint below. Every one of these is a
    // plain DOM element, so nothing between the user and the input can disable it.
    function fieldEl(id, label, control, hint) {
      return h('div', { key: id, style: styles.field },
        h('label', { htmlFor: id, style: styles.label }, label),
        control,
        h('p', { style: styles.note }, hint),
      )
    }

    // Values from `state.value` are narrowed with property checks, never trusted to a shape: the host
    // omits an unset optional field, and a string is not a boolean.
    function asObject(value) {
      return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
    }

    function booleanValue(value) {
      return value === true
    }

    function numberText(value) {
      return typeof value === 'number' && Number.isFinite(value) ? String(value) : String(MAX_FIELD_CHARS_DEFAULT)
    }

    // THE SESSION ALLOW-LIST IS A LIST OF ENTRIES: `{ id }`, or `{ id, title }` when a title was captured.
    //
    // THE ID IS THE KEY AND THE TITLE IS A CACHE. `session-01234567-89ab-4cde-8f01-23456789abcd` is not
    // something a person reads, so the session menu stores the headline it was handed beside the id -- and
    // nothing matches on the title, because a rename would then silently stop a session being observed.
    // Both shapes are accepted on read, so the plain string list written before titles existed still works.
    // Canonical output keeps a FIXED key order, so two equal drafts serialise identically and `dirty` is not
    // a lie.
    function sessionEntries(value) {
      if (!Array.isArray(value)) return []
      const out = []
      for (const entry of value) {
        const given = typeof entry === 'string' ? { id: entry } : asObject(entry)
        const id = typeof given.id === 'string' ? given.id.trim() : ''
        if (id === '' || out.some(existing => existing.id === id)) continue
        const title = typeof given.title === 'string' ? given.title.trim() : ''
        out.push(title === '' ? { id } : { id, title })
      }
      return out
    }

    function sameEntries(a, b) {
      return JSON.stringify(a) === JSON.stringify(b)
    }

    // -----------------------------------------------------------------------------------------------
    // QUESTIONS PER SEAM
    //
    // The browser half cannot import `lib/seams.js` or `lib/model/questions.js`, so the seam list, the
    // seam-to-event map and the validation rules below are RESTATED here. The host keeps the same check in
    // `lib/questions.js`, and its builders throw on a spec that breaks a rule — so a bad spec this card
    // let through would still end as a skip line naming the reason. The duplication fails CLOSED.
    // -----------------------------------------------------------------------------------------------
    const SEAMS = [
      {
        name: 'assemble', event: 'system-prompt/assemble',
        hint: 'The text here is the system prompt being composed — its sections and its contexts. Nothing at this seam is model output, so ask what the prompt is telling the model to do.',
      },
      {
        name: 'admit', event: 'agent/pre-step',
        hint: 'The text here is the operator’s own message opening a step. Ask what it is asking for, or whether it is supplying context.',
      },
      {
        name: 'request', event: 'agent/request', textless: true,
        hint: 'Routing parameters only — provider, model, temperature. There is no text at this seam, so a question here can never be asked.',
      },
      {
        name: 'draft', event: 'llm/stream',
        hint: 'The text here is the model’s own streamed output. Ask what it is doing: answering, calling a tool, or declining.',
      },
      {
        name: 'pre_execute', event: 'tools/pre-execute',
        hint: 'The text here is the tool name and its arguments, before the call runs. This is the seam where a gate could still change the outcome — ask what the call would do.',
      },
      {
        name: 'execute', event: 'tools/execute',
        hint: 'The text here is the same tool name and arguments, in flight. The decision is already made, so measure here rather than gate.',
      },
      {
        name: 'post_execute', event: 'tools/post-execute',
        hint: 'The text here is the result the tool returned, normalized. Ask whether it succeeded or failed.',
      },
      {
        name: 'result', event: 'tools/result',
        hint: 'The text here is the frozen tool result being written to the record — the same content as post_execute, at the moment it is stored.',
      },
      {
        name: 'close', event: 'agent/turn-stopping', textless: true,
        hint: '{agent, turn, signal} only. There is no text at this seam, so a question here can never be asked.',
      },
    ]
    const QUESTION_TYPES = ['noul', 'choice', 'score']

    // WHAT EACH TYPE IS FOR. The first line is the one worth reading twice: on some decision servers a
    // `noul` does not answer the question at all — it returns a text-agreement score and reports it as
    // whatever was asked, so it can be confidently and stably inverted, with nothing in the reply to say so.
    const TYPE_HINTS = {
      noul: 'One probability. Prefer choice — a noul can be polarity-blind on some servers: it returns a text-agreement score whatever you ask, high for a claim and for its opposite. If you use one, say what true and false each mean.',
      choice: 'A distribution over options, and the type that respects the option text. Exactly one option must be the abstain case: without one, text that fits nothing is forced into an option it does not fit.',
      score: 'A probability-weighted level over an ordered list. Keep the levels ordered lowest first, and read the numbers in code — the level alone hides how spread the distribution was.',
    }

    // THE RULES THAT ARE CHEAP TO STATE AND EXPENSIVE TO LEARN. Each is a measured failure mode, not a
    // style preference: a question that was never validated produces a confident number about nothing.
    const HOW_TO_ASK = [
      'Prefer choice over noul. A noul can be polarity-blind, so any judgement that depends on the question’s own polarity, or on its criteria, belongs in a choice.',
      'Give every choice exactly one abstain option — unclear, none, says_nothing. Without one, text that fits no option is forced into one it does not fit.',
      'One narrow judgement per question. The model answers the question you wrote, not the one you meant.',
      'Ask what the text says literally. Counting, arithmetic and dates belong in code — a question whose answer has to be inferred does not separate.',
      'Trust nothing before two or three cases whose right answer you already know. A working question and a confidently wrong one look identical until you run them.',
      'Ask once. A question and its logical opposite do not sum to 1, so never add the complement as a cross-check.',
      'Keep the subject small. maxFieldChars caps what is sent, and a whole document in one request degrades the answer.',
    ]

    // A spec, canonicalised: fixed key ORDER (so two equal drafts serialise identically and `dirty` is not
    // a lie), only the keys this type uses, and `abstain` present only when true. Every edit funnels
    // through this, which is what keeps a draft and the value the host hands back comparable by string.
    function canonicalQuestion(spec) {
      const given = asObject(spec)
      const out = {
        id: typeof given.id === 'string' ? given.id : '',
        type: QUESTION_TYPES.includes(given.type) ? given.type : 'noul',
        instructions: typeof given.instructions === 'string' ? given.instructions : '',
      }
      if (out.type === 'noul') {
        const criteria = asObject(given.criteria)
        const yes = typeof criteria.true === 'string' ? criteria.true : ''
        const no = typeof criteria.false === 'string' ? criteria.false : ''
        if (yes !== '' || no !== '') out.criteria = { true: yes, false: no }
      }
      if (out.type === 'choice') {
        out.options = (Array.isArray(given.options) ? given.options : []).map((option) => {
          const row = asObject(option)
          const out2 = {
            label: typeof row.label === 'string' ? row.label : '',
            criterion: typeof row.criterion === 'string' ? row.criterion : '',
          }
          if (row.abstain === true) out2.abstain = true
          return out2
        })
      }
      if (out.type === 'score') {
        out.levels = (Array.isArray(given.levels) ? given.levels : []).map(level => (typeof level === 'string' ? level : ''))
      }
      return out
    }

    // EVERY seam gets a key, always, even when it carries nothing. The card writes all nine on save, which
    // is what makes "configured, and this seam asks nothing" distinguishable from "never configured" at
    // the host (see `lib/questions.js`).
    function cloneQuestions(value) {
      const source = asObject(value)
      const out = {}
      for (const seam of SEAMS) {
        // A NOT-APPLICABLE SEAM IS FORCED EMPTY, whatever the config holds. `request` and `close` carry no
        // text, so a spec there can never be asked -- and if one reached the draft it would make the whole
        // form invalid (`request[0]: needs an instruction`) over a question that was never going to run.
        // Forcing it empty here means such a spec can neither block a save nor survive one.
        out[seam.name] = seam.textless === true
          ? []
          : (Array.isArray(source[seam.name]) ? source[seam.name].map(canonicalQuestion) : [])
      }
      return out
    }

    function hasAnyQuestion(questions) {
      return SEAMS.some(seam => (questions[seam.name] ?? []).length > 0)
    }

    // THE PER-SEAM SWITCHES, canonicalised the same way and for the same reason: every seam gets a key, a
    // not-applicable seam is forced OFF (it can never be called), and an ABSENT key means ON -- `!== false`
    // on both sides of the wire, so a card can never show a seam off while the host is calling it.
    function cloneSeamEnabled(value) {
      const source = asObject(value)
      const out = {}
      for (const seam of SEAMS) {
        out[seam.name] = seam.textless === true ? false : source[seam.name] !== false
      }
      return out
    }

    function sameQuestions(a, b) {
      return JSON.stringify(a) === JSON.stringify(b)
    }

    function sameSeamEnabled(a, b) {
      return JSON.stringify(a) === JSON.stringify(b)
    }

    function currentSpec(questions, seam, index) {
      return cloneQuestions(questions)[seam][index]
    }

    function replaceSpec(questions, seam, index, next) {
      const out = cloneQuestions(questions)
      out[seam][index] = canonicalQuestion(next)
      return out
    }

    function editSpec(questions, seam, index, patch) {
      return replaceSpec(questions, seam, index, Object.assign({}, currentSpec(questions, seam, index), patch))
    }

    function nextQuestionId(specs) {
      const used = new Set(specs.map(spec => spec.id))
      if (!used.has('probe')) return 'probe'
      let n = 2
      while (used.has(`probe${n}`)) n += 1
      return `probe${n}`
    }

    function addQuestion(questions, seam) {
      const out = cloneQuestions(questions)
      out[seam] = out[seam].concat([canonicalQuestion({ id: nextQuestionId(out[seam]), type: 'noul', instructions: '' })])
      return out
    }

    function removeQuestion(questions, seam, index) {
      const out = cloneQuestions(questions)
      out[seam] = out[seam].filter((_, i) => i !== index)
      return out
    }

    // A TYPE CHANGE KEEPS NOTHING THE NEW TYPE DOES NOT USE, and seeds the minimum the builders demand: a
    // choice needs two options and exactly one abstain, a score needs two levels. Without the seed every
    // new choice would start invalid and the save would be refused with no obvious next step.
    function changeType(questions, seam, index, type) {
      const spec = currentSpec(questions, seam, index)
      if (type === 'choice') {
        const options = Array.isArray(spec.options) && spec.options.length >= 2
          ? spec.options
          : [{ label: '', criterion: '' }, { label: '', criterion: '', abstain: true }]
        return replaceSpec(questions, seam, index, Object.assign({}, spec, { type, options }))
      }
      if (type === 'score') {
        const levels = Array.isArray(spec.levels) && spec.levels.length >= 2 ? spec.levels : ['', '']
        return replaceSpec(questions, seam, index, Object.assign({}, spec, { type, levels }))
      }
      return replaceSpec(questions, seam, index, Object.assign({}, spec, { type }))
    }

    function editOption(questions, seam, index, optionIndex, patch) {
      const spec = currentSpec(questions, seam, index)
      const options = (spec.options ?? []).map((option, i) => (i === optionIndex ? Object.assign({}, option, patch) : option))
      return replaceSpec(questions, seam, index, Object.assign({}, spec, { options }))
    }

    // A RADIO SET CANNOT UNCHECK ITS SIBLINGS BY ITSELF: the browser moves the dot, the state keeps
    // `abstain: true` on the old option, and two abstain options is exactly what the builder refuses.
    function setAbstain(questions, seam, index, optionIndex) {
      const spec = currentSpec(questions, seam, index)
      const options = (spec.options ?? []).map((option, i) => {
        const copy = Object.assign({}, option)
        if (i === optionIndex) copy.abstain = true
        else delete copy.abstain
        return copy
      })
      return replaceSpec(questions, seam, index, Object.assign({}, spec, { options }))
    }

    function addOption(questions, seam, index) {
      const spec = currentSpec(questions, seam, index)
      return replaceSpec(questions, seam, index, Object.assign({}, spec, { options: (spec.options ?? []).concat([{ label: '', criterion: '' }]) }))
    }

    function removeOption(questions, seam, index, optionIndex) {
      const spec = currentSpec(questions, seam, index)
      return replaceSpec(questions, seam, index, Object.assign({}, spec, { options: (spec.options ?? []).filter((_, i) => i !== optionIndex) }))
    }

    function editLevel(questions, seam, index, levelIndex, value) {
      const spec = currentSpec(questions, seam, index)
      const levels = (spec.levels ?? []).map((level, i) => (i === levelIndex ? value : level))
      return replaceSpec(questions, seam, index, Object.assign({}, spec, { levels }))
    }

    function addLevel(questions, seam, index) {
      const spec = currentSpec(questions, seam, index)
      return replaceSpec(questions, seam, index, Object.assign({}, spec, { levels: (spec.levels ?? []).concat(['']) }))
    }

    function removeLevel(questions, seam, index, levelIndex) {
      const spec = currentSpec(questions, seam, index)
      return replaceSpec(questions, seam, index, Object.assign({}, spec, { levels: (spec.levels ?? []).filter((_, i) => i !== levelIndex) }))
    }

    /**
     * THE SAME RULES THE HOST ENFORCES, restated so the card can refuse a spec BEFORE a save the host would
     * accept and the model would then refuse. Every line names its location: "a choice needs two options"
     * without `draft[0]` is a message nobody can act on.
     */
    function questionProblems(questions) {
      const problems = []
      for (const seam of SEAMS) {
        // A NOT-APPLICABLE SEAM HAS NO RULE TO BREAK, so it is skipped rather than judged. `cloneQuestions`
        // already empties it; this is what keeps a draft arriving from anywhere else from being refused
        // over a question that could never be asked.
        if (seam.textless === true) continue
        const specs = questions[seam.name] ?? []
        const seen = new Set()
        specs.forEach((spec, index) => {
          const where = `${seam.name}[${index}]`
          const id = typeof spec.id === 'string' ? spec.id.trim() : ''
          if (id === '') problems.push(`${where}: needs an id`)
          else if (seen.has(id)) problems.push(`${where}: duplicate id "${id}"`)
          else seen.add(id)
          if (typeof spec.instructions !== 'string' || spec.instructions.trim() === '') {
            problems.push(`${where}: needs an instruction`)
          }
          if (spec.type === 'choice') {
            const options = Array.isArray(spec.options) ? spec.options : []
            if (options.length < 2) problems.push(`${where}: a choice needs at least two options`)
            const labels = new Set()
            let abstains = 0
            options.forEach((option, i) => {
              const label = typeof option.label === 'string' ? option.label.trim() : ''
              if (label === '') problems.push(`${where} option ${i}: needs a label`)
              else if (labels.has(label)) problems.push(`${where} option ${i}: duplicate label "${label}"`)
              else labels.add(label)
              if (typeof option.criterion !== 'string' || option.criterion.trim() === '') {
                problems.push(`${where} option ${i}: needs a criterion`)
              }
              if (option.abstain === true) abstains += 1
            })
            if (abstains !== 1) problems.push(`${where}: exactly one option must be the abstain option (found ${abstains})`)
          }
          if (spec.type === 'score') {
            const levels = Array.isArray(spec.levels) ? spec.levels : []
            if (levels.length < 2) problems.push(`${where}: a score needs at least two levels`)
            levels.forEach((level, i) => {
              if (typeof level !== 'string' || level.trim() === '') problems.push(`${where} level ${i}: must not be empty`)
            })
          }
          if (spec.type === 'noul' && spec.criteria !== undefined) {
            const criteria = asObject(spec.criteria)
            if (typeof criteria.true !== 'string' || criteria.true.trim() === '') problems.push(`${where}: criteria for true must not be empty`)
            if (typeof criteria.false !== 'string' || criteria.false.trim() === '') problems.push(`${where}: criteria for false must not be empty`)
          }
        })
      }
      return problems
    }

    // The badge a collapsed seam shows. It answers "what will this seam ask?", which differs by mode: with
    // nothing configured anywhere, an empty seam asks the probe question.
    function seamBadge(seam, specs, perSeam) {
      if (seam.textless === true) return 'not applicable — no text'
      if (specs.length > 0) return specs.length === 1 ? '1 question' : `${specs.length} questions`
      return perSeam ? 'asks nothing' : 'probe question'
    }

    function questionEditor(seam, index, spec, api, setQuestions) {
      const disabled = !api.canSave || api.saving
      const base = `system1-observer-q-${seam}-${index}`
      const edit = (patch) => setQuestions(editSpec(api.questions, seam, index, patch))
      return h('div', { key: `${seam}-${index}`, style: styles.question },
        h('div', { style: styles.row },
          h('label', { htmlFor: `${base}-id`, style: styles.label }, 'id'),
          h('input', {
            id: `${base}-id`, name: `${base}-id`, type: 'text', value: spec.id, disabled,
            placeholder: 'probe',
            onChange: (event) => edit({ id: event.currentTarget.value }),
          }),
          h('select', {
            id: `${base}-type`, name: `${base}-type`, value: spec.type, disabled,
            'aria-label': 'question type',
            onChange: (event) => setQuestions(changeType(api.questions, seam, index, event.currentTarget.value)),
          }, QUESTION_TYPES.map(type => h('option', { key: type, value: type }, type))),
          h('button', {
            id: `system1-observer-remove-${seam}-${index}`, type: 'button', disabled,
            onClick: () => setQuestions(removeQuestion(api.questions, seam, index)),
          }, 'remove'),
        ),
        h('input', {
          id: `${base}-instructions`, name: `${base}-instructions`, type: 'text', value: spec.instructions, disabled,
          placeholder: 'the question — one narrow judgement',
          onChange: (event) => edit({ instructions: event.currentTarget.value }),
        }),
        // WHAT THIS TYPE IS FOR, under the control that chooses it: the difference between the three is
        // the difference between a measurement and a confident number about nothing.
        h('p', { id: `system1-observer-typehint-${seam}-${index}`, style: styles.hint }, TYPE_HINTS[spec.type]),
        spec.type === 'noul' ? noulFields(base, spec, disabled, edit) : null,
        spec.type === 'choice' ? choiceFields(seam, index, base, spec, api, setQuestions, disabled) : null,
        spec.type === 'score' ? scoreFields(seam, index, base, spec, api, setQuestions, disabled) : null,
      )
    }

    // `noul` criteria are OPTIONAL in the host builder: both boxes empty omits the map entirely rather
    // than sending `{true:'', false:''}`, which the builder would refuse.
    function noulFields(base, spec, disabled, edit) {
      const criteria = asObject(spec.criteria)
      return h('div', { style: styles.sub },
        h('p', { style: styles.note }, 'criteria (optional) — what true and false each mean'),
        h('input', {
          id: `${base}-true`, name: `${base}-true`, type: 'text', value: criteria.true ?? '', disabled,
          placeholder: 'true means…',
          onChange: (event) => edit({ criteria: { true: event.currentTarget.value, false: criteria.false ?? '' } }),
        }),
        h('input', {
          id: `${base}-false`, name: `${base}-false`, type: 'text', value: criteria.false ?? '', disabled,
          placeholder: 'false means…',
          onChange: (event) => edit({ criteria: { true: criteria.true ?? '', false: event.currentTarget.value } }),
        }),
      )
    }

    function choiceFields(seam, index, base, spec, api, setQuestions, disabled) {
      const options = Array.isArray(spec.options) ? spec.options : []
      return h('div', { style: styles.sub },
        h('p', { style: styles.note }, 'options — at least two, exactly one marked as the abstain option'),
        options.map((option, optionIndex) => h('div', { key: optionIndex, style: styles.row },
          h('input', {
            id: `system1-observer-abstain-${seam}-${index}-${optionIndex}`, type: 'radio',
            name: `${base}-abstain`, checked: option.abstain === true, disabled,
            title: 'the abstain option — the one that means none of these fits',
            onChange: () => setQuestions(setAbstain(api.questions, seam, index, optionIndex)),
          }),
          h('input', {
            id: `${base}-label-${optionIndex}`, name: `${base}-label-${optionIndex}`, type: 'text',
            value: option.label, disabled, placeholder: 'label',
            onChange: (event) => setQuestions(editOption(api.questions, seam, index, optionIndex, { label: event.currentTarget.value })),
          }),
          h('input', {
            id: `${base}-criterion-${optionIndex}`, name: `${base}-criterion-${optionIndex}`, type: 'text',
            value: option.criterion, disabled, placeholder: 'what this option means',
            onChange: (event) => setQuestions(editOption(api.questions, seam, index, optionIndex, { criterion: event.currentTarget.value })),
          }),
          h('button', {
            id: `system1-observer-option-remove-${seam}-${index}-${optionIndex}`, type: 'button', disabled,
            onClick: () => setQuestions(removeOption(api.questions, seam, index, optionIndex)),
          }, '×'),
        )),
        h('button', {
          id: `system1-observer-option-add-${seam}-${index}`, type: 'button', disabled,
          onClick: () => setQuestions(addOption(api.questions, seam, index)),
        }, '+ option'),
      )
    }

    function scoreFields(seam, index, base, spec, api, setQuestions, disabled) {
      const levels = Array.isArray(spec.levels) ? spec.levels : []
      return h('div', { style: styles.sub },
        h('p', { style: styles.note }, 'levels, lowest first — at least two, each a description'),
        levels.map((level, levelIndex) => h('div', { key: levelIndex, style: styles.row },
          h('span', { style: styles.note }, String(levelIndex)),
          h('input', {
            id: `${base}-level-${levelIndex}`, name: `${base}-level-${levelIndex}`, type: 'text',
            value: level, disabled, placeholder: `level ${levelIndex}`,
            onChange: (event) => setQuestions(editLevel(api.questions, seam, index, levelIndex, event.currentTarget.value)),
          }),
          h('button', {
            id: `system1-observer-level-remove-${seam}-${index}-${levelIndex}`, type: 'button', disabled,
            onClick: () => setQuestions(removeLevel(api.questions, seam, index, levelIndex)),
          }, '×'),
        )),
        h('button', {
          id: `system1-observer-level-add-${seam}-${index}`, type: 'button', disabled,
          onClick: () => setQuestions(addLevel(api.questions, seam, index)),
        }, '+ level'),
      )
    }

    // A NOT-APPLICABLE SEAM GETS NO CONTROLS AT ALL. Not a disabled "+ question" and not a greyed editor:
    // there is nothing to author, and offering the button is what let a spec be staged at `request` and
    // refuse the whole save with `request[0]: needs an instruction` over a question that could never run.
    // It is a plain `div` rather than a `details` because there is nothing to expand.
    function textlessSection(seam, api) {
      return h('div', { key: seam.name, id: `system1-observer-seam-${seam.name}`, style: styles.seam },
        h('div', { style: styles.summary },
          h('span', { style: styles.seamName }, seam.name),
          h('code', { style: styles.seamEvent }, seam.event),
          h('span', { id: `system1-observer-badge-${seam.name}`, style: styles.badge }, seamBadge(seam, [], api.perSeam)),
        ),
        h('div', { style: styles.seamBody },
          h('p', { id: `system1-observer-hint-${seam.name}`, style: styles.hint }, seam.hint),
        ),
      )
    }

    function seamSection(seam, api) {
      if (seam.textless === true) return textlessSection(seam, api)
      const specs = api.questions[seam.name] ?? []
      const disabled = !api.canSave || api.saving
      return h('details', { key: seam.name, id: `system1-observer-seam-${seam.name}`, style: styles.seam },
        h('summary', { style: styles.summary },
          h('span', { style: styles.seamName }, seam.name),
          h('code', { style: styles.seamEvent }, seam.event),
          h('span', { id: `system1-observer-badge-${seam.name}`, style: styles.badge }, seamBadge(seam, specs, api.perSeam)),
        ),
        h('div', { style: styles.seamBody },
          // WHAT THE TEXT IS HERE, before any control: the single most common way to waste a call is to
          // ask about text this seam was never given.
          h('p', { id: `system1-observer-hint-${seam.name}`, style: styles.hint }, seam.hint),
          specs.map((spec, index) => questionEditor(seam.name, index, spec, api, (next) => api.onEdit('questions', next))),
          h('button', {
            id: `system1-observer-add-${seam.name}`, type: 'button', disabled,
            onClick: () => api.onEdit('questions', addQuestion(api.questions, seam.name)),
          }, '+ question'),
        ),
      )
    }

    // THE PER-SEAM SWITCHES, in ONE VISIBLE ROW rather than inside each collapsed section. Switching a seam
    // off is what an operator reaches for while something is going wrong, and a control that has to be
    // expanded first is the wrong shape for that. All nine seams appear, so the row shows the whole loop;
    // the two not-applicable ones are disabled and off, because they can never be called either way.
    function seamSwitches(api) {
      return h('div', { id: 'system1-observer-seam-switches', style: styles.rules },
        h('h3', { style: styles.title }, 'Call the model at these seams'),
        h('p', { style: styles.note }, 'Off, a seam records a skip with reason `calls disabled at this seam` and makes no request. Its questions are kept, so switching it back on resumes where it left off. These are live — read at the point of use, so a change needs no restart.'),
        h('div', { style: styles.switchGrid },
          SEAMS.map(seam => h('label', { key: seam.name, style: styles.switchRow },
            h('input', {
              id: `system1-observer-seam-enabled-${seam.name}`, type: 'checkbox',
              checked: api.seamEnabled[seam.name] === true,
              disabled: seam.textless === true || !api.canSave || api.saving,
              onChange: (event) => api.onToggleSeam(seam.name, event.currentTarget.checked),
            }),
            h('span', { style: seam.textless === true ? styles.note : styles.label }, seam.name),
            seam.textless === true ? h('span', { style: styles.badge }, 'not applicable') : null,
          )),
        ),
      )
    }

    function questionsEditor(api) {
      const modeNote = api.perSeam
        ? 'A question is configured, so only the seams that carry one are asked. A seam with none asks nothing and records a skip.'
        : 'No question is configured, so every observed seam asks the built-in probe question. Adding one below switches the row to per-seam questions.'
      return h('div', { style: styles.questions },
        h('h3', { style: styles.title }, 'Questions per seam'),
        h('p', { style: styles.note }, modeNote),
        h('p', { style: styles.note }, 'Which seams are OBSERVED is `hooks`, read once at mount from the profile YAML. This page cannot read a non-volatile field, so a seam below may be configured and still never fire — check `hooks` for that.'),
        // WHICH SEAMS CANNOT BE TESTED AT ALL, named rather than left to a badge. "Not applicable" is a
        // property of the seam, not of its settings, so it belongs in prose and not only in a summary line.
        h('p', { id: 'system1-observer-not-applicable', style: styles.note },
          'Two of the nine seams are not applicable. `request` (routing parameters) and `close` ({agent, turn, signal}) carry no text at all, so there is nothing to ask a question about and nothing to test. Leave both out of `hooks`: a listener there can only ever write a skip line.'),
        h('details', { id: 'system1-observer-how-to-ask', style: styles.rules },
          h('summary', { style: styles.summary }, 'How to ask well'),
          h('ul', { style: styles.rulesList }, HOW_TO_ASK.map((rule, index) => h('li', { key: index }, rule))),
        ),
        SEAMS.map(seam => seamSection(seam, api)),
      )
    }

    function Form(props) {
      const { current, draft, saving, notice, error, problems, onSave, onDiscard, onEdit, onReset, onToggleSeam } = props
      const labels = {
        unavailable: 'Settings are unavailable while this component is not loaded.',
        readOnly: 'This profile does not allow settings changes.',
        saveFailed: 'DSH did not accept these settings.',
        save: 'Save',
        saving: 'Saving\u2026',
      }
      // THE SHELL IS BUILT HERE, not by a model. `writable` is `canSave`, so a form with no revision
      // shows the read-only notice instead of a Save button that cannot work.
      const formState = {
        available: true,
        writable: props.canSave,
        dirty: props.dirty,
        invalid: props.invalid,
        saving,
        failed: false,
      }
      const calls = draft.callsEnabled
      const observe = draft.observeSubagents
      const include = draft.includeNonOperatorFacing
      const chars = draft.maxFieldChars
      // ---------------------------------------------------------------------------------------------
      // THE TABLE'S CONTROLS, GROUPED INTO THE PANELS OF `docs/settings.md` §6.
      //
      // The panels are `details` elements with stable ids, reusing the idiom the seam editors already use, and
      // each summary carries the STATE of its group rather than only its name -- a reader scanning six closed
      // rows should be able to see what the row is doing without opening anything.
      // ---------------------------------------------------------------------------------------------
      const chipOf = (id) => {
        if (id === 'observe') return ' \u2014 ' + (Array.isArray(draft.hooks) ? draft.hooks.length : 0) + ' seam(s)'
        if (id === 'send') return ' \u2014 ' + (draft.provider === '' ? '(no provider)' : draft.provider) + ' / ' + (draft.model === '' ? '(no model)' : draft.model)
        if (id === 'see') return ' \u2014 state ' + draft.composeMaxChars + 'c, tool ' + draft.toolBlockMaxChars + 'c, tail ' + draft.tailChars + 'c'
        if (id === 'turn') return ' \u2014 every ' + draft.turnEveryNTurns + ' boundary(ies)'
        if (id === 'keep') return ' \u2014 redact ' + (draft.redactEnabled ? 'on' : 'off') + ', paths ' + draft.pathMode
        if (id === 'numbers') return ' \u2014 $' + draft.pricePerMTokInput + '/MTok, ' + draft.calibrationBins + ' bins, ' + draft.maxCompareLanes + ' lanes'
        return ''
      }
      // THE SAME COMPARISON THE SAVE USES. This was a second, hand-written comparator, and the two could disagree --
      // which is how a panel comes to look clean while the Save button has work to do.
      const movedFields = new Set(tableOps(draft, current).map((op) => op.path[0]))
      const movedSetting = (entry) => movedFields.has(entry.field)
      // ONE PLACE RESOLVES `choices`, so a lazy entry and an eager one behave identically.
      const choicesOf = (entry) => (typeof entry.choices === 'function' ? entry.choices() : (entry.choices ?? []))
      const settingEl = (entry) => {
        const id = 'system1-observer-' + entry.field
        const disabled = !props.canSave || saving
        const value = draft[entry.field]
        let control
        if (entry.kind === 'switch') {
          control = h('div', { style: styles.row },
            h('input', {
              id, name: entry.field, type: 'checkbox', checked: value === true, disabled,
              onChange: (event) => props.onEdit(entry.field, event.currentTarget.checked),
            }),
            h('span', { style: styles.note }, value === true ? 'on' : 'off'))
        } else if (entry.kind === 'select') {
          control = h('select', {
            id, name: entry.field, value, disabled,
            onChange: (event) => props.onEdit(entry.field, event.currentTarget.value),
          }, choicesOf(entry).map((choice) => h('option', { key: choice, value: choice }, choice)))
        } else if (entry.kind === 'multi') {
          control = h('div', { style: styles.rules }, choicesOf(entry).map((choice) => h('label', { key: choice, style: styles.switchRow },
            h('input', {
              id: id + '-' + choice, type: 'checkbox', disabled,
              checked: Array.isArray(value) && value.includes(choice),
              onChange: (event) => props.onEdit(entry.field, event.currentTarget.checked
                ? (Array.isArray(value) ? value : []).concat(choice)
                : (Array.isArray(value) ? value : []).filter((item) => item !== choice)),
            }),
            h('span', { style: styles.note }, choice))))
        } else if (entry.kind === 'list') {
          control = h('input', {
            id, name: entry.field, type: 'text', disabled,
            value: Array.isArray(value) ? value.join(', ') : '',
            onChange: (event) => props.onEdit(entry.field, event.currentTarget.value
              .split(',').map((item) => item.trim()).filter((item) => item !== '')),
          })
        } else if (entry.kind === 'number') {
          control = h('div', { style: styles.row },
            h('input', {
              id, name: entry.field, type: 'text', inputMode: 'numeric', disabled,
              value: String(value ?? ''),
              onChange: (event) => props.onEdit(entry.field, event.currentTarget.value),
            }),
            h('button', {
              id: id + '-reset', type: 'button', disabled, title: 'restore the schema default',
              onClick: () => props.onReset(entry.field, numberText(entry.fallback)),
            }, 'reset'))
        } else if (entry.kind === 'lines') {
          control = h('textarea', {
            id, name: entry.field, rows: 3, disabled, spellCheck: false, style: styles.rules,
            value: typeof value === 'string' ? value : '',
            onChange: (event) => props.onEdit(entry.field, event.currentTarget.value),
          })
        } else if (entry.kind === 'longtext') {
          control = h('textarea', {
            id, name: entry.field, rows: 3, disabled, style: styles.rules, value: String(value ?? ''),
            onChange: (event) => props.onEdit(entry.field, event.currentTarget.value),
          })
        } else {
          control = h('input', {
            id, name: entry.field, type: 'text', disabled, value: String(value ?? ''),
            onChange: (event) => props.onEdit(entry.field, event.currentTarget.value),
          })
        }
        return fieldEl(id, entry.label, control, entry.hint)
      }
      const panelEl = (group) => {
        const entries = SETTINGS.filter((entry) => entry.panel === group.id)
        if (entries.length === 0) return null
        // A PANEL WITH AN UNSAVED CHANGE OPENS ITSELF. Save lives in the host's chrome at the bottom, so an edit
        // inside a closed panel is an edit the person cannot see; this is the cheap version of a sticky save bar,
        // and it is what the card test asserts about the panels.
        const open = entries.some(movedSetting)
        return h('details', {
          key: group.id, id: 'system1-observer-panel-' + group.id, style: styles.seam,
          open: open ? true : undefined,
        },
          h('summary', { style: styles.summary }, group.title + chipOf(group.id)),
          ...entries.map(settingEl))
      }

      return h(SettingsForm, { state: formState, labels, onSave, onDiscard },
        ...PANELS.map(panelEl),
        // THE MASTER SWITCH, first because it governs everything below it. It is a tick rather than a
        // slider, and it takes effect on the NEXT seam firing -- the questions are kept, so turning it
        // back on resumes where it left off.
        fieldEl('system1-observer-callsEnabled', 'Call the System One model',
          h('div', { style: styles.row },
            h('input', {
              id: 'system1-observer-callsEnabled', name: 'callsEnabled', type: 'checkbox',
              checked: calls, disabled: !props.canSave || saving,
              onChange: (event) => onEdit('callsEnabled', event.currentTarget.checked),
            }),
            h('span', { style: styles.note }, calls ? 'on' : 'off'),
          ),
          'The MASTER switch, and it outranks everything below: off, every seam records `calls disabled` — including seams you have switched on and sessions you have observed. It does not touch the questions or the hooks, so switching it back on resumes where it left off. Read at the point of use, so it takes effect on the next seam firing, with no restart.'),
        // WHAT IS ACTUALLY HAPPENING, in one line, because there are THREE ways to observe nothing -- the master
        // switch, an empty session list, and every seam switched off -- and all three look identical from the
        // outside: no calls. A control that silently does nothing is the failure this project keeps refusing,
        // and two independent controls with the same visible effect is that failure at the interface.
        //
        // IT DESCRIBES THE SAVED STATE, NOT THE DRAFT, and that distinction cost a real confusion: read from the
        // draft, this line said "Calls are ON" the instant the box was ticked, while the running row was still
        // off and still recording `calls disabled` -- a line whose whole job is to explain why nothing is
        // happening, confidently explaining the opposite. The draft is still worth reporting, so it is reported
        // as what it is: not yet in force.
        h('p', { id: 'system1-observer-effective', style: styles.effective, role: 'status' },
          effectiveNote(current) + (props.dirty ? '  ·  You have UNSAVED changes: nothing above is in force until you press Save.' : '')),
        // WHO. THE "..." MENU IS THE WAY IN, and this is the way to SEE and to prune what it added. There is
        // deliberately NO add box: a session id is 36 characters of uuid, and a control that asks a person to
        // find one is a control that will not be used. The menu already has the id and the headline in hand.
        fieldEl('system1-observer-sessions', 'Observe only these sessions',
          h('div', { style: styles.sessions },
            draft.sessions.length === 0
              ? h('p', { id: 'system1-observer-sessions-empty', style: styles.note }, 'No session is observed. Use the “...” menu on a session in the sidebar to observe it.')
              : draft.sessions.map((entry, index) => h('div', { key: entry.id, style: styles.sessionRow },
                h('span', {
                  id: `system1-observer-session-title-${index}`, style: styles.label,
                  // AN ENTRY ADDED BEFORE HEADLINES WERE RECORDED HAS NO TITLE AND CANNOT GET ONE HERE: the
                  // card has no way to look a session up, so the only place a headline can be captured is the
                  // session menu that was handed it. Say how to fix it rather than showing a bare uuid.
                  title: typeof entry.title === 'string'
                    ? entry.title
                    : 'This entry was added before headlines were recorded. Toggle it off and on in the session menu to capture the headline.',
                }, entry.id === SESSION_WILDCARD
                  ? 'every session'
                  : (typeof entry.title === 'string' ? entry.title : 'no headline recorded')),
                h('code', { style: styles.seamEvent }, entry.id),
                h('button', {
                  id: `system1-observer-session-remove-${index}`, type: 'button',
                  disabled: !props.canSave || saving,
                  title: entry.id === SESSION_WILDCARD ? 'stop observing every session' : 'stop observing this session',
                  onClick: () => onEdit('sessions', draft.sessions.filter((_, i) => i !== index)),
                }, '×'),
              )),
          ),
          // THE HINT BECOMES THE DIAGNOSIS WHEN THE HOST IS OLDER THAN THIS PAGE. A host whose schema predates
          // `sessions` cannot project it, so the list reads empty, the session menu's write is refused, and
          // BOTH FAIL SILENTLY -- the operator sees a control that does nothing. `value.sessions` is the
          // discriminator: a volatile `Schema.array` materialises to `[]` for a field nobody has written, so
          // the key is ABSENT only when the running host does not know the field at all.
          props.staleHost
            ? h('span', { style: styles.error, role: 'alert' },
              'This page is newer than the running host: `sessions` is not in its schema, so this list stays empty and a session-menu click is refused. Restart the host to load this version of the plugin — after that, the list here and the “...” menu are the same setting.')
            : '`*` means EVERY session, and an EMPTY list means none. Add a session from the “...” menu on it; that menu can also narrow `*` down to one session. The id is what is matched and the headline is a label kept beside it, so renaming a session changes nothing. A firing in any session that is not observed records a skip with reason `session not observed`, and its text never reaches the model or the trace.'),
        fieldEl('system1-observer-observeSubagents', 'Observe subagents',
          h('div', { style: styles.row },
            h('input', {
              id: 'system1-observer-observeSubagents', name: 'observeSubagents', type: 'checkbox',
              checked: observe, disabled: !props.canSave || saving,
              onChange: (event) => onEdit('observeSubagents', event.currentTarget.checked),
            }),
            h('span', { style: styles.note }, observe ? 'on' : 'off'),
          ),
          'Off records a subagent\u2019s streams and tool calls as skip lines; their text never reaches the model.'),
        fieldEl('system1-observer-includeNonOperatorFacing', 'Include the harness\u2019s own calls',
          h('div', { style: styles.row },
            h('input', {
              id: 'system1-observer-includeNonOperatorFacing', name: 'includeNonOperatorFacing', type: 'checkbox',
              checked: include, disabled: !props.canSave || saving,
              onChange: (event) => onEdit('includeNonOperatorFacing', event.currentTarget.checked),
            }),
            h('span', { style: styles.note }, include ? 'on' : 'off'),
          ),
          'Also observe purpose-tagged streams: session titles and compaction.'),
        fieldEl('system1-observer-maxFieldChars', 'Longest recorded field',
          h('div', { style: styles.row },
            h('input', {
              id: 'system1-observer-maxFieldChars', name: 'maxFieldChars', type: 'text', inputMode: 'numeric',
              value: chars, disabled: !props.canSave || saving,
              onChange: (event) => onEdit('maxFieldChars', event.currentTarget.value),
            }),
            // The toolkit's reset badge is not rendered beside a plain control, so its action is kept
            // here: it restores the schema default rather than clearing the box, which `.min(1)` would
            // refuse. Without a handler that badge would throw at the click.
            h('button', {
              type: 'button', disabled: !props.canSave || saving,
              onClick: () => onReset('maxFieldChars', numberText(current.maxFieldChars)),
            }, 'reset'),
          ),
          'Characters kept per state field; longer values are cut and the line is marked truncated.'),
        // PER SEAM FIRST, then the questions: which seams are called is the coarser decision, and a seam
        // switched off here keeps its questions for when it comes back.
        seamSwitches({
          seamEnabled: draft.seamEnabled,
          canSave: props.canSave,
          saving,
          onToggleSeam,
        }),
        questionsEditor({
          questions: draft.questions,
          perSeam: hasAnyQuestion(draft.questions),
          canSave: props.canSave,
          saving,
          onEdit,
        }),
        // THE PROBLEMS ARE SHOWN BEFORE A SAVE, not only when one is refused. A staged spec that breaks a
        // rule makes the whole form invalid, so a person who cannot see why would find a dead Save button.
        problems !== '' ? h('p', { style: styles.error, role: 'alert' }, problems) : null,
        error !== '' ? h('p', { style: styles.error, role: 'alert' }, error) : null,
        notice !== '' ? h('p', { style: styles.note, role: 'status' }, notice) : null,
        h('p', { style: styles.note }, 'The other seven settings are YAML-only and are refused by the host.'),
      )
    }

    // -----------------------------------------------------------------------------------------------
    // THE SESSION MENU SEAT
    //
    // `sidebar.workspaces.session.menu.item` is a declared list seat: the rows of one session's "..." menu,
    // handed `{ sessionId, displayTitle }` and a `useMenuOpenState` hook, and placed among the shipped rows by
    // `order`. An observer scoped to one conversation is useless if pointing it at that conversation means
    // typing a uuid, so the menu is where the pointing happens and the card's text box is the back door.
    //
    // THE WRITE PATH IS THE CARD'S OWN. It resolves the same namespace through the same `configForms`, and
    // sends the same one `set` op; the menu is a second way in, not a second mechanism.
    // -----------------------------------------------------------------------------------------------
    // THE ONE ENTRY THAT IS NOT A SESSION ID: it names every session, and it is what the schema defaults to, so
    // a row nobody has configured observes everything while an EMPTIED list observes nothing. Restated from
    // `lib/sessions.js` because the browser half cannot import it.
    const SESSION_WILDCARD = '*'
    const OBSERVE_MENU_ID = 'system1-observer:observe'
    // After the shipped pin/rename/fork/archive (100/200/300/400), so it reads as a plugin row among them.
    const OBSERVE_MENU_ORDER = 500

    /** The entry form for this plugin's row, or `undefined` when the profile serves no such namespace. */
    function system1Form(services) {
      try {
        const snapshot = services.configForms.describe().getSnapshot()
        const namespaces = snapshot !== null && typeof snapshot === 'object' && snapshot.view !== undefined
          ? snapshot.view.namespaces
          : undefined
        const ns = Array.isArray(namespaces) ? namespaces.find(candidate => NAMESPACES.includes(candidate.ns)) : undefined
        return ns === undefined ? undefined : services.configForms.get(ns.ns)
      } catch {
        return undefined
      }
    }

    /** The stored allow-list, as entries. Anything else in the field is ignored rather than trusted. */
    function storedSessions(services) {
      const form = system1Form(services)
      if (form === undefined) return []
      const snapshot = form.getSnapshot()
      const value = snapshot === null || snapshot === undefined ? undefined : snapshot.value
      const given = value !== null && typeof value === 'object' ? value.sessions : undefined
      return sessionEntries(given)
    }

    /**
     * THREE ACTIONS, because there are three states a session can be in, and the menu is the only control that
     * can tell them apart:
     *
     *   the wildcard is active      -> `only`  : narrow to this session alone
     *   a specific entry matches    -> `stop`  : drop every entry this session matches
     *   neither                     -> `add`   : observe this session as well
     *
     * `stop` cannot apply while the wildcard is active -- "every session EXCEPT this one" is not expressible in
     * a list of inclusions -- so the honest action there is to narrow, which is what `only` does.
     *
     * THE TITLE IS CAPTURED HERE, because this is the only place that has it: the seat is handed
     * `{ sessionId, displayTitle }`, and an id alone is unreadable in the settings card. It is written BESIDE
     * the id and never matched on -- a rename must not be able to stop a session being observed.
     *
     * REMOVING DROPS EVERY ENTRY THE SESSION MATCHES, not just its exact id: a prefix the operator typed by
     * hand is an entry for the same session, and leaving it behind would make "stop observing" a lie.
     */
    async function setSessionObserved(services, sessionId, action, displayTitle) {
      if (typeof sessionId !== 'string' || sessionId === '') return false
      const form = system1Form(services)
      if (form === undefined) return false
      const current = storedSessions(services)
      const specific = current.filter(existing => existing.id !== SESSION_WILDCARD)
      const title = typeof displayTitle === 'string' ? displayTitle.trim() : ''
      const entry = title === '' ? { id: sessionId } : { id: sessionId, title }
      let next
      if (action === 'only') next = [entry]
      else if (action === 'stop') next = specific.filter(existing => !sessionId.startsWith(existing.id))
      else next = current.concat([entry])
      try {
        const snapshot = form.getSnapshot()
        return await form.mutate([{ op: 'set', path: ['sessions'], value: next }], snapshot === undefined || snapshot === null ? undefined : snapshot.revision)
      } catch {
        // A refused or failed write is not a success: the caller flips its own label back on the resolved
        // value, so the menu never claims a change that did not happen.
        return false
      }
    }

    /** Which of the three states a session is in, for the menu's label and its action. */
    function sessionMenuState(services, sessionId) {
      const entries = storedSessions(services)
      const hasWildcard = entries.some(entry => entry.id === SESSION_WILDCARD)
      const specific = entries.filter(entry => entry.id !== SESSION_WILDCARD)
      const matches = typeof sessionId === 'string' && sessionId !== ''
        && specific.some(entry => sessionId.startsWith(entry.id))
      if (hasWildcard) return { action: 'only', label: 'Observe only this session' }
      if (matches) return { action: 'stop', label: 'Stop observing this session' }
      return { action: 'add', label: 'Observe this session' }
    }

    /**
     * One row of a session's "..." menu.
     *
     * The label is seeded when the menu opens and flipped locally on select, because the entry form is a
     * subscribe-able store this component has no hook for -- and a menu that is reopened reads the truth
     * again. A write that resolves false puts the label back.
     */
    function ObserveMenuItem(props) {
      const { sessionId, displayTitle, services } = props
      // ALWAYS CALLED, when the seat provides it: the condition is fixed for the life of the instance, so
      // the hook order does not vary between renders.
      const menuState = typeof props.useMenuOpenState === 'function' ? props.useMenuOpenState() : [false, () => {}]
      const setMenuOpen = typeof menuState[1] === 'function' ? menuState[1] : () => {}
      const [state, setState] = React.useState(() => sessionMenuState(services, sessionId))
      const select = () => {
        setMenuOpen(false)
        // The label after acting is known without re-reading: `only` leaves the wildcard gone and this session
        // in, `stop` removes it, `add` adds it.
        const optimistic = state.action === 'add' ? 'stop' : 'add'
        setState({ action: optimistic, label: optimistic === 'stop' ? 'Stop observing this session' : 'Observe this session' })
        // `displayTitle` goes with the id, and it is the only chance to capture it: the settings card has no
        // way to look a session up, so a title not recorded here can never be shown there.
        void setSessionObserved(services, sessionId, state.action, displayTitle).then((ok) => {
          if (ok === false) setState(state)
        })
      }
      return h(MenuItemButton, { id: OBSERVE_MENU_ID, onSelect: select }, state.label)
    }

    /**
     * One sentence for "what will actually happen", because three separate controls can each stop every call
     * and all three look identical from the outside.
     *
     * The order is the order `lib/observe.js` checks them: the master switch, then the session list, then the
     * per-seam switches. It therefore names the FIRST gate that is stopping things, which is the one worth
     * acting on — a session list that cannot help while the master is off is exactly the confusion this is
     * here to prevent.
     */
    function effectiveNote(draft) {
      if (draft.callsEnabled !== true) {
        return 'Calls are OFF. Every seam records `calls disabled`, whatever the seams and sessions below say — this switch overrides both. Switch it on to resume.'
      }
      if (draft.sessions.length === 0) {
        return 'Calls are ON but NO session is observed, so every firing records `session not observed`. Use the “...” menu on a session in the sidebar to observe one.'
      }
      const wildcard = draft.sessions.some(entry => entry.id === SESSION_WILDCARD)
      const who = wildcard
        ? 'every session'
        : `${draft.sessions.length} session${draft.sessions.length === 1 ? '' : 's'}`
      const off = SEAMS.filter(seam => seam.textless !== true && draft.seamEnabled[seam.name] === false).map(seam => seam.name)
      if (off.length === SEAMS.filter(seam => seam.textless !== true).length) {
        return `Calls are ON for ${who}, but every seam is switched off, so every firing records \`calls disabled at this seam\`. Switch one on below.`
      }
      const seams = off.length === 0 ? 'every observed seam calls' : `off: ${off.join(', ')}`
      return `Calls are ON for ${who}; ${seams}. Anything else records \`session not observed\`.`
    }

    function Card(props) {
      const { view, services } = props
      const mirror = services.configForms.describe()

      // THE MIRROR SUBSCRIPTION: it lists the namespaces this profile serves, and it is where the
      // namespace's spelling is read from rather than guessed.
      const subscribeMirror = React.useCallback((listener) => mirror.subscribe(listener), [mirror])
      const getMirrorSnapshot = React.useCallback(() => mirror.getSnapshot(), [mirror])
      const snap = React.useSyncExternalStore(subscribeMirror, getMirrorSnapshot, getMirrorSnapshot)
      React.useEffect(() => { void mirror.ensure() }, [mirror])

      // EVERY hook runs before any early return, and the hook count is IDENTICAL in both views -- the
      // Plugins page renders one entry for `summary` and one for `page`, and a conditional hook would
      // blank the slot entry rather than render a shorter list. The count is also the same on both
      // SEATS: the row page starts from the provided form and never resolves a namespace, but it runs
      // the same five hooks below over that form.
      const namespaces = snap && snap.view ? snap.view.namespaces : null
      const ns = namespaces ? namespaces.find((n) => NAMESPACES.includes(n.ns)) : undefined
      const nsName = ns === undefined ? undefined : ns.ns
      const resolved = React.useMemo(
        // `get()` takes the BARE namespace, which is exactly the entry id the mirror reports.
        () => (nsName === undefined ? undefined : services.configForms.get(nsName)),
        [nsName, services],
      )
      // THE PAGE-SUPPLIED FORM WINS WHEN PRESENT. On a row page the page owner hands `props.form`, a
      // `ConfigPageForm` (`{ state, mutate }`) that it keeps fresh itself -- so there is NOTHING to
      // subscribe to and no `getSnapshot` to call. On the bundle page it is absent and the controller
      // is subscribed instead.
      const provided = props.form !== undefined && props.form !== null ? props.form : undefined
      const source = provided !== undefined ? provided : resolved
      // A `ConfigPageForm` HAS NO `subscribe`/`getSnapshot` -- it is `{ state, mutate }`, kept fresh by
      // the page owner -- so the hook is fed a no-op pair for it rather than called into a missing
      // method. The hook still runs, because its position in the order must not depend on the seat.
      const subscribeForm = React.useCallback(
        (listener) => (provided !== undefined || source === undefined ? () => {} : source.subscribe(listener)),
        [provided, source],
      )
      const getFormSnapshot = React.useCallback(
        () => (provided !== undefined || source === undefined ? undefined : source.getSnapshot()),
        [provided, source],
      )
      const subscribed = React.useSyncExternalStore(subscribeForm, getFormSnapshot, getFormSnapshot)
      // THE FORM'S OWN STATE, SUBSCRIBED. This is the fix: a store that has not derived yet answers
      // `status: 'loading'` at `writable: false`, and this hook re-reads it when it does derive, so the
      // controls appear instead of the card sitting on a status line forever.
      const state = provided !== undefined ? provided.state : subscribed
      const status = state === undefined || state === null ? undefined : state.status
      const revision = state === undefined || state === null ? undefined : state.revision
      const value = state === undefined || state === null ? undefined : state.value
      const valueObject = asObject(value)
      // A PAGE NEWER THAN THE HOST IS A REAL AND RECURRING STATE, because the browser half follows the
      // package while the host half follows a restart. `sessions` is the field that exposes it: the schema
      // projection omits a field the running host does not declare, and a volatile `Schema.array` is
      // otherwise always present as `[]`, so an ABSENT key means the host predates this version.
      const staleHost = status === 'ready' && !Object.hasOwn(valueObject, 'sessions')

      // THE DRAFTS. The two booleans are booleans -- a checkbox stages `true`/`false` -- and the number
      // is TEXT, because an empty or half-typed box is a state a number cannot hold.
      const current = React.useMemo(() => ({
        // THE MASTER SWITCH IS ON WHEN ABSENT, not off. Every other top-level boolean here reads `=== true`,
        // but this one is `!== false` on both sides of the wire: a field nobody has written must mean
        // "calls on", and a card that showed it off while the host was calling would be lying about the
        // live state.
        callsEnabled: valueObject.callsEnabled !== false,
        sessions: sessionEntries(valueObject.sessions),
        observeSubagents: booleanValue(valueObject.observeSubagents),
        includeNonOperatorFacing: booleanValue(valueObject.includeNonOperatorFacing),
        maxFieldChars: numberText(valueObject.maxFieldChars),
        // EVERY FIELD THE TABLE OWNS, from one function: the draft cannot miss a setting the table lists.
        ...seedTable(valueObject),
        // CANONICALISED ON READ. The host projects whatever is stored, including keys this card would
        // never write (`abstain: false`, an empty `criteria`), so the draft and the stored value are
        // compared through the same normaliser -- otherwise an untouched form would read as dirty.
        questions: cloneQuestions(valueObject.questions),
        seamEnabled: cloneSeamEnabled(valueObject.seamEnabled),
      }), [status, revision, value])
      const [draft, setDraft] = React.useState(current)
      const [saving, setSaving] = React.useState(false)
      const [notice, setNotice] = React.useState('')
      const [error, setError] = React.useState('')
      React.useEffect(() => {
        // THE SEED, on status/revision/value -- the reference's exact dependency triple, so it runs when
        // the SNAPSHOT changes and not on every render. Re-seeding replaces a draft that diverged
        // because a new source arrived; the draft is derived state, and nothing else may key it.
        setDraft(current)
      }, [current])

      const parsedChars = Number(draft.maxFieldChars)
      // WHOLE NUMBERS ONLY, because the copy below says "a whole number" and the reference does the same
      // (`dsh-system1/lib/client.js:212`: Number.isInteger(parsedTimeout) && parsedTimeout >= 1). A fractional
      // count reached `mutate` before this, so the card refused in words what it accepted in code.
      const charsValid = draft.maxFieldChars.trim() !== '' && Number.isInteger(parsedChars) && parsedChars >= 1
      // EVERY RULE THE FORM ENFORCES, IN ONE STRING. The number and the questions are checked the same way
      // -- refuse to SEND, say why in the same words -- so a person never meets a Save button that does
      // nothing and explains nothing.
      const questionProblemList = questionProblems(draft.questions)
      const problemText = [
        charsValid ? '' : 'Enter a whole number of characters, 1 or more.',
        ...questionProblemList,
        ...tableProblems(draft),
      ].filter(line => line !== '').join(' · ')
      const invalid = problemText !== ''
      const dirty = draft.callsEnabled !== current.callsEnabled
        || !sameEntries(draft.sessions, current.sessions)
        || draft.observeSubagents !== current.observeSubagents
        || draft.includeNonOperatorFacing !== current.includeNonOperatorFacing
        || draft.maxFieldChars !== current.maxFieldChars
        || !sameQuestions(draft.questions, current.questions)
        || !sameSeamEnabled(draft.seamEnabled, current.seamEnabled)
        // AND THE TABLE'S FIELDS, by the same rule the save uses: dirty and save can never disagree.
        || tableDirty(draft, current)
      // STRICT: a save needs a state that PERMITS writes AND a revision to fence them with, and both
      // must be true -- a missing `writable` is not a licence to write.
      const canSave = state !== undefined && state !== null
        && state.writable === true && state.revision !== undefined

      const edit = React.useCallback((field, next) => {
        setNotice('')
        setError('')
        setDraft((previous) => Object.assign({}, previous, { [field]: next }))
      }, [])
      const resetField = React.useCallback((field, next) => {
        setNotice('')
        setError('')
        setDraft((previous) => Object.assign({}, previous, { [field]: next }))
      }, [])
      // ONE SEAM'S SWITCH, staged into the whole map so the draft stays canonical and comparable.
      const toggleSeam = React.useCallback((seam, on) => {
        setNotice('')
        setError('')
        setDraft((previous) => Object.assign({}, previous, {
          seamEnabled: Object.assign({}, previous.seamEnabled, { [seam]: on }),
        }))
      }, [])
      const discard = React.useCallback(() => {
        setNotice('')
        setError('')
        setDraft(current)
      }, [current])
      const save = React.useCallback(async () => {
        if (source === undefined || state === undefined || !canSave) return
        if (invalid) { setError(problemText); return }
        // ONLY THE CHANGED FIELDS, as `set` ops against the path the host accepts.
        const ops = []
        // WRITTEN ONLY WHEN IT MOVES. An untouched switch must not write `true` into the profile, because
        // that would be the card claiming a setting nobody made -- and the field is off-by-absence-aware.
        if (draft.callsEnabled !== current.callsEnabled) {
          ops.push({ op: 'set', path: ['callsEnabled'], value: draft.callsEnabled })
        }
        // THE ENTRIES AS THE LIST SHOWS THEM: canonical `{ id }` / `{ id, title }`, never a typed string.
        if (!sameEntries(draft.sessions, current.sessions)) {
          ops.push({ op: 'set', path: ['sessions'], value: draft.sessions })
        }
        // THE SAME SHAPE AS `questions`, AND FOR THE SAME REASON: a volatile object at the root is written
        // whole, so all nine seams go in one op and an untouched one cannot be dropped by the projection.
        if (!sameSeamEnabled(draft.seamEnabled, current.seamEnabled)) {
          ops.push({ op: 'set', path: ['seamEnabled'], value: draft.seamEnabled })
        }
        if (draft.observeSubagents !== current.observeSubagents) {
          ops.push({ op: 'set', path: ['observeSubagents'], value: draft.observeSubagents })
        }
        if (draft.includeNonOperatorFacing !== current.includeNonOperatorFacing) {
          ops.push({ op: 'set', path: ['includeNonOperatorFacing'], value: draft.includeNonOperatorFacing })
        }
        if (draft.maxFieldChars !== current.maxFieldChars) {
          ops.push({ op: 'set', path: ['maxFieldChars'], value: parsedChars })
        }
        // THE WHOLE MAP, ALL NINE SEAMS, IN ONE OP. `questions` is a VOLATILE OBJECT at the root: the host
        // treats it as one editable node (`isVolatilePath` accepts every path beneath it, `strip` replaces
        // the subtree whole, and `projectForm` DROPS an undeclared key), so writing all nine is what keeps
        // an untouched seam from disappearing out of the stored config.
        if (!sameQuestions(draft.questions, current.questions)) {
          ops.push({ op: 'set', path: ['questions'], value: draft.questions })
        }
        // THE TABLE'S FIELDS, appended rather than enumerated: one list decides what may be written.
        ops.push(...tableOps(draft, current))
        if (ops.length === 0) { setNotice('No changes to save.'); return }
        setSaving(true)
        try {
          // THE SAME MUTATE ON BOTH SEATS: `ConfigPageForm.mutate` and `ConfigFormController.mutate`
          // have the same shape, and `revision` is optional to the controller, which falls back to its
          // own. A REFUSAL IS NOT A SUCCESS: resolving `false` is how a stale write is rejected, and
          // reporting that as saved is how it comes to look like it worked.
          const mutate = provided !== undefined ? provided.mutate : source.mutate
          if (await mutate.call(source, ops, state.revision)) {
            setNotice('Saved.')
            setError('')
          } else {
            setError('DSH refused the change; the form may be stale. Reload the page and try again.')
          }
        } catch {
          setError('DSH did not accept these settings.')
        } finally {
          setSaving(false)
        }
      }, [source, provided, state, canSave, invalid, problemText, draft, current, parsedChars])

      // THE SUMMARY VIEW, after every hook: one entry renders for both views.
      if (view === 'summary') {
        return h('span', null, 'Calls a System One model at chosen points of the agent loop and traces every call.')
      }

      const heading = h('h2', { style: styles.title }, 'System One observer')

      // STRICT, LIKE THE REFERENCE: when no state is available, or its status says it is not ready, a
      // STATUS LINE replaces the form. Never dead controls, and never controls that look usable but
      // cannot save. Every hook above has already run, so this early return costs nothing.
      const pageState = status === 'loading'
        ? h('p', { role: 'status', style: styles.note }, 'Loading settings\u2026')
        : (status === 'unavailable' || status === undefined)
          ? h('p', { role: 'note', style: styles.note }, 'Settings are unavailable while this component is not loaded.')
          : null

      // THE DIAGNOSTIC LINE IS GONE. It was scaffolding for the two defects that made this card dead and
      // then silent -- the namespace spelling and the pre-derived `writable: false` -- and both are now
      // covered by tests that assert the behaviour instead of a string a person had to read. `status`,
      // `writable` and `revision` are still what the card gates on; they are simply not printed any more.
      return h('div', { style: styles.wrap },
        heading,
        pageState !== null
          ? pageState
          : h(Form, {
            current, draft, canSave, dirty, invalid, saving, notice, error,
            problems: problemText,
            staleHost,
            onSave: () => { void save() },
            onDiscard: discard,
            onEdit: edit,
            onReset: resetField,
            onToggleSeam: toggleSeam,
          }),
      )
    }


    // ---------------------------------------------------------------------------------------------
    // THE TRACE CARD, in the conversation.
    //
    // WHY THIS SEAT AND NOT A NEW TAB. `tool.call.toolview` is keyed by TOOL NAME with an open key domain --
    // "Any name is allowed, including tools registered by your package. Register with `key: '<tool name>'`" --
    // so a package can own the card for its own tool, and the data is already in the browser: it arrives with
    // the tool result. A session-level TAB would need a host-to-browser channel of its own, and the only one
    // this harness offers a third-party plugin is `@deepseek-ai/dsh-typert-protocol`, an internal package
    // whose decorators are not part of a plugin's contract. The card needs no new dependency and no new
    // protocol, and it puts the trace where someone is already reading it: next to the call that produced it.
    //
    // THE DATA COMES FROM `block.meta`, which is `output.presentationMeta`'s projection, persisted on
    // `tool/result` for exactly this purpose. When it is absent -- a nested call, or a host that predates the
    // projection -- the card falls back to the model-facing text rather than rendering an empty shell.
    // ---------------------------------------------------------------------------------------------
    function chipsOf(data) {
      const counts = data.counts ?? {}
      const chips = [
        { key: 'calls', label: `${counts.call ?? 0} calls` },
        { key: 'skips', label: `${counts.skip ?? 0} skips` },
      ]
      if ((counts.error ?? 0) > 0) chips.push({ key: 'errors', label: `${counts.error} errors`, off: true })
      if (data.latency !== null && data.latency !== undefined) {
        chips.push({ key: 'latency', label: `${data.latency.min}-${data.latency.max}ms` })
      }
      return chips.map(chip => h('span', { key: chip.key, style: chip.off === true ? styles.chipOff : styles.chip }, chip.label))
    }

    /** One line that says what the row is asked to do, from the mount line -- the same fields the tool prints. */
    function scopeStrip(mount) {
      if (mount === null || mount === undefined) return null
      const sessions = Array.isArray(mount.sessions) ? mount.sessions : null
      const seamsOff = Array.isArray(mount.seamsOff) ? mount.seamsOff : null
      return h('div', { style: styles.strip },
        h('span', null,
          h('strong', null, 'scope at mount: '),
          mount.callsEnabled === false ? 'calls OFF' : 'calls on',
          seamsOff === null ? '' : ` · seams off ${seamsOff.length === 0 ? 'none' : seamsOff.join(', ')}`,
        ),
        h('span', { style: styles.dim },
          sessions === null
            ? 'sessions: (not recorded by this host)'
            : `sessions: ${sessions.length === 0 ? 'NONE — observes nothing' : sessions.join(', ')}`),
      )
    }

    function tallyPanel(title, entries, empty) {
      const list = Array.isArray(entries) ? entries : []
      return h('div', { style: styles.panel },
        h('span', { style: styles.panelHead }, title),
        list.length === 0
          ? h('span', { style: styles.dim }, empty)
          : list.slice(0, 8).map(entry => h('span', { key: entry.key, style: styles.kv },
            h('span', { style: styles.mono }, entry.key),
            h('span', { style: styles.dim }, String(entry.count)))),
      )
    }

    /**
     * One labelled proportion bar.
     *
     * A BAR RATHER THAN A NUMBER because the distribution's shape is the thing a person is judging, and `p=0.4`
     * has to be read while a filled track is seen. Accessible as a `progressbar` with the value on it, so the
     * same information survives without sight of the bar.
     */
    function barRow(key, label, fraction, options = {}) {
      const value = typeof fraction === 'number' && Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0
      const percent = Math.round(value * 100)
      return h('div', { key, style: styles.barRow },
        h('span', { style: Object.assign({}, styles.barLabel, options.emphasis === true ? { color: 'var(--dsw-alias-label-primary)', fontWeight: 500 } : {}) }, label),
        h('span', {
          role: 'progressbar', 'aria-label': `${label}: ${percent}%`,
          'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': percent, style: styles.barTrack,
        }, h('div', { style: { height: '100%', borderRadius: '999px', width: `${percent}%`, background: options.tone ?? 'var(--dsw-alias-brand-primary)' } })),
        h('span', { style: styles.barReadout }, options.readout ?? `${percent}%`),
      )
    }

    /** The bars for one answer, capped so a ten-option distribution cannot triple the height of sixty rows. */
    const ANSWER_BARS = 4

    /** The answer, as the card shows it: the chosen label, and its distribution as bars. */
    function answerLine(row) {
      const answers = Array.isArray(row.answers) ? row.answers : []
      if (answers.length === 0) return row.excerpt ?? ''
      return answers.map((answer, index) => {
        const label = answer.label ?? '(no label)'
        const confidence = typeof answer.confidence === 'number' ? ` p=${answer.confidence}` : ''
        const head = h('div', { key: `head-${index}`, style: styles.barsHead },
          h('span', { style: Object.assign({}, styles.mono, { fontSize: '11px' }) }, `${answer.id} = ${label}${confidence}`),
          answer.answerConfidence === null || answer.answerConfidence === undefined || answer.answerConfidence === answer.confidence
            ? null
            : h('span', { style: styles.barNote }, `answer_confidence ${answer.answerConfidence}`),
        )
        const entries = answer.probabilities === null || answer.probabilities === undefined
          ? []
          : Object.entries(answer.probabilities).filter(([, p]) => typeof p === 'number').sort((a, b) => b[1] - a[1])
        // A RECORDED DEFECT IS SHOWN, not buried: an answer that is readable and wrong is the most interesting
        // thing a judge can send back, and the answer is kept rather than discarded.
        const defect = answer.invalid === true
          ? h('div', { key: `bad-${index}`, style: Object.assign({}, styles.barNote, { color: 'var(--dsw-alias-state-error-primary)' }) }, `invalid: ${answer.invalidReason ?? 'recorded as invalid'}`)
          : null
        const shown = entries.slice(0, ANSWER_BARS).map(([option, p]) =>
          barRow(`${index}-${option}`, option, p, {
            // The chosen option is filled in the brand colour and the rest in the success colour, so "which one it
            // picked" is visible without reading the label twice.
            tone: option === answer.label ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-state-success-primary)',
            emphasis: option === answer.label,
          }))
        const rest = entries.length > ANSWER_BARS
          ? h('span', { key: `rest-${index}`, style: styles.barNote }, `+${entries.length - ANSWER_BARS} more option(s)`)
          : null
        return h('div', { key: `answer-${index}`, style: styles.barStack }, head, defect, ...shown, rest)
      })
    }

    /**
     * The runs side by side, with the VERDICT FIRST.
     *
     * Two lanes of numbers look comparable, and only the verdict says whether they are. So the note is the
     * headline and the lanes are beneath it -- a reader who takes in one line learns whether they are allowed to
     * read the rest together.
     */
    function comparePanel(compare) {
      if (compare === null || compare === undefined || (compare.lanes ?? []).length < 2) return null
      const tone = compare.verdict?.reason === 'same'
        ? 'var(--dsw-alias-state-success-primary)'
        : (compare.verdict?.reason === 'no-task-key' ? 'var(--dsw-alias-state-warn-primary)' : 'var(--dsw-alias-state-error-primary)')
      return h('div', { style: styles.panel },
        h('span', { style: styles.panelHead }, 'runs side by side'),
        h('span', { style: Object.assign({}, styles.barNote, { color: tone }) }, compare.note),
        h('div', { style: styles.barStack },
          ...compare.lanes.map(lane => h('div', { key: lane.id, style: styles.kv },
            h('span', { style: Object.assign({}, styles.mono, { fontSize: '11px' }) }, lane.id),
            h('span', { style: styles.barNote },
              `${lane.calls} calls · ${lane.errors} errors · ${lane.skips} skips · ${(lane.msSum / 1000).toFixed(1)}s`),
          ))),
        compare.selected < compare.total
          ? h('span', { style: styles.barNote }, `the newest ${compare.selected} of ${compare.total} runs in this window`)
          : null,
      )
    }

    /**
     * The probe's own measurement, as bars.
     *
     * THE ACCURACY IS DRAWN AGAINST ITS FLOOR, because a bare 88.99% invites comparison with "1 in 9" and the
     * honest comparison is the majority-class floor: the two bars side by side are the whole argument, and they
     * are why the floor is computed at all. Then the reliability bins, where the bar is WHAT IT SAID and the
     * number is WHAT ACTUALLY HAPPENED -- the two disagree in a direction, and seeing 64.3% against 83.8% is the
     * only way to know the model is under-confident rather than over-.
     */
    function probePanel(probe) {
      if (probe === null || probe === undefined || probe.scored === 0) return null
      const pct = value => value === null || value === undefined ? 'n/a' : `${(value * 100).toFixed(2)}%`
      const headline = probe.calibration?.scalars?.find(entry => entry.scalar === 'probabilities[chosen]')
      const bins = headline?.bins ?? []
      return h('div', { style: styles.panel },
        h('span', { style: styles.panelHead }, 'the probe, scored'),
        h('div', { style: styles.kv },
          h('span', null, 'accuracy vs the majority-class floor'),
          h('span', { style: styles.dim }, `${probe.scored} scored · ${probe.unreadable} unreadable · kappa ${probe.kappa === null ? 'n/a' : probe.kappa.toFixed(4)}`),
        ),
        barRow('acc', 'accuracy', probe.accuracy),
        barRow('floor', `always "${probe.majority.label ?? '?'}"`, probe.majority.floor, { tone: 'var(--dsw-alias-state-idle-primary)' }),
        h('div', { style: styles.barStack },
          ...probe.byTier.filter(tier => tier.n > 0).map(tier => barRow(`tier-${tier.tier}`, tier.tier,
            tier.reported ? tier.accuracy : 0,
            { readout: tier.reported ? `${(tier.accuracy * 100).toFixed(1)}%` : `n=${tier.n} (thin)`,
              tone: tier.tier === 'full' ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-warn-primary)' }))),
        h('span', { style: styles.barNote }, 'by tier: bar is the accuracy, the count is how many calls it rests on'),
        headline === undefined || headline === null ? null : h('div', { style: styles.kv },
          h('span', null, 'reliability (bar = what it said)'),
          h('span', { style: styles.dim }, `ECE ${headline.ece?.toFixed(4)} · bias ${headline.bias?.toFixed(4)} (${headline.bias < 0 ? 'UNDER' : 'OVER'}-confident) · bins cover ${(headline.eceWeight * 100).toFixed(0)}%`),
        ),
        h('div', { style: styles.barStack },
          ...bins.map(bin => barRow(`bin-${bin.low}`, `${bin.low.toFixed(1)}-${bin.high.toFixed(1)}`, bin.meanP,
            { readout: `${(bin.meanY * 100).toFixed(0)}%`, tone: bin.gap < 0 ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-state-warn-primary)' }))),
        bins.length === 0 ? null : h('span', { style: styles.barNote }, 'the number is what actually happened. Every bar where it is larger means the model claimed less than it delivered.'),
      )
    }

    function eventRow(row, index) {
      const detail = row.event === 'call'
        ? answerLine(row)
        : (row.reason ?? row.error ?? '')
      const style = row.event === 'call'
        ? Object.assign({}, styles.traceRow, styles.traceCall)
        : (row.event === 'error' ? Object.assign({}, styles.traceRow, styles.traceError) : styles.traceRow)
      return h('div', { key: `${row.at}-${index}`, style },
        h('span', { style: styles.dim }, row.clock),
        h('span', { style: row.event === 'call' ? undefined : styles.dim }, row.event),
        h('span', { style: styles.mono }, [row.hook ?? '', row.session === null ? '' : ` ${row.session}`].join('')),
        h('span', { style: row.event === 'call' ? undefined : styles.answer },
          row.event === 'call' && typeof row.ms === 'number'
            ? h('span', { style: Object.assign({}, styles.dim, { fontSize: '11px' }) }, `${row.ms}ms `)
            : null,
          ...(Array.isArray(detail) ? detail : [detail])),
      )
    }

    /**
     * THE SEAT'S CONTRACT WITH THE PAGE IS ALL-OR-NOTHING: a keyed `tool.call.toolview` entry REPLACES the
     * generic card, and its `fallback` is used only when NO entry claims the key. So a component that throws
     * does not degrade to the generic row -- it takes the row down with it, and the observable symptom is a
     * tool call with NO row at all. That is a failure mode nothing in this project would accept anywhere else,
     * so the card catches its own errors and says so on screen.
     */
    function TraceCard(props) {
      try {
        return traceCardBody(props)
      } catch (error) {
        const message = error !== null && error !== undefined && typeof error.message === 'string' ? error.message : String(error)
        return h('div', { style: styles.card },
          h('span', { style: styles.chipOff }, 'System One trace card failed: ' + message),
          h('span', { style: styles.dim }, 'The tool call itself succeeded — this is the card, not the reader.'),
        )
      }
    }

    function traceCardBody(props) {
      const { phase, block } = props
      if (phase !== 'result') {
        return h('div', { style: styles.card }, h('span', { style: styles.dim }, 'Reading the System One observer trace…'))
      }
      const data = block !== null && block !== undefined && block.meta !== null && typeof block.meta === 'object'
        ? block.meta
        : null
      if (data === null) {
        // A HOST THAT PREDATES THE PROJECTION still gets a readable card rather than an empty one: the text the
        // model saw is the same report, so it is shown as it is.
        const content = Array.isArray(block?.content) ? block.content : []
        const text = content.filter(part => part?.type === 'text' && typeof part.text === 'string')
          .map(part => part.text).join('\n')
        return h('div', { style: styles.card },
          h('span', { style: styles.dim }, 'The observer trace (no structured projection from this host):'),
          h('pre', { style: Object.assign({}, styles.mono, { margin: 0, whiteSpace: 'pre-wrap', maxHeight: '420px', overflow: 'auto' }) }, text),
        )
      }
      return renderTraceData(data)
    }

    /**
     * THE TRACE, DRAWN. Shared by the conversation card and the Observer tab, so the two cannot disagree about
     * what happened -- and the tab is the same renderer over a different source.
     */
    function renderTraceData(data) {
      const runLabel = data.unknownRun === true ? `no run matching "${data.hook ?? ''}"` : (data.run ?? '(no run)')
      return h('div', { style: styles.card },
        h('div', { style: styles.cardHead },
          h('h4', { style: styles.cardTitle }, 'System One trace'),
          h('span', { style: Object.assign({}, styles.mono, styles.dim) }, runLabel ?? ''),
          data.hook === null || data.hook === undefined ? null : h('span', { style: styles.chip }, `seam ${data.hook}`),
          data.window?.truncated === true ? h('span', { style: styles.chipOff }, 'file truncated to the last window') : null,
        ),
        h('div', { style: styles.chips }, chipsOf(data)),
        scopeStrip(Array.isArray(data.mounts) && data.mounts.length > 0 ? data.mounts[data.mounts.length - 1] : null),
        data.unknownRun === true
          ? h('div', { style: styles.strip }, h('span', null, 'Runs in this file: '), h('span', { style: styles.mono }, (data.runs ?? []).join(', ')))
          : null,
        h('div', { style: styles.grid },
          tallyPanel('calls by seam', data.seams, 'none'),
          tallyPanel('skips by reason', data.reasons, 'none'),
          tallyPanel('subject model', data.subjects, 'not recorded'),
          tallyPanel('graded by', data.models, 'none'),
        ),
        Array.isArray(data.liveAgents) && data.liveAgents.length > 0
          ? h('div', { style: styles.strip }, h('span', null, h('strong', null, 'sessions live now: '), data.liveAgents.join(', ')))
          : null,
        comparePanel(data.compare),
        probePanel(data.probe),
        h('div', { style: styles.traceRows },
          (data.listed ?? []).map((row, index) => eventRow(row, index)),
        ),
        h('span', { style: styles.dim },
          `showing the last ${(data.listed ?? []).length} of ${data.listedOf ?? 0} events · trace ${data.path ?? ''}`),
      )
    }


    return {
      inject: ['slots', 'configForms'],
      apply(ctx) {
        const services = { configForms: ctx.configForms }
        const wrap = (props) => h(Card, Object.assign({}, props, { services }))
        // WARM THE MIRROR. The menu seat resolves the namespace without a subscription, so it needs the
        // namespace list to have been fetched at least once; doing it here means the ⋯ menu works even if the
        // Plugins page was never opened in this tab.
        ctx.effect(() => { void ctx.configForms.describe().ensure() })
        // `slots.inject(ownerKey, ...)` keeps each registration alive across the slot's own
        // re-declaration, which matters because the Plugins page declares its slots at runtime.
        ctx.effect(() => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register(
          { name: 'plugins.bundle.config', key: PACKAGE },
          wrap,
        )))
        ctx.effect(() => ctx.slots.inject('plugins.row.config', () => ctx.slots.register(
          // The ROW page is keyed `<package name>#<row id>`, with the row id as the patch declares it.
          // This is the seat that gives the row in the Components list a configure control.
          { name: 'plugins.row.config', key: PACKAGE + '#' + ROW_ID },
          wrap,
        )))
        // THE THIRD SEAT: one row in a session's "..." menu, which is how a session gets targeted without
        // anyone typing a uuid. `id` is package-namespaced, as the seat's catalog requires -- reusing a
        // shipped id would SHADOW that row rather than sit beside it.
        ctx.effect(() => ctx.slots.inject('sidebar.workspaces.session.menu.item', () => ctx.slots.register(
          { name: 'sidebar.workspaces.session.menu.item', id: OBSERVE_MENU_ID, order: OBSERVE_MENU_ORDER },
          (props) => h(ObserveMenuItem, Object.assign({}, props, { services })),
        )))
        // THE FOURTH SEAT: the card for our own tool, in the conversation. The key is the WIRE TOOL NAME, and
        // the seat's catalog is explicit that a name registered by this package is allowed and that "a typo
        // never renders" -- so this constant is the one thing here that must match `lib/tool.js` exactly.
        ctx.effect(() => ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
          { name: 'tool.call.toolview', key: TRACE_TOOL_NAME },
          TraceCard,
        )))
      },
    }
  },
})
