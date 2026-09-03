# Agent Note: Native cross-session Memory capability

Status: implemented

English | [中文](2026-08-23-native-memory-capability.zh.md)

## Problem

Durable session logs, compaction summaries, searchable prior sessions, and filesystem skills already preserve different kinds of context, but none owns a small explicit fact that should be available in a later unrelated session. Treating a session log as a preference database exposes excess history; putting facts in skills mixes user data with authored procedures; process-local maps disappear on restart. Third-party Memory MCP servers can fill the product role, but they do not provide a native typed service, shared scope policy, Storage integration, or guaranteed model-visible logging.

## Decision

Native Memory is an optional capability seam with three packages. `@deepseek-ai/dsh-memory` defines `ctx.memory`, branded ids, immutable records, global/exact-workspace scopes, synchronous current-state reads, deterministic search requests, revision-checked mutations, stable error codes, and the post-commit `memory/changed` event. `@deepseek-ai/dsh-memory-local` implements the service over version-0 Storage Domain `memory`. `@deepseek-ai/dsh-tool-memory` consumes it through five explicit tools and bounded pinned runtime context.

The first Provider keeps an authoritative in-memory projection backed by the configured Storage Domain backend. It serializes logical mutations, enforces configurable record/text/tag/search limits, validates durable data through zod on reopen, and uses optimistic revisions for update and remove. Search is a deterministic lexical scan of text and tags; the seam does not imply embeddings or network retrieval.

Model authority is derived from the calling Agent rather than model-supplied paths. Global records are visible everywhere. Workspace records are visible only when their stored `cwd` exactly equals `agent.session.header.cwd`; tool schemas expose the choices `global`, `workspace`, and `all`, never an arbitrary cwd. Read, update, and forget make inaccessible ids indistinguishable from missing ids. Writes attribute the calling session automatically.

Pinned accessible records are injected through `ctx.systemPrompt.context`. The rendered contribution labels stored values as untrusted historical data rather than instructions, XML-escapes every value, includes ids and revisions, and admits only complete records below configured record and byte limits. The existing runtime-context snapshot mechanism logs the resolved contribution before model use; unpinned records reach the model only through logged tool results.

The base bundle does not enable Memory. A deployment opts in by composing a Storage backend, `storage-domain`, `memory-local`, and `tool-memory`. The complete seam has a real Loader composition test that writes through `memory_write`, disposes the app, reboots the same JSON-backed configuration, and reads the durable record.

## Alternatives considered

- **Use session-query as Memory** — rejected because a broad historical search and an explicit curated fact have different retention, authority, and context-cost semantics. Memory may cite a source session but never indexes or copies its event log.
- **Store Markdown under the workspace** — rejected as the native service because filesystem location, merge behavior, scope, concurrency, and schema would become accidental conventions. A future Provider may deliberately project to files behind the same service.
- **Enable an existing Memory MCP server by default** — rejected because an external protocol server cannot own the harness's native service types, current-Agent workspace authority, Storage lifecycle, or prompt snapshot guarantees. MCP integrations remain valid opt-in alternatives.
- **Automatically summarize every completed turn into Memory** — deferred. Automatic retention requires a separately reviewed Consumer with explicit consent, redaction, contradiction, expiry, deletion, and evaluation policy. Binding it to the base Provider would make storage imply an unreviewed privacy decision.
- **Put Memory inside the agent loop** — rejected. Service, Provider, tools, and prompt context compose through documented extension points; the loop requires no change.
- **Use last-write-wins updates** — rejected because a model can act on an old search result after a user or another agent corrects the record. Expected revisions make that race visible and recoverable.
- **Truncate one oversized pinned record** — rejected because truncation can change the meaning of a fact. Pinned context includes a complete escaped record or skips it.

## Consequences

DSH now has a native durable fact store that survives application restarts and can be replaced independently from its model Consumer. Storage backend selection remains a composition decision, while workspace authorization and prompt safety remain Consumer decisions. The provider's domain record schema is pre-release format version 0 and has no compatibility promise.

The capability consumes no model tokens when its Consumer is absent. With the Consumer present, one stable guidance section is always visible; pinned records change runtime context and therefore request-prefix cache behavior, while unpinned records cost context only after search or read. All model-visible content remains reconstructable from the session log.

Exact workspace path comparison, linear lexical search, manual retention, and boolean pinning are intentional first-version limits. Semantic retrieval, canonical path identities, expiry/eviction, management UI, approval flows, and an automatic curator can evolve as sibling Providers or Consumers without changing the agent loop.

Follow-up: [Opt-in automatic Memory curation](2026-08-24-opt-in-automatic-memory-curation.md) implements the automatic-curator Consumer and settings UI while leaving the Service Definition, local Provider, scopes, revisions, and explicit tools unchanged.
