# @deepseek-ai/dsh-memory

[English](README.md) | 中文

`MemoryStore` 是持久跨会话事实的抽象 `ctx.memory` Service Definition。它负责带品牌的 `MemoryId`、全局与精确工作区作用域、不可变记录、确定性搜索请求、乐观修订、预期失败代码，以及提交后的 `memory/changed` 事件。Provider 必须从当前状态同步返回分离的读取结果，并且只有持久提交后才可完成变更 Promise。

`MemoryRecord` 包含 `text`、有序且唯一的标签、`pinned`、可选来源会话归因、修订号和 ISO 时间戳。`create()` 从修订 1 开始；`update()` 与 `remove()` 要求调用方提交当前 `expectedRevision`，避免过期的模型或 UI 覆盖后续修正。

## 模型体验

间接产生，通过 `dsh-tool-memory` 等 Consumer；它们负责模型权限与呈现。

#### KV Cache 影响

无；Service Definition 不组装模型请求。

## 已知限制与延后工作

- 本契约没有自动整理器、向量嵌入 API、过期字段，也没有全局与精确工作区之外的命名空间。
- 权限属于各 Consumer；直接的受信调用方可读取自己请求的作用域。
