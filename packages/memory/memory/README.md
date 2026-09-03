---
description: "Define durable Memory records, scopes, revision-checked mutations, deterministic search, and change events."
kind: "package-reference"
---

# @deepseek-ai/dsh-memory

English | [中文](README.zh.md)

## Summary

`MemoryStore` is the abstract `ctx.memory` Service Definition for durable cross-session facts. It owns branded `MemoryId` values, global and exact-workspace scopes, immutable records, deterministic search requests, optimistic revisions, expected failure codes, and the post-commit `memory/changed` event. Providers must expose synchronous detached reads from current state and resolve mutations only after durable commit.

`MemoryRecord` carries `text`, ordered unique tags, `pinned`, optional source session attribution, revision, and ISO timestamps. `create()` starts at revision 1; `update()` and `remove()` require the caller's current `expectedRevision`, preventing a stale model or UI from overwriting a later correction.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Model Experience

Indirectly, through Consumers such as `dsh-tool-memory`, which own model authority and presentation.

#### KV Cache effect

None; the Service Definition never assembles a model request.

## Known Limitations and Deferred Work

- The contract has no automatic curator, embedding API, expiration field, or namespace beyond global and exact workspace scopes.
- Authorization belongs to each Consumer; direct trusted callers receive the scopes they request.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
