/** Client-side Workspace presentation collections. */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'

/** One UI-only collection of Workspaces and Sessions sharing a path policy. */
export interface WorkspacePresentationCollection {
  /** Stable browser-local identity; must not be a Host Workspace id. */
  key: string
  /** Display title used by the sidebar, picker, and search results. */
  title: string
  /** Representative directory shown by the Workspace hover card. */
  path: string
  /** Whether a Workspace path or Session cwd belongs to this collection. */
  matchesPath: (path: string) => boolean
  /** Resolve the real Workspace that receives a newly created Session. */
  resolveWorkspace: () => Promise<WorkspaceId>
}
/** Registration and lookup API for UI-only Workspace collections. */
export interface WorkspacePresentation {
  /** Live registered collections in effect-registration order. */
  readonly collections: HostObservable<readonly WorkspacePresentationCollection[]>
  /**
   * Register one collection for the caller's effect lifetime.
   * @param collection - display policy and New Session resolver.
   * @returns disposer that removes this exact registration.
   */
  register(collection: WorkspacePresentationCollection): () => void
  /**
   * Resolve a collection key or pass through a real Workspace id.
   * @param key - presentation collection key or Host Workspace id.
   * @returns real Workspace id.
   */
  resolveWorkspace(key: string): Promise<WorkspaceId>
  /**
   * Find the collection presenting one real Workspace.
   * @param workspace - real Host Workspace.
   * @returns matching collection, if any.
   */
  findForWorkspace(workspace: WorkspaceView): WorkspacePresentationCollection | undefined
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** UI-only grouping of related real Workspaces. */
    workspacePresentation: WorkspacePresentation
  }
}

/** Owns same-process collection callbacks and a React-bindable snapshot. */
export class WorkspacePresentationService extends Service implements WorkspacePresentation {
  private readonly registered = new Map<string, WorkspacePresentationCollection>()
  private readonly listeners = new Set<() => void>()
  private snapshot: readonly WorkspacePresentationCollection[] = []

  readonly collections: HostObservable<readonly WorkspacePresentationCollection[]> = {
    getSnapshot: () => this.snapshot,
    subscribe: (listener) => {
      this.listeners.add(listener)
      return () => { this.listeners.delete(listener) }
    },
  }

  /** @param ctx - client root Context. */
  constructor(ctx: Context) {
    super(ctx, 'workspacePresentation')
  }

  register(collection: WorkspacePresentationCollection): () => void {
    if (collection.key.trim() === '') throw new Error('workspacePresentation: collection key must not be blank')
    if (collection.title.trim() === '') throw new Error('workspacePresentation: collection title must not be blank')
    if (this.registered.has(collection.key)) {
      throw new Error(`workspacePresentation: duplicate collection key "${collection.key}"`)
    }
    this.registered.set(collection.key, collection)
    this.publish()
    return () => {
      if (this.registered.get(collection.key) !== collection) return
      this.registered.delete(collection.key)
      this.publish()
    }
  }

  async resolveWorkspace(key: string): Promise<WorkspaceId> {
    const collection = this.registered.get(key)
    return collection === undefined ? key as WorkspaceId : collection.resolveWorkspace()
  }

  findForWorkspace(workspace: WorkspaceView): WorkspacePresentationCollection | undefined {
    return this.snapshot.find(collection => collection.matchesPath(workspace.path))
  }

  private publish(): void {
    this.snapshot = [...this.registered.values()]
    for (const listener of this.listeners) listener()
  }
}
