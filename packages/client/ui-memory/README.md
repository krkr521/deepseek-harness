---
description: "Configure automatic native Memory collection and tool-source admission from the Web settings UI."
kind: "package-reference"
---

# `@deepseek-ai/dsh-client-ui-memory`

English | [中文](README.zh.md)

## Summary

Browser settings page for native automatic Memory. It contributes the `memory` entry at order 12 to `settings.section` and binds the Host `memory-curator` namespace through `ctx.settingsScope`, so both writes carry the revision read by the page.

The first switch controls automatic local-memory creation. The second independently decides whether chats that used any tool, MCP integration, or web search may become automatic sources. Loading, unavailable, and read-only deployments have explicit states; a click follows the accepted Host snapshot rather than changing the switch optimistically.

This is a pure Client surface. The Node half is an empty Loader marker so the module system can discover the package's `./client` export from an enabled Cordis row.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Model Experience

None, as the page edits Host settings and contributes no prompt, message, tool, or model request; the separately composed `dsh-memory-curator` owns auxiliary model calls.

#### KV Cache effect

None from this package.

## Known Limitations and Deferred Work

No runtime invariant companion is published: this page owns no independent persistent state; the Host settings service owns revisions and persistence.

- Record-by-record browsing and editing remain available through native Memory tools rather than this page.
- The page is shown only when its optional Loader row is composed; an unavailable Host namespace renders a diagnostic instead of inert switches.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
