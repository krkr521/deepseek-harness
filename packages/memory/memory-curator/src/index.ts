/**
 * Settings-controlled automatic curation for native cross-session Memory.
 *
 * @module @deepseek-ai/dsh-memory-curator
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createUserMessage, BlockAssembler } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, FinishReason, GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import {
  MemoryId,
  type MemoryPatch,
  type MemoryRecord,
  type MemoryScope,
} from '@deepseek-ai/dsh-memory'
import { SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent, SessionSeq } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-settings'
import { deadline, MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { deepFreeze } from '@deepseek-ai/dsh-util-values'
import { z as zv } from 'zod'

/** Settings namespace shared with the Memory settings page. */
export const MEMORY_CURATOR_SETTINGS_NAMESPACE = 'memory-curator' as const

/** Capability-owned timeout reason for an automatic curation call. */
export const MEMORY_CURATOR_TIMEOUT_CODE = 'MEMORY_CURATOR_TIMEOUT'

/** Loader and user-settings configuration. */
export interface Config {
  /** Automatically curate durable memories after completed human turns. */
  enabled?: boolean
  /** Allow turns that used tools, including MCP and web search, as curation sources. */
  allowToolSources?: boolean
  /** Maximum current records supplied to one curation request. */
  maxExistingRecords?: number
  /** Maximum UTF-8 bytes in the JSON-framed curation input. */
  maxInputBytes?: number
  /** Maximum output tokens for one auxiliary curation call. */
  maxOutputTokens?: number
  /** Maximum create or update operations accepted from one call. */
  maxOperations?: number
  /** End-to-end deadline for one auxiliary curation call. */
  timeoutMs?: number
  /** Optional explicit provider route; must be paired with `model`. */
  provider?: string
  /** Optional explicit model id; must be paired with `provider`. */
  model?: string
}

/** Complete resolved curation policy. */
export interface ResolvedConfig {
  readonly enabled: boolean
  readonly allowToolSources: boolean
  readonly maxExistingRecords: number
  readonly maxInputBytes: number
  readonly maxOutputTokens: number
  readonly maxOperations: number
  readonly timeoutMs: number
  readonly provider?: string
  readonly model?: string
}

const DEFAULT_CONFIG: ResolvedConfig = {
  enabled: false,
  allowToolSources: false,
  maxExistingRecords: 100,
  maxInputBytes: 65_536,
  maxOutputTokens: 2_048,
  maxOperations: 8,
  timeoutMs: 30_000,
}

/** Schemastery schema shared by Loader and the settings provider. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(DEFAULT_CONFIG.enabled),
  allowToolSources: z.boolean().default(DEFAULT_CONFIG.allowToolSources),
  maxExistingRecords: z.number().step(1).min(1).max(100).default(DEFAULT_CONFIG.maxExistingRecords),
  maxInputBytes: z.number().step(1).min(1).default(DEFAULT_CONFIG.maxInputBytes),
  maxOutputTokens: z.number().step(1).min(1).default(DEFAULT_CONFIG.maxOutputTokens),
  maxOperations: z.number().step(1).min(1).default(DEFAULT_CONFIG.maxOperations),
  timeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_CONFIG.timeoutMs),
  provider: z.string(),
  model: z.string(),
})

/** One exact automatic-curation model request recorded before dispatch. */
export interface MemoryCurationRequestEventData {
  /** Turn whose completed conversation supplied the candidate facts. */
  readonly turn: number
  /** Exact source event seqs represented in `messages`. */
  readonly sourceEventSeqs: SessionSeq[]
  /** Whether tool-bearing turns were admitted for this request. */
  readonly allowToolSources: boolean
  /** Exact auxiliary route. */
  readonly route: { readonly provider: string; readonly model: string }
  /** Exact auxiliary system prompt. */
  readonly system: string
  /** Exact auxiliary message list. */
  readonly messages: Message[]
  /** Exact auxiliary output-token cap. */
  readonly maxTokens: number
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Log-only pre-dispatch record of one automatic Memory curation request. */
    'memory/curation-request': MemoryCurationRequestEventData
    /** Audit record appended after one automatic curation result is fully applied. */
    'memory/curation-applied': MemoryCurationAppliedEventData
  }
}

/** One model-proposed create operation accepted by the automatic curator. */
export interface MemoryCurationCreateOperation {
  readonly kind: 'create'
  readonly scope: 'global' | 'workspace'
  readonly text: string
  readonly tags: readonly string[]
  readonly pinned: boolean
}

/** One model-proposed revision-checked update accepted by the automatic curator. */
export interface MemoryCurationUpdateOperation {
  readonly kind: 'update'
  readonly id: string
  readonly expectedRevision: number
  readonly text?: string
  readonly tags?: readonly string[]
  readonly pinned?: boolean
}

/** Operation vocabulary accepted from automatic curation output. */
export type MemoryCurationOperation = MemoryCurationCreateOperation | MemoryCurationUpdateOperation

/** Post-commit audit data for one fully applied automatic curation result. */
export interface MemoryCurationAppliedEventData {
  /** Turn whose request produced these operations. */
  readonly turn: number
  /** Sequence of the matching `memory/curation-request` event. */
  readonly requestSeq: SessionSeq
  /** Exact validated operations, appended only after every operation succeeds. */
  readonly operations: MemoryCurationOperation[]
}

const curatorCreateOperation = zv.strictObject({
  kind: zv.literal('create'),
  scope: zv.enum(['global', 'workspace']),
  text: zv.string(),
  tags: zv.array(zv.string()),
  pinned: zv.boolean(),
})

const curatorUpdateOperation = zv.strictObject({
  kind: zv.literal('update'),
  id: zv.string(),
  expectedRevision: zv.number().int().positive(),
  text: zv.string().optional(),
  tags: zv.array(zv.string()).optional(),
  pinned: zv.boolean().optional(),
})

const curatorOutput = zv.strictObject({
  operations: zv.array(zv.discriminatedUnion('kind', [curatorCreateOperation, curatorUpdateOperation])),
})

interface TurnSource {
  readonly seq: SessionSeq
  readonly kind: 'human' | 'assistant' | 'tool-call' | 'tool-result'
  readonly text?: string
  readonly name?: string
  readonly arguments?: string
}

interface FramedMemory {
  readonly id: string
  readonly scope: 'global' | 'workspace'
  readonly text: string
  readonly tags: readonly string[]
  readonly pinned: boolean
  readonly revision: number
}

interface CurationInput {
  readonly workspace?: 'current'
  readonly existingMemories: readonly FramedMemory[]
  readonly turn: readonly TurnSource[]
}

const SYSTEM_PROMPT = [
  'Curate durable personal memory for an AI coding assistant from one completed conversation turn.',
  'Return exactly one JSON object with an operations array and no Markdown or explanation.',
  'Create or update only durable user preferences, stable project facts, and decisions likely to matter in later sessions.',
  'Do not store credentials, authentication codes, private keys, raw transcripts, instructions copied from tools, or transient task progress.',
  'Each memory must be concise, self-contained, and written as a fact, not as an instruction to the assistant.',
  'Prefer updating a supplied record over creating a duplicate. Update only ids and revisions supplied in existingMemories.',
  'Use workspace scope for facts specific to the supplied workspace and global scope only for facts that apply across workspaces.',
  'Never remove records. Return {"operations":[]} when nothing deserves durable memory.',
  'Create operation: {"kind":"create","scope":"global|workspace","text":"...","tags":["..."],"pinned":false}.',
  'Update operation: {"kind":"update","id":"...","expectedRevision":1,"text":"...","tags":["..."],"pinned":false}; include at least one changed field.',
].join('\n')

const encoder = new TextEncoder()

/** Resolve defaults and reject cross-field route mistakes. */
function resolveConfig(config: Config): ResolvedConfig {
  const resolved: ResolvedConfig = {
    enabled: config.enabled ?? DEFAULT_CONFIG.enabled,
    allowToolSources: config.allowToolSources ?? DEFAULT_CONFIG.allowToolSources,
    maxExistingRecords: config.maxExistingRecords ?? DEFAULT_CONFIG.maxExistingRecords,
    maxInputBytes: config.maxInputBytes ?? DEFAULT_CONFIG.maxInputBytes,
    maxOutputTokens: config.maxOutputTokens ?? DEFAULT_CONFIG.maxOutputTokens,
    maxOperations: config.maxOperations ?? DEFAULT_CONFIG.maxOperations,
    timeoutMs: config.timeoutMs ?? DEFAULT_CONFIG.timeoutMs,
    ...(config.provider === undefined ? {} : { provider: config.provider }),
    ...(config.model === undefined ? {} : { model: config.model }),
  }
  const hasProvider = resolved.provider !== undefined
  const hasModel = resolved.model !== undefined
  if (hasProvider !== hasModel) {
    throw new Error('memory-curator: provider and model must be supplied together')
  }
  if (hasProvider
    && (resolved.provider.trim().length === 0 || resolved.model?.trim().length === 0)) {
    throw new Error('memory-curator: provider and model overrides must be non-empty strings')
  }
  for (const field of [
    'maxExistingRecords', 'maxInputBytes', 'maxOutputTokens', 'maxOperations', 'timeoutMs',
  ] as const) {
    const value = resolved[field]
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error(`memory-curator: ${field} must be a positive safe integer`)
    }
  }
  if (resolved.maxExistingRecords > 100) {
    throw new Error('memory-curator: maxExistingRecords must not exceed 100')
  }
  if (resolved.timeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`memory-curator: timeoutMs must not exceed ${MAX_TIMER_DELAY_MS}`)
  }
  return deepFreeze(resolved)
}

/** Extract user-visible text without admitting reasoning or raw image bytes. */
function visibleText(blocks: readonly ContentBlock[]): string {
  const lines: string[] = []
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        if (block.text.trim().length > 0) lines.push(block.text)
        break
      case 'image':
        lines.push('[image]')
        break
      case 'tool-result': {
        const nested = visibleText(block.content)
        if (nested.length > 0) lines.push(nested)
        break
      }
      case 'reasoning':
      case 'tool-call':
        break
      default:
        break
    }
  }
  return lines.join('\n').trim()
}

/** Select the completed turn's eligible source events. */
function turnSources(
  session: Session,
  end: Extract<SessionEvent, { type: 'turn/end' }>,
  allowToolSources: boolean,
): { readonly sources: readonly TurnSource[]; readonly seqs: readonly SessionSeq[] } | undefined {
  const start = session.snapshotEvents().findLast(event =>
    event.seq < end.seq && event.type === 'turn/start' && event.data.turn === end.data.turn)
  if (start === undefined) return undefined
  const events = session.snapshotEvents(SessionLogOffset(start.seq + 1), SessionLogOffset(end.seq))
  const usedTools = events.some(event => event.type === 'tool/call' || event.type === 'tool/result')
  if (usedTools && !allowToolSources) return undefined

  const sources: TurnSource[] = []
  for (const event of events) {
    switch (event.type) {
      case 'user/message': {
        if (event.data.source.kind !== 'user') break
        const text = visibleText(event.data.content)
        if (text.length > 0) sources.push({ seq: event.seq, kind: 'human', text })
        break
      }
      case 'assistant/message': {
        const text = visibleText(event.data.message.content)
        if (text.length > 0) sources.push({ seq: event.seq, kind: 'assistant', text })
        break
      }
      case 'tool/call':
        if (allowToolSources) {
          sources.push({
            seq: event.seq,
            kind: 'tool-call',
            name: event.data.name,
            arguments: event.data.arguments,
          })
        }
        break
      case 'tool/result': {
        if (!allowToolSources) break
        const text = visibleText(event.data.message.content)
        sources.push({ seq: event.seq, kind: 'tool-result', text })
        break
      }
      default:
        break
    }
  }
  if (!sources.some(source => source.kind === 'human')) return undefined
  return {
    sources: Object.freeze(sources.map(source => Object.freeze(source))),
    seqs: Object.freeze(sources.map(source => source.seq)),
  }
}

/** Resolve the exact auxiliary route from settings or the latest logged request. */
function routeFor(
  session: Session,
  config: ResolvedConfig,
): { readonly provider: string; readonly model: string } {
  if (config.provider !== undefined && config.model !== undefined) {
    return { provider: config.provider, model: config.model }
  }
  const route = session.requestHeader()?.config
  if (route === undefined) {
    throw new Error('memory-curator: no logged request route is available; configure provider and model together')
  }
  return { provider: route.provider, model: route.model }
}

/** Project a durable record into the bounded JSON input. */
function framedMemory(record: MemoryRecord): FramedMemory {
  return {
    id: String(record.id),
    scope: record.scope.kind,
    text: record.text,
    tags: [...record.tags],
    pinned: record.pinned,
    revision: record.revision,
  }
}

/** Authorized scopes for one session's automatic curation. */
function scopesFor(session: Session): MemoryScope[] {
  return session.header.cwd === undefined
    ? [{ kind: 'global' }]
    : [{ kind: 'global' }, { kind: 'workspace', cwd: session.header.cwd }]
}

/** Translate a terminal finish reason into a curation failure. */
function finishError(finish: FinishReason): Error | undefined {
  switch (finish.kind) {
    case 'stop':
      return undefined
    case 'error':
    case 'aborted': {
      const error = new Error(finish.failure.message) as Error & { code?: string }
      error.code = finish.failure.code
      return error
    }
    case 'max-tokens':
      return new Error('memory-curator: output reached maxOutputTokens')
    case 'tool-calls':
      return new Error('memory-curator: model unexpectedly requested a tool')
    default:
      return new Error(`memory-curator: unsupported finish reason "${String((finish as { kind?: unknown }).kind)}"`)
  }
}

/** Parse and bound the model's strict JSON operation list. */
function parseOperations(text: string, maxOperations: number): readonly MemoryCurationOperation[] {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new Error(`memory-curator: model output is not valid JSON: ${String(error)}`)
  }
  const parsed = curatorOutput.parse(value)
  if (parsed.operations.length > maxOperations) {
    throw new Error(`memory-curator: model returned ${parsed.operations.length} operations, exceeding ${maxOperations}`)
  }
  for (const operation of parsed.operations) {
    if (operation.kind === 'update'
      && operation.text === undefined
      && operation.tags === undefined
      && operation.pinned === undefined) {
      throw new Error(`memory-curator: update for '${operation.id}' changes no fields`)
    }
  }
  return parsed.operations.map(operation => operation.kind === 'create'
    ? operation
    : {
      kind: operation.kind,
      id: operation.id,
      expectedRevision: operation.expectedRevision,
      ...operation.text === undefined ? {} : { text: operation.text },
      ...operation.tags === undefined ? {} : { tags: operation.tags },
      ...operation.pinned === undefined ? {} : { pinned: operation.pinned },
    })
}

/** Apply validated operations without granting access outside supplied scopes. */
async function applyOperations(
  ctx: Context,
  session: Session,
  existing: readonly MemoryRecord[],
  operations: readonly MemoryCurationOperation[],
): Promise<void> {
  const byId = new Map(existing.map(record => [String(record.id), record]))
  for (const operation of operations) {
    switch (operation.kind) {
      case 'create': {
        if (operation.scope === 'workspace' && session.header.cwd === undefined) {
          throw new Error('memory-curator: workspace operation requires a session cwd')
        }
        const scope: MemoryScope = operation.scope === 'global'
          ? { kind: 'global' }
          : { kind: 'workspace', cwd: session.header.cwd as string }
        await ctx.memory.create({
          scope,
          text: operation.text,
          tags: operation.tags,
          pinned: operation.pinned,
          sourceSessionId: session.id,
        })
        break
      }
      case 'update': {
        const current = byId.get(operation.id)
        if (current === undefined || current.revision !== operation.expectedRevision) {
          throw new Error(`memory-curator: update '${operation.id}' does not match a supplied memory revision`)
        }
        const patch: MemoryPatch = {
          ...operation.text === undefined ? {} : { text: operation.text },
          ...operation.tags === undefined ? {} : { tags: operation.tags },
          ...operation.pinned === undefined ? {} : { pinned: operation.pinned },
        }
        const updated = await ctx.memory.update({
          id: MemoryId(operation.id),
          expectedRevision: operation.expectedRevision,
          patch,
        })
        byId.set(operation.id, updated)
        break
      }
      default:
        operation satisfies never
    }
  }
}

/** Run one logged automatic curation request and apply its validated result. */
async function curate(
  ctx: Context,
  session: Session,
  end: Extract<SessionEvent, { type: 'turn/end' }>,
  config: ResolvedConfig,
): Promise<void> {
  const selected = turnSources(session, end, config.allowToolSources)
  if (selected === undefined) return
  const scopes = scopesFor(session)
  const existing = ctx.memory.search({ scopes, limit: config.maxExistingRecords })
    .map(hit => hit.record)
  const input: CurationInput = {
    ...session.header.cwd === undefined ? {} : { workspace: 'current' as const },
    existingMemories: existing.map(framedMemory),
    turn: selected.sources,
  }
  const framed = `Curate memory from this JSON input:\n${JSON.stringify(input)}`
  const inputBytes = encoder.encode(framed).byteLength
  if (inputBytes > config.maxInputBytes) {
    throw new Error(`memory-curator: input is ${inputBytes} bytes, exceeding maxInputBytes ${config.maxInputBytes}`)
  }
  const route = routeFor(session, config)
  const messages: Message[] = [createUserMessage({
    content: [{ type: 'text', text: framed }],
    source: { kind: 'plugin', plugin: 'dsh-memory-curator' },
  })]
  using callDeadline = deadline(undefined, config.timeoutMs, MEMORY_CURATOR_TIMEOUT_CODE)
  const options: GenerateOptions = deepFreeze({
    provider: route.provider,
    model: route.model,
    messages,
    system: SYSTEM_PROMPT,
    maxTokens: config.maxOutputTokens,
    sessionId: session.id,
    purpose: 'memory-curation',
    signal: callDeadline.signal,
  })
  const request = session.append('memory/curation-request', {
    turn: end.data.turn,
    sourceEventSeqs: [...selected.seqs],
    allowToolSources: config.allowToolSources,
    route,
    system: SYSTEM_PROMPT,
    messages,
    maxTokens: config.maxOutputTokens,
  })

  const assembler = new BlockAssembler()
  for await (const chunk of ctx.llm.stream(options)) {
    callDeadline.signal.throwIfAborted()
    assembler.push(chunk)
  }
  callDeadline.signal.throwIfAborted()
  const terminalError = finishError(assembler.finish)
  if (terminalError !== undefined) throw terminalError
  const blocks = assembler.blocks()
  if (blocks.some(block => block.type === 'tool-call' || block.type === 'image')) {
    throw new Error('memory-curator: output must contain text JSON only')
  }
  const text = blocks
    .filter((block): block is Extract<(typeof blocks)[number], { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('')
    .trim()
  if (text.length === 0) throw new Error('memory-curator: model produced no JSON text')
  const operations = parseOperations(text, config.maxOperations)
  await applyOperations(ctx, session, existing, operations)
  session.append('memory/curation-applied', {
    turn: end.data.turn,
    requestSeq: request.seq,
    operations: [...operations],
  })
}

/** Native Memory, LLM, and session services are required; settings are optional. */
export const inject = ['memory', 'llm', 'sessions']

/**
 * Register live settings and automatic post-turn curation.
 * @param ctx - Host context carrying Memory and LLM capabilities.
 * @param config - Composition-layer curation policy.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const entry = resolveConfig(config)
  let source = () => entry
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, MEMORY_CURATOR_SETTINGS_NAMESPACE, Config, entry, {
      validate: resolveConfig,
      setSource(current) { source = () => resolveConfig(current()) },
      onChange() {},
    })
  })

  let stopped = false
  const pending = new Set<Promise<void>>()
  ctx.effect(() => async () => {
    stopped = true
    await Promise.allSettled([...pending])
  }, 'memory-curator.pending')

  ctx.on('session/event', (session, event) => {
    if (stopped || event.type !== 'turn/end' || event.data.reason.kind !== 'completed') return
    const current = source()
    if (!current.enabled) return
    // Session publishes observers inside append's re-entry guard. Start on the
    // next microtask so the curation request can append its own audit event.
    const task = Promise.resolve().then(() => curate(ctx, session, event, current)).catch((error: unknown) => {
      ctx.logger.warn(`memory-curator: automatic curation failed for session '${session.id}' turn ${event.data.turn}: ${String(error)}`)
    })
    pending.add(task)
    void task.finally(() => pending.delete(task))
  })
}
