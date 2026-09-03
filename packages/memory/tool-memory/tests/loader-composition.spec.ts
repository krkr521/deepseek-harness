// Proves the complete native Memory seam through the real Loader: cordis.yml
// selects the JSON backend, Domain form, local Provider, and model Consumer;
// a tool write survives app disposal and a fresh Loader boot.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import LocalMemoryStore from '@deepseek-ai/dsh-memory-local'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ToolMemory from '@deepseek-ai/dsh-tool-memory'

let root: string | undefined
let contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.map(ctx => ctx.fiber.dispose()))
  contexts = []
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function boot(): Promise<Context> {
  root ??= await mkdtemp(join(tmpdir(), 'dsh-memory-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    '  config:',
    '    includeHarnessIdentity: false',
    '    includeRuntimeContext: true',
    "    persona: ''",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-storage'",
    "- name: '@deepseek-ai/dsh-storage-json'",
    '  config:',
    `    root: ${JSON.stringify(join(root, 'store'))}`,
    "- name: '@deepseek-ai/dsh-storage-domain'",
    '  config:',
    '    backend: json',
    "- name: '@deepseek-ai/dsh-memory-local'",
    '  config:',
    '    maxRecords: 8',
    '    maxTextBytes: 256',
    '    maxTags: 4',
    '    maxTagBytes: 32',
    '    maxSearchResults: 8',
    "- name: '@deepseek-ai/dsh-tool-memory'",
    '  config:',
    '    maxSearchResults: 4',
    '    maxContextRecords: 4',
    '    maxContextBytes: 1024',
    '',
  ].join('\n'))

  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-storage', Storage],
    ['@deepseek-ai/dsh-storage-json', StorageJson],
    ['@deepseek-ai/dsh-storage-domain', StorageDomain],
    ['@deepseek-ai/dsh-memory-local', LocalMemoryStore],
    ['@deepseek-ai/dsh-tool-memory', ToolMemory],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return ctx
}

function owner(ctx: Context): Agent {
  const id = SessionId('memory-loader-agent')
  const session = ctx.sessions.create(id, { meta: { cwd: resolve('loader-workspace') } })
  return { id, session } as unknown as Agent
}

describe('native Memory real Loader composition through cordis.yml', () => {
  it('loads five tools and restores a durable tool write after restart', async () => {
    const first = await boot()
    expect(first.tools.schemas().filter(schema => schema.name.startsWith('memory_')).map(schema => schema.name))
      .toEqual(['memory_search', 'memory_read', 'memory_write', 'memory_update', 'memory_forget'])
    const writer = owner(first)
    const result = await first.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('loader-write'),
      name: 'memory_write',
      arguments: { text: 'Loader-composed durable preference.', scope: 'global', tags: ['loader'], pinned: true },
      agent: writer,
    })
    expect(result.isError).toBe(false)
    const record = first.memory.search({ scopes: [{ kind: 'global' }], query: 'durable preference', limit: 4 })[0]?.record
    if (record === undefined) throw new Error('Loader-composed write was not searchable')

    await first.fiber.dispose()
    contexts = contexts.filter(ctx => ctx !== first)
    const second = await boot()
    expect(second.memory.get(record.id)).toMatchObject({
      text: 'Loader-composed durable preference.',
      tags: ['loader'],
      pinned: true,
      revision: 1,
    })
  }, 30_000)
})
