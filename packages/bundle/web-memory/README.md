# `@deepseek-ai/dsh-web-memory`

English | [中文](README.zh.md)

Optional patch layer applied after `@deepseek-ai/dsh-web-app`. It inserts the local Memory provider, settings-controlled automatic curator, explicit Memory tools with pinned context, and the Memory settings page. It relies on the Web bundle's storage-domain, settings, LLM, tool, prompt, and browser-module services.

The patch deliberately keeps `memory-curator.enabled: false` and `allowToolSources: false`. Installing the bundle makes the two controls available; automatic collection begins only after the user enables the first switch, and tool-bearing chats remain excluded until the second switch is enabled.

## Model Experience

Indirectly, through [`dsh-tool-memory`](../../memory/tool-memory/README.md) and [`dsh-memory-curator`](../../memory/memory-curator/README.md), because the bundle adds no model-visible content of its own.

#### KV Cache effect

Defined by the two Consumer packages above.

## Known Limitations and Deferred Work

- This bundle is Web-specific and must be layered after `dsh-web-app`; it is not a standalone profile.
- Deployment removal leaves the Storage Domain data intact. Reinstalling the bundle reopens the same local records.
