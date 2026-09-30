// THE EVIDENCE RECORD: what was observed, what was decided, what it cost.
//
// This is `docs/RUNTIME_SEMANTICS.md`'s **evidence** — *"what was observed, what was decided, what it cost"*,
// the runtime's AVC log. It is MECHANISM: one JSON object per line, best effort, unable to break the thing it
// observes.
//
// WHY IT IS A FACTORY AND NOT A MODULE CONSTANT. It began as a module in the application's tree that read its
// path at module load from an environment variable whose NAME was the application's, and defaulted to a file
// named after that application. **Both of those are the application's**: a runtime that writes to a file named
// after one application is a runtime that knows which application it is in, and the split cannot carry that.
// Measured 2026-09-29: the path appeared in five places across the application's code, and the variable name
// in its own header — none of which a runtime may hold.
//
// So the caller supplies three things and the runtime supplies none:
//
//   - the **default path**,
//   - the **environment variable** that overrides it, and
//   - a **redaction policy getter**.
//
// The first two are read at FACTORY time, once per module load, which preserves a contract the test suite
// depends on: the suite sets the variable before any test file is imported, and the application's tracer
// captures it when it loads. A lazily-read variable would change that ordering, and a trace that lands in the
// production file during a test run is the exact failure the test isolation exists to prevent.
//
// THE POLICY IS A GETTER, precisely because it is the opposite case: it is live config an operator can flip in
// the settings card, so it must be read per line rather than captured once. That is also why redaction is
// applied HERE and not only in each writer -- see below.
//
// Note the deliberate vagueness: this module names no file of the application's, not even in a comment. A
// reader grepping the runtime for an application's name should find NOTHING, and a comment that names one
// makes that grep unusable as the boundary check it deserves to be.
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, renameSync, statSync, writeSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { redactPolicy, sanitizeJson } from './redact.js';
import { ENFORCEMENT, VERIFIED } from './honesty.js';
/**
 * A tracer over one file.
 *
 * `fields` may be a FUNCTION, and that is the important part. A `ReferenceError` while evaluating the
 * arguments to `trace(...)` happens at the CALL SITE, before this function is entered, so the `try` below
 * cannot see it -- and a throw inside an event listener aborts the rest of that listener. Passing a thunk
 * moves the whole field computation inside the `try`, which is what makes a trace call unable to break the
 * thing it is observing. Learned the hard way: `execution.arguments` where the parameter was `exec` silently
 * disabled part of the guard for a whole run.
 *
 * THE REDACTION HERE IS THE CHOKE POINT. Every line of every event passes through `sanitizeJson`, so a future
 * writer cannot forget it -- and it runs AFTER any per-field cut, which is why it complements rather than
 * replaces the redact-then-cut ordering in `lib/observe.js`. It deep-clones, so a line can never mutate the
 * object the decision model was handed.
 */
/**
 * The smallest cap that can be honoured.
 *
 * A `rotate` line names the archive it closed, so IT GROWS with the path and with the rotation count -- measured
 * at 441 bytes under a 400-byte cap and 863 bytes under a 1 KB one. Under a cap smaller than that line, the fresh
 * file is already over the cap the moment it is opened, so every line after the first rotates again.
 *
 * MEASURED, WITH the guard that claims to prevent exactly this: 40 lines at a 400-byte cap produced **39
 * rotations and 39 archives**, one rename per line. The comment below credited that guard with bounding the
 * thrash; it can only ever prevent the FIRST rotation, because the second line alone exceeds the cap. A cap that
 * cannot hold its own rotation record is therefore raised to one that can: 40 lines at the floor produce 2.
 *
 * The record is still worth more than the bound -- that part of the original reasoning holds -- so nothing is
 * dropped and the cap is not refused. This decides WHICH record survives: a handful of files a reader can open,
 * rather than forty archives holding one line each.
 */
const MIN_CAP_BYTES = 4096;

export function createEvidence(options) {
    const path = process.env[options.envVar] ?? options.defaultPath;
    // Every line carries the run it came from, so one file can hold several runs and they can still be told
    // apart. Without this a reader sees two runs interleaved and cannot say which numbers belong to which --
    // which happened on the first real read.
    const run = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
    // THE ACTIVE FILE KEEPS ITS NAME. Rotation renames the FULL file aside and starts a fresh one at the same
    // path, instead of switching to a new name: every reader -- the trace tool, both report modules, the card --
    // captured `path` once, so a rotation that moved the name would leave all of them watching a file nobody
    // writes to any more. The bound stays visible through the `rotate` line and the count on the mount line,
    // which is the audit trail; the name is plumbing.
    const rotation = { count: 0, lines: 0, bytes: 0, archived: null };
    // Counted rather than measured: finding out what a file held otherwise means reading it, and a counter
    // nothing can read is exactly the upstream defect this is written to avoid. These two ARE read -- the
    // `rotate` line carries them.
    let linesWritten = 0;
    // A ROTATION MAY NOT FOLLOW A ROTATION WITH NOTHING IN BETWEEN -- but this guard is NOT what bounds the
    // thrash, and the comment here claimed it was until the reviewer session went looking for the test that would
    // have caught it. It only prevents the FIRST rotation after a rotation; the second line exceeds such a cap on
    // its own. `MIN_CAP_BYTES` is the actual bound; this one still earns its place by keeping an empty file from
    // being renamed.
    let bodiesSinceRotation = 0;
    let modeFixed = false;
    const maxBytes = () => {
        const value = typeof options.maxBytes === 'function' ? options.maxBytes() : options.maxBytes;
        if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
        // A cap below what a rotation record costs is raised rather than honoured: see MIN_CAP_BYTES.
        return Math.max(value, MIN_CAP_BYTES);
    };
    /**
     * Make room if the next line would cross the cap, and report what moved.
     *
     * The archive is `<name>.<runId>.<n>.jsonl`, NOT `<name>.<runId>.jsonl`: a run can cross the cap more than
     * once, and the second rotation would otherwise overwrite the first archive -- which is not a bound, it is
     * data loss wearing a bound's name.
     */
    function rotateIfNeeded(incoming) {
        const cap = maxBytes();
        if (cap === 0 || !existsSync(path)) return undefined;
        let size = 0;
        try {
            size = statSync(path).size;
        }
        catch {
            return undefined;
        }
        if (size === 0 || bodiesSinceRotation === 0 || size + incoming <= cap) return undefined;
        rotation.count += 1;
        const extension = extname(path) || '.jsonl';
        const archive = join(dirname(path), `${basename(path, extname(path))}.${run}.${rotation.count}${extension}`);
        try {
            renameSync(path, archive);
        }
        catch {
            return undefined; // a rotation that failed must not cost the line
        }
        const moved = {
            at: new Date().toISOString(), run, event: 'rotate',
            closed: archive, opened: path, bytes: size, lines: linesWritten,
        };
        rotation.lines += linesWritten;
        rotation.bytes += size;
        rotation.archived = archive;
        linesWritten = 0;
        bodiesSinceRotation = 0;
        return moved;
    }
    function append(line) {
        mkdirSync(dirname(path), { recursive: true });
        // MODE 600, ON THE FILE AND NOT ONLY ON THE OPEN. `appendFileSync` creates with 644 under the default
        // umask, which is how the live trace came to be world-readable with thousands of unredacted call lines
        // in it. The explicit mode covers a new file; the single chmod covers one an earlier version created.
        const fd = openSync(path, 'a', 0o600);
        try {
            writeSync(fd, line);
        }
        finally {
            closeSync(fd);
        }
        if (!modeFixed) {
            modeFixed = true;
            try {
                chmodSync(path, 0o600);
            }
            catch { /* a filesystem that cannot chmod is not a reason to lose a line */ }
        }
    }
    return {
        runId: () => run,
        path,
        /** What has been rotated away, for the mount line to carry: a bound nobody can read is not a bound. */
        rotations: () => ({ count: rotation.count, lines: rotation.lines, bytes: rotation.bytes, archived: rotation.archived }),
        trace(event, fields = {}) {
            try {
                // A thunk that throws still produces a LINE, carrying the event's existence and the reason its
                // detail is missing. In a chronological record the absence of detail must be visible; absence of
                // the event itself would read as "it never happened".
                let resolved = fields;
                if (typeof fields === 'function') {
                    try {
                        resolved = fields();
                    }
                    catch (error) {
                        resolved = { fields_unavailable: String(error?.message ?? error) };
                    }
                }
                if (resolved === null || typeof resolved !== 'object' || Array.isArray(resolved)) {
                    resolved = { fields_not_an_object: String(resolved) };
                }
                const policy = redactPolicy(typeof options.policy === 'function' ? options.policy() : options.policy);
                // `event` last: a caller whose fields happen to contain `event` must not be able to clobber the
                // record's type.
                // THE RECORD'S OWN HONESTY POSTURE, on every line and AFTER the caller's fields, for the same
                // reason `event` is last: a caller that happens to carry `verified` must not be able to flip what
                // the record says about itself. What is claimed ("it decides nothing"), how it is enforced (the
                // code shape, not a sandbox), and that nobody has verified it -- so a reader can tell "structurally
                // cannot act" from "acts, but this run happened not to".
                const body = JSON.stringify(sanitizeJson({
                    at: new Date().toISOString(), run, ...resolved, enforcement: ENFORCEMENT, verified: VERIFIED, event,
                }, policy));
                const line = `${body}\n`;
                const moved = rotateIfNeeded(Buffer.byteLength(line));
                if (moved !== undefined) {
                    // THE ROTATION IS A LINE. A bound that is not visible in the record is a bound an operator
                    // cannot audit, and it is also how the new file explains why it starts where it does.
                    append(`${JSON.stringify(sanitizeJson(moved, policy))}\n`);
                    linesWritten += 1;
                }
                append(line);
                linesWritten += 1;
                bodiesSinceRotation += 1;
            }
            catch {
                /* best effort, deliberately silent */
            }
        },
    };
}
