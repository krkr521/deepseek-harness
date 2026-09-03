---
description: "Persist native Memory records through Storage Domain and provide deterministic lexical search."
kind: "package-reference"
---

# @deepseek-ai/dsh-memory-local

English | [中文](README.zh.md)

## Summary

`LocalMemoryStore` is the persistent native Memory Service Provider. It opens the version-0 `memory` Storage Domain, stores records in the `records` table, keeps an authoritative in-memory projection for synchronous reads, and serializes create/update/remove operations. It can use any backend selected for that domain by `dsh-storage-domain`; JSON and SQLite storage backends therefore require no Memory-specific adapter.

Search is deterministic lexical matching over lower-cased text and tags. A phrase match ranks above an all-token match; tag filters are ANDed; ties use newest `updatedAt` and then id. No model embedding, network call, or session-log scan occurs.

## Table of Contents

- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Configuration

| Key | Default | Contract |
|---|---:|---|
| `maxRecords` | `10000` | Maximum durable record count. |
| `maxTextBytes` | `16384` | Maximum UTF-8 bytes in one trimmed text. |
| `maxTags` | `16` | Maximum unique case-insensitive tags per record or search filter. |
| `maxTagBytes` | `64` | Maximum UTF-8 bytes in one trimmed tag. |
| `maxSearchResults` | `100` | Maximum result limit accepted by the service. |

Every value must be a positive safe integer. Workspace scopes require an absolute `cwd`. Records are schema-validated again when the domain reopens; an incompatible or malformed stored record fails startup.

## Model Experience

Indirectly, through `dsh-tool-memory`, which turns durable records and ranking into model-visible tools and context.

#### KV Cache effect

None directly; storage changes do not themselves trigger or modify a model request.

## Known Limitations and Deferred Work

- Search is an in-memory linear scan and has no stemming, fuzzy matching, semantic embeddings, or secondary index.
- Exact workspace path strings are compared as stored; this Provider does not resolve symlinks, filesystem aliases, or cross-machine path mappings.
- The record limit is a hard refusal. Eviction and time-based retention require a separate policy Consumer.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
