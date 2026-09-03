import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { resolve } from 'node:path'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryId } from '@deepseek-ai/dsh-memory'
import LocalMemoryStore from '../src/index.ts'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'

let contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.map(ctx => ctx.fiber.dispose()))
  contexts = []
})

async function harness(
  pool = new MemoryMediaPool(),
  config: ConstructorParameters<typeof LocalMemoryStore>[1] = {},
) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(LocalMemoryStore, config)
  return { ctx, pool, memory: ctx.memory }
}

describe('LocalMemoryStore', () => {
  it('persists global and workspace records and restores them on reopen', async () => {
    const first = await harness()
    const global = await first.memory.create({
      scope: { kind: 'global' },
      text: '  User prefers concise Chinese replies.  ',
      tags: ['Preference', 'Language'],
      pinned: true,
    })
    const workspace = await first.memory.create({
      scope: { kind: 'workspace', cwd: resolve('workspace') },
      text: 'Run focused checks before a push.',
      tags: ['workflow'],
      pinned: false,
    })
    expect(global).toMatchObject({ text: 'User prefers concise Chinese replies.', revision: 1 })
    expect(Object.isFrozen(global)).toBe(true)
    expect(Object.isFrozen(global.tags)).toBe(true)

    await first.ctx.fiber.dispose()
    contexts = contexts.filter(ctx => ctx !== first.ctx)
    const reopened = await harness(first.pool)
    expect(reopened.memory.get(global.id)).toEqual(global)
    expect(reopened.memory.get(workspace.id)).toEqual(workspace)
  })

  it('searches authorized scopes and AND-filters tags deterministically', async () => {
    const { memory } = await harness()
    const older = await memory.create({
      scope: { kind: 'global' }, text: 'Use pnpm for repository checks.', tags: ['repo', 'tooling'], pinned: false,
    })
    await memory.create({
      scope: { kind: 'workspace', cwd: resolve('workspace') },
      text: 'Use pnpm test for focused verification.', tags: ['repo', 'testing'], pinned: true,
    })
    await memory.create({
      scope: { kind: 'workspace', cwd: resolve('other') },
      text: 'Use pnpm elsewhere.', tags: ['repo'], pinned: true,
    })

    const hits = memory.search({
      scopes: [{ kind: 'global' }, { kind: 'workspace', cwd: resolve('workspace') }],
      query: 'pnpm checks',
      tags: ['repo'],
      limit: 10,
    })
    expect(hits.map(hit => hit.record.id)).toEqual([older.id])
    expect(memory.search({
      scopes: [{ kind: 'workspace', cwd: resolve('workspace') }], pinned: true, limit: 10,
    })).toHaveLength(1)
    expect(memory.search({ scopes: [{ kind: 'global' }], pinned: true, limit: 10 })).toEqual([])
    expect(memory.search({ scopes: [{ kind: 'global' }], query: '!!!', limit: 10 })).toEqual([])
    expect(memory.search({ scopes: [{ kind: 'global' }], tags: ['missing'], limit: 10 })).toEqual([])
  })

  it('uses score, update time, and id as deterministic search tie-breakers', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime('2026-08-23T00:00:00.000Z')
      const { memory } = await harness()
      const first = await memory.create({
        scope: { kind: 'global' }, text: 'shared phrase', tags: [], pinned: false,
      })
      const second = await memory.create({
        scope: { kind: 'global' }, text: 'shared phrase', tags: [], pinned: false,
      })
      const tied = memory.search({ scopes: [{ kind: 'global' }], query: 'shared phrase', limit: 10 })
      expect(tied.map(hit => String(hit.record.id)))
        .toEqual([String(first.id), String(second.id)].sort((left, right) => left.localeCompare(right)))

      vi.setSystemTime('2026-08-23T00:00:01.000Z')
      const updated = await memory.update({ id: first.id, expectedRevision: 1, patch: { pinned: true } })
      expect(memory.search({ scopes: [{ kind: 'global' }], query: 'shared phrase', limit: 10 })[0]?.record.id)
        .toBe(updated.id)
    } finally {
      vi.useRealTimers()
    }
  })

  it('uses revision checks for update and removal and emits committed changes', async () => {
    const { ctx, memory } = await harness()
    const changes: string[] = []
    ctx.on('memory/changed', (change) => { changes.push(change.operation) })
    const record = await memory.create({
      scope: { kind: 'global' }, text: 'Initial fact.', tags: [], pinned: false,
    })
    const updated = await memory.update({
      id: record.id, expectedRevision: 1, patch: { text: 'Updated fact.', pinned: true },
    })
    expect(updated).toMatchObject({ text: 'Updated fact.', pinned: true, revision: 2 })
    await expect(memory.update({
      id: record.id, expectedRevision: 1, patch: { text: 'Stale edit.' },
    })).rejects.toMatchObject({ code: 'MEMORY_REVISION_CONFLICT' })
    await expect(memory.remove({ id: record.id, expectedRevision: 1 }))
      .rejects.toMatchObject({ code: 'MEMORY_REVISION_CONFLICT' })
    await memory.remove({ id: record.id, expectedRevision: 2 })
    expect(memory.get(record.id)).toBeUndefined()
    expect(changes).toEqual(['create', 'update', 'remove'])
  })

  it('rejects invalid durable inputs and configured resource limits', async () => {
    const { memory } = await harness(new MemoryMediaPool(), {
      maxRecords: 1,
      maxTextBytes: 8,
      maxTags: 1,
      maxTagBytes: 4,
      maxSearchResults: 2,
    })
    await expect(memory.create({
      scope: { kind: 'global' }, text: '   ', tags: [], pinned: false,
    })).rejects.toMatchObject({ code: 'MEMORY_INVALID_INPUT' })
    await expect(memory.create({
      scope: { kind: 'workspace', cwd: 'relative' }, text: 'ok', tags: [], pinned: false,
    })).rejects.toMatchObject({ code: 'MEMORY_INVALID_INPUT' })
    await expect(memory.create({
      scope: { kind: 'global' }, text: '九'.repeat(3), tags: [], pinned: false,
    })).rejects.toMatchObject({ code: 'MEMORY_INVALID_INPUT' })
    await expect(memory.create({
      scope: { kind: 'global' }, text: 'ok', tags: ['one', 'two'], pinned: false,
    })).rejects.toMatchObject({ code: 'MEMORY_INVALID_INPUT' })
    await expect(memory.create({
      scope: { kind: 'global' }, text: 'ok', tags: ['   '], pinned: false,
    })).rejects.toMatchObject({ code: 'MEMORY_INVALID_INPUT' })
    await expect(memory.create({
      scope: { kind: 'global' }, text: 'ok', tags: ['abcde'], pinned: false,
    })).rejects.toMatchObject({ code: 'MEMORY_INVALID_INPUT' })
    await expect(memory.create({
      scope: { kind: 'global' }, text: 'ok', tags: ['One', 'one'], pinned: false,
    })).rejects.toMatchObject({ code: 'MEMORY_INVALID_INPUT' })
    await memory.create({ scope: { kind: 'global' }, text: 'ok', tags: ['one'], pinned: false })
    await expect(memory.create({
      scope: { kind: 'global' }, text: 'next', tags: [], pinned: false,
    })).rejects.toMatchObject({ code: 'MEMORY_LIMIT_REACHED' })
    expect(() => memory.search({ scopes: [{ kind: 'global' }], limit: 3 }))
      .toThrow(/between 1 and 2/)
    expect(() => memory.search({ scopes: [], limit: 1 })).toThrow(/at least one scope/)
  })

  it('validates revisions and non-empty update patches', async () => {
    const { memory } = await harness()
    const record = await memory.create({
      scope: { kind: 'global' }, text: 'Initial.', tags: [], pinned: false,
    })
    await expect(memory.update({ id: record.id, expectedRevision: 1, patch: {} }))
      .rejects.toMatchObject({ code: 'MEMORY_INVALID_INPUT' })
    await expect(memory.update({ id: record.id, expectedRevision: 0, patch: { pinned: true } }))
      .rejects.toMatchObject({ code: 'MEMORY_INVALID_INPUT' })
    await expect(memory.remove({ id: record.id, expectedRevision: Number.NaN }))
      .rejects.toMatchObject({ code: 'MEMORY_INVALID_INPUT' })
    await expect(memory.update({ id: record.id, expectedRevision: 1, patch: { tags: ['One', 'one'] } }))
      .rejects.toMatchObject({ code: 'MEMORY_INVALID_INPUT' })
    const updated = await memory.update({ id: record.id, expectedRevision: 1, patch: { tags: ['new'] } })
    expect(updated.tags).toEqual(['new'])
  })

  it('rejects invalid direct config and reads before initialization', async () => {
    const invalid = new Context()
    contexts.push(invalid)
    expect(() => { new LocalMemoryStore(invalid, { maxRecords: 0 }) }).toThrow(/positive safe integer/)

    const bare = new Context()
    contexts.push(bare)
    const memory = new LocalMemoryStore(bare)
    expect(() => memory.get(MemoryId('uninitialized'))).toThrow(/not initialized/)
  })

  it('contains listener failures after durable commit', async () => {
    const { ctx, memory } = await harness()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
    ctx.on('memory/changed', () => { throw new Error('observer failed') })
    await expect(memory.create({
      scope: { kind: 'global' }, text: 'Committed despite observer.', tags: [], pinned: false,
    })).resolves.toMatchObject({ revision: 1 })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('observer failed'))
  })

  it('reports missing records without converting them into revision conflicts', async () => {
    const { memory } = await harness()
    await expect(memory.update({
      id: MemoryId('missing'), expectedRevision: 1, patch: { pinned: true },
    })).rejects.toMatchObject({ code: 'MEMORY_NOT_FOUND' })
    await expect(memory.remove({ id: MemoryId('missing'), expectedRevision: 1 }))
      .rejects.toMatchObject({ code: 'MEMORY_NOT_FOUND' })
  })
})
