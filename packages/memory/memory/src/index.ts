/**
 * Native cross-session memory Service Definition.
 *
 * @module @deepseek-ai/dsh-memory
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** Identifies one durable memory record. */
export type MemoryId = Branded<'MemoryId'>

/**
 * Brand a raw string as a {@link MemoryId}.
 * @param id - Raw memory id.
 * @returns the same string with the compile-time brand.
 */
export function MemoryId(id: string): MemoryId {
  return id as MemoryId
}

/** A memory visible to every workspace in the deployment. */
export interface GlobalMemoryScope {
  readonly kind: 'global'
}

/** A memory visible only when an agent runs in one exact working directory. */
export interface WorkspaceMemoryScope {
  readonly kind: 'workspace'
  readonly cwd: string
}

/** Durable memory visibility. */
export type MemoryScope = GlobalMemoryScope | WorkspaceMemoryScope

/** One immutable durable memory record. */
export interface MemoryRecord {
  readonly id: MemoryId
  readonly scope: MemoryScope
  readonly text: string
  readonly tags: readonly string[]
  readonly pinned: boolean
  readonly sourceSessionId?: SessionId
  readonly revision: number
  readonly createdAt: string
  readonly updatedAt: string
}

/** Fully resolved input for creating a memory. */
export interface MemoryCreateRequest {
  readonly scope: MemoryScope
  readonly text: string
  readonly tags: readonly string[]
  readonly pinned: boolean
  readonly sourceSessionId?: SessionId
}

/** Mutable fields of a memory record. */
export interface MemoryPatch {
  readonly text?: string
  readonly tags?: readonly string[]
  readonly pinned?: boolean
}

/** Revision-checked input for updating a memory. */
export interface MemoryUpdateRequest {
  readonly id: MemoryId
  readonly expectedRevision: number
  readonly patch: MemoryPatch
}

/** Revision-checked input for forgetting a memory. */
export interface MemoryRemoveRequest {
  readonly id: MemoryId
  readonly expectedRevision: number
}

/** Trusted-scope search over durable memories. */
export interface MemorySearchRequest {
  readonly scopes: readonly MemoryScope[]
  readonly query?: string
  readonly tags?: readonly string[]
  readonly pinned?: boolean
  readonly limit: number
}

/** One deterministic search result. */
export interface MemorySearchHit {
  readonly record: MemoryRecord
  readonly score: number
}

/** Mutation notification emitted after durable commit. */
export type MemoryChanged =
  | { readonly operation: 'create' | 'update'; readonly record: MemoryRecord }
  | { readonly operation: 'remove'; readonly id: MemoryId; readonly revision: number }

/** Stable error codes returned by native Memory providers. */
export type MemoryErrorCode =
  | 'MEMORY_INVALID_INPUT'
  | 'MEMORY_LIMIT_REACHED'
  | 'MEMORY_NOT_FOUND'
  | 'MEMORY_REVISION_CONFLICT'

/** Expected Memory failure with a machine-readable code. */
export class MemoryError extends Error {
  /**
   * @param message - Human-readable failure detail.
   * @param code - Stable failure category.
   */
  constructor(message: string, readonly code: MemoryErrorCode) {
    super(message)
    this.name = 'MemoryError'
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    memory: MemoryStore
  }

  interface Events {
    /**
     * Emitted after one memory mutation commits durably.
     * @param change - Committed create, update, or remove observation.
     * @mode emit
     */
    'memory/changed'(change: MemoryChanged): void
  }
}

/**
 * Durable cross-session memory service. Reads are synchronous projections of
 * provider-owned current state; mutations resolve only after durable commit.
 */
export abstract class MemoryStore extends Service {
  constructor(ctx: Context) {
    super(ctx, 'memory')
  }

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
}

export default MemoryStore
