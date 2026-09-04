---
description: "Expose native Memory search and revision-checked mutations as model tools with bounded pinned context."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-memory

English | [中文](README.zh.md)

## Summary

This Consumer exposes `memory_search`, `memory_read`, `memory_write`, `memory_update`, and `memory_forget`. Every call requires an owning Agent. Global records are visible to all agents; workspace records are bound to the exact `agent.session.header.cwd`. The tool schema never accepts an arbitrary workspace path, and read/update/forget report an inaccessible id exactly like a missing id.

`memory_write` requires the model to choose `global` or `workspace`; omitted tags and `pinned` resolve explicitly to `[]` and `false`. Updates and deletion require a current positive revision. The guidance section tells the model to write only after an explicit remember or durable-preference request, and forbids credentials, authentication codes, raw transcripts, and transient state.

Pinned records from the accessible scopes become a `memory:pinned` runtime-context contribution. The text identifies them as untrusted historical data rather than instructions, XML-escapes every stored field, includes ids and revisions, and admits only complete records under `maxContextBytes`. Standard prompt assembly logs the resolved runtime-context snapshot before it reaches the model.

## Table of Contents

- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Configuration

| Key | Default | Contract |
|---|---:|---|
| `maxSearchResults` | `20` | Result count requested from `ctx.memory` per search tool call. |
| `maxContextRecords` | `20` | Maximum pinned records considered for one prompt assembly. |
| `maxContextBytes` | `8192` | Maximum UTF-8 bytes in the complete pinned context contribution. |

Every value must be a positive safe integer and must not exceed the Provider's corresponding search limit.

## Model Experience

### System prompt

#### What the model sees

Every request in this plugin's registration scope receives the fixed Memory-use and secret-handling guidance below.

##### Memory guidance

```markdown
Use native Memory only for durable user preferences, stable project facts, and decisions that will matter in later sessions. Search when prior context is relevant. Write only when the user explicitly asks you to remember something or clearly requests a durable preference change. Never store credentials, authentication codes, raw conversation transcripts, or transient task state. Read a record before updating or forgetting it, and pass its current revision.
```

#### Token effect

One small fixed guidance paragraph is present on every request while the plugin is active.

#### KV Cache effect

Prefix-stable while the plugin scope and guidance text remain unchanged.

### Tool schemas

#### What the model sees

The generated [`memory_*` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-memory) expose lexical search, exact reads, explicit writes, revision-checked updates, and revision-checked forgetting. Workspace paths never appear as model-supplied arguments.

#### Token effect

Five fixed schemas are present on each request where the tools are visible.

#### KV Cache effect

Prefix-stable while tool definitions and scoped visibility remain unchanged.

### Pinned runtime context

#### What the model sees

Accessible pinned records appear in the `memory:pinned` context as XML-escaped, untrusted historical data with ids, scopes, revisions, tags, and text. Only complete records fit under `maxContextRecords` and `maxContextBytes`.

#### Token effect

Data-dependent and capped by `maxContextBytes`; unpinned records add no automatic context tokens.

#### KV Cache effect

Changing an accessible pinned record changes the durable runtime-context snapshot and invalidates prefix reuse from its first difference.

### Tool-call history and results

#### What the model sees

Assistant calls retain the submitted query or mutation fields. Results retain matching record text, ids, scopes, tags, pin state, revisions, and timestamps; failures retain the normalized tool error. Search count is capped by `maxSearchResults`, while Provider text and tag limits bound each record.

#### Token effect

Data-dependent call and result tokens remain in session history until compaction.

#### KV Cache effect

Append-only history preserves prior prefix reuse; later calls and results extend the uncached suffix.

## Known Limitations and Deferred Work

No runtime invariant companion is published because this Consumer projects provider-validated records without owning independent mutable state.

- Optional automatic conversation curation is owned by [`dsh-memory-curator`](../memory-curator/README.md); this package's write/update/forget tools retain their explicit-request policy.
- There is no record-management screen or secret detector; current controls are the Memory settings switches plus explicit model tools and prompt policy.
- Pinning is boolean. Priority, expiry, per-agent scope, and token-aware semantic selection are deferred.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
