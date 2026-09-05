# Agent Note: ACP subagent observability extensions

Status: implemented

English | [中文](2026-08-30-acp-subagent-observability-extensions.zh.md)

## Problem

ACP streams standard progress only for the session addressed by the client. A DSH subagent runs in its own durable session, so its intermediate assistant output, reasoning, tool activity, plan, and lifecycle are absent from the parent's `session/update` stream. Standard session lineage also cannot distinguish an ordinary ACP session from a session whose durable `origin` is `subagent`.

An automation client could therefore wait for the parent tool result but could not inspect the current child tree or incrementally read a running or completed child's activity. Reading persistence artifacts directly in each client would duplicate codecs, bypass live state, and misclassify ordinary sessions from `parentSession` alone.

## Decision

`@deepseek-ai/dsh-acp` keeps the standard ACP surface described by [ACP as an automation-only protocol](../simplification/2026-07-23-acp-automation-only-protocol.md) and adds two DSH-owned custom methods in ACP's reserved `_` namespace. A client requests discovery with `_meta["_deepseek.ai/dsh"].subagents: true`; `initialize` responds with version 1 and the exact method names only when both the session store and subagent service are mounted. Generic clients receive no DSH metadata.

`_deepseek.ai/dsh/subagents/list` accepts a connection-owned root session and a direct-children or descendants scope. It delegates enumeration to `ctx.subagents.listChildren` or `listDescendants`; the subagent service remains authoritative for durable origin, mode, label, activity, diagnostics, and tree position. Ordinary sessions may be traversal nodes for deeper subagents but never become result rows.

`_deepseek.ai/dsh/subagents/activity` accepts the same owned root, one child id, an event-sequence cursor, and a bounded page size. The server re-lists descendants on every request and permits the read only when that service currently returns the target as a child. A live child reads its `Session.snapshotEvents()`; an inactive child opens a read-only persistence handle, reads events, and closes it after success or failure. Responses expose settled assistant messages and attempts with their embedded streams, tool calls and results, nested PTC dispatches, todo snapshots, and turn or step start and end. Unsettled model streams are not exposed by this method. `nextSeq` advances over excluded records after an exhausted page so polling does not rescan an invisible suffix.

Both methods require the root to remain in this ACP connection's owned session table. A caller cannot use a guessed child id to read an unrelated session, and closing the root removes that authority. The extension is read-only and does not resume, interrupt, message, close, or delete a child.

## Alternatives considered

**Infer children from `parentSession` in the Codex bridge.** Rejected because ordinary ACP sessions use the same lineage field and the client should not own DSH persistence semantics.

**Decode persistence artifacts in every automation client.** Rejected because this duplicates backend recovery rules, misses live-only events, and bypasses the subagent projection that owns descriptor versions and diagnostics.

**Add child activity to the parent's standard `session/update` stream.** Rejected because standard updates are scoped to their addressed session; multiplexing unrelated child ids would change interoperable ACP behavior and duplicate output already owned by child logs.

**Return every raw session event.** Rejected because request reconstruction, injected context, compaction state, and descriptor records are not automation progress. The explicit event set is versioned public behavior.

## Consequences

Opted-in ACP automation clients can discover the exact DSH subagent tree and poll observable activity during or after a run without becoming persistence consumers. Standard ACP clients remain unaffected, and deployments without the subagent service advertise no extension.

The activity method returns durable session events rather than editor cards. A host may preserve them, render them, or project selected fields into its own incremental API. Long polling, run retention, and host-side background execution remain client concerns rather than DSH ACP protocol state.

Protocol tests pin capability advertisement, direct and transitive listing, ordinary-session exclusion, live and persisted activity, event filtering, sequence pagination, root ownership, descendant authorization, and parameter validation.
