import { randomUUID } from 'node:crypto';
import type { FileNode, FileTreeUpdate, IFileTree, NodeId } from '@emdash/core/files';
import { err, ok, type Result } from '@emdash/shared';
import type {
  FileTreeProjectionOpenData,
  FileTreeProjectionVersionData,
} from '@shared/core/fs/file-tree';
import type { FileTreeOperationError } from '@shared/core/fs/file-tree-errors';
import type { FileTreeProjectionScope } from '@shared/core/fs/fsEvents';

/** Scopes are coalesced for at most this long before a flush, so storms collapse into a few sends. */
const FLUSH_COALESCE_MS = 16;

type Scope = NodeId | null;

type ProjectionSubscription = {
  /** Directory scopes this view has registered (root `null` is always present). */
  readonly scopes: Set<Scope>;
  /** Monotonic per-subscription version; what the renderer waits on for read-your-writes. */
  version: number;
};

export type FileTreeProjectionPush = {
  subscriptionId: string;
  version: number;
  scopes: FileTreeProjectionScope[];
};

/**
 * Per-path main-process projector. It is the single client of the core `FileTree` for one path and
 * the per-view projection hub toward renderer (and, later, mobile) clients.
 *
 * - Subscribes once to the core tree and reduces its keyed delta stream into an inline
 *   `scope -> listing` union cache (no exported primitive; just a Map + a small reducer).
 * - Ref-counts directory registrations across all views, driving `registerDir`/`unregisterDir`
 *   on core so a scope is loaded while any view wants it and unloaded when the last releases.
 * - Sends each view whole per-scope snapshots (coalesced) for the scopes it has registered.
 */
export class FileTreeProjector {
  private readonly unsubscribe: () => void;
  private readonly subscriptions = new Map<string, ProjectionSubscription>();

  // Inline union cache: scope -> (nodeId -> node), plus indexes for delta reduction and reveal.
  private readonly cache = new Map<Scope, Map<NodeId, FileNode>>();
  private readonly nodeById = new Map<NodeId, FileNode>();
  private readonly idByPath = new Map<string, NodeId>();

  // Aggregate (cross-view) ref-count + in-flight loads driving the core tree.
  private readonly scopeRetains = new Map<Scope, number>();
  private readonly scopeLoads = new Map<Scope, Promise<unknown>>();

  private readonly dirtyScopes = new Set<Scope>();
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(
    private readonly coreTree: IFileTree,
    private readonly push: (update: FileTreeProjectionPush) => void
  ) {
    // Core emits a snapshot synchronously to a new subscriber, then keyed deltas.
    this.unsubscribe = this.coreTree.subscribe((update) => this.applyUpdate(update));
  }

  async openProjection(): Promise<Result<FileTreeProjectionOpenData, FileTreeOperationError>> {
    const ready = await this.coreTree.ready();
    if (!ready.success) return err(ready.error);
    if (this.disposed) return err({ type: 'not_found' });

    const subscriptionId = randomUUID();
    const sub: ProjectionSubscription = { scopes: new Set<Scope>([null]), version: 0 };
    this.subscriptions.set(subscriptionId, sub);

    const retained = await this.retainScope(null);
    if (!retained.success) {
      this.subscriptions.delete(subscriptionId);
      return err(retained.error);
    }

    sub.version += 1;
    return ok({
      subscriptionId,
      version: sub.version,
      scopes: [{ scopeId: null, entries: this.materialize(null) }],
    });
  }

  async registerDir(
    subscriptionId: string,
    dirId: Scope
  ): Promise<Result<FileTreeProjectionVersionData, FileTreeOperationError>> {
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub) return err({ type: 'not_found' });

    if (sub.scopes.has(dirId)) {
      return ok({ version: this.flushScopes(subscriptionId, sub, [dirId]) });
    }

    sub.scopes.add(dirId);
    const retained = await this.retainScope(dirId);
    if (!retained.success) {
      sub.scopes.delete(dirId);
      return err(retained.error);
    }
    return ok({ version: this.flushScopes(subscriptionId, sub, [dirId]) });
  }

  async unregisterDir(
    subscriptionId: string,
    dirId: Scope
  ): Promise<Result<FileTreeProjectionVersionData, FileTreeOperationError>> {
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub) return err({ type: 'not_found' });
    if (dirId === null || !sub.scopes.has(dirId)) return ok({ version: sub.version });

    sub.scopes.delete(dirId);
    await this.releaseScope(dirId);
    return ok({ version: sub.version });
  }

  async revealPath(
    subscriptionId: string,
    absPath: string
  ): Promise<Result<FileTreeProjectionVersionData, FileTreeOperationError>> {
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub) return err({ type: 'not_found' });

    const revealed = await this.coreTree.revealPath(absPath);
    if (!revealed.success) return err(revealed.error);

    const scopes = this.ancestorScopesForPath(absPath);
    for (const scope of scopes) {
      if (sub.scopes.has(scope)) continue;
      sub.scopes.add(scope);
      const retained = await this.retainScope(scope);
      if (!retained.success) {
        sub.scopes.delete(scope);
        return err(retained.error);
      }
    }
    return ok({ version: this.flushScopes(subscriptionId, sub, scopes) });
  }

  async closeProjection(subscriptionId: string): Promise<void> {
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub) return;
    this.subscriptions.delete(subscriptionId);
    for (const scope of sub.scopes) await this.releaseScope(scope);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.flushTimer !== undefined) clearTimeout(this.flushTimer);
    this.unsubscribe();
    this.subscriptions.clear();
    this.scopeRetains.clear();
    this.scopeLoads.clear();
    this.cache.clear();
    this.nodeById.clear();
    this.idByPath.clear();
    this.dirtyScopes.clear();
  }

  // --- core ref-counting ---------------------------------------------------

  private async retainScope(scope: Scope): Promise<Result<void, FileTreeOperationError>> {
    const next = (this.scopeRetains.get(scope) ?? 0) + 1;
    this.scopeRetains.set(scope, next);

    if (next > 1) {
      const pending = this.scopeLoads.get(scope);
      if (pending) await pending;
      return ok<void>();
    }

    const loading = this.coreTree.registerDir(scope);
    this.scopeLoads.set(
      scope,
      loading.catch(() => undefined)
    );
    const result = await loading;
    this.scopeLoads.delete(scope);
    if (!result.success) {
      const current = this.scopeRetains.get(scope) ?? 0;
      if (current <= 1) this.scopeRetains.delete(scope);
      else this.scopeRetains.set(scope, current - 1);
      return err(result.error);
    }
    return ok<void>();
  }

  private async releaseScope(scope: Scope): Promise<void> {
    const current = this.scopeRetains.get(scope) ?? 0;
    if (current <= 0) return;
    if (current > 1) {
      this.scopeRetains.set(scope, current - 1);
      return;
    }
    this.scopeRetains.delete(scope);
    await this.coreTree.unregisterDir(scope);
  }

  // --- inline cache reducer ------------------------------------------------

  private applyUpdate(update: FileTreeUpdate): void {
    if (update.kind === 'snapshot') {
      this.cache.clear();
      this.nodeById.clear();
      this.idByPath.clear();
      for (const [id, node] of update.entries) this.indexPut(id, node);
      for (const scope of this.cache.keys()) this.dirtyScopes.add(scope);
    } else {
      for (const op of update.ops) {
        if (op.op === 'put') this.indexPut(op.key, op.value);
        else this.indexDel(op.key);
      }
    }
    if (this.dirtyScopes.size > 0) this.scheduleFlush();
  }

  private indexPut(id: NodeId, node: FileNode): void {
    const previous = this.nodeById.get(id);
    if (previous) {
      if (previous.parentId !== node.parentId) {
        this.removeFromScope(previous.parentId, id);
        this.dirtyScopes.add(previous.parentId);
      }
      if (previous.path !== node.path) this.idByPath.delete(previous.path);
    }
    this.nodeById.set(id, node);
    this.idByPath.set(node.path, id);
    let scopeMap = this.cache.get(node.parentId);
    if (!scopeMap) {
      scopeMap = new Map();
      this.cache.set(node.parentId, scopeMap);
    }
    scopeMap.set(id, node);
    this.dirtyScopes.add(node.parentId);
  }

  private indexDel(id: NodeId): void {
    const previous = this.nodeById.get(id);
    if (!previous) return;
    this.removeFromScope(previous.parentId, id);
    this.idByPath.delete(previous.path);
    this.nodeById.delete(id);
    this.dirtyScopes.add(previous.parentId);
    // A removed directory's own scope is gone.
    this.cache.delete(id);
  }

  private removeFromScope(scope: Scope, id: NodeId): void {
    const scopeMap = this.cache.get(scope);
    if (!scopeMap) return;
    scopeMap.delete(id);
    if (scopeMap.size === 0) this.cache.delete(scope);
  }

  private materialize(scope: Scope): FileNode[] {
    const scopeMap = this.cache.get(scope);
    return scopeMap ? [...scopeMap.values()] : [];
  }

  /** Directory scopes (deepest-first) that must be registered for `absPath` to be visible. */
  private ancestorScopesForPath(absPath: string): Scope[] {
    const scopes: Scope[] = [];
    const targetId = this.idByPath.get(absPath);
    const target = targetId !== undefined ? this.nodeById.get(targetId) : undefined;
    if (!target) return scopes;
    if (target.type === 'directory') scopes.push(target.id);
    let parentId = target.parentId;
    while (parentId !== null) {
      const parent = this.nodeById.get(parentId);
      if (!parent) break;
      scopes.push(parent.id);
      parentId = parent.parentId;
    }
    return scopes;
  }

  // --- flushing ------------------------------------------------------------

  private flushScopes(
    subscriptionId: string,
    sub: ProjectionSubscription,
    scopeIds: Scope[]
  ): number {
    const scopes = scopeIds
      .filter((scopeId) => sub.scopes.has(scopeId))
      .map((scopeId) => ({ scopeId, entries: this.materialize(scopeId) }));
    sub.version += 1;
    this.push({ subscriptionId, version: sub.version, scopes });
    return sub.version;
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== undefined || this.disposed) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      this.flushDirty();
    }, FLUSH_COALESCE_MS);
    this.flushTimer.unref?.();
  }

  private flushDirty(): void {
    if (this.dirtyScopes.size === 0) return;
    const dirty = [...this.dirtyScopes];
    this.dirtyScopes.clear();
    for (const [subscriptionId, sub] of this.subscriptions) {
      const scopeIds = dirty.filter((scope) => sub.scopes.has(scope));
      if (scopeIds.length === 0) continue;
      this.flushScopes(subscriptionId, sub, scopeIds);
    }
  }
}
