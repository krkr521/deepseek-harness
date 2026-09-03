---
description: "Model routing for the Web GUI: /model, the composer model seat, and the one-shot /compact picker over one per-session provider-grouped directory."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-model-selection

English | [中文](README.zh.md)

## Summary

This package provides model routing in the Web GUI: the `/model` popup command, the composer's model seat, and the bare `/compact` picker all read one per-session directory of provider-grouped models. `/model` and the composer submit the complete conversation selection — provider, model, and reasoning effort — which the Host snapshots at the next prompt-assembly boundary. The `/compact` picker instead submits one exact provider/model route for that compaction only and leaves the conversation selection unchanged. The composer seat shows a two-level Model/Effort menu, and the input goes inert when the Host reports that no adapter serves the conversation route.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin alongside `ui-conversation` and the commands package; the composer then shows the model seat next to the pending indicator, `/model` opens the same directory for durable conversation selection, and a bare `/compact` opens it for one-shot compaction routing. The model-selection surfaces show the Host-reported current selection when the exact provider/model pair remains in the advertised groups; a missing catalog row leaves the routable selection intact while the trigger prompts `Select model`.

### Model and effort

Models stay grouped by provider. The menu shows model and effort names only; catalog descriptions remain available to other consumers. The `/model` popup applies the selected model's default effort; the composer can then choose any advertised effort. An adapter without reasoning metadata leaves the Effort row absent; there is no arbitrary effort input.

### One-shot compaction

Choose `/compact` from the slash menu or submit the bare command to open a searchable model picker. Each row shows the model name plus the provider display name and exact `provider/model` ids. Selecting a row runs `/compact <provider> <model>` without changing the conversation model. Typing `/compact <provider> <model>` directly remains available and bypasses the picker.

### Unroutable sessions

When the Host reports that no adapter serves the session's route, this plugin raises a composer block and the input goes inert with its own copy; recovering clears it without a reload. A `null` before the first load or after one failed never blocks, and catalog membership never blocks either — a route serving a model it does not advertise is missing from the groups yet usable.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Three entries read ONE per-session directory owned by `ModelDirectoryResolver` (`ctx.modelDirectories`). The `/model` popupSelect contribution and the composer's named `conversation.input.model` seat load the advisory directory through `session.models` and submit durable selection through `session.selectModel` via the same `ModelDirectory` instance, so a switch made in either entry is what the other shows next. The `/compact` decoration uses the same loaded rows but sends the selected provider/model ids through `session.command`; because only the bare invocation is decorated, the Host retains the argued command path and lifecycle logging. Directory loads and selections share a generation counter so an older response never overwrites a newer one; a connection reset drops every resident projection and repulls the Host-restored selection. Directories are per-session, resolved lazily, and disposed with the session scope; addressed subagent sessions expose none of the entries. Every resident directory refetches directly on forwarded `llm/adapters-updated` and `settings/document-updated` owner events.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the model surface is not enough. They move from the browser surfaces to the command popup shell and the selection contract.

- [ui-commands](../ui-commands/README.md) — the popupSelect shell used by `/model` and the bare `/compact` decoration.
- [ui-conversation](../ui-conversation/README.md) — declares the composer's `conversation.input.model` seat and the composer block.
- [dsh-agent-default-model](../../core/agent-default-model/README.md) — the default-model service for sessions that never choose.
- [Client package map](../README.md) — adjacent browser UI packages.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `session.selectModel` and `session.command`: the Host owns the durable conversation route and any auxiliary compaction request initiated by the picked exact route.

#### KV Cache effect

Switching the conversation route can reduce or invalidate provider-side cache reuse for subsequent requests; manual compaction changes the retained history prefix after it succeeds, so later requests do not preserve the same prompt-cache prefix even though the conversation route is unchanged.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the current model surface. They are current package constraints, not a general model-router comparison or a task backlog.

- **No create-time or addressed-subagent selection** — all three entries require an existing ordinary session's Agent; there is no draft-phase model choice to fold into session creation, and subagent continuation deliberately exposes no independent model-routing contract.
- **Directory names are presentation-only** — selection and persistence use provider/model/effort ids; a provider whose catalog or exact-model metadata lookup fails lists as an unselectable failure row until reload.
- **The compaction picker is catalog-backed** — the Web picker lists advertised models only. Direct `/compact <provider> <model>` input can still target an exact route that the Host serves but does not advertise, and non-Web clients keep that direct grammar without the picker.
- **No arbitrary effort input** — the composer offers only the exact model's adapter-advertised levels; an adapter without reasoning metadata leaves the Effort row absent.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. A single command contribution registration whose disposal is proven by the HMR-safety spec — it emits no cordis events and owns no cross-plugin mutable state.
