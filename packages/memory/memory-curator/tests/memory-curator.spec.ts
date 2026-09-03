import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, {
  ToolCallId,
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
  LlmAdapter,
} from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import LocalMemoryStore from '@deepseek-ai/dsh-memory-local'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import * as curator from '../src/index.ts'

class MemorySettings extends SettingsProvider {
  private doc: Record<string, unknown> = {}

  override get writable(): boolean {
    return true
  }

  protected override load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected override persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

class ScriptedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  readonly loggedBeforeDispatch: boolean[] = []
  settled = 0

  constructor(
    private readonly outputs: string[],
    private readonly sessionForDispatch: () => Session | undefined,
  ) {
    super()
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    this.loggedBeforeDispatch.push(this.sessionForDispatch()?.snapshotEvents()
      .some(event => event.type === 'memory/curation-request') ?? false)
    const text = this.outputs.shift()
    if (text === undefined) throw new Error('curator test adapter has no scripted output')
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'finish', reason: { kind: 'stop' } }
    this.settled += 1
  }

  enqueue(output: string): void {
    this.outputs.push(output)
  }
}

interface Harness {
  readonly ctx: Context
  adapter: ScriptedAdapter
  currentSession: Session | undefined
}

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.map(ctx => ctx.fiber.dispose()))
  contexts.length = 0
})

async function harness(
  outputs: string[],
  config: curator.Config = { enabled: true },
): Promise<Harness> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(LocalMemoryStore)
  await ctx.plugin(SessionStore)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(MemorySettings)
  const state: Harness = {
    ctx,
    adapter: undefined as unknown as ScriptedAdapter,
    currentSession: undefined,
  }
  state.adapter = new ScriptedAdapter(outputs, () => state.currentSession)
  ctx.llm.registerAdapter(['curator-test'], state.adapter)
  await ctx.plugin(curator, config)
  return state
}

function appendHeader(session: NonNullable<Harness['currentSession']>): void {
  if (session.requestHeader() !== undefined) return
  session.append('request/header', {
    header: { config: { provider: 'curator-test', model: 'curator-model' } },
    reason: 'initial',
  })
}

function completeTextTurn(h: Harness, turn: number, text: string): void {
  const session = h.currentSession ??= h.ctx.sessions.create(
    SessionId(`memory-curator-${randomUUID()}`),
    { meta: { cwd: resolve('workspace') } },
  )
  session.append('turn/start', { turn })
  session.append('step/start', { turn, step: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  appendHeader(session)
  session.append('assistant/message', {
    turn,
    step: 1,
    message: createAssistantMessage({
      content: [{ type: 'text', text: 'Understood.' }],
      source: { provider: 'curator-test', model: 'curator-model' },
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn, step: 1 })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

function completeToolTurn(h: Harness, turn: number): void {
  const session = h.currentSession ??= h.ctx.sessions.create(
    SessionId(`memory-curator-${randomUUID()}`),
    { meta: { cwd: resolve('workspace') } },
  )
  const callId = ToolCallId(`call-${turn}`)
  session.append('turn/start', { turn })
  session.append('step/start', { turn, step: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Remember the verified project command.' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  appendHeader(session)
  session.append('assistant/message', {
    turn,
    step: 1,
    message: createAssistantMessage({
      content: [{ type: 'tool-call', id: callId, name: 'web_search', arguments: '{"query":"command"}' }],
      source: { provider: 'curator-test', model: 'curator-model' },
    }),
  }, { surfaceOp: 'append' })
  session.append('tool/call', {
    turn, step: 1, callId, name: 'web_search', arguments: '{"query":"command"}',
  })
  session.append('tool/result', {
    turn,
    step: 1,
    message: createToolResultMessage({
      callId,
      content: [{ type: 'text', text: 'Use pnpm test.' }],
      isError: false,
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn, step: 1 })
  session.append('step/start', { turn, step: 2 })
  session.append('assistant/message', {
    turn,
    step: 2,
    message: createAssistantMessage({
      content: [{ type: 'text', text: 'The verified command is pnpm test.' }],
      source: { provider: 'curator-test', model: 'curator-model' },
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn, step: 2 })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

describe('automatic Memory curation', () => {
  it('does nothing until the persisted enable switch is turned on', async () => {
    const h = await harness([
      JSON.stringify({
        operations: [{
          kind: 'create', scope: 'global', text: 'User prefers concise replies.', tags: ['preference'], pinned: false,
        }],
      }),
    ], { enabled: false })
    completeTextTurn(h, 1, 'Please keep future replies concise.')
    await Promise.resolve()
    expect(h.adapter.requests).toHaveLength(0)

    await h.ctx.settings.update(curator.MEMORY_CURATOR_SETTINGS_NAMESPACE, { enabled: true })
    completeTextTurn(h, 2, 'This preference should apply later too.')
    await vi.waitFor(() => { expect(h.ctx.memory.search({ scopes: [{ kind: 'global' }], limit: 10 })).toHaveLength(1) })
    expect(h.adapter.requests[0]).toMatchObject({
      provider: 'curator-test', model: 'curator-model', purpose: 'memory-curation', maxTokens: 2_048,
    })
    expect(h.adapter.loggedBeforeDispatch).toEqual([true])
    const request = h.currentSession?.snapshotEvents().findLast(event => event.type === 'memory/curation-request')
    expect(request?.data).toMatchObject({ turn: 2, allowToolSources: false })
    expect(h.currentSession?.snapshotEvents().findLast(event => event.type === 'memory/curation-applied')?.data)
      .toMatchObject({
        turn: 2,
        requestSeq: request?.seq,
        operations: [{
          kind: 'create', scope: 'global', text: 'User prefers concise replies.', tags: ['preference'], pinned: false,
        }],
      })
  })

  it('excludes whole tool-bearing turns until the separate source switch is enabled', async () => {
    const h = await harness([
      JSON.stringify({ operations: [{
        kind: 'create', scope: 'workspace', text: 'Use pnpm test for this workspace.', tags: ['testing'], pinned: false,
      }] }),
    ], { enabled: true, allowToolSources: false })
    completeToolTurn(h, 1)
    await Promise.resolve()
    expect(h.adapter.requests).toHaveLength(0)

    await h.ctx.settings.update(curator.MEMORY_CURATOR_SETTINGS_NAMESPACE, { allowToolSources: true })
    completeToolTurn(h, 2)
    await vi.waitFor(() => { expect(h.adapter.requests).toHaveLength(1) })
    const event = h.currentSession?.snapshotEvents().findLast(candidate => candidate.type === 'memory/curation-request')
    expect(event?.type === 'memory/curation-request' && event.data.allowToolSources).toBe(true)
    const framed = h.adapter.requests[0]?.messages[0]?.content[0]
    expect(framed?.type === 'text' && framed.text).toContain('web_search')
    expect(framed?.type === 'text' && framed.text).toContain('Use pnpm test.')
  })

  it('updates only a supplied current revision and never accepts removal operations', async () => {
    const h = await harness([])
    const current = await h.ctx.memory.create({
      scope: { kind: 'global' },
      text: 'User prefers long replies.',
      tags: ['preference'],
      pinned: false,
    })
    h.adapter.enqueue(JSON.stringify({ operations: [{
      kind: 'update',
      id: String(current.id),
      expectedRevision: current.revision,
      text: 'User prefers concise replies.',
    }] }))
    completeTextTurn(h, 1, 'Actually, keep future replies concise.')
    await vi.waitFor(() => { expect(h.ctx.memory.get(current.id)?.revision).toBe(2) })
    expect(h.ctx.memory.get(current.id)?.text).toBe('User prefers concise replies.')

    h.adapter.enqueue(JSON.stringify({ operations: [{
      kind: 'remove', id: String(current.id), expectedRevision: 2,
    }] }))
    completeTextTurn(h, 2, 'Forget nothing automatically.')
    await vi.waitFor(() => { expect(h.adapter.settled).toBe(2) })
    expect(h.ctx.memory.get(current.id)).toBeDefined()
  })
})
