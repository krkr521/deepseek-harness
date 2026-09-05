/** Generic keyless ACP v1 automation-control conformance over the real dsh profile. */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import {
  launchAcpTestAgent,
  type AgentUnderTest,
  type LaunchedAcpTestAgent,
} from '@deepseek-ai/dsh-session-snapshot'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../../../../../', import.meta.url))
const agent: AgentUnderTest = {
  binScript: join(repoRoot, 'apps/cli/src/bin.ts'),
  libBinScript: join(repoRoot, 'apps/cli/lib/bin.js'),
  configPath: fileURLToPath(new URL('./fixtures/control-surface/cordis.yml', import.meta.url)),
  profile: 'acp',
  tsconfigPath: join(repoRoot, 'tsconfig.json'),
}
const mcpServer = fileURLToPath(new URL('../../../../../../packages/mcp/mcp-client/tests/fixture-server.ts', import.meta.url))
const subagentListMethod = '_deepseek.ai/dsh/subagents/list'
const subagentActivityMethod = '_deepseek.ai/dsh/subagents/activity'

/** Find one named select value in grouped or ungrouped standard options. */
function selectValue(
  options: Awaited<ReturnType<LaunchedAcpTestAgent['client']['newSession']>>['configOptions'],
  configId: string,
  name: string,
): string {
  const option = options?.find(candidate => candidate.id === configId)
  if (option?.type !== 'select') throw new Error(`missing select option: ${configId}`)
  const values = option.options.flatMap(candidate => 'group' in candidate ? candidate.options : [candidate])
  const selected = values.find(candidate => candidate.name === name)
  if (selected === undefined) throw new Error(`missing ${configId} value: ${name}`)
  return selected.value
}

describe('standard ACP v1 control surface', () => {
  it.skipIf(process.platform !== 'win32').each(['allow-once', 'reject-once'] as const)(
    'confines PowerShell and honors %s for one workspace write', async (answer) => {
      const cwd = await mkdtemp(join(tmpdir(), 'dsh-acp-pwsh-'))
      const permissionRequests: string[] = []
      const launched = launchAcpTestAgent({
        agent,
        cwd,
        env: {
          DSH_CONFORMANCE_PERSISTENCE_ROOT: join(cwd, '.sessions'),
          DSH_CONFORMANCE_PERMISSION_MODE: 'read-only',
          DSH_TELEMETRY_DISABLED: '1',
        },
        async requestPermission(params) {
          await expect(readFile(join(cwd, 'acp-shell-proof.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
          permissionRequests.push(params.toolCall.toolCallId)
          const option = params.options.find(candidate => candidate.optionId === answer)
          if (option === undefined) return Promise.resolve({ outcome: { outcome: 'cancelled' } })
          return Promise.resolve({ outcome: { outcome: 'selected', optionId: option.optionId } })
        },
      })
      try {
        await launched.spawned
        await launched.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
        const created = await launched.client.newSession({ cwd, mcpServers: [] })
        await expect(launched.client.prompt({
          sessionId: created.sessionId,
          prompt: [{ type: 'text', text: 'exercise Windows shell policy' }],
        })).resolves.toEqual({ stopReason: 'end_turn' })
        expect(permissionRequests).toEqual(['control-shell-retry'])
        const firstResult = launched.updates.find(update => update.sessionUpdate === 'tool_call_update'
          && update.toolCallId === 'control-shell-denied'
          && (update.status === 'failed' || update.status === 'completed'))
        expect(firstResult).toBeDefined()
        const written = readFile(join(cwd, 'acp-shell-proof.txt'), 'utf8')
        if (answer === 'allow-once') expect((await written).trim()).toBe('ACP_SHELL_OK')
        else await expect(written).rejects.toMatchObject({ code: 'ENOENT' })
        await launched.client.closeSession({ sessionId: created.sessionId })
      } catch (error: unknown) {
        throw new Error(`ACP PowerShell scenario failed: ${String(error)}\n${launched.stderr()}`, { cause: error })
      } finally {
        await launched.close()
        await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
      }
    }, 45_000,
  )

  it('applies the Host route allowlist to a real ACP child delegation', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dsh-acp-route-'))
    const dshHome = join(cwd, '.dsh')
    await mkdir(dshHome, { recursive: true })
    await writeFile(join(dshHome, 'settings.yaml'), [
      'subagent-model-selection:',
      '  enabled: true',
      '  allowedModels:',
      '    - provider: control-fixture',
      '      model: beta',
      '',
    ].join('\n'), 'utf8')
    const launched = launchAcpTestAgent({
      agent,
      cwd,
      env: {
        DSH_CONFORMANCE_PERSISTENCE_ROOT: join(cwd, '.sessions'),
        DSH_CONFORMANCE_ROUTE_SELECTION: '1',
        DSH_TELEMETRY_DISABLED: '1',
      },
    })
    try {
      await launched.spawned
      const initialized = await launched.client.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {},
        _meta: { '_deepseek.ai/dsh': { subagents: true } },
      })
      expect(initialized._meta).toEqual({
        '_deepseek.ai/dsh': {
          version: 1,
          subagents: {
            listMethod: subagentListMethod,
            activityMethod: subagentActivityMethod,
          },
        },
      })
      const created = await launched.client.newSession({ cwd, mcpServers: [] })
      await expect(launched.client.prompt({
        sessionId: created.sessionId,
        prompt: [{ type: 'text', text: 'exercise selected child route' }],
      })).resolves.toEqual({ stopReason: 'end_turn' })
      expect(launched.updates).toContainEqual(expect.objectContaining({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'child=control-fixture/beta' },
      }))
      const listed = await launched.client.extension(subagentListMethod, {
        rootSessionId: created.sessionId,
      })
      expect(listed).toMatchObject({
        rootSessionId: created.sessionId,
        scope: 'descendants',
        entries: [expect.objectContaining({
          kind: 'child',
          activity: 'inactive',
          parentId: created.sessionId,
          depth: 1,
        })],
      })
      const child = (listed.entries as { id: string }[])[0]
      expect(child).toBeDefined()
      const activity = await launched.client.extension(subagentActivityMethod, {
        rootSessionId: created.sessionId,
        sessionId: child?.id,
      })
      expect(activity).toMatchObject({
        sessionId: child?.id,
        activity: 'inactive',
        hasMore: false,
      })
      const assistantMessage = (activity.events as readonly unknown[]).find((event): event is Record<string, unknown> => (
        typeof event === 'object' && event !== null && (event as { type?: unknown }).type === 'assistant/message'
      ))
      expect(assistantMessage).toMatchObject({
        type: 'assistant/message',
        data: {
          message: {
            content: [{ type: 'text', text: 'child=control-fixture/beta' }],
          },
        },
      })
      await launched.client.closeSession({ sessionId: created.sessionId })
    } catch (error: unknown) {
      const stderr = launched.stderr()
      throw new Error(
        stderr.length === 0
          ? `ACP route scenario failed: ${String(error)}`
          : `ACP route scenario failed: ${String(error)}\nagent stderr:\n${stderr}`,
        { cause: error },
      )
    } finally {
      await launched.close()
      await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  }, 30_000)

  it('selects, mounts MCP, closes, restarts, resumes, and cancels through the SDK only', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dsh-acp-control-'))
    const persistenceRoot = join(cwd, '.sessions')
    const env = { DSH_CONFORMANCE_PERSISTENCE_ROOT: persistenceRoot, DSH_TELEMETRY_DISABLED: '1' }
    const mcpServers = [{ name: 'fixture', command: process.execPath, args: [mcpServer], env: [] }]
    let first: LaunchedAcpTestAgent | undefined
    let second: LaunchedAcpTestAgent | undefined
    let stage = 'first launch'
    try {
      first = launchAcpTestAgent({ agent, cwd, env })
      await first.spawned
      stage = 'initialize'
      const initialized = await first.client.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { _meta: { ignored: true } },
      })
      expect(initialized.agentCapabilities).toEqual({
        mcpCapabilities: { http: true },
        promptCapabilities: { image: false, audio: false, embeddedContext: false },
        sessionCapabilities: { close: {}, list: {}, resume: {} },
      })
      expect('_meta' in initialized).toBe(false)
      stage = 'new session'
      const created = await first.client.newSession({ cwd, mcpServers })
      const beta = selectValue(created.configOptions, 'model', 'Beta')
      const selectedModel = await first.client.setSessionConfigOption({
        sessionId: created.sessionId,
        configId: 'model',
        value: beta,
      })
      const low = selectValue(selectedModel.configOptions, 'reasoning_effort', 'Low')
      await first.client.setSessionConfigOption({
        sessionId: created.sessionId,
        configId: 'reasoning_effort',
        value: low,
      })

      stage = 'first prompt'
      await expect(first.client.prompt({
        sessionId: created.sessionId,
        prompt: [{ type: 'text', text: 'exercise the attached server' }],
      })).resolves.toEqual({ stopReason: 'end_turn' })
      expect(first.updates.map(update => update.sessionUpdate)).toEqual([
        'agent_thought_chunk',
        'usage_update',
        'tool_call',
        'tool_call_update',
        'agent_message_chunk',
        'usage_update',
      ])
      expect(first.updates).toContainEqual(expect.objectContaining({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'model=beta; tool=5' },
      }))
      const message = first.updates.find(update => update.sessionUpdate === 'agent_message_chunk')
      expect(message !== undefined && 'messageId' in message && typeof message.messageId === 'string').toBe(true)
      stage = 'first close session'
      await first.client.closeSession({ sessionId: created.sessionId })
      await first.close()
      first = undefined

      second = launchAcpTestAgent({ agent, cwd, env })
      await second.spawned
      stage = 'second initialize'
      await second.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
      stage = 'list sessions'
      await expect(second.client.listSessions({ cwd })).resolves.toEqual({
        sessions: [{ sessionId: created.sessionId, cwd }],
      })
      stage = 'resume session'
      await second.client.resumeSession({ sessionId: created.sessionId, cwd, mcpServers })
      const toolFinished = second.waitForUpdate(update => (
        update.sessionUpdate === 'tool_call_update' && update.toolCallId === 'control-cancel-add'
      ))
      stage = 'cancel prompt'
      const prompt = second.client.prompt({
        sessionId: created.sessionId,
        prompt: [{ type: 'text', text: 'cancel after the tool finishes' }],
      })
      await toolFinished
      await second.client.cancel({ sessionId: created.sessionId })
      await expect(prompt).resolves.toEqual({ stopReason: 'cancelled' })
      stage = 'second close session'
      await second.client.closeSession({ sessionId: created.sessionId })
    } catch (error: unknown) {
      const diagnostics = [first?.stderr(), second?.stderr()].filter((value): value is string => Boolean(value))
      throw new Error(
        diagnostics.length === 0
          ? `ACP control-surface scenario failed during ${stage}: ${String(error)}`
          : `ACP control-surface scenario failed during ${stage}: ${String(error)}\nagent stderr:\n${diagnostics.join('\n')}`,
        { cause: error },
      )
    } finally {
      await Promise.allSettled([first?.close(), second?.close()].filter((value): value is Promise<void> => value !== undefined))
      await rm(cwd, { recursive: true, force: true })
    }
  }, 30_000)
})
