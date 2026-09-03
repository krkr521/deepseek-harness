import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { describe, expect, it } from 'vitest'
import { MemoryError, MemoryId } from '../src/index.ts'
import * as MemoryInvariant from '../src/invariant.ts'

describe('Memory Service Definition', () => {
  it('brands ids and exposes machine-readable provider errors', () => {
    expect(MemoryId('memory-1')).toBe('memory-1')
    const error = new MemoryError('invalid memory', 'MEMORY_INVALID_INPUT')
    expect(error).toMatchObject({ name: 'MemoryError', message: 'invalid memory', code: 'MEMORY_INVALID_INPUT' })
  })

  it('registers and disposes its stateless invariant companion', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(InvariantRegistry, { enabled: true })
      const fiber = await ctx.plugin(MemoryInvariant)
      expect(() => { ctx.invariants.register('@deepseek-ai/dsh-memory', () => {}) }).toThrow(/already registered/u)
      await fiber.dispose()
      await expect(ctx.plugin(MemoryInvariant).await()).resolves.toBeDefined()
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
