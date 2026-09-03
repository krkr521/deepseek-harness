# Agent Note: Workspace presentation collections

Status: implemented

English | [中文](2026-09-03-workspace-presentation-collections.zh.md)

## Problem

Some Workspace providers retain separate canonical directories for operational reasons while users understand them as one browsing area. A monthly default-chat provider is one example: every Session must keep the month directory as its `cwd`, but rendering one sidebar group per month exposes a storage detail as navigation structure.

Workspace membership cannot express this relationship. A Workspace owns only Sessions whose immutable header `cwd` equals its canonical path. Moving several monthly accounts under one real Workspace would either leave older Sessions ungrouped or require rewriting durable Session identity and storage.

## Decision

`ui-workspace` owns a client-side `workspacePresentation` service. A client plugin registers a stable collection key, display title, representative path, a path matcher, and an asynchronous resolver for the real Workspace that receives a new Session. Registrations are effects and publish an observable snapshot consumed by the sidebar and Workspace picker.

The tree replaces matching real Workspaces with one collection account at the first matching Workspace position. It combines the member Workspace accounts with Session summaries whose retained `cwd` matches the same policy. The latter rule keeps Sessions visible when an older canonical directory is no longer available and the Host therefore cannot project its Workspace membership.

Collections change presentation only. Real Workspace ids, Session headers, logs, archive state, and the Host registry remain unchanged. A collection header has no rename, delete, or Workspace-drag actions. Its combined Session order is browser-local; only a real Workspace group may write `insertSessionBefore` to the Host. Search and both Workspace pickers use the same collection title. New Session resolves the collection each time, so a long-running browser can target a newly created calendar period.

## Alternatives considered

**Register the parent directory as one real Workspace.** Rejected because Session membership requires exact canonical `cwd` equality, not ancestry.

**Rewrite historical Session headers and move their logs.** Rejected because this is a storage migration across Session logs, projection caches, usage records, and Workspace accounting, while the requested behavior is visual grouping.

**Let the default-chat package replace the sidebar slot.** Rejected because `sidebar.workspaces` is a single slot and replacing the complete browser would duplicate search, archive, ordering, dialogs, localization, and later Workspace features.

**Match only currently visible Workspaces.** Rejected because an unavailable historical directory removes its Workspace membership projection even though the Session summary still retains the authoritative `cwd` needed for safe presentation.

## Consequences

Collection matchers are same-process client callbacks and do not change the Host protocol. Registrations must use disjoint path policies; when multiple policies match, the first registration owns presentation. Collection keys are browser-state identities and must stay stable across changes to their member Workspaces.

Flat mode remains a cross-Workspace Session list. Removing a collection provider immediately restores the underlying real Workspace rows because the Host data was never changed.

## Testing

Tree tests cover multiple monthly Workspaces, a retained Session from an unavailable former user-home path, current-group expansion, ungrouped exclusion, and collection search labels. Picker tests cover one visible collection row resolving to the current real Workspace. Apply tests cover registration snapshots, disposal, and collection-key resolution. The default-chat package tests cover browser registration, preservation of an existing selection, path matching, protocol validation, and the shipped browser artifact.
