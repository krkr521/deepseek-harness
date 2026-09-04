# Agent Note: Opt-in automatic Memory curation

Status: implemented

English | [中文](2026-08-24-opt-in-automatic-memory-curation.zh.md)

## Problem

Native Memory initially exposed explicit CRUD/search tools and pinned context only. That preserved clear write authority, but did not provide the product behavior users expect from a local-memory switch: once enabled, completed chats should be curated without requiring the conversation model to call `memory_write`. Tool-assisted chats require a second consent decision because assistant text can contain facts derived from MCP, web search, or another tool even when raw `tool/result` blocks are omitted.

Automatic curation is an auxiliary model call. Its exact input must remain reconstructable from the Session log, it must not delay or change the completed user turn, and malformed or over-broad output must not gain trusted write authority.

## Decision

`@deepseek-ai/dsh-memory-curator` is a sibling Consumer over `ctx.memory`, `ctx.llm`, and Session events. Its `memory-curator` settings section is live and has two independent booleans. `enabled`, default false, starts post-turn curation. `allowToolSources`, default false, admits turns containing `tool/call` or `tool/result`; while false, the whole tool-bearing turn is skipped. Whole-turn exclusion is the authority rule because visible assistant text can already be derived from tool output.

The Consumer handles completed turns only and defers work to the next microtask so it never re-enters `Session.append` from a `session/event` observer. It selects direct human messages and visible assistant text from committed `assistant/message` events; log-only `assistant/attempt` streams never supply curation sources. Admitted tool turns additionally include tool names, arguments, and visible result text. The frame includes the latest bounded records visible to the Session's global and exact-cwd scopes.

Before dispatch, the Consumer appends `memory/curation-request` with the source seqs, source-policy value, route, fixed system prompt, exact message list, and output cap. The request carries `GenerateOptions.purpose: 'memory-curation'`; DeepSeek disables thinking for this purpose. The call has byte, record, token, operation-count, and deadline limits. A configured provider/model pair overrides the latest logged conversation route.

The model returns strict JSON. Its vocabulary permits create and revision-checked update only. Every update id and revision must match a record supplied in that exact request; workspace creation derives cwd from the Session. The Consumer never accepts arbitrary paths or deletion. `ctx.memory` still owns validation, optimistic concurrency, durable commit, and post-commit notification. After every operation succeeds, `memory/curation-applied` links the accepted operations to the request seq. A failure is contained and logged after the turn, and plugin teardown waits for calls already in progress.

`@deepseek-ai/dsh-client-ui-memory` contributes a Memory settings page with the two switches. `@deepseek-ai/dsh-web-memory` is an optional bundle applied after `dsh-web-app`; it composes the local Provider, explicit tool Consumer, automatic curator, and settings page. The base and Web bundles do not include this opt-in layer, and the optional bundle still starts with automatic curation disabled.

## Alternatives considered

- **Let the conversation model call `memory_write` more aggressively** — rejected because a prompt preference is not a reliable settings switch, provides no hard tool-source gate, and ties curation quality to the main response loop.
- **Remove only tool-result events when the tool-source switch is off** — rejected because the assistant's visible answer can reproduce or summarize those results.
- **Run curation inside agent-loop** — rejected because Session events provide the required completed-turn extension point and keep the loop unchanged.
- **Allow automatic delete operations** — rejected because removal is destructive and contradiction resolution needs a separate user-facing policy. Explicit revision-checked forgetting remains available.
- **Mount the Memory stack in the shipped Web bundle** — rejected because installing an optional capability and enabling automatic retention are deployment and user choices. A separate bundle gives the settings page a real composition without changing default profiles.
- **Keep the auxiliary request out of the Session log** — rejected because the curation model sees chat and existing Memory content; model-visible input must be reconstructable even though the output changes a separate Storage Domain.

## Consequences

An installed Web Memory layer now matches the expected switch behavior: opening automatic Memory causes future eligible completed turns to be curated, and the second switch is an enforceable source gate rather than advisory copy. Explicit Memory tools retain their explicit-request guidance and work independently of automatic curation.

Enabled curation spends one auxiliary model call for each eligible completed turn and can create durable local records without a per-record confirmation. Input and output are bounded, failures do not change the user turn, and no automatic path deletes data. The settings page exposes no record browser; inspection, correction, and forgetting continue through revision-checked Memory tools.

The earlier [native Memory capability note](2026-08-23-native-memory-capability.md) remains active authority for the Service Definition, Provider, scopes, revisions, pinned context, and opt-in base posture. This note supersedes only its deferral of automatic curation.
