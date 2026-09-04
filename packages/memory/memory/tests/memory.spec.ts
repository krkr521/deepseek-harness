import { describe, expect, it } from 'vitest'
import { MemoryError, MemoryId } from '../src/index.ts'

describe('Memory Service Definition', () => {
  it('brands ids and exposes machine-readable provider errors', () => {
    expect(MemoryId('memory-1')).toBe('memory-1')
    const error = new MemoryError('invalid memory', 'MEMORY_INVALID_INPUT')
    expect(error).toMatchObject({ name: 'MemoryError', message: 'invalid memory', code: 'MEMORY_INVALID_INPUT' })
  })

})
