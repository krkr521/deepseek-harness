---
description: "为 Web profile 添加原生本地 Memory、自动整理控制、模型工具和设置界面。"
kind: "package-bundle"
---

# `@deepseek-ai/dsh-web-memory`

[English](README.md) | 中文

## 概述

这是应用在 `@deepseek-ai/dsh-web-app` 之后的可选 patch 层。它插入本地 Memory 提供方、由设置控制的自动整理器、带固定上下文的显式 Memory 工具，以及 Memory 设置页。它依赖 Web bundle 提供的 storage-domain、settings、LLM、工具、提示词和浏览器模块服务。

该 patch 有意保持 `memory-curator.enabled: false` 与 `allowToolSources: false`。安装 bundle 后两个控件会出现；只有用户打开第一个开关后才开始自动收集，使用过工具的聊天则要等第二个开关打开后才会进入来源。

## 目录

- [模型体验](#model-experience)
- [已知限制与暂缓工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="model-experience"></a>
## 模型体验

通过 [`dsh-tool-memory`](../../memory/tool-memory/README.zh.md) 与 [`dsh-memory-curator`](../../memory/memory-curator/README.zh.md) 间接产生影响，因为 bundle 自身不添加模型可见内容。

#### KV Cache 影响

由上述两个 Consumer 包定义。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与暂缓工作

- 此 bundle 仅面向 Web，必须叠加在 `dsh-web-app` 之后；它不是独立 profile。
- 从部署中移除 bundle 不会删除 Storage Domain 数据。重新安装后会再次打开同一批本地记录。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
