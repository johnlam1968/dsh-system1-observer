// THE INDEPENDENT LABEL FOR `operator_had_to_nudge`.
//
// WHY IT MATTERS MORE THAN THE QUESTION. ROADMAP §9.5/§11.3: every question in the set depends on the judge being
// right about its own call, EXCEPT this one, because the operator's next message is in the record. So this label is
// what turns `operator_had_to_nudge` from an opinion into a calibration: the model's answer can be compared against
// a fact nobody asked it for. It is also the behavioural proxy for the whole feature -- the operator's goal is to
// stop having to nudge.
//
// THE HARD CASE IS ABSENCE, AND IT IS WHY THIS RETURNS `null`. A turn with no next message is not a turn that did
// well; it is a turn with no evidence. `false` would be read as "the operator did not have to nudge", which is the
// flattering reading and the one that would make a measurement look better than it is. So the answer is three-valued
// and the third value is not a failure.
//
// HOW IT WAS VALIDATED, AND HOW IT WAS NOT -- worth recording because the second one cost a wrong conclusion.
//
// AGAINST THE SESSION'S OWN EVENTS: sound, and it found the marker-based nudges in the observed session -- "check
// again", "Did you find the tool…", and the operator's own "You should mutate and iterate the keywords" -- each
// from a marker that survives in short messages, plus `null` for the open final turn.
//
// AGAINST THE PROJCACHE'S `prompt`/`response` FIELDS: NOT VALID, and this file's earlier commit said otherwise. Those
// fields are TRUNCATED DISPLAY STRINGS -- turn 8 reads `[implementer session, dsh-system1-observer (sessi…`, cut off
// mid-header -- so a comparison over them measures two 50-character prefixes, not two messages. It produced four
// "false positives" at 60-100% recurrence between unrelated peer messages, and a header-strip that appeared not to
// work because an unterminated `[` cannot match a pattern that requires its closing bracket. The recurrence branch
// was therefore never validated against real text, and the false-positive finding is retracted as a real-data
// result. The header-strip itself stays: a shared transport header inflating overlap is a real hazard on reasoning
// and on the fixture, and the fixture is honest about being a fixture.
//
// WHAT THAT MEANS FOR THE NEXT READER: use `snapshotEvents` or the session log for whole messages. The projcache is
// a UI cache and truncates, and a validation run over it will agree with you about nothing.
//
// WHAT IT IS NOT: it does not read tone, sentiment or satisfaction. Those are inferences about a person from their
// words, and a proxy that guesses at them would be measuring the guess. It looks for two things a reader can see:
// the request coming back in different words, and the markers that mean "you did not do what I asked".
const STOPWORDS = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'than', 'that', 'this', 'these', 'those', 'is', 'are', 'was',
    'were', 'be', 'been', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'by', 'from', 'as', 'it', 'its', 'you', 'your',
    'i', 'me', 'my', 'we', 'us', 'our', 'they', 'them', 'he', 'she', 'do', 'did', 'does', 'can', 'could', 'should',
    'would', 'will', 'just', 'so', 'not', 'no', 'yes', 'please', 'about', 'into', 'up', 'out', 'all', 'any', 'some',
])

/** Correction markers: the words that mean the previous answer did not do the job. Deliberately explicit. */
const CORRECTION_MARKERS = Object.freeze([
    'you should', 'i said', 'i asked', 'did you', 'try again', 'check again', 'once more', 'again', 'instead',
    'not what i', 'redo', 'retry', 'you missed', 'you forgot', 'still not', 'that is not', "that's not", 'wrong',
    'incorrect', 'actually', 'why did you not', 'why didn\'t you',
])

/** A leading bracketed header is TRANSPORT, not content: `[from X via peer-bridge]`, `[1]`, a quoted reply. */
const stripHeader = (text) => text.replace(/^\s*(\[[^\]]*\]\s*)+/u, '')

/**
 * The content words of a message: lowercased, without a transport header, punctuation or stopwords.
 *
 * THE HEADER MATTERS MORE THAN IT LOOKS. Measured against the real record: successive peer-bridge messages share
 * `[implementer session, dsh-system1-observer (…) via peer-bridge]`, and counting that as content made FOUR
 * unrelated coordination messages read as operator nudges at 60-100% recurrence. The heuristic was measuring the
 * envelope rather than the message -- the serialisation-versus-meaning shape this repository catalogues.
 */
export function contentTokens(text) {
    if (typeof text !== 'string') return []
    return stripHeader(text)
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter((word) => word.length > 1 && !STOPWORDS.has(word))
}

/** How much of the next message's content is the request's, as a fraction of the shorter one. */
export function recurrence(request, next) {
    const a = new Set(contentTokens(request))
    const b = contentTokens(next)
    if (a.size === 0 || b.length === 0) return 0
    const shared = b.filter((word) => a.has(word)).length
    return shared / Math.min(a.size, new Set(b).size)
}

/**
 * Did the operator have to nudge?
 *
 * @returns `{ label, reason, signals }` where `label` is `true`, `false`, or **`null` when there is no next message
 *          to judge** -- the third value is the point, and a caller that treats `null` as `false` has made the
 *          measurement flattering rather than wrong.
 */
export function deriveNudgeLabel({ request, next, recurrenceThreshold = 0.5 } = {}) {
    if (typeof next !== 'string' || next.trim() === '') {
        return { label: null, reason: 'no next message, so there is no evidence either way', signals: { marker: null, recurrence: 0 } }
    }
    const text = next.toLowerCase()
    const marker = CORRECTION_MARKERS.find((phrase) => text.includes(phrase)) ?? null
    const overlap = recurrence(request, next)
    const signals = { marker, recurrence: overlap }
    if (marker !== null) {
        return { label: true, reason: `the operator corrects: ${JSON.stringify(marker)}`, signals }
    }
    if (overlap >= recurrenceThreshold) {
        return { label: true, reason: `the request comes back in different words (${Math.round(overlap * 100)}% of its content recurs)`, signals }
    }
    return { label: false, reason: 'the next message does not repeat or correct the request', signals }
}
