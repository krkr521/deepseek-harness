# Agent Note：原生跨会话 Memory 能力

Status: implemented

[English](2026-08-23-native-memory-capability.md) | 中文

## 问题

持久会话日志、压缩摘要、可搜索的先前会话和文件系统技能已经保存了不同种类的上下文，但它们都不负责一条应在后续无关会话中可用的小型显式事实。把会话日志当作偏好数据库会暴露过多历史；把事实放入 skills 会混合用户数据与编写好的流程；进程内 map 会在重启后消失。第三方 Memory MCP server 可以承担产品角色，但它们不提供原生类型化服务、共享作用域策略、Storage 集成或模型可见内容的必然记录。

## 决策

原生 Memory 是由三个包组成的可选能力 seam。`@deepseek-ai/dsh-memory` 定义 `ctx.memory`、带品牌 id、不可变记录、全局/精确工作区作用域、同步当前状态读取、确定性搜索请求、带修订检查的变更、稳定错误码，以及提交后的 `memory/changed` 事件。`@deepseek-ai/dsh-memory-local` 在版本 0 的 Storage Domain `memory` 上实现该服务。`@deepseek-ai/dsh-tool-memory` 通过五个显式工具和有界的置顶运行时上下文消费它。

首个 Provider 维护由配置的 Storage Domain 后端支持的权威内存投影。它串行执行逻辑变更，执行可配置的记录/正文/标签/搜索限制，在重新打开时通过 zod 验证持久数据，并对更新和删除使用乐观修订。搜索是对正文与标签的确定性词法扫描；该 seam 不意味着嵌入或网络检索。

模型权限从调用 Agent 派生，而不是来自模型提供的路径。全局记录在所有位置可见。工作区记录只在其存储 `cwd` 与 `agent.session.header.cwd` 完全相等时可见；工具 schema 暴露 `global`、`workspace` 和 `all` 选择，从不接受任意 cwd。read、update 和 forget 会让不可访问 id 与缺失 id 无法区分。写入会自动归因到调用会话。

可访问的置顶记录通过 `ctx.systemPrompt.context` 注入。渲染贡献会把存储值标记为不可信历史数据而非指令，对每个值执行 XML 转义，包含 id 与修订号，并且只在配置的记录数和字节限制下纳入完整记录。既有运行时上下文快照机制会在模型使用前记录解析后的贡献；未置顶记录只通过已记录的工具结果抵达模型。

基础组合包不启用 Memory。部署通过组合 Storage 后端、`storage-domain`、`memory-local` 和 `tool-memory` 显式启用。完整 seam 具有真实 Loader 组合测试：它通过 `memory_write` 写入、卸载应用、以同一 JSON 后端配置重新启动，并读取持久记录。

## 曾考虑的替代方案

- **把 session-query 当作 Memory** —— 否决，因为广泛历史搜索与显式整理事实具有不同的保留、权限和上下文成本语义。Memory 可以引用来源会话，但从不索引或复制其事件日志。
- **在工作区下存储 Markdown** —— 否决作为原生服务，因为文件位置、合并行为、作用域、并发和 schema 会变成偶然约定。未来的 Provider 可以有意在同一服务之后投影到文件。
- **默认启用现有 Memory MCP server** —— 否决，因为外部协议 server 无法拥有 harness 的原生服务类型、当前 Agent 工作区权限、Storage 生命周期或提示词快照保证。MCP 集成仍是有效的显式启用替代方案。
- **自动把每个已完成轮次总结到 Memory** —— 延后。自动保留需要一个另行评审的 Consumer，并且必须有明确的同意、脱敏、冲突、过期、删除与评估策略。把它绑定到底层 Provider 会让存储隐含一项未经评审的隐私决策。
- **把 Memory 放进 agent loop** —— 否决。服务、Provider、工具和提示词上下文通过已记录的扩展点组合；无需修改循环。
- **更新采用最终写入获胜** —— 否决，因为在用户或另一个 agent 修正记录后，模型仍可能根据旧搜索结果行动。预期修订会让该竞态可见且可恢复。
- **截断一条过大的置顶记录** —— 否决，因为截断可能改变事实含义。置顶上下文要么包含完整转义记录，要么跳过它。

## 后果

DSH 现在拥有可在应用重启后继续存在的原生持久事实存储，并且可以独立于其模型 Consumer 被替换。Storage 后端选择仍是组合决策，而工作区权限与提示词安全仍是 Consumer 决策。Provider 的领域记录 schema 是发布前的格式版本 0，不提供兼容承诺。

Consumer 不存在时，该能力不消耗模型 token。Consumer 存在时，一个稳定指导段始终可见；置顶记录会改变运行时上下文，进而影响请求前缀缓存行为；未置顶记录只在搜索或读取后占用上下文。全部模型可见内容仍可从会话日志重建。

精确工作区路径比较、线性词法搜索、手动保留和布尔置顶是有意的首版限制。语义检索、规范路径身份、过期/淘汰、管理 UI、审批流和自动整理器可以作为兄弟 Provider 或 Consumer 演进，而无需改变 agent loop。

后续：[可选择启用的自动 Memory 整理](2026-08-24-opt-in-automatic-memory-curation.zh.md)实现自动整理 Consumer 和设置 UI，同时保持 Service Definition、本地 Provider、作用域、修订号和显式工具不变。
