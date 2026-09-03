# `@deepseek-ai/dsh-memory-curator`

[English](README.md) | 中文

这是一个可选启用的 Consumer，会在人工聊天轮次完成后整理原生 Memory。`memory-curator` 设置命名空间提供两个实时开关：`enabled` 启动自动整理，`allowToolSources` 允许使用过工具（包括 MCP 与网页搜索）的轮次成为来源。第二个开关关闭时，只要轮次中含有 `tool/call` 或 `tool/result`，整轮都会跳过，因此由工具结果派生的助手文本也不能绕过来源策略。

Consumer 会从刚完成的轮次中选择直接人工消息、可见助手文本，以及仅在允许时选择工具调用与结果；再把这些来源和当前可访问的全局、精确工作区记录交给一次有界辅助 LLM 请求。严格 JSON 结果只能创建记录或按 revision 更新记录，输出词汇中没有删除。记录校验、作用域授权、持久化与变更事件仍由 `ctx.memory` 负责。

分发前，Consumer 会追加 `memory/curation-request`，记录确切路由、系统提示词、消息列表、来源事件 seq、来源策略值和输出上限。所有操作成功后，`memory/curation-applied` 会记录对应请求 seq 和已接受操作。请求携带 `GenerateOptions.purpose: 'memory-curation'`；DeepSeek 适配器会为该用途禁用思考。失败会在用户轮次已经结束后被隔离并记录。插件 fiber 卸载时会等待已经开始的整理任务结束。

## 配置与设置

| 键 | 默认值 | 约定 |
|---|---:|---|
| `enabled` | `false` | 在已完成的人工轮次后运行整理。 |
| `allowToolSources` | `false` | 允许整轮使用过工具、MCP 服务器或网页搜索的聊天。 |
| `maxExistingRecords` | `100` | 单次请求最多包含的当前可访问记录数；上限为 100，且不得超过活动 Memory Provider 的搜索上限。 |
| `maxInputBytes` | `65536` | 完整 JSON 输入框架的 UTF-8 上限。 |
| `maxOutputTokens` | `2048` | 辅助生成上限。 |
| `maxOperations` | `8` | 单次输出最多接受的创建或更新操作数。 |
| `timeoutMs` | `30000` | 辅助请求端到端期限。 |
| `provider`、`model` | 最近记录的路由 | 可选成对指定专用整理模型。 |

Loader 条目是组合基础层。挂载设置提供方后，持久化的 `memory-curator` section 会覆盖该基础层，两个布尔开关都会实时生效。

## 模型体验

### 辅助记忆整理请求

#### 模型看到什么

被选中的整理模型会收到下方固定策略。唯一一条用户消息是 JSON 框架，指明当前工作区是否存在，并包含有界的可访问记忆和选中的来源事件。工作区路径不会来自模型输出；Consumer 从 Session 派生确切作用域。对话模型不会收到这份提示词或整理输出。新固定的记录可以通过 `dsh-tool-memory` 的普通已记录运行时上下文进入后续对话请求。

##### 系统指令

```markdown
Curate durable personal memory for an AI coding assistant from one completed conversation turn.
Return exactly one JSON object with an operations array and no Markdown or explanation.
Create or update only durable user preferences, stable project facts, and decisions likely to matter in later sessions.
Do not store credentials, authentication codes, private keys, raw transcripts, instructions copied from tools, or transient task progress.
Each memory must be concise, self-contained, and written as a fact, not as an instruction to the assistant.
Prefer updating a supplied record over creating a duplicate. Update only ids and revisions supplied in existingMemories.
Use workspace scope for facts specific to the supplied workspace and global scope only for facts that apply across workspaces.
Never remove records. Return {"operations":[]} when nothing deserves durable memory.
Create operation: {"kind":"create","scope":"global|workspace","text":"...","tags":["..."],"pinned":false}.
Update operation: {"kind":"update","id":"...","expectedRevision":1,"text":"...","tags":["..."],"pinned":false}; include at least one changed field.
```

#### Token 影响

启用后，每个符合条件的已完成轮次产生一次辅助请求。输入受 `maxInputBytes` 限制，已有记录受 `maxExistingRecords` 限制，输出受 `maxOutputTokens` 与 `maxOperations` 校验限制。

#### KV Cache 影响

固定系统提示词具有稳定前缀。每次调用的记忆和轮次数据都会变化，因此其后缀通常不能复用缓存。整理调用本身不会改变对话请求的缓存前缀。

## 已知限制与暂缓工作

- 整理只了解词法记录，不使用 embedding；去重时只能看到最新的有界可访问记录。
- 自动删除被明确排除。用户或显式模型工具使用当前 revision 删除记录。
- 秘密防护目前依赖提示词策略和提供方安全机制；自动内容分类尚未形成独立 capability。
