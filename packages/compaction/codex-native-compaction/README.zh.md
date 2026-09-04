---
description: "在 codex 路由上使用 Codex Responses 原生压缩，同时保留 Harness 压缩策略与持久状态。"
kind: "package-reference"
---

# @deepseek-ai/dsh-codex-native-compaction

[English](README.md) | 中文

## 概述

一个可选启用的压缩 Service Provider，供路由到 `codex` 提供方的会话使用 Codex Responses 原生压缩。它把 Codex 的不透明 compaction item 作为持久、模型可见的状态保存，同时复用基础后端的压力判断、近期保留、剪枝、事务、收敛、手动命令与上下文溢出恢复行为。

本包实现与 [`dsh-compaction-basic`](../compaction-basic/README.zh.md) 相同的 `ctx.compaction` 服务。一个组合中必须且只能加载一个压缩后端。

## 目录

- [行为](#behavior)
- [适配器约定](#adapter-contract)
- [配置](#configuration)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="behavior"></a>
## 行为

当最新持久请求路由到 `codex` 时，provider 会用选中的历史前缀、原始系统提示词与工具调用一次 `ctx.llm.stream()`，并设置 `GenerateOptions.purpose: 'provider-compaction'`。兼容的 Codex 适配器会把该用途映射为 Responses 的 `compaction_trigger` 输入项，并返回且只返回一个 `codex-compaction` 内容块；该块包含完整的提供方 item，包括 harness 尚不认识的字段。

provider 会直接把该块作为替换 `user/message` 的内容提交，不添加基础后端的前导说明或 `<compacted-summary>` 标签。替换仍是带规范 compact-checkpoint 来源的普通持久 surface 事件，因此会话重建、来源事件校验、token 计量、剪枝、重试准入与手动 `/compact` 都沿用既有压缩生命周期。

下一次 Codex 请求会把已保存 item 作为独立的 Responses 输入项回放，后面接按原顺序保留的近期消息。provider 级 `llm/stream` 监听器会以 `UNSUPPORTED_PROVIDER_STATE` 拒绝把已保存的 Codex 检查点发送给其他提供方；静默丢弃不透明状态会丢失已压缩历史。

当路由提供方不是 `codex` 时，该类委托给 `BasicCompactionEngine.summarize()`。因此混合提供方部署可以使用同一个后端，而非 Codex 路由仍获得可移植的文本检查点。除非对话与本次所选目标都使用 `codex`，否则手动本次目标也使用基础文本摘要器；这样可避免把不透明 item 写入下一个提供方无法消费的对话。Codex 对话选择另一个 Codex 模型时会原生使用该模型；省略选择时则使用对话已路由的 Codex 模型。

<a id="adapter-contract"></a>
## 适配器约定

Codex 适配器与本 provider 的职责划分如下：

- provider 拥有压力策略、范围选择、持久化、缩减校验与已保存状态的准入。
- 适配器拥有 Codex wire protocol：只为 `provider-compaction` 追加一个 `compaction_trigger`，把返回的 Responses `compaction` item 转换成一个 `codex-compaction` 块，再把已保存块还原为完全相同的 item。
- 适配器必须保留未知 item 字段。harness 将 `encrypted_content` 视为不透明，只校验 item 是带非空内容的 Codex `compaction` item。
- 原生压缩响应若没有块、包含多个块、返回文本、返回工具调用或 item 无效，带括号的事务就会失败，且不会替换会话 surface。

不满足该约定的适配器不得在本 provider 下用于 Codex 路由会话。仓库自带的 DeepSeek 适配器只实现可移植文本压缩，不会合成 Codex 状态。

<a id="configuration"></a>
## 配置

`CodexNativeCompactionEngine` 接受本包的 `Config`；该接口原样继承 `BasicCompactionConfig` 的全部字段。阈值、保留、逐模型压力策略、重试、溢出恢复、可选工具结果 pruner 与 `auto` 的含义见 [`dsh-compaction-basic`](../compaction-basic/README.zh.md)。

`summarizationProvider`、`summarizationModel` 与 `maxTokens` 仍作用于非 Codex 路由使用的基础回退。手动提供方／模型对会一次性覆盖回退路由。对于 Codex 对话，所选 Codex 对会选择原生请求模型；已配置摘要字段不会改变原生请求，原生压缩的输出限制与协议细节由 Codex 适配器拥有。

```yaml
- name: '@deepseek-ai/dsh-token-meter'

- name: '@deepseek-ai/dsh-compaction-tool-result-pruner'

- name: '@deepseek-ai/dsh-codex-native-compaction'
  config:
    thresholdRatio: 0.8
    retainRatio: 0.16
    compactionRetries: 1

- name: '@deepseek-ai/dsh-command-compact'
```

该包已进入 CLI resolver manifest，但自带 preset 不会选择它。部署方需以本包替换 `@deepseek-ai/dsh-compaction-basic`，并安装实现原生内容块约定的 Codex 适配器，才算显式启用。

<a id="model-experience"></a>
## 模型体验

### 压缩后的会话请求

#### 模型看到的内容

Codex 模型会在 Responses 输入中收到一个不透明原生 compaction item，后面接常规压缩策略逐字保留的近期消息。它不会收到 DSH 撰写的摘要前导说明、类 XML 标签或旧历史的文本近似。

#### Token 影响

token 效果是替换：选中的旧范围从未来输入中移除，由不透明 item 代替；近期尾部保持不变。因为 item 不透明，DSH 会保守估算其大小，用于缩减校验与后续压力计量，而不会检查提供方状态内部。

#### KV Cache 影响

KV Cache 效果由提供方定义。压缩请求会回放相同的系统提示词、工具与选中前缀；随后会话请求则以原生 item 加保留尾部代替原始前缀。

### 辅助压缩请求

#### 模型看到的内容

适配器收到原始系统提示词、工具 schema 与选中消息，并带有模型不可见的 `provider-compaction` 用途。兼容的 Codex transport 会追加 `compaction_trigger`，不会添加用户态摘要指令。响应必须且只能包含一个不透明 compaction item。

#### Token 影响

原生压缩会增加一次覆盖选中前缀的 Codex 请求及其由提供方定义的不透明输出。手动选择非 Codex 目标时则增加一次可移植文本摘要请求。`maxTokens` 只作用于文本回退。

#### KV Cache 影响

辅助请求保留会话的系统提示词、工具与选中消息前缀，因此提供方可以复用匹配的缓存状态；追加的 trigger 是唯一的新输入项。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与暂缓事项

本包不发布运行时不变量伴随插件，因为提供方状态准入与继承的压缩事务在各自拥有者处校验运行时关系。

- 原生检查点不能跨提供方移植。将已压缩会话从 `codex` 切换到其他提供方会在发送前失败。
- Codex 提供方内部不同模型之间的兼容性由远端 Responses 实现控制。本包会无损保留 item，但不会解密或重新解释它。
- 不认识 `codex-compaction` 的通用客户端可能需要展示回退；持久会话仍有效，因为该块使用可合并扩展的 LLM 内容词汇。
- Codex 适配器目前位于本仓库之外。若加载本 provider 时适配器未实现 `provider-compaction`，原生请求会失败，而不会静默回退。
- 提供方协议字段可能演进。无损 item 存储可保护未知字段，但远端破坏性变更仍可能要求更新适配器。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
