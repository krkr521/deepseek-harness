# memory/ — native cross-session Memory capability family

English | [中文](README.zh.md)

This family stores small, explicit facts that should survive across sessions. It is separate from session logs, session search, compaction summaries, and filesystem skills.

| Package | Role | ctx key |
|---|---|---|
| [`memory/`](memory/README.md) | Defines durable records, scopes, revision checks, and search operations | `ctx.memory` |
| [`memory-local/`](memory-local/README.md) | Persists the service through `ctx.storageDomain` and performs deterministic lexical search | `ctx.memory` |
| [`memory-curator/`](memory-curator/README.md) | Curates completed chats into create/update operations behind live privacy switches | reads `ctx.memory`, `ctx.llm`, and Session events |
| [`tool-memory/`](tool-memory/README.md) | Adds explicit model CRUD/search tools and bounded pinned runtime context | registers on `ctx.tools` and `ctx.systemPrompt` |

The subsystem reference, composition example, authority rules, and retention boundaries are in [docs/subsystems/memory.md](../../docs/subsystems/memory.md).
