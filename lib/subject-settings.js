// THE ROW'S OWN SETTINGS, as the session reader needs them -- OUR configuration, not the harness's.
//
// WHY IT IS NOT IN THE ADAPTER PACKAGE: every other line of the subject reader is about the HARNESS's shapes (which
// event types are the two voices, how a window slices, what a slice covers), and the package must not depend on this
// plugin's config reader. This function is the one part that reads the row, so it stays here and imports the
// vocabulary it fills in.
import { DEFAULT_KINDS } from 'dsh-session-adapter/reader'
import { readConfigValue } from './config-value.js'

/** The row's own settings, as the reader needs them. Read live, like every other setting in this plugin. */
export function subjectSettings(config) {
  const source = readConfigValue(config?.subjectSource)
  const sessionId = readConfigValue(config?.subjectSession)
  const kinds = readConfigValue(config?.subjectKinds)
  const last = readConfigValue(config?.subjectLastMessages)
  return {
    source: source === 'stored' ? 'stored' : 'live',
    sessionId: typeof sessionId === 'string' ? sessionId : '',
    kinds: Array.isArray(kinds) && kinds.length > 0 ? kinds : [...DEFAULT_KINDS],
    lastMessages: Number.isInteger(last) && last > 0 ? last : 0,
  }
}
