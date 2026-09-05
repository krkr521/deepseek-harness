/** DSH-owned ACP extensions for observing session-backed subagents. @module */

import type { Context } from '@deepseek-ai/cordis'
import { RequestError } from '@agentclientprotocol/sdk'
import { errorChain } from '@deepseek-ai/dsh-llm'
import { SessionId, SessionLogOffset, type SessionEvent } from '@deepseek-ai/dsh-session'
// Type-only: the optional todo producer owns the `todo/write` session event.
import type {} from '@deepseek-ai/dsh-tool-todo'
// Type-only: the tools service owns nested PTC dispatch events.
import type {} from '@deepseek-ai/dsh-tools'
import type { SubagentRuntime, SubagentDescendantListEntry } from '@deepseek-ai/dsh-subagent'

/** ACP custom method that lists direct or transitive session-backed subagents. */
export const DSH_SUBAGENT_LIST_METHOD = '_deepseek.ai/dsh/subagents/list'
/** ACP custom method that reads one authorized subagent's observable event suffix. */
export const DSH_SUBAGENT_ACTIVITY_METHOD = '_deepseek.ai/dsh/subagents/activity'

/** Version of the DSH-owned subagent-observation response fields. */
const DSH_SUBAGENT_EXTENSION_VERSION = 1
/** Default response page. This is a wire-response bound, not deployment behavior. */
const DEFAULT_ACTIVITY_LIMIT = 100
/** Largest response page accepted at the untrusted ACP request parser. */
const MAX_ACTIVITY_LIMIT = 500

/** Session events already represented by ACP progress updates, plus their lifecycle brackets. */
const OBSERVABLE_EVENT_TYPES: ReadonlySet<SessionEvent['type']> = new Set([
  'turn/start',
  'turn/end',
  'step/start',
  'step/end',
  'assistant/attempt',
  'assistant/message',
  'tool/call',
  'tool/result',
  'tool/code-dispatch-start',
  'tool/code-dispatch',
  'todo/write',
])

/** Listing entries whose persisted origin identifies an authorized child. */
type AuthorizedChild = Extract<SubagentDescendantListEntry, { kind: 'child' }>

/**
 * Return whether the optional DSH subagent observation extension can serve requests.
 * @param ctx - Cordis context carrying optional subagent and session services.
 * @returns whether both required services are mounted.
 */
export function supportsDshSubagentExtensions(ctx: Context): boolean {
  return ctx.get('subagents') !== undefined && ctx.get('sessions') !== undefined
}

/**
 * Build initialization metadata for the DSH-owned subagent observation methods.
 * @param ctx - Cordis context carrying optional subagent and session services.
 * @param clientMetadata - Untrusted initialization metadata carrying the explicit opt-in.
 * @returns namespaced metadata when the deployment can serve the methods.
 */
export function dshSubagentExtensionMetadata(
  ctx: Context,
  clientMetadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> | undefined {
  const requested = clientMetadata?.['_deepseek.ai/dsh']
  if (!isSubagentExtensionRequest(requested) || !supportsDshSubagentExtensions(ctx)) return undefined
  return {
    '_deepseek.ai/dsh': {
      version: DSH_SUBAGENT_EXTENSION_VERSION,
      subagents: {
        listMethod: DSH_SUBAGENT_LIST_METHOD,
        activityMethod: DSH_SUBAGENT_ACTIVITY_METHOD,
      },
    },
  }
}

/** Whether client initialization explicitly opts into DSH subagent observation. */
function isSubagentExtensionRequest(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  return (value as { subagents?: unknown }).subagents === true
}

/**
 * Parse one custom-method parameter object.
 * @param value - Untrusted ACP extension parameters.
 * @returns the accepted object.
 */
export function parseDshSubagentExtensionParams(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalidParams('params must be an object')
  }
  return value as Record<string, unknown>
}

/**
 * Handle one DSH-owned ACP extension request.
 * @param ctx - Cordis context carrying subagent, session, and optional persistence services.
 * @param method - ACP custom method name.
 * @param params - Untrusted extension request parameters.
 * @param requireOwnedRoot - Connection ownership check for the requested root session.
 * @returns the method-specific JSON response.
 */
export async function handleDshSubagentExtension(
  ctx: Context,
  method: string,
  params: Record<string, unknown>,
  requireOwnedRoot: (sessionId: SessionId) => void,
): Promise<Record<string, unknown>> {
  switch (method) {
    case DSH_SUBAGENT_LIST_METHOD:
      return listSubagents(ctx, params, requireOwnedRoot)
    case DSH_SUBAGENT_ACTIVITY_METHOD:
      return readSubagentActivity(ctx, params, requireOwnedRoot)
    default:
      throw RequestError.methodNotFound(method)
  }
}

/** List direct or transitive subagents below one connection-owned root. */
async function listSubagents(
  ctx: Context,
  params: Record<string, unknown>,
  requireOwnedRoot: (sessionId: SessionId) => void,
): Promise<Record<string, unknown>> {
  rejectUnknownParams(params, ['rootSessionId', 'scope'])
  const rootSessionId = requiredSessionId(params, 'rootSessionId')
  const scope = optionalScope(params.scope)
  requireOwnedRoot(rootSessionId)
  const subagents = requireSubagentObserver(ctx)
  try {
    const entries = scope === 'children'
      ? await subagents.listChildren(rootSessionId)
      : await subagents.listDescendants(rootSessionId)
    return { rootSessionId, scope, entries }
  } catch (error: unknown) {
    throw internalError(`unable to list subagents below "${rootSessionId}": ${errorChain(error)}`)
  }
}

/** Read one activity page after proving the target remains below the owned root. */
async function readSubagentActivity(
  ctx: Context,
  params: Record<string, unknown>,
  requireOwnedRoot: (sessionId: SessionId) => void,
): Promise<Record<string, unknown>> {
  rejectUnknownParams(params, ['rootSessionId', 'sessionId', 'afterSeq', 'limit'])
  const rootSessionId = requiredSessionId(params, 'rootSessionId')
  const sessionId = requiredSessionId(params, 'sessionId')
  const afterSeq = optionalSafeInteger(
    params.afterSeq,
    'afterSeq',
    -1,
    -1,
    Number.MAX_SAFE_INTEGER - 1,
  )
  const limit = optionalSafeInteger(params.limit, 'limit', DEFAULT_ACTIVITY_LIMIT, 1, MAX_ACTIVITY_LIMIT)
  requireOwnedRoot(rootSessionId)

  const subagents = requireSubagentObserver(ctx)
  let child: AuthorizedChild | undefined
  try {
    const descendants = await subagents.listDescendants(rootSessionId)
    child = descendants.find((entry): entry is AuthorizedChild => entry.kind === 'child' && entry.id === sessionId)
  } catch (error: unknown) {
    throw internalError(`unable to authorize subagent "${sessionId}": ${errorChain(error)}`)
  }
  if (child === undefined) {
    throw invalidParams(`session is not a subagent below the owned root: ${sessionId}`)
  }

  let snapshot: { activity: 'running' | 'inactive'; events: readonly SessionEvent[] }
  try {
    snapshot = await readEventSuffix(ctx, child, afterSeq)
  } catch (error: unknown) {
    throw internalError(`unable to read subagent "${sessionId}": ${errorChain(error)}`)
  }
  return activityPage(sessionId, afterSeq, limit, snapshot)
}

/** Read from the live Session when present, otherwise from the configured durable backend. */
async function readEventSuffix(
  ctx: Context,
  child: AuthorizedChild,
  afterSeq: number,
): Promise<{ activity: 'running' | 'inactive'; events: readonly SessionEvent[] }> {
  const live = ctx.get('sessions')?.get(child.id)
  if (live !== undefined) {
    return { activity: 'running', events: live.snapshotEvents(SessionLogOffset(afterSeq + 1)) }
  }
  const persistence = ctx.get('sessionPersistence')
  if (persistence === undefined) {
    throw new Error('session persistence is not configured for an inactive subagent')
  }
  const handle = await persistence.open(child.id, 'read')
  try {
    return { activity: 'inactive', events: await handle.read(afterSeq + 1) }
  } finally {
    await handle.close()
  }
}

/** Paginate observable events while advancing past hidden log-only records. */
function activityPage(
  sessionId: SessionId,
  afterSeq: number,
  limit: number,
  snapshot: { activity: 'running' | 'inactive'; events: readonly SessionEvent[] },
): Record<string, unknown> {
  const observable = snapshot.events.filter(event => OBSERVABLE_EVENT_TYPES.has(event.type))
  const events = observable.slice(0, limit)
  const hasMore = observable.length > events.length
  const lastReturned = events.at(-1)?.seq
  const lastScanned = snapshot.events.at(-1)?.seq
  const nextSeq = hasMore ? (lastReturned ?? afterSeq) : (lastScanned ?? afterSeq)
  return {
    sessionId,
    activity: snapshot.activity,
    afterSeq,
    nextSeq,
    hasMore,
    events,
  }
}

/** Resolve the optional subagent service or fail at the first callable point. */
function requireSubagentObserver(ctx: Context): SubagentRuntime {
  const service = ctx.get('subagents')
  if (service === undefined || ctx.get('sessions') === undefined) {
    throw internalError('subagent observation is not configured')
  }
  return service
}

/** Parse one required opaque session id. */
function requiredSessionId(params: Record<string, unknown>, key: string): SessionId {
  const value = params[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw invalidParams(`${key} must be a non-empty string`)
  }
  return SessionId(value)
}

/** Resolve the explicit list scope. */
function optionalScope(value: unknown): 'children' | 'descendants' {
  if (value === undefined || value === null) return 'descendants'
  if (value === 'children' || value === 'descendants') return value
  throw invalidParams('scope must be "children" or "descendants"')
}

/** Parse one bounded safe integer with an explicit owner-selected default. */
function optionalSafeInteger(
  value: unknown,
  key: string,
  defaultValue: number,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (value === undefined || value === null) return defaultValue
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw invalidParams(`${key} must be a safe integer between ${minimum} and ${maximum}`)
  }
  return value as number
}

/** Reject unrecognized wire fields instead of silently accepting misspelled controls. */
function rejectUnknownParams(params: Record<string, unknown>, allowed: readonly string[]): void {
  const allowedKeys = new Set(allowed)
  const unknown = Object.keys(params).find(key => !allowedKeys.has(key))
  if (unknown !== undefined) throw invalidParams(`unknown parameter: ${unknown}`)
}

/** Preserve invalid-parameter detail in the SDK wire error message. */
function invalidParams(detail: string): RequestError {
  return RequestError.invalidParams(undefined, detail)
}

/** Preserve extension failure detail instead of exposing an implementation stack. */
function internalError(detail: string): RequestError {
  return RequestError.internalError(undefined, detail)
}
