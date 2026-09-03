// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { MemorySettingsSection } from '../src/client/MemorySettingsSection.tsx'
import type {
  MemoryCuratorSettings,
  MemorySettingsSectionProps,
} from '../src/client/MemorySettingsSection.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

class FakeScope implements SettingsScope<MemoryCuratorSettings> {
  readonly writes: Array<{ field: string; value: unknown }> = []
  private readonly listeners = new Set<() => void>()

  constructor(private snapshot: SettingsScopeSnapshot<MemoryCuratorSettings>) {}

  getSnapshot(): SettingsScopeSnapshot<MemoryCuratorSettings> {
    return this.snapshot
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  set(field: string, value: unknown): Promise<void> {
    this.writes.push({ field, value })
    return Promise.resolve()
  }

  unset(): Promise<void> {
    return Promise.resolve()
  }

  mutate(): Promise<void> {
    return Promise.resolve()
  }

  replace(snapshot: SettingsScopeSnapshot<MemoryCuratorSettings>): void {
    this.snapshot = snapshot
    for (const listener of this.listeners) listener()
  }
}

function ready(
  value: MemoryCuratorSettings = { enabled: false, allowToolSources: false },
  writable = true,
): SettingsScopeSnapshot<MemoryCuratorSettings> {
  return {
    status: 'ready',
    value,
    base: {},
    user: {},
    revision: 0,
    writable,
    mode: 'host',
  }
}

function mount(scope: FakeScope): void {
  const props = {
    t: (key: keyof typeof en) => en[key],
    scope,
  } as unknown as MemorySettingsSectionProps
  render(<MemorySettingsSection {...props} />)
}

describe('MemorySettingsSection', () => {
  it('renders both persisted switches and writes only the selected field', () => {
    const scope = new FakeScope(ready({ enabled: true, allowToolSources: false }))
    mount(scope)

    const automatic = screen.getByRole('switch', { name: en.automaticTitle })
    const tools = screen.getByRole('switch', { name: en.toolTitle })
    expect(automatic.getAttribute('aria-checked')).toBe('true')
    expect(tools.getAttribute('aria-checked')).toBe('false')

    fireEvent.click(automatic)
    fireEvent.click(tools)
    expect(scope.writes).toEqual([
      { field: 'enabled', value: false },
      { field: 'allowToolSources', value: true },
    ])
  })

  it('follows Host snapshots instead of optimistically changing the switch', () => {
    const scope = new FakeScope(ready())
    mount(scope)
    const automatic = screen.getByRole('switch', { name: en.automaticTitle })
    fireEvent.click(automatic)
    expect(automatic.getAttribute('aria-checked')).toBe('false')

    act(() => { scope.replace(ready({ enabled: true, allowToolSources: false })) })
    expect(automatic.getAttribute('aria-checked')).toBe('true')
  })

  it.each([
    [{ status: 'loading', value: undefined, base: undefined, user: undefined, revision: undefined, writable: false, mode: 'host' }, en.loading],
    [{ status: 'unavailable', value: undefined, base: undefined, user: undefined, revision: undefined, writable: false, mode: 'host' }, en.unavailable],
  ] as const)('renders the non-ready state', (snapshot, message) => {
    mount(new FakeScope(snapshot))
    expect(screen.getByText(message)).toBeTruthy()
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('disables controls and explains a read-only Host document', () => {
    mount(new FakeScope(ready(undefined, false)))
    expect(screen.getByText(en.readOnly)).toBeTruthy()
    expect(screen.getAllByRole('switch').every(control => (control as HTMLButtonElement).disabled)).toBe(true)
  })
})
