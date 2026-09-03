/** Provider-native Codex compaction content stored in a durable checkpoint. */

/** Lossless Responses item returned for a Codex compaction trigger. */
export type CodexCompactionItem = Record<string, unknown> & {
  readonly type: 'compaction'
  readonly encrypted_content: string
}

/** Opaque Codex state replayed as one standalone Responses input item. */
export interface CodexCompactionBlock {
  readonly type: 'codex-compaction'
  readonly item: CodexCompactionItem
}

declare module '@deepseek-ai/dsh-llm' {
  interface ContentBlockMap {
    'codex-compaction': CodexCompactionBlock
  }
}
