/**
 * Codex-native compaction backend over the basic backend's policy and durable
 * region transaction.
 *
 * @module @deepseek-ai/dsh-codex-native-compaction
 */

import type { Context } from '@deepseek-ai/cordis'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import type { BasicCompactionConfig, SummarizationInput, SummaryResult } from '@deepseek-ai/dsh-compaction-basic'
import {
  BlockAssembler,
  LlmError,
  errorChain,
} from '@deepseek-ai/dsh-llm'
import type {
  ContentBlock,
  FinishReason,
  GenerateOptions,
} from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CodexCompactionBlock } from './types.ts'

export type { CodexCompactionBlock, CodexCompactionItem } from './types.ts'

/**
 * Native Codex compaction policy. Every field retains the basic backend's
 * meaning; the local declaration keeps this plugin's configuration surface
 * discoverable by repository tooling.
 */
export interface Config extends BasicCompactionConfig {}

const CODEX_PROVIDER = 'codex'

/** Exact conversation route used for provider-native compaction. */
function conversationTarget(agent: Agent): Pick<GenerateOptions, 'provider' | 'model'> | undefined {
  const routed = agent.session.requestHeader()?.config
  if (routed !== undefined && routed.provider.length > 0 && routed.model.length > 0) {
    return { provider: routed.provider, model: routed.model }
  }
  const provider = agent.options.provider
  const model = agent.options.model
  if (provider === undefined || provider.length === 0 || model === undefined || model.length === 0) {
    return undefined
  }
  return { provider, model }
}

/** Whether a content tree contains an opaque Codex checkpoint. */
function containsCodexCompaction(blocks: readonly ContentBlock[]): boolean {
  return blocks.some(block => block.type === 'codex-compaction'
    || (block.type === 'tool-result' && containsCodexCompaction(block.content)))
}

/** Validate and narrow one provider-native response block. */
function codexCompactionBlock(block: ContentBlock): CodexCompactionBlock | undefined {
  if (block.type !== 'codex-compaction') return undefined
  const item: Record<string, unknown> = block.item
  if (item.type !== 'compaction'
    || typeof item.encrypted_content !== 'string'
    || item.encrypted_content.length === 0) {
    throw new LlmError('codex compaction returned an invalid opaque item', 'INVALID_RESPONSE')
  }
  return block
}

/** Map a non-successful native compaction finish to one explicit failure. */
function finishFailure(reason: FinishReason): Error | undefined {
  switch (reason.kind) {
    case 'stop':
      return undefined
    case 'error':
    case 'aborted':
      return new LlmError(reason.failure.message, reason.failure.code, {
        ...reason.failure.status === undefined ? {} : { status: reason.failure.status },
        ...reason.failure.providerRetryAfterMs === undefined
          ? {}
          : { providerRetryAfterMs: reason.failure.providerRetryAfterMs },
        ...reason.failure.requestId === undefined ? {} : { requestId: reason.failure.requestId },
      })
    case 'max-tokens':
      return new LlmError('codex compaction stopped at the output limit', 'MAX_TOKENS')
    case 'tool-calls':
      return new LlmError('codex compaction returned tool calls instead of opaque state', 'INVALID_RESPONSE')
    default:
      return new LlmError(`codex compaction ended unexpectedly: ${errorChain(reason)}`, 'INVALID_RESPONSE')
  }
}

/**
 * Compaction provider that uses Codex's Responses compaction trigger for the
 * `codex` route and the basic text summarizer for every other route.
 */
export class CodexNativeCompactionEngine extends BasicCompactionEngine {
  /**
   * @param ctx - Cordis context carrying the LLM and inherited compaction services.
   * @param config - pressure, retention, retry, and fallback-summary policy.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, config)
    ctx.on('llm/stream', (options, next) => {
      const hasCheckpoint = options.messages.some(message => containsCodexCompaction(message.content))
      if (hasCheckpoint && options.provider !== CODEX_PROVIDER) {
        throw new LlmError(
          `provider "${options.provider}" cannot replay a Codex-native compaction checkpoint`,
          'UNSUPPORTED_PROVIDER_STATE',
        )
      }
      return next()
    })
  }

  /**
   * Ask the routed Codex adapter for one opaque compaction item. Other routes
   * retain the basic backend's text summary.
   * @param input - exact selected conversation prefix.
   * @param agent - owner whose latest route selects the compaction protocol.
   * @param signal - cancellation forwarded to the adapter.
   * @returns provider-native checkpoint content or a basic text summary.
   */
  protected override async summarize(
    input: SummarizationInput,
    agent: Agent,
    signal?: AbortSignal,
  ): Promise<SummaryResult> {
    const target = conversationTarget(agent)
    if (target?.provider !== CODEX_PROVIDER) return super.summarize(input, agent, signal)

    const options: GenerateOptions = {
      ...target,
      messages: [...input.messages],
      ...input.system === undefined ? {} : { system: input.system },
      ...input.tools === undefined ? {} : { tools: [...input.tools] },
      sessionId: agent.session.id,
      purpose: 'provider-compaction',
      ...signal === undefined ? {} : { signal },
    }
    const assembler = new BlockAssembler()
    for await (const chunk of this.ctx.llm.stream(options)) assembler.push(chunk)
    const failure = finishFailure(assembler.finish)
    if (failure !== undefined) throw failure

    const rawOutput = assembler.blocks()
    const [onlyBlock] = rawOutput
    const checkpoint = rawOutput.length === 1 && onlyBlock !== undefined
      ? codexCompactionBlock(onlyBlock)
      : undefined
    if (checkpoint === undefined) {
      throw new LlmError(
        `codex compaction expected exactly one opaque item, received ${rawOutput.length}`,
        'INVALID_RESPONSE',
      )
    }

    return {
      summary: [checkpoint],
      checkpointContent: [checkpoint],
      rawOutput,
      llmStreamCall: true,
      provider: target.provider,
      model: target.model,
      ...assembler.usage === undefined ? {} : { usage: assembler.usage },
    }
  }
}

export default CodexNativeCompactionEngine
