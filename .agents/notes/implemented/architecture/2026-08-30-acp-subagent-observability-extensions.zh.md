# Agent Note: ACP subagent 可观测性扩展

Status: implemented

[English](2026-08-30-acp-subagent-observability-extensions.md) | 中文

## 问题

ACP 的标准进度流只覆盖客户端指定的会话。DSH subagent 在自身的持久会话中运行，因此其中间 assistant 输出、推理、工具活动、计划和生命周期不会进入父会话的 `session/update` 流。标准会话血缘也无法区分普通 ACP 会话与持久 `origin` 为 `subagent` 的会话。

因此，自动化客户端可以等待父会话中的工具结果，却无法检查当前子树，也无法增量读取运行中或已完成子会话的活动。让每个客户端直接读取持久化文件会重复编解码、绕过实时状态，并且只凭 `parentSession` 会把普通会话误判为 subagent。

## 决策

`@deepseek-ai/dsh-acp` 保留 [ACP 作为仅面向自动化的协议](../simplification/2026-07-23-acp-automation-only-protocol.zh.md)所述的标准 ACP 接口，并在 ACP 保留的 `_` 命名空间中增加两个 DSH 自有方法。客户端通过 `_meta["_deepseek.ai/dsh"].subagents: true` 请求发现；只有同时挂载会话存储和 subagent 服务时，`initialize` 才返回第 1 版及确切方法名。通用客户端不会收到 DSH 元数据。

`_deepseek.ai/dsh/subagents/list` 接受当前连接拥有的根会话，以及直接 child 或全部后代范围。它把枚举委托给 `ctx.subagents.listChildren` 或 `listDescendants`；subagent 服务仍是持久 origin、模式、标签、活动状态、诊断和树位置的权威。普通会话可以作为更深层 subagent 的遍历节点，但绝不会成为结果行。

`_deepseek.ai/dsh/subagents/activity` 接受同一个自有根会话、一个子会话 id、事件序列游标和有界页大小。服务器会在每次请求时重新列出后代，只有当该服务当前仍把目标作为 child 返回时才允许读取。实时 child 读取其 `Session.snapshotEvents()`；不活动的 child 打开只读持久化 handle、读取事件并在成功或失败后关闭它。响应公开已结算的 assistant 消息与尝试（含其嵌入流）、工具调用与结果、PTC 内层分派、todo 快照，以及轮次或步骤的开始和结束。尚未结算的模型流不会进入此接口。页面读尽后，`nextSeq` 会越过被排除记录，因此轮询不会反复扫描不可见后缀。

两种方法都要求根会话仍在当前 ACP 连接的自有会话表中。调用方不能使用猜测到的子会话 id 读取无关会话；关闭根会话也会移除该权限。扩展是只读的，不会恢复、中断、发送消息、关闭或删除 child。

## 考虑过的替代方案

**在 Codex 桥中根据 `parentSession` 推断 child。** 不予采用，因为普通 ACP 会话使用同一个血缘字段，而且客户端不应拥有 DSH 持久化语义。

**让每个自动化客户端解码持久化文件。** 不予采用，因为这会重复后端恢复规则、遗漏仅存在于实时状态的事件，并绕过拥有 descriptor 版本和诊断的 subagent projection。

**把 child 活动加入父会话的标准 `session/update` 流。** 不予采用，因为标准更新以其指定会话为作用域；混入无关 child id 会改变可互操作 ACP 行为，并重复 child 日志已经拥有的输出。

**返回每一个原始会话事件。** 不予采用，因为请求重建、注入上下文、压缩状态和 descriptor 记录不是自动化进度。显式事件集合属于带版本的公开行为。

## 结果

选择启用的 ACP 自动化客户端无需成为持久化消费者，就能发现确切的 DSH subagent 树，并在运行期间或结束后轮询可观测活动。标准 ACP 客户端不受影响；没有 subagent 服务的部署不会公布该扩展。

活动方法返回持久会话事件，而不是编辑器卡片。宿主可以保留、渲染这些事件，或把选定字段投影到自己的增量 API。长轮询、运行保留和宿主侧后台执行仍是客户端职责，而不是 DSH ACP 协议状态。

协议测试锁定能力公布、直接与传递列表、普通会话排除、实时与已持久化活动、事件筛选、序列分页、根会话所有权、后代授权和参数校验。
