/** Settings page for native automatic Memory curation. */

import { useSyncExternalStore } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { MemorySettingsKey } from './locales.ts'
import css from './MemorySettingsSection.module.css'

/** Settings fields owned by the Host automatic curator. */
export interface MemoryCuratorSettings {
  readonly enabled: boolean
  readonly allowToolSources: boolean
}

/** Business face injected by the browser plugin. */
export interface MemorySettingsSectionInjected {
  /** Revision-fenced Host settings handle. */
  scope: SettingsScope<MemoryCuratorSettings>
}

/** Full section props. */
export type MemorySettingsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.memory'>
  & InjectFace<MemorySettingsSectionInjected>

interface SwitchRowProps {
  readonly title: string
  readonly description: string
  readonly checked: boolean
  readonly disabled: boolean
  readonly onChange: (checked: boolean) => void
}

/** Render one accessible settings switch row. */
function SwitchRow(props: SwitchRowProps) {
  return (
    <div className={css.row}>
      <div className={css.copy}>
        <div className={css.rowTitle}>{props.title}</div>
        <p className={css.description}>{props.description}</p>
      </div>
      <button
        type="button"
        role="switch"
        className={css.toggle}
        aria-label={props.title}
        aria-checked={props.checked}
        disabled={props.disabled}
        onClick={() => { props.onChange(!props.checked) }}
      >
        <span className={css.knob} />
      </button>
    </div>
  )
}

/**
 * Render native Memory settings from the shared settings scope.
 * @param props - slot, locale, and Host settings bindings.
 * @returns the Memory settings page.
 */
export function MemorySettingsSection({ t, scope }: MemorySettingsSectionProps) {
  const snapshot = useSyncExternalStore(
    listener => scope.subscribe(listener),
    () => scope.getSnapshot(),
  )
  const value = snapshot.value
  const disabled = !snapshot.writable || snapshot.status !== 'ready'

  return (
    <div className={css.section}>
      <h2 className={css.heading}>{t('title')}</h2>
      <p className={css.intro}>{t('intro')}</p>
      {snapshot.status === 'loading' ? <p className={css.status}>{t('loading')}</p> : null}
      {snapshot.status === 'unavailable' ? <p className={css.status}>{t('unavailable')}</p> : null}
      {snapshot.status === 'ready' && !snapshot.writable ? <p className={css.status}>{t('readOnly')}</p> : null}
      {value === undefined ? null : (
        <div className={css.card}>
          <SwitchRow
            title={t('automaticTitle')}
            description={t('automaticDescription')}
            checked={value.enabled}
            disabled={disabled}
            onChange={(enabled) => { void scope.set('enabled', enabled) }}
          />
          <SwitchRow
            title={t('toolTitle')}
            description={t('toolDescription')}
            checked={value.allowToolSources}
            disabled={disabled}
            onChange={(allowToolSources) => { void scope.set('allowToolSources', allowToolSources) }}
          />
        </div>
      )}
    </div>
  )
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Native Memory settings copy. */
    'settings.memory': MemorySettingsKey
  }
}
