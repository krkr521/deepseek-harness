---
description: "把原生 Memory 搜索和修订检查变更暴露为模型工具，并提供有界置顶上下文。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-memory

[English](README.md) | 中文

## 概述

本 Consumer 暴露 `memory_search`、`memory_read`、`memory_write`、`memory_update` 和 `memory_forget`。每次调用都要求一个所属 Agent。全局记录对所有 agent 可见；工作区记录绑定到精确的 `agent.session.header.cwd`。工具 schema 从不接受任意工作区路径，read/update/forget 对不可访问 id 与缺失 id 给出完全相同的结果。

`memory_write` 要求模型选择 `global` 或 `workspace`；省略的标签和 `pinned` 会显式解析为 `[]` 和 `false`。更新与删除要求当前的正修订号。指导段要求模型只在用户明确要求记住或修改持久偏好后写入，并禁止保存凭据、认证码、原始对话记录和临时状态。

可访问作用域内的置顶记录会成为 `memory:pinned` 运行时上下文贡献。文本明确把它们标为不可信历史数据而非指令，对每个存储字段执行 XML 转义，包含 id 与修订号，并且只在 `maxContextBytes` 下纳入完整记录。标准提示词组装会在其进入模型前记录解析后的运行时上下文快照。

## 目录

- [配置](#configuration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="configuration"></a>
## 配置

| 键 | 默认值 | 约定 |
|---|---:|---|
| `maxSearchResults` | `20` | 每次搜索工具调用向 `ctx.memory` 请求的结果数。 |
| `maxContextRecords` | `20` | 一次提示词组装考虑的置顶记录最大数。 |
| `maxContextBytes` | `8192` | 完整置顶上下文贡献的最大 UTF-8 字节数。 |

每个值都必须是正安全整数，并且不得超过 Provider 对应的搜索上限。

<a id="model-experience"></a>
## 模型体验

### 系统提示词

#### 模型看到的内容

在该插件的注册作用域内，每个请求都会收到下方固定的 Memory 使用与秘密处理指导。

##### Memory 指导

```markdown
Use native Memory only for durable user preferences, stable project facts, and decisions that will matter in later sessions. Search when prior context is relevant. Write only when the user explicitly asks you to remember something or clearly requests a durable preference change. Never store credentials, authentication codes, raw conversation transcripts, or transient task state. Read a record before updating or forgetting it, and pass its current revision.
```

#### Token 影响

插件启用时，每个请求都会包含一小段固定指导。

#### KV Cache 影响

只要插件作用域与指导文本不变，前缀就保持稳定。

### 工具 schema

#### 模型看到的内容

生成的 [`memory_*` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-memory) 提供词法搜索、精确读取、显式写入、带修订检查的更新，以及带修订检查的遗忘。模型参数中不会出现工作区路径。

#### Token 影响

工具可见时，每个请求都会包含 5 个固定 schema。

#### KV Cache 影响

只要工具定义与作用域可见性不变，前缀就保持稳定。

### 置顶运行时上下文

#### 模型看到的内容

可访问的置顶记录会出现在 `memory:pinned` 上下文中，内容经过 XML 转义并标为不可信历史数据，包含 id、作用域、修订号、标签与正文。只有完整记录能在 `maxContextRecords` 和 `maxContextBytes` 限制内进入上下文。

#### Token 影响

开销取决于数据并受 `maxContextBytes` 限制；未置顶记录不会自动增加上下文 token。

#### KV Cache 影响

修改可访问的置顶记录会改变持久运行时上下文快照，并从首次差异处使前缀复用失效。

### 工具调用历史与结果

#### 模型看到的内容

assistant 调用会保留提交的查询或变更字段。结果会保留匹配记录的正文、id、作用域、标签、置顶状态、修订号和时间戳；失败会保留规范化工具错误。搜索数量受 `maxSearchResults` 限制，而 Provider 的正文和标签限制约束每条记录。

#### Token 影响

取决于数据的调用与结果 token 会保留在会话历史中，直到压缩为止。

#### KV Cache 影响

追加式历史保留先前的前缀复用；后续调用与结果会扩展未缓存后缀。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- 可选的自动对话整理由 [`dsh-memory-curator`](../memory-curator/README.zh.md) 负责；此包的写入、更新与遗忘工具仍保留显式请求策略。
- 当前没有记录管理界面或秘密检测器；控制面是 Memory 设置开关、显式模型工具与提示词策略。
- 置顶目前是布尔值。优先级、过期、按 agent 作用域和 token 感知的语义选择均延后。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
