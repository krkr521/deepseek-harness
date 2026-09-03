import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { describe, expect, it } from 'vitest'
import * as ToolMemoryInvariant from '../src/invariant.ts'

describe('tool-memory invariant companion', () => {
  it('registers and disposes its stateless package ownership', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(InvariantRegistry, { enabled: true })
      const fiber = await ctx.plugin(ToolMemoryInvariant)
      expect(() => { ctx.invariants.register('@deepseek-ai/dsh-tool-memory', () => {}) }).toThrow(/already registered/u)
      await fiber.dispose()
      await expect(ctx.plugin(ToolMemoryInvariant).await()).resolves.toBeDefined()
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
