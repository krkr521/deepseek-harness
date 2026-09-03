// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import type { MemoryCuratorSettings, MemorySettingsSectionInjected } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.map(ctx => ctx.fiber.dispose()))
  contexts.length = 0
})

function fakeScope(): SettingsScope<MemoryCuratorSettings> {
  return {
    getSnapshot: () => ({
      status: 'ready',
      value: { enabled: false, allowToolSources: false },
      base: {},
      user: {},
      revision: 0,
      writable: true,
      mode: 'host',
    }),
    subscribe: () => () => {},
    set: () => Promise.resolve(),
    unset: () => Promise.resolve(),
    mutate: () => Promise.resolve(),
  }
}

class ScopeService extends Service {
  constructor(ctx: Context, private readonly scope: SettingsScope<MemoryCuratorSettings>) {
    super(ctx, 'settingsScope')
  }

  bind(): SettingsScope<MemoryCuratorSettings> {
    return this.scope
  }
}

async function bench() {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SlotRegistry)
  ctx.slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, (() => null) as never)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const scope = fakeScope()
  new ScopeService(ctx, scope)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, scope }
}

describe('ui-memory browser plugin', () => {
  it('registers one localized Memory section with the bound settings scope', async () => {
    const b = await bench()
    const entry = b.ctx.slots.entries('settings.section')[0]
    expect(entry?.options).toMatchObject({ id: 'memory', order: 12 })
    expect(entry?.locale).toBe('settings.memory')
    const injected = entry?.inject?.() as MemorySettingsSectionInjected | undefined
    expect(injected?.scope).toBe(b.scope)
  })

  it('keeps the node loader half deliberately empty', () => {
    nodeApply()
  })
})
