import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CodexNativeCompactionEngine from '@deepseek-ai/dsh-codex-native-compaction'
import LlmRuntime, {
  createMessage,
  createUserMessage,
  LlmAdapter,
} from '@deepseek-ai/dsh-llm'
import type {
  ContentBlock,
  GenerateOptions,
  LlmResolvedModelInfo,
  StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import TokenMeter from '@deepseek-ai/dsh-token-meter'

const SIGNAL = new AbortController().signal
const MODEL = 'gpt-native-test'

class ScriptedAdapter extends LlmAdapter {
  calls: GenerateOptions[] = []

  constructor(public blocks: ContentBlock[]) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      context: { contextWindow: 8_192 },
    })
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls.push(options)
    for (const [index, block] of this.blocks.entries()) {
      yield { type: 'block-start', index, blockType: block.type }
      yield { type: 'block-end', index, block }
    }
    yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 8 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

function harness(blocks: ContentBlock[]): {
  adapter: ScriptedAdapter
  compact: CodexNativeCompactionEngine
  ctx: Context
} {
  const ctx = new Context()
  void new LlmRuntime(ctx)
  void new SessionProjectionRegistry(ctx)
  void new TokenMeter(ctx)
  const adapter = new ScriptedAdapter(blocks)
  ctx.llm.registerAdapter(['codex', 'other'], adapter)
  return {
    adapter,
    compact: new CodexNativeCompactionEngine(ctx, { auto: false }),
    ctx,
  }
}

function conversation(provider: 'codex' | 'other' = 'codex'): Session {
  const session = Session.create(SessionId(`native-${provider}`))
  for (let turn = 1; turn <= 3; turn += 1) {
    session.append('turn/start', { turn })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: `large user history ${turn} `.repeat(80) }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('step/start', { turn, step: 1 })
    if (turn === 1) {
      session.append('request/header', {
        header: {
          config: { provider, model: MODEL },
          system: 'conversation system',
          tools: [{ name: 'read', description: 'read a file', parameters: { type: 'object' } }],
        },
        reason: 'initial',
      })
    }
    session.append('assistant/message', {
      turn,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: `large assistant history ${turn} `.repeat(80) }],
        source: { kind: 'model', provider, model: MODEL },
      }),
    }, { surfaceOp: 'append' })
    session.append('step/end', { turn, step: 1 })
    session.append('turn/end', { turn, reason: { kind: 'completed' } })
  }
  session.append('turn/start', { turn: 4 })
  return session
}

function testAgent(session: Session, provider: 'codex' | 'other'): Agent {
  return { session, options: { provider, model: MODEL } } as Agent
}

describe('Codex-native compaction provider', () => {
  it('commits one opaque item without framing and retains the raw conversation tail', async () => {
    const item = {
      type: 'compaction' as const,
      id: 'cmp-1',
      encrypted_content: 'opaque-native-state',
      future_field: { retained: true },
    }
    const block: ContentBlock = { type: 'codex-compaction', item }
    const { adapter, compact } = harness([block])
    const session = conversation()
    const before = [...session.surface.nodes]

    const result = await compact.compactRegion(
      before[0]!,
      before[3]!,
      testAgent(session, 'codex'),
      SIGNAL,
    )

    expect(result.shadowedSeqs).toEqual(before.slice(0, 4))
    expect(session.surface.nodes.slice(1)).toEqual(before.slice(4))
    expect(session.deriveMessages()[0]?.content).toEqual([block])
    const retainedHead = session.deriveMessages()[1]?.content[0]
    expect(retainedHead?.type).toBe('text')
    expect(retainedHead?.type === 'text' ? retainedHead.text : '').toContain('large user history 3')
    expect(adapter.calls).toHaveLength(1)
    expect(adapter.calls[0]).toMatchObject({
      provider: 'codex',
      model: MODEL,
      purpose: 'provider-compaction',
      system: 'conversation system',
      sessionId: session.id,
    })
    expect(adapter.calls[0]?.tools).toEqual([
      { name: 'read', description: 'read a file', parameters: { type: 'object' } },
    ])
    const summary = session.snapshotEvents().findLast(event => event.type === 'compaction/summary')
    expect(summary?.data).toMatchObject({
      summary: [block],
      rawOutput: [block],
      llmStreamCall: true,
      provider: 'codex',
      model: MODEL,
      usage: { inputTokens: 100, outputTokens: 8 },
    })

    const replay = Session.create(SessionId('native-replay'), session.snapshotEvents())
    expect(replay.deriveMessages()).toEqual(session.deriveMessages())
  })

  it('rejects malformed native output without replacing the surface', async () => {
    const { compact } = harness([{ type: 'text', text: 'not opaque state' }])
    const session = conversation()
    const before = [...session.surface.nodes]
    const generation = session.surface.replaceGeneration

    await expect(compact.compactRegion(
      before[0]!,
      before[3]!,
      testAgent(session, 'codex'),
      SIGNAL,
    )).rejects.toThrow(/expected exactly one opaque item/)
    expect(session.surface.nodes).toEqual(before)
    expect(session.surface.replaceGeneration).toBe(generation)
    expect(session.snapshotEvents().some(event => event.type === 'compaction/summary')).toBe(false)
    const end = session.snapshotEvents().findLast(event => event.type === 'compaction/end')
    expect(end?.type === 'compaction/end' ? end.data.error : undefined)
      .toContain('expected exactly one opaque item')
  })

  it('uses the basic framed summary for non-Codex routes', async () => {
    const { adapter, compact } = harness([{ type: 'text', text: 'portable fallback summary' }])
    const session = conversation('other')
    const nodes = [...session.surface.nodes]

    await compact.compactRegion(
      nodes[0]!,
      nodes[3]!,
      testAgent(session, 'other'),
      SIGNAL,
    )

    expect(adapter.calls[0]?.purpose).toBe('compaction')
    const checkpoint = session.deriveMessages()[0]?.content
    const checkpointHead = checkpoint?.[0]
    expect(checkpointHead?.type).toBe('text')
    expect(checkpointHead?.type === 'text' ? checkpointHead.text : '')
      .toContain('<compacted-summary>')
    expect(checkpoint).toContainEqual({ type: 'text', text: 'portable fallback summary' })
  })

  it('fails before adapter dispatch when opaque Codex state targets another provider', async () => {
    const block: ContentBlock = {
      type: 'codex-compaction',
      item: { type: 'compaction', encrypted_content: 'opaque-native-state' },
    }
    const { adapter, ctx } = harness([block])

    expect(() => ctx.llm.stream({
      provider: 'other',
      model: MODEL,
      messages: [createUserMessage({
        content: [block],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    })).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_PROVIDER_STATE' }))
    expect(adapter.calls).toHaveLength(0)
  })
})
