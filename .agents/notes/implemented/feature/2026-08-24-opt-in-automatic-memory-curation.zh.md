# Agent Note：可选启用的自动 Memory 整理

状态：已实现

[English](2026-08-24-opt-in-automatic-memory-curation.md) | 中文

## 问题

原生 Memory 最初只提供显式 CRUD／搜索工具和置顶上下文。这保留了清晰的写入权限，但没有提供用户对本地记忆开关的预期行为：启用后，已完成聊天应自动整理，而不要求对话模型调用 `memory_write`。工具辅助聊天还需要第二项同意，因为即使省略原始 `tool/result` 块，助手文本也可能含有来自 MCP、网页搜索或其他工具的事实。

自动整理是辅助模型调用。它的确切输入必须能够从 Session 日志重建，不能延迟或改变已经完成的用户轮次，格式错误或范围过大的输出也不能获得受信写入权限。

## 决定

`@deepseek-ai/dsh-memory-curator` 是消费 `ctx.memory`、`ctx.llm` 与 Session 事件的兄弟 Consumer。它的 `memory-curator` 设置 section 实时生效，并包含两个独立布尔值。默认关闭的 `enabled` 启动轮次后整理。默认关闭的 `allowToolSources` 允许含有 `tool/call` 或 `tool/result` 的轮次；关闭时会跳过整个工具轮次。整轮排除是权限规则，因为可见助手文本可能已经来自工具输出。

Consumer 只处理已完成轮次，并把工作推迟到下一个 microtask，因此不会从 `session/event` 观察方重入 `Session.append`。它选择直接人工消息和已提交的 `assistant/message` 事件中的可见助手文本；仅记入日志的 `assistant/attempt` 流不会成为整理来源。允许的工具轮次还会包含工具名称、参数和可见结果文本。框架会包含当前 Session 的全局和精确 cwd 作用域内最新的有界记录。

分发前，Consumer 会追加 `memory/curation-request`，包含来源 seq、来源策略值、路由、固定系统提示词、确切消息列表和输出上限。请求携带 `GenerateOptions.purpose: 'memory-curation'`；DeepSeek 会为该用途禁用思考。调用具有字节、记录、token、操作数与期限限制。成对配置的 provider/model 会覆盖最近记录的对话路由。

模型返回严格 JSON。其词汇只允许创建和按 revision 更新。每个更新 id 与 revision 都必须匹配该次请求确切提供的记录；工作区创建从 Session 派生 cwd。Consumer 从不接受任意路径或删除。`ctx.memory` 仍负责校验、乐观并发、持久提交与提交后通知。所有操作成功后，`memory/curation-applied` 会把已接受操作关联到请求 seq。失败会在轮次结束后被隔离并记录，插件卸载会等待已经进行中的调用。

`@deepseek-ai/dsh-client-ui-memory` 贡献含两个开关的 Memory 设置页。`@deepseek-ai/dsh-web-memory` 是应用在 `dsh-web-app` 之后的可选 bundle；它组合本地 Provider、显式工具 Consumer、自动整理器与设置页。基础和 Web bundle 不包含这层可选能力，而可选 bundle 中的自动整理仍默认关闭。

## 考虑过的替代方案

- **让对话模型更积极地调用 `memory_write`**——拒绝，因为提示词偏好不是可靠的设置开关，没有强制工具来源门禁，并且会把整理质量绑定到主回答循环。
- **来源开关关闭时只删除 tool-result 事件**——拒绝，因为助手的可见回答可能复述或总结这些结果。
- **在 agent-loop 中运行整理**——拒绝，因为 Session 事件已经提供所需的已完成轮次扩展点，并可保持 loop 不变。
- **允许自动删除操作**——拒绝，因为删除具有破坏性，而冲突处理需要单独的用户界面策略。显式的按 revision 遗忘仍然可用。
- **在发布的 Web bundle 中挂载 Memory 栈**——拒绝，因为安装可选能力和启用自动保留分别属于部署与用户选择。单独 bundle 能提供真实设置页组合，而不改变默认 profile。
- **不把辅助请求写入 Session 日志**——拒绝，因为整理模型会看到聊天与现有 Memory 内容；即使输出修改的是单独 Storage Domain，模型可见输入仍必须可重建。

## 后果

已安装的 Web Memory 层现在符合预期的开关行为：打开自动 Memory 后，未来符合条件的已完成轮次会被整理，第二个开关则是可执行的来源门禁，而非建议性文案。显式 Memory 工具保留显式请求指导，并独立于自动整理工作。

启用后，每个符合条件的已完成轮次会花费一次辅助模型调用，并且可以不逐条确认地创建持久本地记录。输入输出有界，失败不会改变用户轮次，也没有任何自动路径删除数据。设置页不提供记录浏览；检查、修正与遗忘仍通过按 revision 的 Memory 工具完成。

较早的[原生 Memory capability Note](2026-08-23-native-memory-capability.zh.md)继续作为 Service Definition、Provider、作用域、revision、置顶上下文和基础显式启用姿态的有效依据。本 Note 只取代其中对自动整理的延后决定。
