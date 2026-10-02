// REDACTION, ON THE TRACE'S COPY ONLY.
//
// THE DESIGN DECISION THAT MATTERS IS NOT THE ALGORITHM, IT IS WHICH OBJECT IS REDACTED. `state` is the
// decision model's INPUT; `excerpt` is the EVIDENCE. They were the same object, so the obvious fix -- redact
// before the call -- would have the model classify `[REDACTED]`, and the measurement would become a measurement
// of this scrubber. The model's copy stays RAW and only the record's copy is redacted. `lib/observe.js` builds
// the two from one source, and the test that pins it asserts the request handed to `decide` CONTAINS the secret
// while the recorded line does not.
//
// WHAT THIS CAN AND CANNOT DO, stated here rather than implied by a passing test. Pattern matching cannot close
// this. Verified to match none of the shipped rules: an AWS *secret* access key (only the paired `AKIA…` id is
// caught, not the 40-character body), a GitLab `glpat-`, a Slack `xoxb-`, a Stripe `rk_live_`, a bare 40-hex
// token, a private-key body pasted without its `-----BEGIN`/`-----END` wrapper, a secret in the KEY position
// (the walk never pattern-scans keys), and ordinary prose -- "the password is hunter2" has no `:`, no `=` and no
// prefix. Treat the trace file as sensitive: it is mode 600 and it rotates, and it is not a redacted artifact.
import { isRecord } from './is-record.js'
import { readConfigValue } from './config-value.js'
/** The one placeholder. Upstream ships two; one is enough, and a second is a second thing to grep for. */
export const REDACTED = '[REDACTED]'
/**
 * The key denylist: six names.
 *
 * `apiKey` is NOT a seventh entry -- it is caught by the tokenizer, which splits it into `api` + `key`. The
 * upstream README claims seven and the upstream code has six; this copies the code.
 */
export const ALWAYS_REDACT_KEYS = Object.freeze(['key', 'token', 'secret', 'password', 'authorization', 'credential'])// NOT WIDENED WITH `pw`: this is the faithful port of upstream's six, and `test/redact.test.js` counts them
// for that reason. A deployment that wants `pw` as a KEY adds it through `redactKeys`; the SHAPE lists above are
// this repository's own and were widened.
/**
 * How much of an ABSOLUTE PATH the record keeps: `full`, `basename` or `omit`.
 *
 * THE REFERENCE DEFAULTS TO `omit` AND THIS ONE DOES NOT, and the reason is the audience. A telemetry exporter
 * ships its records OFF THE MACHINE, so exporting less is free. This trace is local evidence whose whole purpose
 * is that a wrong judgement is diagnosable -- "the judge called `/home/…/private/config.yml` model_output" is the
 * diagnosis -- and 2,455 of 4,369 call lines on this deployment carry a path like that. So the switch exists and
 * the default preserves the evidence; a deployment that SHARES its trace sets it, and the README says so.
 *
 * It applies to the RECORD only. The decision model keeps the raw text, because a judge asked about `[PATH]` is
 * a judge measuring this scrubber -- the same rule that governs the rest of this module.
 */
export const PATH_MODES = Object.freeze(['full', 'basename', 'omit'])
/**
 * An absolute path: `/…`, a drive path `C:/…` or `C:\…`, or `~/…` / `$HOME/…`.
 *
 * NOT ANCHORED ON A ROOT LIST ANY MORE, and both reviewers are why. Anchoring on thirteen roots left real paths
 * untouched under `basename` and `omit` -- `/data/…`, `/workspace/…`, `/nix/store/…`, `/snap/…`, `/System/…`,
 * `/Volumes/…`, `~/private/x`, `$HOME/private/x` -- which is a leak in the one mode whose whole purpose is to
 * stop leaking. A URL is excluded structurally instead: the path must begin with a SINGLE slash (`(?!\/)`), so
 * `https://host/a/b` cannot match, while the leading `:` that a URL puts before `//` is still allowed as a lead
 * character for `path:/…`.
 *
 * THE CONTINUATION CLASS NOW STOPS AT `:?{}|<>#`, which fixes a corruption the same review found: `x:5` (a line
 * number), `?q=1` (a query) and `{a,b}` (a brace) were being swallowed into the path token, so a compiler error
 * like `error at /home/john/x:5` reduced to `x:5` -- a filename that never existed, with the line number glued to
 * it.
 */
const ABSOLUTE_PATH = /(^|[\s"'=(:\[,])((?:[A-Za-z]:[\\/]|~[\\/]|\$HOME[\\/]|\/(?!\/))[^\s"')\],;:?{}|<>#]+)/gu

/** The last segment of a path, whichever separator it uses. */
export function basenameOf(path) {
    const text = typeof path === 'string' ? path.replace(/[\\/]+$/u, '') : ''
    const cut = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'))
    return cut === -1 ? text : text.slice(cut + 1)
}

/**
 * Reduce every absolute path in one string according to the mode. `full` returns it untouched.
 *
 * Applied to the record's copy BEFORE the cut, so a truncated path cannot leave a half-redacted prefix behind.
 */
export function minimisePaths(value, mode = 'full') {
    if (typeof value !== 'string' || value === '' || mode === 'full' || !PATH_MODES.includes(mode)) return value
    return value.replace(ABSOLUTE_PATH, (match, lead, path) => `${lead}${mode === 'omit' ? '[PATH]' : basenameOf(path)}`)
}

/** Depth cap for the JSON walk. Deeper than any real tool argument, shallow enough to bound the recursion. */
export const MAX_DEPTH = 32
/**
 * How many characters of the END a truncation always keeps.
 *
 * HEAD-ONLY TRUNCATION BREAKS TAIL DETECTION, and the tail is where a tool's failure marker lives: a wrapper
 * appends its stderr section last, so the exit code and the error text hug the end, while a dump that *quotes*
 * another log leaves its markers in the middle where neither window reaches. Measured on this deployment's own
 * trace, truncation hits `post_execute` 221/1,573 (14%) and `result` 47/135 (35%) -- and on every one of those
 * the old head-only cut put the "tail" window at characters 19,000-20,000 of the HEAD, so a tail rule silently
 * degraded to a head-only rule on precisely the long outputs it exists for.
 */
export const TAIL_CHARS = 1000
/**
 * Keep the head AND the tail, in exactly `max` characters. The one cut in this repository, so the model's copy
 * and the record's copy cannot drift apart: a reader comparing them should never be comparing two conventions.
 *
 * A budget too small to hold a meaningful tail falls back to head-only, because a tail window of three
 * characters would drop more evidence than it saves.
 */
export function cutHeadTail(value, max) {
    if (typeof value !== 'string' || value.length <= max) return { text: value, cut: false }
    if (max <= TAIL_CHARS + 1) return { text: value.slice(0, max), cut: true }
    return { text: `${value.slice(0, max - TAIL_CHARS - 1)}\u2026${value.slice(-TAIL_CHARS)}`, cut: true }
}
/**
 * The six shipped credential SHAPES, ported verbatim, each replaced wholesale.
 *
 * They run over any string, whatever its structure, because tool arguments and results are mostly prose and
 * logs where a key rule does nothing.
 */
const SHAPE_PATTERNS = Object.freeze([
    /\bsk-[A-Za-z0-9]{16,}\b/gu,
    /\bghp_[A-Za-z0-9]{20,}\b/gu,
    /\bgho_[A-Za-z0-9]{20,}\b/gu,
    /\bAKIA[0-9A-Z]{16}\b/gu,
    /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gu,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[A-Za-z0-9+/=\s]*-----END [A-Z ]*PRIVATE KEY-----/gu,
])
/**
 * The two patterns upstream does not have, both added for leaks measured elsewhere in this repository.
 *
 * The JWT is simply absent upstream, and a raw one in a tool result is realistic. `Basic` is the measured hole
 * NEITHER upstream closes: `Authorization: Basic <base64>` is the single most likely tool-argument leak, and
 * both repos half-cover it -- the bare-header rule's value class stops at the first space and consumes only the
 * word `Basic`, while the Bearer rule does not match `Basic` at all. The base64 credential survives both.
 */
const ADDED_PATTERNS = Object.freeze([
    [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/gu, REDACTED],
    // Whole-match, like the Bearer rule above: both replace the scheme word too, so an `Authorization:` line
    // reads the same way whichever scheme it carried. The header rules below are the ones that keep the name.
    [/\bBasic\s+[A-Za-z0-9+/=_-]{4,}/giu, REDACTED],
])
/**
 * The credential NAMES that appear as `name: value` or `name=value` in headers, environment dumps and URLs.
 *
 * The upstream value class is `[^\s,;)\]}]+` with NO length floor, so `Authorization: Bearer abc123xyz`
 * redacts only the word `Bearer` and leaves the token behind it. The floor below is what makes this rule reach
 * the credential instead of the scheme.
 */
const CREDENTIAL_NAME = 'access[_-]?token|api[_-]?key|apikey|auth(?:orization)?|client[_-]?secret|key|passw(?:or)?d|passwd|pwd|pword|pw|secret|sig(?:nature)?|token' // `pw` and `pword` are safe HERE because both uses below anchor on a word boundary, so `upward` is not a match
/** `name: "value"` FIRST: the bare form would otherwise consume the opening quote and leave the value. */
const HEADER_QUOTED = new RegExp(`(\\b(?:${CREDENTIAL_NAME})\\s*[:=]\\s*)(["'])[^"']*\\2`, 'giu')
/**
 * `name: value`, with NO length floor and a scheme-word guard instead.
 *
 * THE FLOOR WAS `{8,}` AND IT LEAKED. Measured: `api_key: 2f8a9c` and `password: abcde` were left in the record
 * while the SAME value quoted -- `api_key: "s"` -- was redacted by the rule above, which has no floor, and while
 * `MY_API_KEY=abc` was redacted by the environment rule, which has none either. One form with a floor and two
 * without is not a risk decision, it is an inconsistency, and it was invisible because every redaction test
 * asserted that a `[REDACTED]` token APPEARED -- all twelve of them, each using a long, obviously-token-like
 * value. Found by asking the opposite question: which tests assert the secret is GONE. Three of thirteen
 * credential shapes leaked.
 *
 * The guard replaces the floor. A value that is only a scheme word is left to the Bearer/Basic patterns, which
 * replace the whole `scheme value` pair; without the guard, dropping the floor would redact the word `Digest` and
 * leave the credential behind it -- the exact upstream defect the comment above describes.
 */
const SCHEME_WORD = '(?!(?:Bearer|Basic|Digest|Negotiate)\\b)'
/**
 * And the values that are explicitly NOT credentials.
 *
 * Dropping the floor has a cost, and this is the part of it worth paying down: `token: none`, `key: null` and
 * `password: undefined` are how logs and config dumps say "there is no secret here", and redacting them mangles
 * ordinary diagnostic prose for no gain. A short LIST rather than a length, because the measurement above shows
 * there is no length that separates `abcde` (a real value) from `answer` (a word) -- 5 and 6 characters
 * respectively. Anything not on this list is redacted, so the failure mode stays the safe one.
 */
const NOT_A_SECRET = '(?!(?:none|null|nil|true|false|undefined|unknown|empty|n\\/a|\\?{1,3}|-{1,3})(?:\\b|$))'
const HEADER_BARE = new RegExp(`(\\b(?:${CREDENTIAL_NAME})\\s*[:=]\\s*)${SCHEME_WORD}${NOT_A_SECRET}[A-Za-z0-9._~+/=_-]+`, 'giu')
/** `NAME=value` for an environment-style name that says what it is. */
const ENV_ASSIGNMENT = /(\b[A-Za-z0-9_]*(?:TOKEN|API[_-]?KEY|SECRET|PASSWORD|PASSWD|PWORD|PW)[A-Za-z0-9_]*\s*=\s*)[^\s,;)\]}]+/gu
/** `?name=value` / `&name=value`, decided by the SAME key rule the JSON walk uses. See `redactUrlCredentials`. */
const URL_PARAMETER = /([?&])([A-Za-z0-9_.-]+)=([^&#\s]*)/gu
/**
 * A key, split into the words a person would read it as: `apiKey` → `['api','key']`, `API-KEY` → `['api','key']`.
 */
export function tokenizeKey(key) {
    return key
        .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
        .split(/[^a-zA-Z0-9]+/u)
        .map((token) => token.toLowerCase())
        .filter((token) => token.length > 0)
}
/**
 * Whether a key NAMES a secret.
 *
 * TOKENIZED, NOT SUBSTRING-MATCHED, and that is a deliberate departure. Upstream also redacts any key whose
 * lowercase form CONTAINS one of the six names, which was measured to redact `monkey`, `keyboard` and `turkey`,
 * while the tokenizer alone already catches `apiKey`, `api_key` and `API-KEY`. The substring clause buys almost
 * nothing and costs false positives on ordinary field names.
 */
export function isRedactedKey(key, policy) {
    if (policy === undefined || policy.enabled === false) return false
    const extra = Array.isArray(policy.redactKeys) ? policy.redactKeys : []
    const names = [...ALWAYS_REDACT_KEYS, ...extra]
    return tokenizeKey(key).some((token) => names.includes(token))
}
/**
 * The policy the rest of this module reads.
 *
 * DEFAULT ON, and that is the whole point of a default: a record that leaks because nobody set a switch is the
 * failure this module exists to prevent. The switch is there to be turned off deliberately.
 */
export function redactPolicy(config) {
    const enabled = readConfigValue(config?.redactEnabled)
    const keys = readConfigValue(config?.redactKeys)
    const mode = readConfigValue(config?.pathMode)
    return {
        enabled: enabled === false ? false : true,
        redactKeys: Array.isArray(keys) ? keys.filter((key) => typeof key === 'string' && key !== '') : [],
        // `full` unless asked otherwise: see `PATH_MODES` for why this default is not the reference's.
        pathMode: PATH_MODES.includes(mode) ? mode : 'full',
    }
}
/** Every credential-shaped run in one string. */
export function redactText(value, policy) {
    if (typeof value !== 'string' || value === '') return value
    if (policy === undefined || policy.enabled === false) return value
    let text = value
    for (const pattern of SHAPE_PATTERNS) text = text.replace(pattern, REDACTED)
    for (const [pattern, replacement] of ADDED_PATTERNS) text = text.replace(pattern, replacement)
    // The quoted form first, then the environment form, then the bare form. Each keeps the NAME, so a reader can
    // still see which field was scrubbed -- "keys only, never values" applied to text.
    text = text.replace(HEADER_QUOTED, `$1$2${REDACTED}$2`)
    text = text.replace(ENV_ASSIGNMENT, `$1${REDACTED}`)
    text = text.replace(HEADER_BARE, `$1${REDACTED}`)
    return redactUrlCredentials(text, policy)
}
/**
 * `?token=SECRET` and `&access_token=SECRET`.
 *
 * Decided by `isRedactedKey`, not by a regex over credential words, and that is the narrowest rule available.
 * Upstream's query pattern matches the credential name as a SUBSTRING, which was measured to redact
 * `?design=modern` (inside `sig(?:nature)?`) and `?monkey=1` (inside `key`). Asking the same key rule the JSON
 * walk uses cannot make either mistake and still catches every name the tokenizer recognises.
 */
export function redactUrlCredentials(text, policy) {
    if (typeof text !== 'string' || !text.includes('=')) return text
    return text.replace(URL_PARAMETER, (match, separator, name, value) =>
        value === '' || !isRedactedKey(name, policy) ? match : `${separator}${name}=${REDACTED}`)
}
/** Whatever a `Date`, `Map` or class instance is, it is not a value this record can carry honestly. */
function isPlainObject(value) {
    if (!isRecord(value)) return false
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
}
/**
 * The JSON walk, with the two guards upstream does not have.
 *
 * A CYCLE IS AN OBSERVATION-LOSS BUG, NOT A REDACTION BUG. Upstream's version stack-overflows
 * (`RangeError: Maximum call stack size exceeded`, measured), and this repository's sink turns a throwing field
 * thunk into `fields_unavailable` -- so a cyclic argument would lose the whole observation rather than just the
 * secret. The guard returns a marker instead, and the depth cap bounds the recursion.
 */
export function sanitizeJson(value, policy, seen = new WeakSet(), depth = 0) {
    if (typeof value === 'string') return redactText(value, policy)
    if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value
    if (value === undefined) return null
    if (typeof value !== 'object') return null
    if (depth > MAX_DEPTH) return '[too deep]'
    if (seen.has(value)) return '[circular]'
    if (!Array.isArray(value) && !isPlainObject(value)) return '[non-plain]'
    seen.add(value)
    const out = Array.isArray(value)
        ? value.map((item) => sanitizeJson(item, policy, seen, depth + 1))
        // AN UNDEFINED MEMBER IS DROPPED, NOT WRITTEN AS `null`. `JSON.stringify` already omits undefined properties,
        // so the walk was the only thing turning "this field was absent" into "this field is null" -- and a record
        // whose nulls mean two different things cannot be read by anyone asking which fields were present. The
        // redaction marker stays a string, so the two remain distinguishable in the file.
        : Object.fromEntries(Object.entries(value)
            .filter(([, child]) => child !== undefined)
            .map(([key, child]) => [
                key,
                isRedactedKey(key, policy) ? REDACTED : sanitizeJson(child, policy, seen, depth + 1),
            ]))
    seen.delete(value)
    return out
}
/**
 * One field of the record: redact, THEN cut. The order is load-bearing, not style.
 *
 * The PEM rule is anchored on both markers, so cutting first makes a truncated block match nothing and writes
 * the base64 body verbatim. `sk-`/`ghp_`/`gho_`/`AKIA` all require minimum lengths, so a cut landing inside one
 * leaves a prefix that matches nothing and persists the partial token.
 *
 * THE CUT CONVENTION IS THIS REPOSITORY'S: exactly `max` characters and `cut: true`. Upstream counts its ellipsis
 * inside the budget, and mixing the two would silently change what `truncated` means on a line.
 */
export function sanitizeField(value, max, policy) {
    const text = typeof value === 'string' ? value : String(value ?? '')
    // REDACT, THEN MINIMISE, THEN CUT. All three before the cut for the same reason: a cut landing inside a
    // credential or a path leaves a fragment that matches nothing and is written verbatim.
    const safe = minimisePaths(sanitizeToolText(text, policy), policy?.pathMode)
    return cutHeadTail(safe, max ?? Number.POSITIVE_INFINITY)
}
/**
 * Tool arguments arrive as `name {json}` -- one string, built by the seam extractor.
 *
 * THE TRAP THIS AVOIDS. Upstream's `sanitizeJsonText` applies STRUCTURAL key redaction only when the whole
 * string parses as JSON, and falls back to regexes when it does not. `bash {"api_key":"…"}` does not parse, so
 * that function would skip key redaction on precisely the field with the highest exposure. Detecting the shape
 * and sanitizing the TAIL is what keeps it.
 */
export function sanitizeToolText(value, policy) {
    if (typeof value !== 'string' || value === '') return value
    if (policy === undefined || policy.enabled === false) return value
    const match = /^(\S+)\s+(\{[\s\S]*\}|\[[\s\S]*\])$/u.exec(value)
    if (match !== null) {
        try {
            return `${match[1]} ${JSON.stringify(sanitizeJson(JSON.parse(match[2]), policy))}`
        }
        catch {
            // Balanced braces in prose, not JSON. The text rules below still apply.
        }
    }
    return redactText(value, policy)
}
