/** Durable schema for the native local Memory provider. @module @deepseek-ai/dsh-memory-local/spec */

import { z } from 'zod'
import type { ZodType } from 'zod'
import type { MemoryId, MemoryRecord } from '@deepseek-ai/dsh-memory'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

/** Stored record body; the table key is the record's id. */
export type StoredMemoryRecord = Omit<MemoryRecord, 'id'>

const memoryScope = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('global') }),
  z.object({ kind: z.literal('workspace'), cwd: z.string() }),
])

const storedMemoryFields = {
  scope: memoryScope,
  text: z.string(),
  tags: z.array(z.string()),
  pinned: z.boolean(),
  revision: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}

/** Durable validation for one native memory record body. */
export const storedMemoryRecord: ZodType<StoredMemoryRecord> = z.union([
  z.object({ ...storedMemoryFields, sourceSessionId: z.string().transform(SessionId) }),
  z.object(storedMemoryFields),
])

/** Native Memory domain: one schema-validated record table. */
export const memoryDomainSpec = defineDomain({
  name: 'memory',
  version: 0,
  tables: {
    records: domainTable<MemoryId, StoredMemoryRecord>(storedMemoryRecord),
  },
} as const)
