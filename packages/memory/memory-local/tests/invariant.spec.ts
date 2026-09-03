import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import type { MemoryChanged } from '@deepseek-ai/dsh-memory'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { afterEach, describe, expect, it } from 'vitest'
import LocalMemoryStore from '../src/index.ts'
import * as MemoryLocalInvariant from '../src/invariant.ts'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'

let contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.map(ctx => ctx.fiber.dispose()))
  contexts = []
})

async function setup(): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(LocalMemoryStore)
  await ctx.plugin(MemoryLocalInvariant)
  return ctx
}

describe('memory-local invariant companion', () => {
  it('accepts notifications that agree with the current provider cache', async () => {
    const ctx = await setup()
    const record = await ctx.memory.create({
      scope: { kind: 'global' }, text: 'Current.', tags: [], pinned: false,
    })
    const updated = await ctx.memory.update({ id: record.id, expectedRevision: 1, patch: { pinned: true } })
    await expect(ctx.memory.remove({ id: updated.id, expectedRevision: 2 })).resolves.toBeUndefined()
  })

  it('rejects create and update notifications that differ from the current record', async () => {
    const ctx = await setup()
    const record = await ctx.memory.create({
      scope: { kind: 'global' }, text: 'Current.', tags: [], pinned: false,
    })
    expect(() => {
      ctx.emit('memory/changed', { operation: 'update', record: { ...record, text: 'Different.' } })
    }).toThrow(/differs from the current Memory record/u)
  })

  it('rejects a removal notification while the record remains present', async () => {
    const ctx = await setup()
    const record = await ctx.memory.create({
      scope: { kind: 'global' }, text: 'Still present.', tags: [], pinned: false,
    })
    expect(() => {
      ctx.emit('memory/changed', { operation: 'remove', id: record.id, revision: record.revision })
    }).toThrow(/record is still present/u)
  })

  it('keeps the exhaustive default harmless for an untyped future event', async () => {
    const ctx = await setup()
    expect(() => {
      ctx.emit('memory/changed', { operation: 'future' } as unknown as MemoryChanged)
    }).not.toThrow()
  })
})
