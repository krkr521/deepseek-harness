# Agent Note: Workspace 显示集合

Status: implemented

[English](2026-09-03-workspace-presentation-collections.md) | 中文

## 问题

有些 Workspace 提供方出于运行需要保留多个规范目录，但用户会把它们理解为同一个浏览区域。按月保存的默认聊天就是一个例子：每个 Session 必须保留月份目录作为 `cwd`，但侧边栏按月份渲染多个分组，会把存储细节暴露成导航结构。

Workspace 归属关系无法表达这种联系。Workspace 只持有不可变 header `cwd` 与其规范路径完全相等的 Session。把多个按月记账直接放进一个真实 Workspace，要么会让旧 Session 变成未分组，要么必须重写持久化 Session 身份与存储。

## 决定

`ui-workspace` 持有 client 侧的 `workspacePresentation` 服务。client 插件注册稳定的集合键、显示标题、代表路径、路径匹配器，以及用于解析新 Session 真实接收 Workspace 的异步函数。注册遵循 effect 生命周期，并发布可观察快照供侧边栏和 Workspace 选择器消费。

树投影会在首个匹配 Workspace 的位置，用一个集合记账替换所有匹配的真实 Workspace。它会合并成员 Workspace 记账，也会纳入保留 `cwd` 与同一规则匹配的 Session 摘要。后一条规则可在旧规范目录已经不可用、Host 无法投影其 Workspace 归属时继续显示这些 Session。

集合只改变显示。真实 Workspace id、Session header、日志、归档状态与 Host 注册表都保持不变。集合区头不提供重命名、删除或 Workspace 拖拽操作。组合后的 Session 顺序只保存在浏览器内；只有真实 Workspace 分组可以向 Host 写入 `insertSessionBefore`。搜索和两处 Workspace 选择器使用同一个集合标题。新建 Session 每次都会重新解析集合，因此长期运行的浏览器也能落到新建的日历周期中。

## 考虑过的替代方案

**把父目录注册成一个真实 Workspace。** 不采用，因为 Session 归属要求规范 `cwd` 完全相等，不接受祖先目录关系。

**重写历史 Session header 并移动日志。** 不采用，因为这会成为横跨 Session 日志、投影缓存、用量记录与 Workspace 记账的存储迁移，而需求只是显示分组。

**让默认聊天包替换整个侧边栏 slot。** 不采用，因为 `sidebar.workspaces` 是 single slot，替换完整浏览器会复制搜索、归档、排序、对话框、本地化及后续 Workspace 功能。

**只匹配当前可见 Workspace。** 不采用，因为历史目录不可用时，其 Workspace 归属投影会消失，而 Session 摘要仍保留可用于安全显示的权威 `cwd`。

## 结果

集合匹配器是同进程 client 回调，不改变 Host 协议。各注册应使用互不重叠的路径策略；多个策略同时匹配时，由先注册者持有显示。集合键是浏览器状态身份，在成员 Workspace 变化时必须保持稳定。

扁平模式仍是跨 Workspace 的 Session 列表。移除集合提供方会立即恢复底层真实 Workspace 行，因为 Host 数据从未被修改。

## 测试

树测试覆盖多个按月 Workspace、来自不可用旧用户主目录的保留 Session、当前分组展开、排除未分组以及集合搜索标签。选择器测试覆盖只显示一条集合记录并解析到当前真实 Workspace。apply 测试覆盖注册快照、释放和集合键解析。默认聊天包测试覆盖浏览器注册、保留已有选择、路径匹配、协议校验与交付的浏览器产物。
