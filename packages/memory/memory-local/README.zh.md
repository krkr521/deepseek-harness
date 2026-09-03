---
description: "通过 Storage Domain 持久化原生 Memory 记录，并提供确定性词法搜索。"
kind: "package-reference"
---

# @deepseek-ai/dsh-memory-local

[English](README.md) | 中文

## 概述

`LocalMemoryStore` 是持久化原生 Memory Service Provider。它打开版本 0 的 `memory` Storage Domain，把记录写入 `records` 表，维护可供同步读取的权威内存投影，并串行执行创建、更新与删除。它可以使用 `dsh-storage-domain` 为该领域选择的任意后端，因此 JSON 和 SQLite 存储后端不需要 Memory 专用适配器。

搜索会对小写化后的正文与标签执行确定性的词法匹配。短语匹配高于全部词元匹配；标签过滤采用 AND；同分时依次按较新的 `updatedAt` 和 id 排序。该过程不使用模型嵌入、网络调用或会话日志扫描。

## 目录

- [配置](#configuration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="configuration"></a>
## 配置

| 键 | 默认值 | 约定 |
|---|---:|---|
| `maxRecords` | `10000` | 最大持久记录数。 |
| `maxTextBytes` | `16384` | 单条修剪后正文的最大 UTF-8 字节数。 |
| `maxTags` | `16` | 每条记录或搜索过滤器中不区分大小写的唯一标签最大数。 |
| `maxTagBytes` | `64` | 单个修剪后标签的最大 UTF-8 字节数。 |
| `maxSearchResults` | `100` | 服务接受的最大结果数量。 |

每个值都必须是正安全整数。工作区作用域要求绝对 `cwd`。领域重新打开时会再次按 schema 验证记录；不兼容或损坏的持久记录会使启动失败。

<a id="model-experience"></a>
## 模型体验

间接产生，通过 `dsh-tool-memory` 把持久记录和排序转为模型可见工具与上下文。

#### KV Cache 影响

无直接影响；存储变化本身不会触发或修改模型请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- 搜索是内存中的线性扫描，没有词干处理、模糊匹配、语义嵌入或二级索引。
- 精确工作区路径按存储字符串比较；本 Provider 不解析符号链接、文件系统别名或跨机器路径映射。
- 记录上限会直接拒绝写入。淘汰和按时间保留需要独立的策略 Consumer。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
