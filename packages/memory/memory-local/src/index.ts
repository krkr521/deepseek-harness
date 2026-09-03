/**
 * Storage-Domain-backed native Memory Service Provider.
 *
 * @module @deepseek-ai/dsh-memory-local
 */

import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import MemoryStore, {
  MemoryError,
  MemoryId,
  type MemoryChanged,
  type MemoryCreateRequest,
  type MemoryPatch,
  type MemoryRecord,
  type MemoryRemoveRequest,
  type MemoryScope,
  type MemorySearchHit,
  type MemorySearchRequest,
  type MemoryUpdateRequest,
} from '@deepseek-ai/dsh-memory'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { memoryDomainSpec } from './spec.ts'
import type { StoredMemoryRecord } from './spec.ts'

export { memoryDomainSpec, storedMemoryRecord } from './spec.ts'
export type { StoredMemoryRecord } from './spec.ts'

/** Local provider resource and input limits. */
export interface Config {
  /** Maximum records retained by this provider. */
  maxRecords?: number
  /** Maximum UTF-8 byte length of one memory text. */
  maxTextBytes?: number
  /** Maximum tags on one record or filter. */
  maxTags?: number
  /** Maximum UTF-8 byte length of one tag. */
  maxTagBytes?: number
  /** Maximum results one service search may request. */
  maxSearchResults?: number
}

interface ResolvedConfig {
  readonly maxRecords: number
  readonly maxTextBytes: number
  readonly maxTags: number
  readonly maxTagBytes: number
  readonly maxSearchResults: number
}

const DEFAULT_CONFIG: ResolvedConfig = {
  maxRecords: 10_000,
  maxTextBytes: 16_384,
  maxTags: 16,
  maxTagBytes: 64,
  maxSearchResults: 100,
}

const encoder = new TextEncoder()

function bytes(value: string): number {
  return encoder.encode(value).byteLength
}

function compareScope(left: MemoryScope, right: MemoryScope): boolean {
  return left.kind === right.kind && (left.kind === 'global' || left.cwd === (right as { cwd: string }).cwd)
}

function detached(id: MemoryId, record: StoredMemoryRecord): MemoryRecord {
  const scope: MemoryScope = record.scope.kind === 'global'
    ? Object.freeze({ kind: 'global' })
    : Object.freeze({ kind: 'workspace', cwd: record.scope.cwd })
  return Object.freeze({
    id,
    scope,
    text: record.text,
    tags: Object.freeze([...record.tags]),
    pinned: record.pinned,
    ...record.sourceSessionId === undefined ? {} : { sourceSessionId: record.sourceSessionId },
    revision: record.revision,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  })
}

function normalizeQuery(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
}

function queryScore(record: StoredMemoryRecord, query: string): number | undefined {
  if (query.length === 0) return 0
  const text = `${record.text}\n${record.tags.join('\n')}`.toLocaleLowerCase('en-US')
  const tokens = query.match(/[\p{L}\p{N}_-]+/gu) ?? []
  const includesPhrase = text.includes(query)
  if (!includesPhrase && (tokens.length === 0 || !tokens.every(token => text.includes(token)))) return undefined
  let score = includesPhrase ? 100 : 0
  for (const token of tokens) {
    let at = 0
    while ((at = text.indexOf(token, at)) !== -1) {
      score++
      at += token.length
    }
  }
  return score
}

/** Persistent native Memory implementation over one Storage Domain. */
export class LocalMemoryStore extends MemoryStore {
  static inject = ['storageDomain']

  static Config: z<Config> = z.object({
    maxRecords: z.number().default(DEFAULT_CONFIG.maxRecords),
    maxTextBytes: z.number().default(DEFAULT_CONFIG.maxTextBytes),
    maxTags: z.number().default(DEFAULT_CONFIG.maxTags),
    maxTagBytes: z.number().default(DEFAULT_CONFIG.maxTagBytes),
    maxSearchResults: z.number().default(DEFAULT_CONFIG.maxSearchResults),
  })

  private table?: KvTable<MemoryId, StoredMemoryRecord>
  private readonly config: ResolvedConfig
  private operationTail: Promise<void> = Promise.resolve()

  constructor(ctx: Context, config: Config = {}) {
    super(ctx)
    this.config = { ...DEFAULT_CONFIG, ...config }
    for (const [name, value] of Object.entries(this.config)) {
      if (!Number.isSafeInteger(value) || value < 1) {
        throw new MemoryError(
          `memory-local: ${name} must be a positive safe integer`,
          'MEMORY_INVALID_INPUT',
        )
      }
    }
  }

  /** Open the Memory domain and keep its handle for synchronous reads. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(memoryDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'memory.domainClose')
    this.table = domain.table('records')
  }

  /** @inheritdoc */
  get(id: MemoryId): MemoryRecord | undefined {
    const record = this.requireTable().get(id)
    return record === undefined ? undefined : detached(id, record)
  }

  /** @inheritdoc */
  search(request: MemorySearchRequest): readonly MemorySearchHit[] {
    if (!Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > this.config.maxSearchResults) {
      throw new MemoryError(
        `memory search limit must be an integer between 1 and ${this.config.maxSearchResults}`,
        'MEMORY_INVALID_INPUT',
      )
    }
    if (request.scopes.length === 0) {
      throw new MemoryError('memory search requires at least one scope', 'MEMORY_INVALID_INPUT')
    }
    const scopes = request.scopes.map(scope => this.normalizeScope(scope))
    const tags = request.tags === undefined ? undefined : this.normalizeTags(request.tags)
    const query = normalizeQuery(request.query ?? '')
    const hits: MemorySearchHit[] = []
    for (const [id, record] of this.requireTable().entries()) {
      if (!scopes.some(scope => compareScope(scope, record.scope))) continue
      if (request.pinned !== undefined && record.pinned !== request.pinned) continue
      if (tags !== undefined) {
        const recordTags = new Set(record.tags.map(tag => tag.toLocaleLowerCase('en-US')))
        if (!tags.every(tag => recordTags.has(tag.toLocaleLowerCase('en-US')))) continue
      }
      const score = queryScore(record, query)
      if (score === undefined) continue
      hits.push({ record: detached(id, record), score })
    }
    hits.sort((left, right) =>
      right.score - left.score
      || right.record.updatedAt.localeCompare(left.record.updatedAt)
      || String(left.record.id).localeCompare(String(right.record.id)))
    return Object.freeze(hits.slice(0, request.limit).map(hit => Object.freeze(hit)))
  }

  /** @inheritdoc */
  create(request: MemoryCreateRequest): Promise<MemoryRecord> {
    return this.enqueue(async () => {
      const table = this.requireTable()
      if (table.size >= this.config.maxRecords) {
        throw new MemoryError(
          `memory record limit reached (${this.config.maxRecords})`,
          'MEMORY_LIMIT_REACHED',
        )
      }
      const id = MemoryId(randomUUID())
      const now = new Date().toISOString()
      const record: StoredMemoryRecord = {
        scope: this.normalizeScope(request.scope),
        text: this.normalizeText(request.text),
        tags: this.normalizeTags(request.tags),
        pinned: request.pinned,
        ...request.sourceSessionId === undefined ? {} : { sourceSessionId: request.sourceSessionId },
        revision: 1,
        createdAt: now,
        updatedAt: now,
      }
      await table.put(id, record)
      const result = detached(id, record)
      this.emitChanged({ operation: 'create', record: result })
      return result
    })
  }

  /** @inheritdoc */
  update(request: MemoryUpdateRequest): Promise<MemoryRecord> {
    return this.enqueue(async () => {
      this.assertRevision(request.expectedRevision)
      if (request.patch.text === undefined && request.patch.tags === undefined && request.patch.pinned === undefined) {
        throw new MemoryError('memory update patch must change at least one field', 'MEMORY_INVALID_INPUT')
      }
      const table = this.requireTable()
      if (table.get(request.id) === undefined) {
        throw new MemoryError(`memory '${request.id}' was not found`, 'MEMORY_NOT_FOUND')
      }
      const next = await table.update(request.id, (current) => {
        if (current.revision !== request.expectedRevision) {
          throw new MemoryError(
            `memory '${request.id}' revision is ${current.revision}, not ${request.expectedRevision}`,
            'MEMORY_REVISION_CONFLICT',
          )
        }
        return {
          ...current,
          ...this.normalizePatch(request.patch),
          revision: current.revision + 1,
          updatedAt: new Date().toISOString(),
        }
      })
      const result = detached(request.id, next)
      this.emitChanged({ operation: 'update', record: result })
      return result
    })
  }

  /** @inheritdoc */
  remove(request: MemoryRemoveRequest): Promise<void> {
    return this.enqueue(async () => {
      this.assertRevision(request.expectedRevision)
      const table = this.requireTable()
      const current = table.get(request.id)
      if (current === undefined) {
        throw new MemoryError(`memory '${request.id}' was not found`, 'MEMORY_NOT_FOUND')
      }
      if (current.revision !== request.expectedRevision) {
        throw new MemoryError(
          `memory '${request.id}' revision is ${current.revision}, not ${request.expectedRevision}`,
          'MEMORY_REVISION_CONFLICT',
        )
      }
      await table.delete(request.id)
      this.emitChanged({ operation: 'remove', id: request.id, revision: current.revision })
    })
  }

  private normalizeText(value: string): string {
    const text = value.trim()
    if (text.length === 0) throw new MemoryError('memory text must not be empty', 'MEMORY_INVALID_INPUT')
    if (bytes(text) > this.config.maxTextBytes) {
      throw new MemoryError(
        `memory text exceeds ${this.config.maxTextBytes} UTF-8 bytes`,
        'MEMORY_INVALID_INPUT',
      )
    }
    return text
  }

  private normalizeTags(values: readonly string[]): string[] {
    if (values.length > this.config.maxTags) {
      throw new MemoryError(`a memory may have at most ${this.config.maxTags} tags`, 'MEMORY_INVALID_INPUT')
    }
    const result: string[] = []
    const seen = new Set<string>()
    for (const raw of values) {
      const tag = raw.trim()
      if (tag.length === 0) throw new MemoryError('memory tags must not be empty', 'MEMORY_INVALID_INPUT')
      if (bytes(tag) > this.config.maxTagBytes) {
        throw new MemoryError(
          `memory tag exceeds ${this.config.maxTagBytes} UTF-8 bytes`,
          'MEMORY_INVALID_INPUT',
        )
      }
      const folded = tag.toLocaleLowerCase('en-US')
      if (seen.has(folded)) throw new MemoryError(`duplicate memory tag '${tag}'`, 'MEMORY_INVALID_INPUT')
      seen.add(folded)
      result.push(tag)
    }
    return result
  }

  private normalizeScope(scope: MemoryScope): MemoryScope {
    switch (scope.kind) {
      case 'global':
        return { kind: 'global' }
      case 'workspace': {
        const cwd = scope.cwd.trim()
        if (cwd.length === 0 || !isAbsolute(cwd)) {
          throw new MemoryError('workspace memory scope requires an absolute cwd', 'MEMORY_INVALID_INPUT')
        }
        return { kind: 'workspace', cwd }
      }
      /* v8 ignore start -- MemoryScope is a closed same-process union; this arm makes future variants fail loud. */
      default:
        scope satisfies never
        throw new MemoryError('unknown memory scope', 'MEMORY_INVALID_INPUT')
      /* v8 ignore stop */
    }
  }

  private normalizePatch(patch: MemoryPatch): MemoryPatch {
    return {
      ...patch.text === undefined ? {} : { text: this.normalizeText(patch.text) },
      ...patch.tags === undefined ? {} : { tags: this.normalizeTags(patch.tags) },
      ...patch.pinned === undefined ? {} : { pinned: patch.pinned },
    }
  }

  private assertRevision(revision: number): void {
    if (!Number.isSafeInteger(revision) || revision < 1) {
      throw new MemoryError('memory revision must be a positive safe integer', 'MEMORY_INVALID_INPUT')
    }
  }

  private requireTable(): KvTable<MemoryId, StoredMemoryRecord> {
    if (this.table === undefined) throw new Error('memory-local is not initialized')
    return this.table
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation)
    this.operationTail = result.then(() => {}, () => {})
    return result
  }

  private emitChanged(change: MemoryChanged): void {
    try {
      this.ctx.emit('memory/changed', change)
    } catch (error) {
      this.ctx.logger.warn(`memory/changed listener failed after durable commit: ${String(error)}`)
    }
  }
}

export default LocalMemoryStore
