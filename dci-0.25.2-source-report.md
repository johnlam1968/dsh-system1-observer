# `dsh-chat-import` v0.25.2 — source-level report

Source of truth: unpacked package at `/tmp/dci/package/`. Every claim below cites `file:line`.
Where I did not execute code, I mark the claim **[inference]**; everything else is a **[measured]**
reading of the shipped source (and, where noted, a check against the *installed* harness at
`~/.config/nvm/.../@deepseek-ai/dsh` v**0.1.7-rc.2**).

---

## 1. The agent-facing tools

### 1.1 Registration surface

`lib/tools.mjs:37-43` builds the full list once, then `:79` registers **all** of them:

```js
const definitions = [
  makeImportChatTool(ctx, buildImportSources(ctx, registryDir)),
  ...makeAdminTools(ctx, registryDir),
  ...makeExportTools(ctx, registryDir),
  ...makeSessionTools(ctx, registryDir),
  makeScanTool(ctx, registryDir),
]
…
register('full')
```

**11 tools total** (verified by grepping every `defineTool({ name: … })`):

| # | Tool | Definition site | Injects sessions? |
|---|---|---|---|
| 1 | `import_chat` | `lib/toolkit.mjs:284` | **yes** — the only session-import tool |
| 2 | `import_agents` | `lib/tools/admin-tools.mjs:20` | no (agent/skill assets) |
| 3 | `doctor` | `lib/tools/admin-tools.mjs:104` | no (read-only) |
| 4 | `import_mcp` | `lib/tools/admin-tools.mjs:166` | no |
| 5 | `import_settings` | `lib/tools/admin-tools.mjs:231` | no (read-only) |
| 6 | `export_chat` | `lib/tools/export-tools.mjs:17` | no (DSH → external) |
| 7 | `export_bundle` | `lib/tools/export-tools.mjs:137` | no |
| 8 | `restore_bundle` | `lib/tools/export-tools.mjs:201` | **yes, but only `.dshbundle.json`** |
| 9 | `verify_session` | `lib/tools/session-tools.mjs:14` | no (read-only) |
| 10 | `list_imported_sessions` | `lib/tools/session-tools.mjs:74` | no (read-only) |
| 11 | `retract_import` | `lib/tools/session-tools.mjs:118` | no (registry-only) |
| — | `scan_discover` | `lib/tools/scan-tool.mjs:17` | no (read-only discovery) |

(That is 12 names; `scan_discover` is the 12th — 4 admin + 3 export + 3 session + `scan_discover` +
`import_chat`. Counted: `import_chat`, `import_agents`, `doctor`, `import_mcp`, `import_settings`,
`export_chat`, `export_bundle`, `restore_bundle`, `verify_session`, `list_imported_sessions`,
`retract_import`, `scan_discover` = **12 tools**.)

**Injection tiers** (`lib/tools.mjs:53, 68-78`): `MINIMAL_TOOLS = new Set(['import_chat'])`.
`reconcile(mode)` → `'off'` unregisters everything, `'minimal'` registers only `import_chat`,
`'full'` registers all. Note `:79` calls `register('full')` unconditionally at build time; the
`'minimal'` default only applies once `registerImportPrefs` reads the settings value
(`lib/index.mjs:95`, `lib/import-prefs.mjs:207-269`). **[inference]** In a CLI/headless profile with
no `settings` service, `injectTools` is never reconciled, so **all 12 tools stay injected** —
despite the documented default of `'minimal'`.

---

### 1.2 `import_chat` — the session-import tool

`lib/toolkit.mjs:283-323`. **Yes, it accepts an explicit arbitrary `path`** — see §2.

**`format` (required)** — `lib/toolkit.mjs:289-295`. Enum of **30** values
(`CHAT_FORMATS`, `lib/toolkit.mjs:32-63`; `CHAT_SOURCE_COUNT = 29` counts all but `local-jsonl`):

```
claude, codex, chatgpt, cursor, gemini, antigravity, reasonix, opencode,
mimocode, kilocode, teleagent, zcode, grokbuild, openclaw, hermes, pi,
kimi, qoder, workbuddy, qwen, trae, vibe, continue, cline, goose, zed,
crush, dsh, dsh4, local-jsonl
```

**`COMMON_PARAMS`** — `lib/toolkit.mjs:69-132`. Shared by every format:

| Param | Type | Required | Default / semantics |
|---|---|---|---|
| `path` | string | **yes** | "Source transcript / database / session directory path (shape per format enum)." — arbitrary, see §2 |
| `force` | boolean | no | `undefined`; `true` = save a fresh copy (`import-<src>-<n>`) even if already imported |
| `budget` | integer | no | `undefined`; resolution chain: param > `DSH_IMPORT_CONTEXT_BUDGET` env > dynamic model window > static 550k (`lib/toolkit.mjs:79-82`) |
| `storeImages` | boolean | no | `undefined` ⇒ **true** (`env DSH_IMPORT_STORE_IMAGES=0` forces false) — `lib/toolkit.mjs:83-86`, enforced `lib/import-core.mjs:436-440` |
| `preview` | boolean | no | `undefined`; `true` = zero-write dry run |
| `dryRun` | boolean | no | `undefined`; alias of `preview` (`lib/import-core.mjs:641-643`) |
| `sessionId` | string | no | `undefined`; target DSH id, single-file imports only; default `import-<sourceId>` |
| `recursive` | boolean | no | `undefined` ⇒ **true** (`args.recursive !== false`, `lib/import-core.mjs:552`) |
| `expectedHash` | string | no | `undefined`; lowercase SHA-256 of the source; mismatch throws, nothing written (`lib/import-core.mjs:501-506`) |
| `restamp` | boolean | no | `undefined`; `true` shifts all timestamps to now keeping relative gaps (`lib/import-core.mjs:167-180`) |
| `workspaceMode` | string enum | no | `undefined`; `auto` \| `dedicated` \| `per-project` |
| `workspaceDir` | string | no | `undefined`; used when `workspaceMode=dedicated` |
| `cwdRemap` | array of `{from:string!, to:string!}` (`additionalProperties:false`) | no | `undefined`; longest-prefix wins; **only applies to new imports**; rejects `..` traversal with `reason:'parent-traversal'` (`lib/import-core.mjs:130-154`) |

**`EXTRA_PARAMS`** — `lib/toolkit.mjs:136-176` (per-format, ignored by others):

| Param | Type | Required | Notes |
|---|---|---|---|
| `compacted` | boolean | no | claude only, **legacy no-op alias** |
| `branch` | enum `main`\|`all` | no | chatgpt only; default `main` |
| `sessionIds` | array of string | no | applies to `multiSession` specs: opencode/mimocode/kilocode/teleagent/zcode/trae/goose/zed/crush (derived in the description at `lib/toolkit.mjs:298-301`) |
| `fullHistory` | boolean | no | compaction-aware sources; default `false` (respects compaction); **part of the args fingerprint** |
| `includeToolUseResult` | boolean | no | claude only; default `false`; also fingerprinted |
| `lineage` | enum `tail` | no | hermes only |
| `lineageMode` | enum `canonical`\|`physical` | no | reasonix only; default `canonical` |
| `parseFormat` | enum of 11 | no | **`local-jsonl` only** — forces a converter; see §2 |

`PARSE_FORMATS` = `['dsh','claude','codex','cursor','reasonix','pi','openclaw','hermes','qoder','vibe','generic']` (`lib/toolkit.mjs:66`).

**Notably absent from the tool schema: `replace`.** It exists only on the panel/command path
(`lib/toolkit.mjs:257`, `lib/panel.mjs:263,369,383`, `lib/transfer.mjs:97`). A model cannot set it
through `import_chat`. See §3.3.

**Output schema**: `IMPORT_OUTPUT_SCHEMA`, `lib/tools/schema.mjs:241-350` — a `oneOf` of four states
(single-preview / batch-preview / single-import / batch-import). Statuses at `:239`:
`['imported','replaced','already-imported','appended','skipped','ignored']`.

---

### 1.3 The other 11 tools (full parameter tables)

**`import_agents`** (`lib/tools/admin-tools.mjs:26-59`) — all optional booleans/strings:
`apply:boolean`, `preview:boolean`, `piRoot:string`, `opencodeRoot:string`, `agentsHome:string`,
`claudeRoot:string`, `claudeProjectRoot:string`, `codexRoot:string`. Default = dry-run.

**`doctor`** (`lib/tools/admin-tools.mjs:111`) — `parameters: {}`. No arguments at all.

**`import_mcp`** (`lib/tools/admin-tools.mjs:171-188`) — `claudeMcpPath:string`,
`codexConfigPath:string`, `apply:boolean` (default false), `outPath:string` (default
`$DSH_HOME/dsh-chat-import/mcp-mirror.cordis.yml`).

**`import_settings`** (`lib/tools/admin-tools.mjs:235-244`) — `claudeSettingsPath:string`
(default `~/.claude/settings.json`), `codexConfigPath:string` (default `~/.codex/config.toml`).
Read-only, never writes.

**`export_chat`** (`lib/tools/export-tools.mjs:24-52`) — `format:string` **required**
enum `['claude','codex','kimi','opencode']`; `sessionId:string` **required**; `cwd:string` (claude
only); `path:string` (codex/kimi/opencode only); `outputDir:string` (claude default
`~/.claude/projects`, others `~/.dsh/exports`); `dryRun:boolean`.

**`export_bundle`** (`lib/tools/export-tools.mjs:143-161`) — `sessionId:string` **required**;
`path:string`; `outputDir:string`; `dryRun:boolean`.

**`restore_bundle`** (`lib/tools/export-tools.mjs:208-234`) — `path:string` **required**
(bundle file **or** a directory of bundles); `sessionId:string`; `force:boolean`; `preview:boolean`;
`dryRun:boolean`; `recursive:boolean`. Reuses the same import state machine
(`lib/restore.mjs`), so it inherits the whole §3 semantics.

**`verify_session`** (`lib/tools/session-tools.mjs:20-26`) — `sessionId:string` **required**.

**`list_imported_sessions`** (`lib/tools/session-tools.mjs:79`) — `parameters: {}`.

**`retract_import`** (`lib/tools/session-tools.mjs:125-134`) — `sessionId:string` **or**
`sourcePath:string` (one required in practice; throws if neither,
`lib/retract.mjs:158`). **Never deletes anything** — removes the registry record + prints manual
delete steps (`lib/retract.mjs:187-195`).

**`scan_discover`** (`lib/tools/scan-tool.mjs:25-39`) — `path:string` (one root, default = all roots),
`format:string` enum `FORMATS` (29 discovery formats — `local-jsonl` is **not** discoverable,
`lib/tools/import-sources.mjs:417-419`), `query:string` (case-insensitive substring over
title/project/path, `lib/discovery/discover.mjs:65-70`).

---

## 2. Import from an explicit path with a forced parser

### 2.1 The `path` argument is **not** restricted to discovered source roots

`lib/toolkit.mjs:217-234`:

```js
export async function runImportSpec(ctx, spec, args, { preview = false } = {}) {
  const ops = opsOf(spec)
  const flag = preview ? { preview: true } : {}
  const target = await ctx.fs.resolve(args.path)
  const info = await ctx.fs.stat(target)
  if (info && info.type === 'directory') { …dir branch… }
  const fileArgs = { ...args, ...(await ops.deriveArgs(target)) }
  const mode = await ops.batchFile(ctx, target) ? 'batch' : 'single'
  …
}
```

`args.path` goes straight into `ctx.fs.resolve`. **No root check, no registry lookup, no
`sourceOf()` gate anywhere on this path.** The default-root machinery
(`defaultRoots()` / `lib/discovery/registry.mjs:48-50`) is consumed only by `scan_discover`
(`lib/discovery/discover.mjs:38-63, 90`) and the panel — never by `import_chat`.

A missing file does not error: `ctx.fs.stat` returning null falls through to the file branch.

**[inference]** The host-side read sandbox does not fence absolute paths. `dsh-fs-sandbox` throws
`FS_SANDBOX_DENIED` only from the write path (`dsh-fs-sandbox/lib/index.js:157` and `:164`, both
messages `cannot write "…"`), and the read surface (`resolve`/`stat`/`readText`/`listDir`/
`readBytes`/`readByteRange`, `dsh-fs-local/lib/index.js:780,802,825,837,843,849`) takes no policy
argument. `resolveLocalTarget` resolves with `node:path.resolve(cwd, path)`, which returns an
absolute path unchanged (`dsh-fs-local/lib/index.js:157`). Corroborating signal inside the plugin
itself: the registry writer deliberately bypasses `ctx.fs` with the comment
「不用 ctx.fs（沙箱会拒 `~/.dsh` 写入）」 (`lib/imports.mjs:18-19`) — writes are fenced, reads are not.

### 2.2 `format` vs `parseFormat`

| | `format` | `parseFormat` |
|---|---|---|
| Required? | **yes**, enum of 30 | no, enum of 11 |
| Selects | a **source adapter (spec)** from `lib/tools/import-sources.mjs` — its converter, its IO shape (file / dir / always-batch / file-batch / dir-single), its registry `fingerprintKeys` | a **converter inside `convertLocalJsonl`** |
| Wiring | `makeImportChatTool` → `byFormat.get(args.format)` (`lib/toolkit.mjs:274, 312-314`) | `lib/toolkit.mjs:315-320` |

```js
if (args.format === 'local-jsonl') {
  // 顶层 format 已被 'local-jsonl' 占用：强制解析器经 parseFormat 传入，
  // 剥掉顶层 format 后注入（缺省自动识别——转换器不读 format 即检测）
  const { format, parseFormat, ...rest } = args
  return runOf(spec)(parseFormat ? { ...rest, format: parseFormat } : rest)
}
```
(`lib/toolkit.mjs:315-320`)

The injected `format` is then read by the auto-detector as an explicit override
(`lib/convert/local-jsonl.mjs:84-95`):

```js
const requested = typeof args.format === 'string' && args.format !== 'auto' && CONVERTERS[args.format]
  ? args.format : null
if (requested) {
  const out = runConverter(requested, raw, args)
  if (hasContent(out)) return { ...out, detectedFormat: requested, detectedBy: 'override' }
  …
}
```

Detection is otherwise three-tier (`lib/convert/local-jsonl.mjs:3-11`): **override > content marker
> candidate trial**. `pathPriority()` (`:49-62`) only narrows the *candidate list* for tier 3 —
e.g. `/\bagents\b.*\bsessions\b/` ⇒ `['openclaw']` — and is reported as `detectedBy: 'path-hint'`.
An override never yields to a path hint.

### 2.3 Can `format:"local-jsonl"` + `parseFormat:"openclaw"` target an arbitrary path outside `~/.openclaw`?

**Yes.** There is no gate on the path — only the tier-3 *hint* table has an `~/.openclaw` shape,
and tier 1 (override) short-circuits before any of it is consulted. Concretely
`import_chat({format:'local-jsonl', parseFormat:'openclaw', path:'/anywhere/foo.jsonl'})`:
`runImportSpec` resolves the arbitrary path, `ops.batchFile` is `async () => false`
(`lib/toolkit.mjs:197`, no `io` on the local-jsonl spec), so it takes the single-file branch into
`importTranscript` → `convertLocalJsonl(raw, {format:'openclaw', sourcePath})` → override branch →
`convertOpenclawJson`.

Two behavioural differences from `format:'openclaw'` on a real `~/.openclaw` file — both from
`derive`, which the local-jsonl spec does **not** carry (`lib/tools/import-sources.mjs:419`):

1. **No sidecar title.** `openclawDeriveArgs` (`lib/tools/source-derive.mjs:292-306`) reads the
   sibling `sessions.json` index for `displayName` and sets `openclawId = <file stem>`. It is
   registered only on the `openclaw` spec (`lib/tools/import-sources.mjs:276`). With `parseFormat`
   the id comes from file content instead (`rec.type === 'session'` → `rec.id`,
   `lib/convert/openclaw.mjs:144-145`), and there is no `displayName` → first user prompt is the title.
2. **`args.format` is in scope for the converter**, which is exactly the override mechanism — no
   leak, but it does mean the openclaw converter sees `args.format === 'openclaw'`, which it ignores.

**[measured]** `.zstd` caveat: only the `dsh`/`dsh4` specs install a custom `readText`
(`lib/tools/import-sources.mjs:405, 413`); `local-jsonl` has none, so a compressed
`.jsonl.zstd` passed to `local-jsonl` is read as text. The panel's from-file path handles this
explicitly (`lib/file-import.mjs:20-22`: 「local-jsonl 的其它来源没有 zstd 通道，漏传会把压缩字节
当文本读出 0 轮」).

---

## 3. Incremental / overwrite semantics

### 3.1 Where the registry lives, and its shape

**[measured]** Path: `lib/imports.mjs:47-50`

```js
export function resolveRegistryDir(env = process.env) {
  const base = env.DSH_HOME || join(homedir(), '.dsh')
  return join(base, 'dsh-chat-import')
}
```

* File: **`$DSH_HOME/dsh-chat-import/imports.json`**, `$DSH_HOME` defaulting to `~/.dsh`
  (`lib/imports.mjs:3`, `lib/index.mjs:56-57`).
* **There is no `registryDir` config option.** `registryDir` is a *function parameter* threaded
  from `apply` (`lib/index.mjs:57`) into every tool factory (`lib/tools.mjs:26`) and from there
  into every `registry: { dir }` spec (`lib/tools/import-sources.mjs:80`). The only knobs are the
  `DSH_HOME` env var and the `homedir()` fallback.
* Format: **JSON**, written atomically (temp + fsync + rename) via `node:fs/promises`
  (`lib/imports.mjs:18-19, 159-162`). Corruption is tolerated as an empty registry with a warning
  (`:66-70`).
* Siblings in the same directory: `ignores.json` (`lib/ignore.mjs:31-33`),
  `scan-cache.json` (mtime bookmarks, `lib/discovery-host.mjs:248`),
  `mcp-mirror.cordis.yml`, upload staging/manifests.

**Record shape** (`lib/imports.mjs:5-14`, written by `decideSingle` `:679-689` and `decideMulti` `:766-778`):

```js
{ version: 1, imports: { <absolute source file path>: record } }

record = {
  kind: 'single' | 'multi',
  dshId, turns, events, format,        // single
  storedEvents,                        // measured DSH log length after our last write
  copies?: [{ dshId, turns, events, storedEvents?, importedAt }],
  budget, sizeBytes, mtimeMs, version,
  args,                                // args fingerprint (JSON string)
  walSig?,                             // multi + SQLite only
  importedAt,
  sessions?: { <sourceSessionId>: { dshId, turns, events, format?, … } },   // multi
  conversations?: { … }                // multi (chatgpt uses this sub-table name)
}
```

Legacy records may be a bare string id (`unwrapRecord`, `lib/imports.mjs:337-341`).

### 3.2 Every condition for SKIP vs RE-READ

Two layers. **Layer 1 — "source unchanged" short circuit** (does not even read the source):
`singleShortPath`, `lib/import-state.mjs:53-59`

```js
export function singleShortPath(known, args, fingerprint, stat) {
  if (!known || args.force === true || args.replace === true || isSessionIdChange(args, known.dshId)) return null
  if (typeof known.args === 'string' && fingerprint !== known.args) return alreadyImported(known, { argsChanged: true })
  if (budgetChanged(known, args)) return alreadyImported(known, { budgetChanged: true })
  if (stat && stat.version === known.version && stat.size === known.sizeBytes) return alreadyImported(known)
  return null
}
```

Preconditions for even having a `known` record — `loadKnownRecord`, `lib/import-state.mjs:24-33`:

```js
let known = unwrapRecord(registry.imports[sourcePath])
if (known && known.kind !== kind) known = null
if (known && kind === 'single' && (!known.dshId || !persistedSet.has(known.dshId) || archivedIds.has(known.dshId))) known = null
if (known && kind === 'multi' && (!known[subTable] || typeof known[subTable] !== 'object')) known = null
```

So a record is discarded (→ treated as *no record* → full re-read) when: **no record**; **kind
mismatch**; **single**: missing `dshId`, **session deleted from DSH_HOME / DSH_HOME migrated**
(`!persistedSet.has(dshId)`), or **session archived** (`archivedIds.has(dshId)`); **multi**: sub-table
missing/not an object.

`multiShortPath`, `lib/import-state.mjs:71-89` adds: **selection guard** (every `sessionIds`/`zcodeId`
must already be in the sub-table, else re-read so newly selected sessions aren't mis-skipped),
**every sub-session still persisted and unarchived**, and **WAL sidecar signature unchanged**
(`walSig`, `lib/imports.mjs:794-803`) — a SQLite DB whose writes are still in `-wal` has an
unchanged main-file stat.

**Layer 2 — decision after the source has been read and converted** (`decideItem`,
`lib/imports.mjs:414-639`). Complete enumeration, in evaluation order:

| # | Condition | Outcome | Cite |
|---|---|---|---|
| 0 | ignore tombstone hit (`archived` / `retracted` / `workspace-deleted`), and `force !== true` | `status:'ignored'`, `reason`, `skipReason:'ignored:<code>'`; registry record preserved | `lib/imports.mjs:646-671` |
| 1 | known && (`!persisted.has(dshId)` \|\| `archived.has(dshId)`) | `known = null` (+ `staleRegistry:{previous, reason:'session-log-missing'}`) → falls through to "no record" | `:451-456` |
| 2 | known && no `turns` (legacy record) | falls to the "no record" branch → **legacy backfill**, no write | `:461`, `:579-613` |
| 3 | `args.replace === true` | `__action:'replace'`, **same id**, `status:'replaced'` | `:464-474` |
| 4 | `isSessionIdChange(args, targetId)` (explicit `sessionId` differs and isn't a collision-suffix) **or** `args.force === true` | **new copy** `<id>-<n>`, `status:'imported'`, `reimported{reason:'session-id-changed'\|'forced'}`, old session kept in `copies` | `:477-491`, `isSessionIdChange` `:398-402` |
| 5 | `turns.length > known.turns` (source grew) → `storedEventCount` unreadable | `appendedSkipped:'stored-length-unknown'`, skip | `:499-502` |
| 6 | grew && (`storedEvents` baseline missing **or** `fromSeq > baseline`) | **new copy**, `reimported{reason:'baseline-missing'\|'continued-in-dsh'}` | `:503-517` |
| 7 | grew && `fromSeq < baseline` | skip, `storedShrunk:true` (log truncated externally) | `:518-520` |
| 8 | grew && tail empty | conservative skip | `:522-525` |
| 9 | grew && otherwise | **`__action:'append'`** → append new turns to the same session, `appendedTurns`, `appendedEvents`, `storedEvents = fromSeq + tail.length` | `:526-543` |
| 10 | `turns.length < known.turns` | skip, `sourceShrunk:true` | `:547-556` |
| 11 | equal turns && `events.length !== known.events` | skip, `changedInPlace:true` (append-only cannot rewrite) | `:559-569` |
| 12 | equal turns && equal events | skip, plain `already-imported` | `:570-576` |
| 13 | no record, `meta.id` already persisted, **log unreadable** (ghost) | new suffixed id, `staleGhost{previous,current}` | `:580-601` |
| 14 | no record, id persisted, readable, owner is this path or unknown | `backfilled:true`, skip (idempotent legacy) | `:602-614` |
| 15 | no record, id persisted, owned by another source path, or archived | new suffixed id (collision avoidance) | `:615-627` |
| 16 | otherwise | first import, `__action:'create'` | `:630-638` |

Batch tallies: `lib/import-batch.mjs:72-86` (`imported`+`replaced` both count as `imported`;
`ignored` counted separately from `skipped`).

**Skip reasons as user-visible text**: `lib/tools/import-render.mjs:49-58`.

### 3.3 What `args.replace` actually does

**It deletes the target's artifacts and recreates the session under the same id — an in-place
replace, not a duplicate.** Three code sites:

```js
// lib/imports.mjs:463-474
    // replace：同 id 删工件后全量重导（面板「刷新已导入」）；不新建副本。
    if (args.replace === true) {
      return { …base, sessionId: targetId, status: 'replaced',
        __action: 'replace', __meta: { ...meta, id: targetId }, __events: events,
        __itemRecord: itemRecord(targetId, turns.length, events.length, importFormat, { copies: known.copies }) }
    }
```

```js
// lib/import-core.mjs:306-331 (writeOneSession)
  const writeOneSession = async ({ events, meta, record, replace = false, retryGhost = true, onGhost }) => {
    await materialize(events)
    const prepared = await prepareGrouping(meta)
    let target = prepared.meta
    if (replace) await clearSessionArtifactsForReplace(ctx, target.id)
    try { await createSession(ctx, target, events) } …
```

```js
// lib/purge.mjs:212-232
export async function clearSessionArtifactsForReplace(ctx, sessionId) {
  if (!SESSION_ID_RE.test(sessionId)) throw new Error('非法 sessionId：' + sessionId)
  const agents = ctx.get('agents')
  const agent = agents && typeof agents.get === 'function' ? agents.get(sessionId) : undefined
  if (agent !== undefined && agent.status === 'running')
    throw new Error('会话正在运行，请先停止再刷新：' + sessionId)
  if (agent !== undefined) { const stopped = await disposeAgentFiber(agent); if (!stopped) throw … }
  const sessions = ctx.get('sessions'); detachLiveStore(sessions, sessionId)
  const sp = ctx.get('sessionPersistence')
  let files = await removeArtifactsByLocate(sp, sessionId)
  if (files === 0) files = await removeArtifactsByScan(sessionId)
  if (sp && typeof sp.remove === 'function') { try { await sp.remove(sessionId) } catch { … } }
  return { sessionId, files }
}
```

Notes: the registry record is **reused** (`copies` preserved), workspace grouping re-runs
(`lib/import-core.mjs:354-361`, comment at `:233`), ghost-retry is disabled (`retryGhost:false`
because artifacts were just cleared), and a running agent or a locked file **aborts the whole
replace** by throwing (`lib/purge.mjs:91-106`: 「clearSessionArtifactsForReplace 中止后不重导」).
Multi-session sources run replaces in a separate first loop (`lib/import-core.mjs:365-374`).

**Reachability: `replace` is not an `import_chat` parameter.** It reaches the state machine only via
`importDiscoveryItem(…, { force, replace, … })` (`lib/toolkit.mjs:254-257`) — the panel
(`lib/panel.mjs:263, 369, 383`) and `transferDiscoveryItem` (`lib/transfer.mjs:85, 97`).

### 3.4 Is there a "sync" / "append" mode?

**There is no `sync` flag, no `sync` tool, and no `sync` keyword in the codebase** — a grep for
`sync` across `lib/**/*.mjs` returns only `async` identifiers and unrelated words
(`syncWorkspace` etc. do not exist).

**There IS an automatic incremental-append mode**, but it is *implicit*: it fires whenever the
source grew and the DSH-side session is still exactly what we last wrote. That is branch 9 of §3.2
(`lib/imports.mjs:526-543`) plus the executor (`lib/import-core.mjs:362-363` →
`appendTail` `:335-339` → `appendHostEvents`, `lib/host-session.mjs:302-306`):

```js
export async function appendHostEvents(ctx, targetId, events) {
  const version = (await targetSessionFormatVersion(ctx, targetId)) ?? (await hostSessionFormatVersion(ctx))
  await ctx.sessionPersistence.append(targetId, prepareHostEvents(events, targetId, version, await hostNativeFormatVersion(ctx)))
}
```

The tail is computed by `tailSessionEvents(converted, { fromTurn: known.turns + 1, fromSeq })`
(`lib/imports.mjs:521`; schema field `droppedBoundaryResults` for boundary tool results,
`:542`). Appending is **append-only**: if the source changed *within* an existing turn, it refuses
to rewrite and either skips (`changedInPlace`) or casts a new copy.

**`restore_bundle`** (`lib/restore.mjs:41, 112`) reuses this same state machine, so bundles get
identical append semantics (its output schema re-exports `DECISION_REPORT_PROPS`,
`lib/tools/export-tools.mjs:266`).

**`transfer.mjs` is not a sync** — it is "import to a non-DSH target": import → export to
claude/codex/kimi/opencode → purge the intermediate session (`lib/transfer.mjs:1-17`, `:126-175`).

### 3.5 Does it record a receipt (source hash/length) like zeroclaw's `jsonl_import_receipts`?

**No.** There is no `jsonl_import_receipts` table, no per-import content hash, and the string
`receipt` appears exactly once in the whole package — in `CHANGELOG.md:491`, describing *Claude
Code's* `isMeta` "context receipts", unrelated to importing.

**[measured]** grep for `session_metadata|jsonl_import|receipts|FTS|MATCH ` across `lib/**/*.mjs`:
zero hits.

What it *does* record instead — all stat-derived, never content-derived:

| Signal | Where | Meaning |
|---|---|---|
| `sizeBytes`, `mtimeMs`, `version` | `lib/imports.mjs:683-685, 772-774` | file fingerprint from `ctx.fs.stat` |
| `walSig` | `lib/imports.mjs:794-803` | `<db>-wal` size+mtime, SQLite multi sources only |
| `args` fingerprint | `argsFingerprint`, `lib/imports.mjs:388-394` | JSON of fingerprint keys only (`fullHistory`, `includeToolUseResult`) |
| `budget` | `lib/imports.mjs:682, 770` | token budget used |
| `events` / `turns` | `lib/imports.mjs:441` | conversion-level counts |
| `storedEvents` | `stampStoredEvents`, `lib/import-core.mjs:224-230` | **measured** DSH log length, refreshed only right after our own write |

SHA-256 appears in exactly three unrelated places:

1. **Caller-supplied verification, not a receipt** — `lib/import-core.mjs:501-506`:
   ```js
   if (typeof args.expectedHash === 'string' && args.expectedHash) {
     const actual = createHash('sha256').update(raw).digest('hex')
     if (actual !== args.expectedHash.toLowerCase())
       throw new Error('expectedHash mismatch: 期望 ' + args.expectedHash + '，实际 ' + actual)
   }
   ```
2. Bundle dual checksums (`lib/export/bundle.mjs:36-66`).
3. Resumable-upload manifests (`lib/upload.mjs:107-191`).

---

## 4. The SQLite source family

### 4.1 Shared primitives

`lib/sources/sqlite.mjs` — `node:sqlite` via `process.getBuiltinModule` (`:13-25`), read-only open
(`:28-30`), `closeQuietly` in `finally` (`:33-50`), `readOptionalDb` normalizing "not this db" to
`null` while re-raising `DSH_SQLITE_UNAVAILABLE` (`:58-80`), plus `columnsOf` (PRAGMA `table_info`),
`tableNames`, `hasTable`, `resolveDbInDirectory`, `locateDbInDirectory` (`:83-115`).

Discovery side: `lib/discovery/sqlite.mjs` — `scanSqlite` goes through
`host.readSessions(format, dbPath)` (`:51-78`); readers live in `lib/discovery-host.mjs:35-83`
(`DB_SUMMARY_READERS`, 11 entries). Bookmarks include the `-wal`/`-shm` sidecars
(`sqliteFingerprint`, `lib/discovery/sqlite.mjs:38-47`).

### 4.2 Every SQLite-backed source: tables and columns

| Format | DB file / root | Tables read | Columns read | Cite |
|---|---|---|---|---|
| **opencode** V1 | `~/.local/share/opencode/opencode.db` | `session`, `message`, `part` | `session(id,title,directory,time_created[,model])`; `message(id,time_created,data,session_id)`; `part(message_id,time_created,data,session_id)` | `lib/sources/opencode.mjs:35-45` |
| **opencode** V2 | same | `session_v2`, `session_message` | `session_v2(id,title,directory,time_created,model)`; `session_message(id,type,seq,time_created,data,session_id)` | `:140-154` |
| **mimocode** | `~/.local/share/mimocode/mimocode.db` | same as opencode V1 (no `model` column) | probed via PRAGMA; filters background-task sessions | `lib/sources/mimocode.mjs:11`, `lib/sources/opencode.mjs:33-38` |
| **kilocode** | `~/.local/share/kilo/kilo.db` | `session` (+ message/part via opencode reader) | extra probed columns `parent_id`, `time_archived` used as skip predicates | `lib/sources/kilocode.mjs:30-41, 49-56` |
| **teleagent** | `~/.local/share/TeleAgent/users/<acct>/teleagent.db` | same as opencode | same; multi-account dir enumeration | `lib/sources/teleagent.mjs:11`, `lib/discovery/sqlite.mjs:89-104` |
| **zcode** | `~/.zcode/cli/db/db.sqlite` | `session`, `message`, `part` | `session(id,title,directory,time_updated,parent_id)`; `message(id,time_created,data,session_id)`; `part(id,time_created,data,message_id)`; filter `parent_id IS NULL OR = ''` | `lib/sources/zcode.mjs:36-68` |
| **goose** | `<dataDir>/sessions/sessions.db` | `sessions`, `messages` | signature: `sessions.id/session_type/working_dir` + `messages.session_id/content_json`; reads `name, description, working_dir, session_type, parent_session_id, provider_name, created_at, updated_at` and `messages{role, content_json, metadata_json, created_timestamp, id}`; filters `session_type IN ('sub_agent','hidden')` | `lib/sources/goose.mjs:81-144` |
| **zed** | `<data_dir>/threads/threads.db` | **`threads` only** (`tables.size !== 1` → reject) | `id, summary, data_type, data` required; optional `parent_id` (skipped), `folder_paths`, `folder_paths_order`, `created_at`, `updated_at`; `data_type ∈ {zstd, json}` | `lib/sources/zed.mjs:28-38, 66-81` |
| **crush** | `<project>/.crush/crush.db` | `sessions`, `messages`, **`read_files`** (existence required) | signature: `sessions.parent_session_id/summary_message_id/prompt_tokens` + `messages.parts/is_summary_message/finished_at`; reads `title, created_at, updated_at, message_count, prompt_tokens, completion_tokens, cost, summary_message_id`; `messages{id, role, parts, model, provider, created_at, finished_at, is_summary_message}` | `lib/sources/crush.mjs:34-112` |
| **trae** | `Trae{,\ CN,\ SOLO,\ SOLO CN}/User/workspaceStorage/<h>/state.vscdb` and `globalStorage/state.vscdb` | **`ItemTable(key,value)`** (VS Code key/value store) | `key`, `value` (JSON blob); storage keys `TRAE_STORAGE_KEY` + fallbacks | `lib/sources/trae.mjs:49-79`, `lib/discovery/sqlite.mjs:21-32, 109-137` |
| **hermes** | `~/.hermes/state.db` | `sessions`, `messages` | requires a `sessions` table; adaptive columns via `pickCol`: `cwd|directory`, `started_at|created_at`, `ended_at|updated_at`, `parent_session_id|parent_id`; `messages`: `session_id, role, content, created_at|timestamp, tool_calls|tool_call, reasoning` | `lib/sources/hermes.mjs:24-126` |
| **cline** *(sqlite too, own module)* | `<dataDir>/db/sessions.db` | `sessions` | requires `session_id`; reads `is_subagent, agent_id, parent_session_id, messages_path, metadata_json, prompt, cwd, workspace_root, started_at, updated_at, ended_at, model` | `lib/sources/cline.mjs:76-112` |

So **11 SQLite-backed sources**: opencode, mimocode, kilocode, teleagent, zcode, goose, zed,
crush, trae, hermes, cline. All 11 appear in `DB_SUMMARY_READERS` (`lib/discovery-host.mjs:35-83`)
and in `SOURCES` (`lib/discovery/registry.mjs:31-36`). Every one is `multiSession: true`
(`lib/tools/import-sources.mjs:169, 186, 197, 208, 220, 251, 369, 382, 396`) — each imports as a
batch, registry `kind:'multi'`.

### 4.3 Is zeroclaw / openclaw SQLite among them?

**Definitively no.**

* The only `openclaw` support is **JSONL**: `lib/tools/import-sources.mjs:272-277`
  (`convert: convertOpenclawJson`, root `~/.openclaw/agents`, no `io` → standard file/dir state
  machine), described as `['openclaw', 'OpenClaw session JSONL (~/.openclaw/agents)']`
  (`lib/toolkit.mjs:46`). Discovery: `openclawSource` in `lib/discovery/jsonl.mjs:379-383`
  (`roots: join(home, '.openclaw', 'agents')`, `scanOpenclaw`).
* There is **no `zeroclaw` string anywhere** in the package (grep over `.mjs`, `.md`, `.yml`, `.json`).
* `sessions.db` appears only as goose (`lib/discovery/sqlite.mjs:142`, `lib/sources/goose.mjs`) and
  as cline's `<dataDir>/db/sessions.db`. Neither probe accepts a `sessions` + `session_metadata` +
  `jsonl_import_receipts` + FTS schema: goose's signature demands `messages(session_id, content_json)`
  and `sessions(session_type, working_dir)` (`lib/sources/goose.mjs:85-87`); hermes' demands a
  `messages` table with `session_id` + `role` (`lib/sources/hermes.mjs:78`); cline's demands
  `sessions.session_id` (`lib/sources/cline.mjs:80`). **`jsonl_import_receipts`, `session_metadata`,
  and FTS virtual tables are never referenced** — `tableNames()` is only consulted for `threads`
  (zed), `sessions`/`messages`/`read_files` (crush), and the generation check (opencode), so an
  extra FTS/receipts table would simply be ignored *if* the base signature matched, which it does not.
* Net effect: an openclaw/zeroclaw `sessions.db` would be rejected by every reader; the only route
  into DSH is a JSONL transcript via `format:'openclaw'` or `format:'local-jsonl'` (with or without
  `parseFormat:'openclaw'`).

---

## 5. Config schema and the bundle patch

### 5.1 `cordis.patch.yml` — the whole file (3 lines)

```yaml
- insert:
    - id: import-claude
      name: dsh-chat-import
```
(`cordis.patch.yml:1-3`)

It mounts **exactly one row**, `id: import-claude`, pointing at the plugin's `apply`. No config
block, no disabled flag, no group.

`package.json:46-56` declares it:

```json
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": { "inject": ["@deepseek-ai/dsh-client-locale"], "platform": "web" }
}
```

`lib/index.mjs:46-50` names the row and declares the hard dependency set:

```js
const name = 'import-claude'
const inject = ['sessionPersistence', 'fs', 'tools']
```

Everything else (`webServer`, `skills`, `commands`, `settings`, `workspaceRegistry`) is optional and
mounted through `ctx.inject` inside `apply` (`lib/index.mjs:67-95`).

### 5.2 The complete Config schema

`lib/import-prefs.mjs:79-85`, re-exported by `lib/index.mjs:100`:

```js
export const Config = supportsVolatile(Schema)
  ? Schema.object({
      importSystemPrompt: Schema.boolean().default(true).volatile(),
      injectTools: Schema.any().default('minimal').volatile(),
      sidebarButton: Schema.boolean().default(true).volatile(),
    })
  : undefined
```

| Option | Type | Default | Notes |
|---|---|---|---|
| `importSystemPrompt` | boolean (volatile) | `true` | import the source's system prompt as a context injection (`lib/toolkit.mjs:243`, `readImportPrefs` `:274-287`) |
| `injectTools` | **`Schema.any()`**, normalized to `'off' \| 'minimal' \| 'full'` (boolean `true→'full'`, `false→'off'`) | `'minimal'` | `normalizeInjectTools` `:102-107`; `any` is deliberate (`:77-78`) so a union doesn't swallow booleans into the default |
| `sidebarButton` | boolean (volatile) | `true` | sidebar entry toggle |

**That is the entire Config surface — three options.** Notably **absent**: `registryDir`
(computed from `$DSH_HOME`, §3.1), `budget`, `formats`, `budget default`, and any per-format toggle.

Related runtime knobs that are **env vars, not Config**: `DSH_HOME`, `DSH_IMPORT_CONTEXT_BUDGET`
(`lib/toolkit.mjs:81`), `DSH_IMPORT_STORE_IMAGES` (`lib/import-core.mjs:439`),
`DSH_IMPORT_CONTEXT_BRIDGE` (`lib/index.mjs:88`).

`Config` is `undefined` when the resolved `@deepseek-ai/schemastery` lacks `.volatile()`
(`lib/import-prefs.mjs:63-69, 45-59` — schemastery is resolved from the running harness bin first).
**[measured]** Installed schemastery is **3.18.4** and `Schema.boolean().volatile` **is** a function,
so `Config` is defined on this host. Two settings models are supported and probed at runtime:
`forms` (0.1.7+, namespace = bare row id) vs `legacy` (`'chat-import'` self-registered namespace)
(`resolvePrefsBinding`, `:131-169`).

`lib/settings.mjs` (which the question named) is **not** the plugin config — it is the body of the
`import_settings` **tool**, parsing Claude `settings.json` (`model`, `permissions`, `hooks`, `env`)
and Codex `config.toml` (`model`, `model_provider`) into migration advice. Read-only, no writes
(`lib/settings.mjs:10-131`).

---

## 6. DSH compatibility

### 6.1 Declared peer dependencies (`package.json:57-64`)

```json
"@deepseek-ai/cordis": "^4.0.1",
"@deepseek-ai/dsh": ">=0.1.5-rc.1",
"@deepseek-ai/dsh-client-locale": ">=0.1.0-rc.6",
"@deepseek-ai/dsh-tools": ">=0.1.0-rc.6 <0.3.0",
"@deepseek-ai/schemastery": ">=3.0.0",
"react": ">=18.0.0"
```

Runtime dependency: `fzstd ^0.1.1` (pure-JS zstd for `.zstd` DSH logs). `engines.node >= 22.13`
(`package.json:104-106`) — required by `node:sqlite`.

### 6.2 The one hard, load-time version gate

`lib/tools.mjs:18, 27-33`:

```js
import { TOOL_RUNTIME_SCHEDULER } from '@deepseek-ai/dsh-tools'
…
  // 声明 TOOL_RUNTIME_SCHEDULER 命名导入：一旦解析到旧副本 dsh-tools@0.0.1-rc.1
  // （只导出 TOOL_REGISTRY_SCHEDULER），模块加载即失败并大声报错
  if (typeof TOOL_RUNTIME_SCHEDULER !== 'symbol') {
    throw new Error('dsh-chat-import: resolved @deepseek-ai/dsh-tools lacks TOOL_RUNTIME_SCHEDULER — requires >=0.1.0-rc.6 <0.3.0')
  }
```

**[measured]** Installed `dsh-tools` is **0.1.7-rc.2** and does export it
(`…/@deepseek-ai/dsh-tools/lib/index.js:3714`, symbol declared at `:2526`). **This gate passes on
0.1.7-rc.2.** It is a *named import* of a `Symbol`, so on any dsh-tools that lacks it the plugin
fails at module load, not at apply.

`defineTool` is the only other `@deepseek-ai/*` symbol used, from 5 modules
(`lib/toolkit.mjs:13`, `lib/tools/{admin,export,session,scan}-tools.mjs`, `lib/tools.mjs`).

### 6.3 Services consumed

Hard `inject` (`lib/index.mjs:50`): `sessionPersistence`, `fs`, `tools`. If any is missing the plugin
will not activate.

**[measured]** Both `sessionPersistence` and `workspaceRegistry` are live service-id literals used
across many installed dsh packages (`sessionPersistence` in `dsh-agent-loop`, `dsh-api-workspace-files`,
`dsh-headless`, `dsh-acp`, …; `workspaceRegistry` in `dsh-workspace`, `dsh-api-workspace-controller`,
`dsh-webhook`, …), and `dsh-cordis-host-runner` provides `fs`/`tools`.

Optional / probed at runtime, with the guards:

| Service | Used at | Absent ⇒ |
|---|---|---|
| `agents` | `lib/host-session.mjs:326, 348-357` (`agents.create({sessionId, meta, seed, agentOptions, setup})`) | fall back to `sessionPersistence.create` (`:366-374`) |
| `agentPresets` | `:339-343` (`resolve()`), `:354-355` (`mount`) | no preset id / no mount; caught, non-fatal |
| `sessionProjectionCache` | `lib/import-core.mjs:195` (`coldSnapshot`) | skipped, `storedEvents` falls back to a re-read |
| `workspaceRegistry` | `archivedSessionIds` (`lib/host-session.mjs:528-537`), `detachSession`/`list` (`lib/purge.mjs:79-89`) | treated as "no archived sessions" |
| `attachments` | `lib/attachments.mjs` via `ctx.get('attachments')` | images degrade to `[image]` placeholders |
| `agentDefaultModel`, `llm` | `lib/budget.mjs` | budget falls back to the static default |
| `sessions` | `lib/purge.mjs:70-77` (detach live store) | no-op |
| `webServer`, `skills`, `commands`, `settings` | `ctx.inject` (`lib/index.mjs:67, 72`; `lib/import-prefs.mjs:208`; `lib/command.mjs:43`; `lib/ignore-command.mjs:22`; `lib/resume-command.mjs:14`; `lib/ignore-watch.mjs:29`) | panel/routes/commands/prefs simply not mounted |

### 6.4 The genuinely version-sensitive parts

These are not service-presence issues; they encode **host session-format generations** and would
break silently-ish (loudly, at least) on a host that moved on:

1. **Session format generations.** `KNOWN_HOST_VERSIONS = [3, 4]` (`lib/host-session.mjs:222`). Any
   higher version is handled by producing the newest known shape **plus** a one-time console error
   naming the version (`:188-192`). Version discovery is a 3-way probe —
   `sp.formatVersion` / `sp.currentVersion` (`:72-78`), else max `header.version` from `list()`
   (`:118-121`), else `SESSION_FORMAT_VERSION`.
2. **`surfaceOp` field naming is host-generation-dependent** (`:196-219`): `dsh-session ≤ 0.1.x`
   runtime accepts `{op:'replace', start, end}`; `dsh-session ≥ 0.2.0` accepts only
   `{op:'replace', startSeq, endSeq}`, and writing the old names on a V4 host makes the host refuse
   the whole log. The plugin normalizes both directions based on the **native** host version.
3. **V4 producer-kind renaming table** (`:236-260`) mirrors the host's
   `dsh-session-format-v3-to-v4` `producerKind()` — `compact → compact-checkpoint`,
   `tools-code-mode`/`tools-ptc → ptc-mode`, `dsh-compaction-basic → compact-basic`,
   `@deepseek-ai/dsh-system-prompt → runtime-context` (or `system-prompt` in the `system` role).
4. **Host header whitelist** `HOST_HEADER_FIELDS` (`:140`) — any extra key makes the host reject the
   create with `format v2 header has unexpected field …`; `cwd` must be absolute or is dropped
   (`:153`), and `createdAt` must be a non-negative safe integer (`:155`).
5. **`sessionPersistence` has two ABI shapes** and the plugin adapts both (`:406-506`): handle-style
   (`list() → [{header, revision, sizeBytes}]`, `open(id,'read')`, `create(header) → handle` with
   `append`/`flush`/`close`) and direct-write style (`readFrom`, `create(header)` returning nothing,
   `append(id, events)`). **[measured]** The installed `dsh-session-persistence-jsonl` exposes
   `create` (:2431), `open` (:2454), `list` (:2569), `append` (:116), `locate` (2 hits), `inspect`
   (1 hit), `currentVersion` (:1895) — the **handle** shape. It has **no `remove` and no `readFrom`**
   (0 hits), matching the plugin's own note 「上游缺口：sessionPersistence.remove(id) / fs.removeFile
   未提供」 (`lib/imports.mjs:21-22`, `lib/retract.mjs:3-6`); `purge.mjs:228-230` calls `sp.remove`
   best-effort inside a `try/catch` for exactly this reason.
6. **Tool-result shape is mutually exclusive across V3/V4** (`:164-170`), so append shapes follow
   the *target session's* own header version, not the host's (`:294-300`).
7. **Ghost/taken-id error detection** matches both `err.name` classes
   `SessionAlreadyExistsError` / `SessionAlreadyOwnedError` **and** the message text
   `/already exists|duplicate session|already owned by an active write handle/i`
   (`:399-404`) — deliberately version-tolerant.

**[inference]** Points 2 and 3 are the highest-risk items on `dsh 0.1.7-rc.2`: the installed host is
`≤0.1.x`, so the `start`/`end` spelling and the V3 `source.kind:'plugin'` shape are correct there;
a `≥0.2.0` host would exercise the other branches, which I have not run. Everything else degrades
through explicit try/catch with a documented fallback rather than an exception at plugin load.

---

## Summary of the headline answers

1. **12 tools**, of which **`import_chat` is the session importer** (`lib/toolkit.mjs:284`); it
   takes a **required, unrestricted `path`**. The other importers: `restore_bundle` (bundles only).
2. **`format` picks the source adapter (30 values); `parseFormat` picks the converter inside the
   `local-jsonl` auto-detector (11 values).** `~/.openclaw` is a *default root* and a *path hint*,
   never a gate — **`format:'local-jsonl'` + `parseFormat:'openclaw'` on an arbitrary absolute path
   works**, losing only the sidecar `sessions.json` title and the stem-derived id.
3. **Registry** = `$DSH_HOME/dsh-chat-import/imports.json`, JSON, no config option. Re-import skips
   on a stat/fingerprint match; grows trigger an **implicit append**; anything ambiguous casts a
   new suffixed copy and keeps the old session. **`replace` deletes artifacts and recreates under
   the same id** — but is unreachable from the tool schema. **No sync mode, no receipt table, no
   content hash stored** (SHA-256 exists only for caller-supplied `expectedHash`, bundles, uploads).
4. **11 SQLite sources** (opencode V1/V2, mimocode, kilocode, teleagent, zcode, goose, zed, crush,
   trae, cline, hermes). **zeroclaw/openclaw SQLite is not supported** — openclaw is JSONL-only, and
   `session_metadata` / `jsonl_import_receipts` / FTS appear nowhere in the package.
5. **Config = 3 volatile options** (`importSystemPrompt`, `injectTools`, `sidebarButton`);
   `cordis.patch.yml` inserts a single row `import-claude`; there is **no `registryDir` config**.
6. **Compatible with dsh 0.1.7-rc.2** in the sense that the hard gate
   (`TOOL_RUNTIME_SCHEDULER`, `>=0.1.0-rc.6 <0.3.0`) passes, all three hard services exist, and
   `schemastery@3.18.4` supplies `.volatile()`. The version-fragile surface is the **session-format
   generation layer** (`surfaceOp` spelling, V4 producer-kind table, header whitelist), not service
   discovery.
