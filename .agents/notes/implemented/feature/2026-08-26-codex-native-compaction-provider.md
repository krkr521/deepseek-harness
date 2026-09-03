# Agent Note: Codex-native opaque compaction provider

Status: implemented

English | [中文](2026-08-26-codex-native-compaction-provider.zh.md)

## Problem

The generic compaction backend asks a model to write a text summary, frames that text as established user context, and retains a recent raw tail. Codex Responses exposes a different protocol: a compaction trigger returns an opaque provider item that a later Responses request consumes directly. Converting that item to text is impossible, while dropping unknown fields or sending the stored state to another provider can silently lose the compacted history.

The compaction capability already owns pressure, range selection, source-event citations, shrink validation, durable replacement, manual admission, and overflow recovery. A Codex implementation must preserve those invariants without duplicating the transaction or adding provider branches to `agent-loop`.

## Decision

`@deepseek-ai/dsh-codex-native-compaction` is an independent, opt-in Service Provider that subclasses `BasicCompactionEngine` and overrides only `summarize()`. It uses the latest durable conversation route. A `codex` route issues one direct `ctx.llm.stream()` call with the original system prompt, tools, selected messages, and `GenerateOptions.purpose: 'provider-compaction'`; every other route delegates to the basic text summarizer.

The Codex adapter maps `provider-compaction` to one Responses `{ type: 'compaction_trigger' }` input item. It returns one merge-extensible `codex-compaction` content block containing the complete `{ type: 'compaction', encrypted_content, ...unknownFields }` item. The provider requires exactly one valid block and preserves it in `compaction/summary` as the complete local-call output.

`SummaryResult.checkpointContent` is the basic transaction's provider-native replacement hook. When present, the transaction uses that exact block array for the canonical compact-checkpoint `user/message`; omission retains the basic backend's text preamble and `<compacted-summary>` framing. The hook does not change range selection, event brackets, source citations, shrink validation, or surface replacement semantics.

The adapter expands a stored `codex-compaction` block back to the exact standalone Responses item before the retained recent messages. A provider-level `llm/stream` listener rejects any request carrying this state to a non-`codex` route with `UNSUPPORTED_PROVIDER_STATE`. Unknown item fields remain opaque and lossless across output translation, JSON session persistence, reconstruction, and input translation.

The package is available to the CLI resolver but no shipped preset selects it. A deployment opts in only when its Codex adapter implements the native trigger and block contract. The general-purpose `compaction-basic` provider remains the default.

This decision complements rather than supersedes the [compaction capability seam](2026-06-18-compaction-capability-seam.md) and [reconstructable model requests](../architecture/2026-07-05-reconstructable-requests.md): it supplies a second backend through the existing subclass seam and makes the new provider-visible state reconstructable from the session log.

## Alternatives considered

- **Teach `agent-loop` about Codex compaction** — rejected because request lifecycle and retry ownership already belong to the compaction capability; a provider branch in the loop would duplicate the extension seam.
- **Store the opaque item outside the conversation surface** — rejected because a future model request would depend on state that the canonical session replay cannot reconstruct.
- **Serialize the item as text inside `<compacted-summary>`** — rejected because the encrypted item is provider protocol state, not model-readable summary prose, and the adapter must emit it as a standalone Responses input item.
- **Replace `compaction-basic` globally** — rejected because other providers need portable text summaries and because Codex transport support is currently adapter-specific.
- **Fall back to text when native output is invalid** — rejected because a protocol regression would become invisible and could commit a checkpoint with different semantics from the requested native operation.

## Consequences

- The native provider inherits the mature compaction transaction, including deterministic pruning, retained-tail policy, convergence, failure brackets, manual `/compact`, and overflow retry proof.
- A successful Codex checkpoint is durable but provider-bound. Switching that session to another provider fails before dispatch; model compatibility inside the Codex route remains a remote-provider property.
- `GenerateOptions.purpose` includes `provider-compaction` as model-hidden adapter metadata. Generic text compaction continues to use `compaction`.
- `codex-compaction` extends the LLM content vocabulary. Consumers may render it generically, but adapters that own Codex replay must preserve the item exactly.
- Native response failure leaves the surface unchanged and records `compaction/end { error }`; automatic pressure may continue with the uncompressed history, while canonical overflow preserves the original request failure unless another durable reduction already advanced the surface.
- The existing compaction seam note's scoped active-record audit found no superseded decision. Its interface, transaction, and user-message carrier remain authoritative; this note owns only the Codex-native specialization.

## Verification

Focused provider tests pin native dispatch metadata, exact checkpoint content, retained raw tail, session reconstruction, non-Codex fallback, invalid-output rollback, and cross-provider admission failure. Adapter tests pin one trigger, non-mutation of translated input, lossless future fields, and exact output-to-input round-trip. A keyless assembled headless snapshot pins context-overflow recovery through `compaction/start`, opaque `compaction/summary`, the unframed replacement, `compaction/end`, and completion of the same turn.
