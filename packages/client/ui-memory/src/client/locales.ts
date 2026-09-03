/** Locale keys for the native Memory settings page. */
export type MemorySettingsKey =
  | 'nav' | 'title' | 'intro' | 'automaticTitle' | 'automaticDescription'
  | 'toolTitle' | 'toolDescription' | 'loading' | 'unavailable' | 'readOnly'

/** English Memory settings copy. */
export const en: Record<MemorySettingsKey, string> = {
  nav: 'Memory',
  title: 'Memory',
  intro: 'Control how this computer curates durable local memory from chats.',
  automaticTitle: 'Create local memories automatically',
  automaticDescription: 'After a completed chat turn, use an auxiliary model call to keep durable preferences, project facts, and decisions for later chats on this computer.',
  toolTitle: 'Allow chats that used tools, MCP, or web search',
  toolDescription: 'When off, an entire turn is excluded from automatic memory if it used any tool. Explicit Memory tools remain available.',
  loading: 'Loading Memory settings…',
  unavailable: 'Native automatic Memory is not installed in this deployment.',
  readOnly: 'This deployment stores settings read-only.',
}

/** Simplified Chinese Memory settings copy. */
export const zh: Record<MemorySettingsKey, string> = {
  nav: '记忆',
  title: '记忆',
  intro: '设置此电脑如何根据聊天整理并保留本地长期记忆。',
  automaticTitle: '自动创建本地记忆',
  automaticDescription: '每个聊天轮次完成后，通过一次辅助模型调用，整理可供后续聊天使用的长期偏好、项目事实和决定。',
  toolTitle: '允许使用过工具、MCP 或网页搜索的聊天',
  toolDescription: '关闭时，只要该轮使用过任何工具，整轮都不会进入自动记忆整理；显式 Memory 工具仍可使用。',
  loading: '正在加载记忆设置…',
  unavailable: '当前部署未安装原生自动记忆。',
  readOnly: '当前部署的设置为只读。',
}
