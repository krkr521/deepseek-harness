# Native Memory

English | [中文](memory.zh.md)

Native Memory is an optional cross-session capability seam: [`dsh-memory`](../../packages/memory/memory/README.md) defines `ctx.memory`, [`dsh-memory-local`](../../packages/memory/memory-local/README.md) implements it over `ctx.storageDomain`, [`dsh-tool-memory`](../../packages/memory/tool-memory/README.md) consumes it through model tools and pinned runtime context, and [`dsh-memory-curator`](../../packages/memory/memory-curator/README.md) optionally curates completed chats behind persisted settings. It is not part of the agent-loop spine.

## What belongs in Memory

Memory stores small, self-contained facts that should remain useful in later sessions: an explicit user preference, a stable project convention, or a durable decision. Session logs remain the source of conversation history; session-query finds prior events; compaction preserves one session's usable surface; skills contain authored procedures and files. A Memory record may cite its source session id for provenance, but it neither copies nor indexes that session.

The explicit tool Consumer instructs the conversation model to write only after the user asks it to remember something or requests a durable preference change. The separate automatic curator is disabled by default and applies a stricter durable-fact prompt after eligible completed turns. The Provider itself is trusted infrastructure and does not infer whether text contains a secret; deployments remain responsible for provider-side safety and retention policy.

## Records and scopes

Every record has a branded id, `text`, ordered tags, `pinned`, optional `sourceSessionId`, a positive revision, and create/update timestamps. Scope is either `global` or `workspace` with one absolute `cwd`. The local Provider compares workspace path strings exactly; canonicalization or cross-machine path mapping belongs above this seam.

The model Consumer derives all scopes from the calling Agent. It never accepts a raw workspace path: `global` selects only global records, `workspace` selects the current session cwd, and `all` combines both when a cwd exists. Read, update, and forget first load the record and return the same missing error when its workspace scope is inaccessible, preventing id probing across workspaces.

## Durability and concurrency

The local Provider owns Storage Domain `memory`, format version 0, with one `records` table. `dsh-storage-domain` validates every stored record at open, keeps authoritative in-memory values for synchronous reads, queues durable writes, and emits its own storage changes after commit. `dsh-memory-local` additionally serializes logical operations so record-limit checks and revision-checked changes cannot interleave through the service.

Create commits revision 1. Update and forget require `expectedRevision`; a stale caller receives `MEMORY_REVISION_CONFLICT` and must read again. Successful create/update/remove operations emit `memory/changed` only after durability. Observer failures are contained because they cannot roll back a committed write.

## Search and pinned context

Search is a deterministic in-memory lexical scan over lower-cased text and tags. An exact phrase match ranks above an all-token match; requested tags are ANDed; results then sort by score, newest update, and id. The first implementation intentionally has no embeddings, network dependency, fuzzy matching, or session-history fallback.

Pinned accessible records are rendered into the `memory:pinned` dynamic context. The contribution marks records as untrusted historical data rather than instructions, XML-escapes stored fields, includes the id and revision, and admits only whole records under configured record and byte limits. Standard system-prompt assembly turns that resolved text into a durable runtime-context snapshot, satisfying the model-visible-is-logged rule. Unpinned memories enter model history only through logged tool results.

## Automatic curation and source policy

The `memory-curator` settings namespace owns two live switches. `enabled` controls whether completed human turns produce an auxiliary curation request. `allowToolSources` controls whether a turn that used any tool—including MCP and web search—can be a source at all. When it is false, the Consumer skips the entire tool-bearing turn instead of merely deleting `tool/result`, because the assistant answer may already derive from that result.

An eligible turn is framed with the latest accessible global and exact-workspace records. The auxiliary model can return strict JSON create or revision-checked update operations; automatic deletion is not accepted. Before model dispatch, `memory/curation-request` logs the exact source event seqs, source-policy value, route, system prompt, message list, and output cap. After all operations commit, `memory/curation-applied` links the accepted operations to that request seq. The request is tagged `purpose: 'memory-curation'`, and the DeepSeek adapter disables thinking for this bounded JSON task. A curation failure is contained after the user turn and does not change its completion result.

## Opt-in composition

The capability is not enabled by the base or Web bundle. A Web deployment can layer the optional [`dsh-web-memory`](../../packages/bundle/web-memory/README.md) bundle after `dsh-web-app`; it composes the local Provider, both Consumers, and the settings page while keeping automatic curation off until its switch is enabled. A custom deployment can instead compose the rows directly; the backend and budgets remain deployment choices.

```yaml
- name: '@deepseek-ai/dsh-storage'
- name: '@deepseek-ai/dsh-storage-json'
  config:
    root: .dsh/storage
- name: '@deepseek-ai/dsh-storage-domain'
  config:
    backend: json
- name: '@deepseek-ai/dsh-memory-local'
  config:
    maxRecords: 10000
    maxTextBytes: 16384
    maxTags: 16
    maxTagBytes: 64
    maxSearchResults: 100
- name: '@deepseek-ai/dsh-tool-memory'
  config:
    maxSearchResults: 20
    maxContextRecords: 20
    maxContextBytes: 8192
- name: '@deepseek-ai/dsh-memory-curator'
  config:
    enabled: false
    allowToolSources: false
- name: '@deepseek-ai/dsh-client-ui-memory'
```

The concrete config rows must be placed where their required core services (`ctx.tools` and `ctx.systemPrompt`) already exist. Provider `maxSearchResults` must be at least both Consumer result limits.

## Deferred work

The first automatic curator supports create and update only, with prompt-level secret policy and a whole-turn tool-source gate. Record management UI, automatic content classification, expiry, contradiction workflows, and automatic deletion remain separate decisions. Semantic retrieval can likewise arrive as a sibling Provider without changing either Consumer's authority rules.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxmemory--memorystore-abstract-seam"></a>

### `ctx.memory` — `MemoryStore` (abstract seam)

Durable cross-session memory service. Reads are synchronous projections of provider-owned current state; mutations resolve only after durable commit.

```ts cordis-catalog
/**
 * Read one memory by id.
 * @param id - Memory id.
 * @returns an immutable detached record, or `undefined` when absent.
 */
abstract get(id: MemoryId): MemoryRecord | undefined

/**
 * Search authorized scopes using provider-defined ranking.
 * @param request - Resolved scopes, filters, and result limit.
 * @returns deterministic immutable hits.
 */
abstract search(request: MemorySearchRequest): readonly MemorySearchHit[]

/**
 * Create one durable memory.
 * @param request - Fully resolved memory fields.
 * @returns the committed record.
 */
abstract create(request: MemoryCreateRequest): Promise<MemoryRecord>

/**
 * Replace selected fields when the expected revision is current.
 * @param request - Memory id, expected revision, and non-empty patch.
 * @returns the committed next revision.
 */
abstract update(request: MemoryUpdateRequest): Promise<MemoryRecord>

/**
 * Forget one memory when the expected revision is current.
 * @param request - Memory id and expected revision.
 * @returns resolution after durable removal.
 */
abstract remove(request: MemoryRemoveRequest): Promise<void>
```

Source: [`packages/memory/memory/src/index.ts`](../../packages/memory/memory/src/index.ts)

<a id="memory-events"></a>

### `memory/*` events

<a id="memorychanged--emit"></a>

#### `memory/changed` — emit

Emitted after one memory mutation commits durably.

```ts cordis-catalog
/**
 * Emitted after one memory mutation commits durably.
 * @param change - Committed create, update, or remove observation.
 * @mode emit
 */
'memory/changed'(change: MemoryChanged): void
```

Source: [`packages/memory/memory/src/index.ts`](../../packages/memory/memory/src/index.ts)
<!-- END GENERATED cordis-surface -->
