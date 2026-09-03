# memory/——原生跨会话 Memory 能力系列

[English](README.md) | 中文

本系列保存应跨会话延续的小型显式事实。它与会话日志、会话搜索、压缩摘要和文件系统技能相互独立。

| 包 | 角色 | ctx 键 |
|---|---|---|
| [`memory/`](memory/README.zh.md) | 定义持久记录、作用域、修订检查和搜索操作 | `ctx.memory` |
| [`memory-local/`](memory-local/README.zh.md) | 通过 `ctx.storageDomain` 持久化服务，并执行确定性的词法搜索 | `ctx.memory` |
| [`memory-curator/`](memory-curator/README.zh.md) | 在实时隐私开关控制下，把已完成聊天整理为创建或更新操作 | 读取 `ctx.memory`、`ctx.llm` 与 Session 事件 |
| [`tool-memory/`](tool-memory/README.zh.md) | 添加显式模型 CRUD/搜索工具和有界的置顶运行时上下文 | 注册到 `ctx.tools` 与 `ctx.systemPrompt` |

子系统参考、组合示例、权限规则和保留边界见 [docs/subsystems/memory.md](../../docs/subsystems/memory.zh.md)。
