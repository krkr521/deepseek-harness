# 原生 Memory

[English](memory.md) | 中文

原生 Memory 是一项可选的跨会话能力 seam：[dsh-memory](../../packages/memory/memory/README.zh.md) 定义 `ctx.memory`，[dsh-memory-local](../../packages/memory/memory-local/README.zh.md) 在 `ctx.storageDomain` 上实现它，[dsh-tool-memory](../../packages/memory/tool-memory/README.zh.md) 通过模型工具和置顶运行时上下文消费它，而 [`dsh-memory-curator`](../../packages/memory/memory-curator/README.zh.md) 可以在持久设置控制下整理已完成聊天。它不属于 agent loop（智能体循环）主干。

## 什么内容属于 Memory

Memory 保存应在后续会话中继续有用的小型、自包含事实：明确的用户偏好、稳定的项目约定或持久决策。会话日志仍是对话历史的事实来源；session-query 查找先前事件；compaction 保留单个会话的可用表层；skills 保存编写好的流程和文件。Memory 记录可以引用来源会话 id 以提供出处，但不会复制或索引该会话。

显式工具 Consumer 会指示对话模型仅在用户要求记住某事或修改持久偏好后写入。单独的自动整理器默认关闭，并在符合条件的已完成轮次后使用更严格的长期事实提示词。Provider 本身是受信基础设施，不推断文本是否包含秘密；部署仍须负责提供方安全与保留策略。

## 记录与作用域

每条记录都有带品牌的 id、`text`、有序标签、`pinned`、可选 `sourceSessionId`、正修订号和创建/更新时间戳。作用域是 `global`，或带一个绝对 `cwd` 的 `workspace`。本地 Provider 精确比较工作区路径字符串；规范化或跨机器路径映射属于本 seam 上层。

模型 Consumer 从调用 Agent 派生全部作用域。它从不接受原始工作区路径：`global` 只选择全局记录，`workspace` 选择当前会话 cwd，而有 cwd 时 `all` 会组合两者。read、update 和 forget 会先加载记录；工作区作用域不可访问时返回与缺失记录相同的错误，从而防止跨工作区探测 id。

## 持久性与并发

本地 Provider 拥有格式版本 0、包含一个 `records` 表的 Storage Domain `memory`。`dsh-storage-domain` 在打开时验证每条存储记录，保留用于同步读取的权威内存值，对持久写入排队，并在提交后发出自己的存储变更。`dsh-memory-local` 还会串行执行逻辑操作，因此记录上限检查和带修订检查的变更无法通过服务相互穿插。

创建提交修订 1。更新和遗忘要求 `expectedRevision`；过期调用方会收到 `MEMORY_REVISION_CONFLICT`，并且必须重新读取。成功的创建、更新和删除只在持久提交后发出 `memory/changed`。观察方失败会被隔离，因为它们无法回滚已提交写入。

## 搜索与置顶上下文

搜索会对小写化后的正文与标签执行确定性的内存词法扫描。完整短语匹配高于全部词元匹配；请求标签采用 AND；结果随后依次按分数、较新更新时间和 id 排序。首个实现有意不包含嵌入、网络依赖、模糊匹配或会话历史回退。

可访问的置顶记录会渲染到 `memory:pinned` 动态上下文。该贡献把记录标为不可信历史数据而非指令，对存储字段执行 XML 转义，包含 id 与修订号，并且只在配置的记录数和字节限制下纳入完整记录。标准 system-prompt 组装会把解析后的文本变为持久运行时上下文快照，从而满足“模型可见即已记录”的规则。未置顶记忆只通过已记录的工具结果进入模型历史。

## 自动整理与来源策略

`memory-curator` 设置命名空间拥有两个实时开关。`enabled` 控制已完成的人工轮次是否产生辅助整理请求。`allowToolSources` 控制使用过任何工具（包括 MCP 与网页搜索）的轮次能否成为来源。它关闭时，Consumer 会跳过整个工具轮次，而不是仅删除 `tool/result`，因为助手回答本身可能已经来自该结果。

符合条件的轮次会与最新可访问的全局和精确工作区记录一起装入 JSON 框架。辅助模型只能返回严格 JSON 创建或按 revision 更新操作，不接受自动删除。模型分发前，`memory/curation-request` 会记录确切来源事件 seq、来源策略值、路由、系统提示词、消息列表和输出上限。所有操作提交后，`memory/curation-applied` 会把已接受操作关联到该请求 seq。请求标为 `purpose: 'memory-curation'`，DeepSeek 适配器会为这项有界 JSON 任务禁用思考。整理失败会在用户轮次结束后被隔离，不会改变该轮的完成结果。

## 显式启用组合

基础组合包和 Web 组合包默认都不启用此能力。Web 部署可以在 `dsh-web-app` 之后叠加可选的 [`dsh-web-memory`](../../packages/bundle/web-memory/README.zh.md) bundle；它会组合本地 Provider、两个 Consumer 和设置页，同时保持自动整理关闭，直到用户打开开关。自定义部署也可以直接组合各行；后端与预算仍由部署选择。

```yaml
- name: '@deepseek-ai/dsh-storage'
- name: '@deepseek-ai/dsh-storage-json'
  config:
    root: .dsh/storage
- name: '@deepseek-ai/dsh-storage-domain'
  config:
    backend: json
- name: '@deepseek-ai/dsh-memory-local'
  config:
    maxRecords: 10000
    maxTextBytes: 16384
    maxTags: 16
    maxTagBytes: 64
    maxSearchResults: 100
- name: '@deepseek-ai/dsh-tool-memory'
  config:
    maxSearchResults: 20
    maxContextRecords: 20
    maxContextBytes: 8192
- name: '@deepseek-ai/dsh-memory-curator'
  config:
    enabled: false
    allowToolSources: false
- name: '@deepseek-ai/dsh-client-ui-memory'
```

具体配置项必须放在所需核心服务（`ctx.tools` 与 `ctx.systemPrompt`）已经存在的位置。Provider 的 `maxSearchResults` 必须不小于 Consumer 的两个结果数量。

## 延后工作

首个自动整理器只支持创建与更新，使用提示词级秘密策略和整轮工具来源门禁。记录管理 UI、自动内容分类、过期、冲突流程和自动删除仍是独立决策。语义检索同样可以作为兄弟 Provider 到来，而无需改变任一 Consumer 的权限规则。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxmemory--memorystore-abstract-seam"></a>

### `ctx.memory` — `MemoryStore` (abstract seam)

Durable cross-session memory service. Reads are synchronous projections of provider-owned current state; mutations resolve only after durable commit.

```ts cordis-catalog
/**
 * Read one memory by id.
 * @param id - Memory id.
 * @returns an immutable detached record, or `undefined` when absent.
 */
abstract get(id: MemoryId): MemoryRecord | undefined

/**
 * Search authorized scopes using provider-defined ranking.
 * @param request - Resolved scopes, filters, and result limit.
 * @returns deterministic immutable hits.
 */
abstract search(request: MemorySearchRequest): readonly MemorySearchHit[]

/**
 * Create one durable memory.
 * @param request - Fully resolved memory fields.
 * @returns the committed record.
 */
abstract create(request: MemoryCreateRequest): Promise<MemoryRecord>

/**
 * Replace selected fields when the expected revision is current.
 * @param request - Memory id, expected revision, and non-empty patch.
 * @returns the committed next revision.
 */
abstract update(request: MemoryUpdateRequest): Promise<MemoryRecord>

/**
 * Forget one memory when the expected revision is current.
 * @param request - Memory id and expected revision.
 * @returns resolution after durable removal.
 */
abstract remove(request: MemoryRemoveRequest): Promise<void>
```

Source: [`packages/memory/memory/src/index.ts`](../../packages/memory/memory/src/index.ts)

<a id="memory-events"></a>

### `memory/*` events

<a id="memorychanged--emit"></a>

#### `memory/changed` — emit

Emitted after one memory mutation commits durably.

```ts cordis-catalog
/**
 * Emitted after one memory mutation commits durably.
 * @param change - Committed create, update, or remove observation.
 * @mode emit
 */
'memory/changed'(change: MemoryChanged): void
```

Source: [`packages/memory/memory/src/index.ts`](../../packages/memory/memory/src/index.ts)
<!-- END GENERATED cordis-surface -->
