/** Browser registration for the native Memory settings page. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { MemorySettingsSection } from './MemorySettingsSection.tsx'
import type { MemoryCuratorSettings } from './MemorySettingsSection.tsx'
import { en, zh } from './locales.ts'

export type {
  MemoryCuratorSettings, MemorySettingsSectionInjected, MemorySettingsSectionProps,
} from './MemorySettingsSection.tsx'
export type { MemorySettingsKey } from './locales.ts'

const NS = 'settings.memory'
const SETTINGS_NAMESPACE = 'memory-curator'

/** Required settings, slot, and locale services. */
export const inject = ['slots', 'locale', 'settingsScope']

/**
 * Register the Memory settings page and bind its Host namespace.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  const scope = ctx.settingsScope.bind<MemoryCuratorSettings>({ namespace: SETTINGS_NAMESPACE })
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-memory: dictionaries')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'memory',
    order: 12,
    label: () => t('nav'),
    locale: NS,
    inject: () => ({ scope }),
  }, MemorySettingsSection))
}
