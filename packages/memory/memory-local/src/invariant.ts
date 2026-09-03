/** Package-owned invariant companion for the local Memory provider. @module @deepseek-ai/dsh-memory-local/invariant */

import { isDeepStrictEqual } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import type { MemoryChanged } from '@deepseek-ai/dsh-memory'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-memory-local'

/** Cordis companion plugin name. */
export const name = 'memory-local-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Assert every committed mutation notification agrees with the provider's current cache. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  ctx.on('memory/changed', (change: MemoryChanged) => {
    switch (change.operation) {
      case 'create':
      case 'update': {
        const current = ctx.memory.get(change.record.id)
        if (!isDeepStrictEqual(current, change.record)) {
          return fail(`memory/changed ${change.operation} record '${change.record.id}' differs from the current Memory record`)
        }
        return
      }
      case 'remove':
        if (ctx.memory.get(change.id) !== undefined) {
          return fail(`memory/changed removal of '${change.id}' emitted while the record is still present`)
        }
        return
      default:
        change satisfies never
    }
  }, { global: true })
}, { inject: ['memory'] })

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
