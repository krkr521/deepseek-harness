# Agent Note：Codex 原生不透明压缩 provider

Status: implemented

[English](2026-08-26-codex-native-compaction-provider.md) | 中文

## 问题

通用压缩后端会要求模型写出文本摘要，把该文本框定为既定 user 上下文，并保留近期原始尾部。Codex Responses 提供的是另一种协议：compaction trigger 返回一个不透明提供方 item，后续 Responses 请求直接消费它。该 item 无法转换成文本；若丢弃未知字段，或把已保存状态发送给其他提供方，都可能静默丢失已压缩历史。

压缩能力已经拥有压力判断、范围选择、来源事件引用、缩减校验、持久替换、手动准入与溢出恢复。Codex 实现必须保留这些不变式，不能复制事务，也不能给 `agent-loop` 增加提供方分支。

## 决策

`@deepseek-ai/dsh-codex-native-compaction` 是独立、可选启用的 Service Provider。它继承 `BasicCompactionEngine`，只覆盖 `summarize()`。它使用最新持久会话路由：`codex` 路由以原始系统提示词、工具、选中消息和 `GenerateOptions.purpose: 'provider-compaction'` 发起一次直接 `ctx.llm.stream()` 调用；其他路由委托给基础文本摘要器。

Codex 适配器把 `provider-compaction` 映射成一个 Responses `{ type: 'compaction_trigger' }` 输入项。它返回一个可合并扩展的 `codex-compaction` 内容块，其中包含完整的 `{ type: 'compaction', encrypted_content, ...unknownFields }` item。provider 要求响应必须且只能含一个有效块，并把它作为完整本地调用输出保存在 `compaction/summary` 中。

`SummaryResult.checkpointContent` 是基础事务的提供方原生替换钩子。存在该字段时，事务把这组精确内容块用于规范 compact-checkpoint `user/message`；省略时则保留基础后端的文本前导说明与 `<compacted-summary>` 框架。该钩子不会改变范围选择、事件括号、来源引用、缩减校验或 surface 替换语义。

适配器会把已保存 `codex-compaction` 块还原成完全相同的独立 Responses item，再接上保留的近期消息。provider 级 `llm/stream` 监听器以 `UNSUPPORTED_PROVIDER_STATE` 拒绝把该状态发送给非 `codex` 路由。未知 item 字段在输出翻译、JSON 会话持久化、重建与输入翻译之间保持不透明且无损。

该包可由 CLI resolver 解析，但自带 preset 不会选择它。只有部署的 Codex 适配器实现原生 trigger 与内容块约定时，部署方才显式启用它。通用 `compaction-basic` provider 继续作为默认值。

本决策补充而非取代[压缩能力 seam](2026-06-18-compaction-capability-seam.zh.md)与[可重建模型请求](../architecture/2026-07-05-reconstructable-requests.zh.md)：它通过现有子类 seam 提供第二种后端，并使新的提供方可见状态能够从会话日志重建。

## 曾考虑的替代方案

- **让 `agent-loop` 理解 Codex 压缩**：否决。请求生命周期与重试所有权已经属于压缩能力；loop 中的提供方分支会复制扩展 seam。
- **把不透明 item 存在会话 surface 外部**：否决。未来模型请求将依赖规范会话回放无法重建的状态。
- **把 item 序列化为 `<compacted-summary>` 内的文本**：否决。加密 item 是提供方协议状态，不是模型可读摘要文本；适配器必须将其作为独立 Responses 输入项发出。
- **全局替换 `compaction-basic`**：否决。其他提供方需要可移植文本摘要，而且 Codex transport 支持目前由特定适配器实现。
- **原生输出无效时回退文本**：否决。协议回归会变得不可见，并可能提交与所请求原生操作语义不同的检查点。

## 后果

- 原生 provider 继承成熟压缩事务，包括确定性剪枝、保留尾部策略、收敛、失败括号、手动 `/compact` 与溢出重试证明。
- 成功的 Codex 检查点可持久化，但受提供方约束。把该会话切换到其他提供方会在发送前失败；Codex 路由内部的模型兼容性仍是远端提供方属性。
- `GenerateOptions.purpose` 增加 `provider-compaction`，作为模型不可见的适配器元数据。通用文本压缩继续使用 `compaction`。
- `codex-compaction` 扩展 LLM 内容词汇。consumer 可以通用展示它，但拥有 Codex 回放的适配器必须精确保留 item。
- 原生响应失败会保持 surface 不变，并记录 `compaction/end { error }`。自动压力可带未压缩历史继续；规范溢出则保留原始请求失败，除非已有其他持久缩减推进了 surface。
- 对既有压缩 seam Note 的限定范围 active record 审计没有发现被取代的决策。其接口、事务与 user-message 载体继续有效；本 Note 只拥有 Codex 原生特化。

## 验证

聚焦 provider 测试固定原生调度元数据、精确检查点内容、保留的原始尾部、会话重建、非 Codex 回退、无效输出回滚与跨提供方准入失败。适配器测试固定单一 trigger、翻译输入不变、未来字段无损与精确输出到输入往返。无密钥的组装 headless 快照固定通过 `compaction/start`、不透明 `compaction/summary`、无框架替换、`compaction/end` 恢复上下文溢出并完成同一轮次。
