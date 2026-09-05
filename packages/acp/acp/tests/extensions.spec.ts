import { afterEach, describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import {
  createAssistantMessage,
  createToolResultMessage,
  ToolCallId,
} from '@deepseek-ai/dsh-llm'
import {
  SESSION_FORMAT_VERSION,
  Session,
  SessionId,
  type SessionEvent,
  type SessionHeader,
} from '@deepseek-ai/dsh-session'
import { SUBAGENT_DESCRIPTOR_VERSION } from '@deepseek-ai/dsh-subagent'
import {
  DSH_SUBAGENT_ACTIVITY_METHOD,
  DSH_SUBAGENT_LIST_METHOD,
} from '../src/extensions.ts'
import { makeBridgeHarness, type BridgeHarness } from './harness.ts'

const descriptor = (label: string) => ({
  version: SUBAGENT_DESCRIPTOR_VERSION,
  mode: 'continuable' as const,
  provider: 'test',
  label,
})

/** Append a complete observable child turn around model and tool progress. */
function appendActivity(session: Session, label: string): void {
  session.append('turn/start', { turn: 1 })
  session.append('subagent/descriptor', descriptor(label))
  session.append('step/start', { turn: 1, step: 1 })
  session.append('assistant/message', {
    stream: [{ type: 'text-chunks', time0: 1, index: 0, dt: [], texts: ['working'] }],
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      content: [{ type: 'text', text: 'working' }],
      source: { provider: 'mock', model: 'mock' },
    }),
  }, { surfaceOp: 'append' })
  const callId = ToolCallId('child-call')
  session.append('tool/call', {
    turn: 1,
    step: 1,
    callId,
    name: 'read',
    arguments: '{"path":"notes.txt"}',
  })
  session.append('tool/result', {
    turn: 1,
    step: 1,
    message: createToolResultMessage({
      callId,
      content: [{ type: 'text', text: 'tool output' }],
      isError: false,
    }),
  }, { surfaceOp: 'append' })
  session.append('todo/write', {
    todos: [{ content: 'inspect child', status: 'completed' }],
  })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
}

/** Create one live session-backed subagent under the requested parent. */
function liveChild(
  harness: BridgeHarness,
  id: string,
  parentSession: SessionId,
  label: string,
): Session {
  const session = harness.ctx.sessions.create(SessionId(id), {
    meta: { cwd: process.cwd(), parentSession, origin: 'subagent' },
  })
  appendActivity(session, label)
  return session
}

/** Persist one inactive session-backed subagent without publishing it to the live store. */
async function persistedChild(
  harness: BridgeHarness,
  id: string,
  parentSession: SessionId,
  label: string,
): Promise<Session> {
  const sessionId = SessionId(id)
  const header: SessionHeader = {
    version: SESSION_FORMAT_VERSION,
    isSeeded: false,
    id: sessionId,
    createdAt: Date.now(),
    cwd: process.cwd(),
    parentSession,
    origin: 'subagent',
  }
  const session = Session.create(sessionId, undefined, header)
  appendActivity(session, label)
  const handle = await harness.ctx.sessionPersistence.create(header)
  try {
    await handle.append(session.snapshotEvents())
    await handle.flush()
  } finally {
    await handle.close()
  }
  return session
}

describe('DSH ACP subagent observation extensions', () => {
  let harness: BridgeHarness | undefined

  afterEach(async () => {
    await harness?.dispose()
    harness = undefined
  })

  it('advertises namespaced methods only when observation is mounted and requested', async () => {
    harness = await makeBridgeHarness({ subagents: true })
    const response = await harness.client.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
      _meta: { '_deepseek.ai/dsh': { subagents: true } },
    })

    expect(response._meta).toEqual({
      '_deepseek.ai/dsh': {
        version: 1,
        subagents: {
          listMethod: DSH_SUBAGENT_LIST_METHOD,
          activityMethod: DSH_SUBAGENT_ACTIVITY_METHOD,
        },
      },
    })

    await harness.dispose()
    harness = await makeBridgeHarness({ subagents: true })
    const withoutOptIn = await harness.client.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
    })
    expect(withoutOptIn._meta).toBeUndefined()

    await harness.dispose()
    harness = await makeBridgeHarness()
    const unavailable = await harness.client.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
      _meta: { '_deepseek.ai/dsh': { subagents: true } },
    })
    expect(unavailable._meta).toBeUndefined()
  })

  it('rejects extension calls without initialization opt-in', async () => {
    harness = await makeBridgeHarness({ subagents: true })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const root = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    await expect(harness.client.extMethod(DSH_SUBAGENT_LIST_METHOD, {
      rootSessionId: root.sessionId,
    })).rejects.toThrow(/method not found/i)
  })

  it('lists only real subagents with direct or transitive tree positions', async () => {
    harness = await makeBridgeHarness({ subagents: true })
    await harness.client.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
      _meta: { '_deepseek.ai/dsh': { subagents: true } },
    })
    const root = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    const rootId = SessionId(root.sessionId)
    liveChild(harness, 'direct-child', rootId, 'direct')
    const ordinary = harness.ctx.sessions.create(SessionId('ordinary-fork'), {
      meta: { cwd: process.cwd(), parentSession: rootId },
    })
    liveChild(harness, 'nested-child', ordinary.id, 'nested')

    expect(await harness.client.extMethod(DSH_SUBAGENT_LIST_METHOD, {
      rootSessionId: root.sessionId,
      scope: 'children',
    })).toEqual({
      rootSessionId: root.sessionId,
      scope: 'children',
      entries: [{
        kind: 'child',
        id: 'direct-child',
        mode: 'continuable',
        label: 'direct',
        activity: 'running',
        hasChildren: false,
      }],
    })

    expect(await harness.client.extMethod(DSH_SUBAGENT_LIST_METHOD, {
      rootSessionId: root.sessionId,
    })).toEqual({
      rootSessionId: root.sessionId,
      scope: 'descendants',
      entries: [
        {
          kind: 'child',
          id: 'direct-child',
          mode: 'continuable',
          label: 'direct',
          activity: 'running',
          hasChildren: false,
          parentId: root.sessionId,
          depth: 1,
        },
        {
          kind: 'child',
          id: 'nested-child',
          mode: 'continuable',
          label: 'nested',
          activity: 'running',
          hasChildren: false,
          parentId: 'ordinary-fork',
          depth: 2,
        },
      ],
    })
  })

  it('paginates live output events by seq without exposing descriptor records', async () => {
    harness = await makeBridgeHarness({ subagents: true })
    await harness.client.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
      _meta: { '_deepseek.ai/dsh': { subagents: true } },
    })
    const root = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    const child = liveChild(harness, 'live-child', SessionId(root.sessionId), 'live')

    const first = await harness.client.extMethod(DSH_SUBAGENT_ACTIVITY_METHOD, {
      rootSessionId: root.sessionId,
      sessionId: child.id,
      limit: 2,
    })
    expect(first).toMatchObject({
      sessionId: child.id,
      activity: 'running',
      afterSeq: -1,
      hasMore: true,
    })
    expect((first.events as SessionEvent[]).map(event => event.type)).toEqual([
      'turn/start',
      'step/start',
    ])
    expect((first.events as SessionEvent[]).some(event => event.type === 'subagent/descriptor')).toBe(false)

    const second = await harness.client.extMethod(DSH_SUBAGENT_ACTIVITY_METHOD, {
      rootSessionId: root.sessionId,
      sessionId: child.id,
      afterSeq: first.nextSeq,
      limit: 500,
    })
    expect(second).toMatchObject({
      sessionId: child.id,
      activity: 'running',
      afterSeq: first.nextSeq,
      nextSeq: child.snapshotEvents().at(-1)?.seq,
      hasMore: false,
    })
    expect((second.events as SessionEvent[]).map(event => event.type)).toEqual([
      'assistant/message',
      'tool/call',
      'tool/result',
      'todo/write',
      'step/end',
      'turn/end',
    ])
  })

  it('reads completed subagent output from persistence', async () => {
    harness = await makeBridgeHarness({ subagents: true })
    await harness.client.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
      _meta: { '_deepseek.ai/dsh': { subagents: true } },
    })
    const root = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    const child = await persistedChild(harness, 'cold-child', SessionId(root.sessionId), 'cold')

    const response = await harness.client.extMethod(DSH_SUBAGENT_ACTIVITY_METHOD, {
      rootSessionId: root.sessionId,
      sessionId: child.id,
    })
    expect(response).toMatchObject({
      sessionId: child.id,
      activity: 'inactive',
      nextSeq: child.snapshotEvents().at(-1)?.seq,
      hasMore: false,
    })
    expect((response.events as SessionEvent[]).map(event => event.type)).toContain('tool/result')
    expect((response.events as SessionEvent[]).find(event => event.type === 'assistant/message')?.data.stream)
      .toEqual([{ type: 'text-chunks', time0: 1, index: 0, dt: [], texts: ['working'] }])
  })

  it('rejects foreign roots, ordinary sessions, and malformed controls', async () => {
    harness = await makeBridgeHarness({ subagents: true })
    await harness.client.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
      _meta: { '_deepseek.ai/dsh': { subagents: true } },
    })
    const root = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    const ordinary = harness.ctx.sessions.create(SessionId('ordinary'), {
      meta: { cwd: process.cwd(), parentSession: SessionId(root.sessionId) },
    })

    await expect(harness.client.extMethod(DSH_SUBAGENT_LIST_METHOD, {
      rootSessionId: 'not-owned',
    })).rejects.toThrow(/unknown session: not-owned/)
    await expect(harness.client.extMethod(DSH_SUBAGENT_ACTIVITY_METHOD, {
      rootSessionId: root.sessionId,
      sessionId: ordinary.id,
    })).rejects.toThrow(/session is not a subagent below the owned root/)
    await expect(harness.client.extMethod(DSH_SUBAGENT_LIST_METHOD, {
      rootSessionId: root.sessionId,
      scope: 'all',
    })).rejects.toThrow(/scope must be "children" or "descendants"/)
    await expect(harness.client.extMethod(DSH_SUBAGENT_ACTIVITY_METHOD, {
      rootSessionId: root.sessionId,
      sessionId: 'missing',
      afterSeq: -2,
    })).rejects.toThrow(/afterSeq must be a safe integer/)
    await expect(harness.client.extMethod(DSH_SUBAGENT_LIST_METHOD, {
      rootSessionId: root.sessionId,
      extra: true,
    })).rejects.toThrow(/unknown parameter: extra/)
  })
})
