---
description: "The on-demand /compact command for interactive compositions: what it does, what you see, and how to mount it."
kind: "package-reference"
---

# @deepseek-ai/dsh-command-compact

English | [中文](README.zh.md)

## Summary

`dsh-command-compact` adds a `/compact` command to chat UIs: type it and the conversation condenses on demand — the older history is replaced by one summary even before automatic pressure triggers. Add a provider and model to choose the summarizer for that invocation without changing the conversation model. In the shipped Web GUI, the bare command opens a searchable picker that displays the exact provider/model ids before submitting that argument form. The command works with any condensation backend and does not consume a model turn; after it finishes you see how many history items were condensed and the estimated tokens saved. While the agent is mid-turn or condensation is already running, it tells you condensation is unavailable. Prompts you send while it runs stay queued and start after it finishes.

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

Type `/compact` in a chat UI when the conversation has grown long and you want to condense it immediately. The shipped Web composition opens a provider/model picker for the bare command; selecting a row submits `/compact <provider> <model>` with the exact catalog ids. You can also type that argument form directly when this summary should use a different model from the configured or current conversation route. Other command adapters keep the bare zero-argument form, which uses backend configuration. The shipped `dsh` base mounts the command next to the default backend, so it is usually already available.

### Using the command

| Input | Result |
|---|---|
| Bare `/compact` in the shipped Web GUI | Open the searchable provider/model picker; selecting a row condenses one useful balanced older span with that exact route. |
| `/compact` in a direct command adapter | Condense one useful balanced older span with backend routing even below automatic pressure, then report the replaced history-item count and estimated tokens. |
| `/compact codex gpt-5.6-luna` | Condense once with `codex/gpt-5.6-luna`; later conversation requests keep their existing route. |
| `/compact` with no compactable history | `No compactable history yet.` — nothing changes. |
| Any input other than zero or two arguments | `Usage: /compact [<provider> <model>]` — provider and model must be supplied together. |

### What you see

The command turns each expected failure into a stable message you can show directly; the situation on the left is what produced the message on the right.

| Situation | Message you see |
|---|---|
| Compaction already running, or the agent is mid-turn | `Compaction is unavailable because this process has an active compaction, or the agent is not idle.` |
| The history changed while condensing | `The history selected for compaction changed before it could be replaced. The conversation is unchanged; the attempt is recorded in the session log.` |
| No useful summary could be produced | `Compaction could not produce a useful summary. The conversation is unchanged; the attempt is recorded in the session log.` |
| Condensation did not finish cleanly | `Compaction did not finish cleanly; some session history may have changed. Inspect the current session state before retrying.` |
| The conversation could not be saved | `Compaction finished, but the session could not be saved.` |

Cancelling the command stops the wait: the backend finishes its required cleanup, and the command settles as `Compaction cancelled.` while the UI stops waiting. Failures other than these expected cases surface as errors rather than being silently converted.

### Composing the command

Mount the command registry, one condensation backend, and this plugin:

```yaml
- id: commands
  name: '@deepseek-ai/dsh-commands'
- id: compaction-basic
  name: '@deepseek-ai/dsh-compaction-basic'
- id: command-compact
  name: '@deepseek-ai/dsh-command-compact'
```

The shipped `dsh` base mounts it beside the default backend, and the Web client provides the command adapter. Automation surfaces that compose no command adapter keep automatic condensation only.

### What happens to the conversation

When the command succeeds, the selected older span is replaced by one summary and the recent history is untouched; the command reports the number of condensed items and estimated tokens. Prompts you submit while condensation runs are accepted and start only after it finishes — they are not lost or reordered. The command lifecycle is recorded in the session log but never enters model history.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the command; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

The command is built on three commitments:

- **Backend-independent control.** The handler depends only on `compactNow(agent, signal, options)`, so it works with any `CompactionEngine` implementation. The optional `summarizationTarget` is one-shot; the invoking agent remains the exact conversation target, and the dispatching UI's cancellation signal is forwarded through the seam.
- **The command lifecycle stays out of model history.** `command/run` and `command/done` are log-only events; `sourceEventSeq` correlates the successful result with the `compaction/summary` event without relying on text or row adjacency.
- **Quiescent teardown.** The lifecycle effect unregisters `/compact` before draining already-started handlers, so an aborted command's close and flush work settles before root disposal completes.

### Lifecycle and correlation

Every resolved invocation records the executor-owned log-only pair `command/run` / `command/done`; neither event joins model history. On success, `command/done.sourceEventSeq` names the transaction's `compaction/summary` event so a presentation can fold the command lifecycle into its checkpoint without parsing result text or assuming adjacent rows. The busy outcome is intentionally process-scoped: a live unmatched marker blocks, while a marker older than the newest `session/end-seed` is stale and does not. The plugin tracks each real handler promise and unregisters `/compact` before draining handlers that already started, so root teardown cannot pass an aborted command's close or flush boundary. Prompts submitted while compaction runs remain accepted in the agent's ordinary FIFO and start only after the compaction's explicit durability checkpoint and admission release; idle injected context may sit between `compaction/start` and `compaction/end` and stays visible after the checkpoint.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `/compact` registration, provider/model parsing, argument rejection, error-code mapping, lifecycle drain |
| — | No runtime invariant companion is published; this command adapter owns no state or event stream; the compaction seam owns the balanced durable transaction and the command registry owns registration and dispatch lifecycle. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough; they move from the command to the seam, the shipped backend, and the design decisions.

- [Compaction seam](../compaction/README.md) — the condensation contract this command triggers.
- [Compaction basic backend](../compaction-basic/README.md) — the shipped backend that condenses automatically and on demand.
- [Commands package](../../interaction/commands/README.md) — the registry and dispatch contract behind chat commands.
- [Web model selection](../../client/ui-model-selection/README.md) — the catalog-backed picker decorating the bare Web invocation.
- [Compaction subsystem reference](../../../docs/subsystems/compaction.md) — the condensation vocabulary, results, and service behavior.
- [Queued manual compaction Agent Note](../../../.agents/notes/implemented/feature/2026-07-30-queued-manual-compaction.md) — how on-demand condensation serializes against running turns.

-----

<a id="model-experience"></a>
## Model Experience

### Human `/compact` control

#### What the model sees

The slash input and direct result never enter a model request. An accepted compaction separately replaces an older span with the backend's user-role checkpoint inside a standalone `compaction/* { turn: null }` bracket.

#### Token effect

The command lifecycle adds no model tokens. A successful compaction reduces later requests by replacing the selected span with one framed summary; summarization itself is one auxiliary request through the selected one-shot route or the backend's default route. The selection does not change later conversation requests.

#### KV Cache effect

Discovery and command bookkeeping do not affect the cache. The accepted surface replacement invalidates reuse from the first shadowed history token.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the command is a poor fit; they are the current package constraints.

- **Idle-only** — `/compact` reports that condensation is unavailable when a turn or already accepted waking prompt has right of way; the command itself is not queued.
- **No range or retention arguments** — the argument form selects only the one-shot summary provider/model. Explicit ranges remain the programmatic `compactRegion()` path, and retention settings remain backend configuration.
- **The Web picker is advisory** — it lists advertised catalog rows only; direct argument input can still name an exact route the Host serves but does not advertise.
- **Command adapters only** — surfaces without `ctx.commands` cannot invoke it and rely on automatic pressure compaction.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers and is explicitly non-authoritative; shipped behavior lives in the sections above, the package code, and the linked Agent Notes.

- **Queued commands, undecided** — a `/compact` submitted while a turn has right of way reports `busy`; queuing the request instead of rejecting it remains an open direction.
- **Range and retention arguments, undecided** — the shared grammar owns only an optional provider/model pair; range and retention controls remain programmatic or deployment configuration.

</details>
