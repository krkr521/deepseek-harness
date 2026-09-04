---
description: "Use Codex Responses native compaction for codex routes while preserving Harness compaction policy and durable state."
kind: "package-reference"
---

# @deepseek-ai/dsh-codex-native-compaction

English | [中文](README.zh.md)

## Summary

An opt-in compaction Service Provider that uses Codex Responses native compaction for conversations routed to the `codex` provider. It preserves Codex's opaque compaction item as durable model-visible state, then reuses the basic backend's pressure, retention, pruning, transaction, convergence, manual command, and context-overflow recovery behavior.

This package implements the same `ctx.compaction` service as [`dsh-compaction-basic`](../compaction-basic/README.md). Load exactly one compaction backend in a composition.

## Table of Contents

- [Behavior](#behavior)
- [Adapter contract](#adapter-contract)
- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Behavior

For a latest durable request routed to `codex`, the provider calls `ctx.llm.stream()` once with the selected history prefix, the original system prompt and tools, and `GenerateOptions.purpose: 'provider-compaction'`. A compatible Codex adapter maps that purpose to a Responses `compaction_trigger` input item and returns exactly one `codex-compaction` content block containing the complete provider item, including fields unknown to the harness.

The provider commits that block directly as the replacement `user/message` content. It does not add the basic backend's preamble or `<compacted-summary>` tags. The replacement is still a normal durable surface event with the canonical compact-checkpoint source, so session reconstruction, source-event validation, token accounting, pruning, retry admission, and manual `/compact` all use the existing compaction lifecycle.

The next Codex request replays the stored item as a standalone Responses input item, followed by the retained recent messages in their original order. A provider-level `llm/stream` listener rejects a request that tries to send a stored Codex checkpoint to another provider with `UNSUPPORTED_PROVIDER_STATE`; silently omitting opaque state would lose the compacted history.

For a route whose provider is not `codex`, this class delegates to `BasicCompactionEngine.summarize()`. Mixed-provider deployments can therefore use one backend while retaining portable text checkpoints for their non-Codex routes. A manual one-shot target also uses the basic text summarizer unless both the conversation and selected target use `codex`; this prevents an opaque item from landing in a conversation whose next provider cannot consume it. A Codex conversation with a selected Codex model uses that model natively, while omission uses the conversation's routed Codex model.

## Adapter contract

The Codex adapter and this provider divide ownership as follows:

- The provider owns pressure policy, range selection, durability, shrink validation, and admission of stored state.
- The adapter owns the Codex wire protocol: it appends one `compaction_trigger` only for `provider-compaction`, converts the returned Responses `compaction` item into one `codex-compaction` block, and expands a stored block back to the exact item.
- The adapter must preserve unknown item fields. The harness treats `encrypted_content` as opaque and validates only that the item is a non-empty Codex `compaction` item.
- A native compaction response containing no block, multiple blocks, text, tool calls, or an invalid item fails the bracketed transaction without replacing the conversation surface.

An adapter without this contract must not be used with a Codex-routed conversation under this provider. The shipped DeepSeek adapters implement only portable text compaction and do not synthesize Codex state.

## Configuration

`CodexNativeCompactionEngine` accepts its local `Config`, which inherits every `BasicCompactionConfig` field unchanged. Threshold, retention, per-model pressure policies, retries, overflow recovery, the optional tool-result pruner, and `auto` have the meanings documented by [`dsh-compaction-basic`](../compaction-basic/README.md).

`summarizationProvider`, `summarizationModel`, and `maxTokens` still apply to the basic fallback used by non-Codex routes. A manual provider/model pair overrides the fallback route once. For a Codex conversation, a selected Codex pair chooses the native request model; configured summarization fields do not alter a native request, and the Codex adapter owns native compaction output limits and protocol details.

```yaml
- name: '@deepseek-ai/dsh-token-meter'

- name: '@deepseek-ai/dsh-compaction-tool-result-pruner'

- name: '@deepseek-ai/dsh-codex-native-compaction'
  config:
    thresholdRatio: 0.8
    retainRatio: 0.16
    compactionRetries: 1

- name: '@deepseek-ai/dsh-command-compact'
```

The package is present in the CLI resolver manifest but is not selected by shipped presets. A deployment opts in by replacing `@deepseek-ai/dsh-compaction-basic` with this package and by installing a Codex adapter that implements the native block contract.

## Model Experience

### Conversation request after compaction

#### What the model sees

The Codex model receives one opaque native compaction item in the Responses input, followed by the recent messages retained verbatim by the normal compaction policy. It does not receive a DSH-authored summary preamble, XML-like tags, or a textual approximation of the older history.

#### Token effect

The token effect is a replacement: the selected older range leaves the future input and the opaque item stands in for it. The recent tail remains unchanged. Because the item is opaque, DSH estimates its size conservatively for shrink validation and future pressure measurement rather than inspecting provider state.

#### KV Cache effect

The KV-cache effect is provider-defined. The compaction request replays the same system, tools, and selected prefix, while the subsequent conversation request contains the native item plus retained tail instead of the original prefix.

### Auxiliary compaction request

#### What the model sees

The adapter receives the original system prompt, tool schemas, and selected messages plus a model-hidden `provider-compaction` purpose. A compatible Codex transport appends a `compaction_trigger`; it does not add a user-authored summarization instruction. The response must contain exactly one opaque compaction item.

#### Token effect

Native compaction adds one Codex request over the selected prefix and its provider-defined opaque output. A manual non-Codex target instead adds one portable text-summary request. `maxTokens` applies only to the text fallback.

#### KV Cache effect

The auxiliary request preserves the conversation's system, tools, and selected-message prefix, so the provider can reuse any matching cache state; the appended trigger is the only new input item.

## Known Limitations and Deferred Work

No runtime invariant companion is published because provider-state admission and the inherited compaction transaction enforce the live relationships at their owners.

- Native checkpoints are not portable across providers. Changing a compacted session from `codex` to another provider fails before dispatch.
- Model-to-model compatibility within the Codex provider is controlled by the remote Responses implementation. This package preserves the item losslessly but does not decrypt or reinterpret it.
- Generic clients that do not understand `codex-compaction` may need a presentation fallback; the durable session remains valid because the block uses the merge-extensible LLM content vocabulary.
- The Codex adapter currently lives outside this repository. Loading this provider without an adapter that implements `provider-compaction` causes native requests to fail rather than fall back silently.
- Provider protocol fields may evolve. Lossless item storage protects unknown fields, but a breaking remote change can still require an adapter update.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
