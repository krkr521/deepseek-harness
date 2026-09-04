---
description: "从 Web 设置界面配置原生 Memory 自动收集和工具来源准入。"
kind: "package-reference"
---

# `@deepseek-ai/dsh-client-ui-memory`

[English](README.md) | 中文

## 概述

原生自动 Memory 的浏览器设置页。它以顺序 12 向 `settings.section` 贡献 `memory` 条目，并通过 `ctx.settingsScope` 绑定 Host 的 `memory-curator` 命名空间，因此两项写入都会携带页面读取到的 revision。

第一个开关控制是否自动创建本地记忆。第二个开关独立决定使用过任何工具、MCP 集成或网页搜索的聊天能否成为自动来源。页面会明确显示加载中、不可用和只读状态；点击后以 Host 接受的快照为准，不会乐观地先改变开关。

这是纯 Client 界面。Node 半边是空的 Loader 标记，让模块系统能从已启用的 Cordis 行发现该包的 `./client` 导出。

## 目录

- [模型体验](#model-experience)
- [已知限制与暂缓工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="model-experience"></a>
## 模型体验

无，因为此页面只修改 Host 设置，不贡献提示词、消息、工具或模型请求；单独组合的 `dsh-memory-curator` 负责辅助模型调用。

#### KV Cache 影响

此包没有影响。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与暂缓工作

不发布运行时不变量伴随模块：该页面没有独立持久状态，修订号和持久化由 Host 设置服务负责。

- 逐条浏览和编辑记录目前通过原生 Memory 工具完成，而不在此页面中提供。
- 只有组合了可选 Loader 行时才会显示页面；Host 命名空间不可用时会显示诊断，而非无效开关。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
