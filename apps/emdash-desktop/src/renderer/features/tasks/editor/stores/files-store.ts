import type { FileNode as CoreFileNode, NodeId } from '@emdash/core/files';
import { computed, makeObservable, observable, runInAction } from 'mobx';
import {
  buildFileTreeVisibleRows,
  isChainExpanded,
  isExpandableFileTreeNode,
  normalizeFileTreePath,
  sortFileNodes,
  toRenderableFileNode,
  type RenderableFileNode,
} from '@renderer/features/tasks/file-tree/tree-utils';
import { events, rpc } from '@renderer/lib/ipc';
import type { FileTreeProjectionVersionResult } from '@shared/core/fs/file-tree';
import { fileTreeOperationErrorMessage } from '@shared/core/fs/file-tree-errors';
import { fileTreeProjectionChannel } from '@shared/core/fs/fsEvents';

export interface FilesData {
  nodes: Map<string, RenderableFileNode>;
  rootNodes: RenderableFileNode[];
  childrenById: Map<NodeId | null, RenderableFileNode[]>;
  loadedPaths: Set<string>;
}

type FilesView = FilesData & {
  pathToId: Map<string, NodeId>;
};

type OptimisticNode = {
  node: CoreFileNode;
  timer?: ReturnType<typeof setTimeout>;
};

type VersionWaiter = {
  target: number;
  resolve: () => void;
  timer: ReturnType<typeof setTimeout>;
};

const OPTIMISTIC_NODE_TTL_MS = 15_000;
const VERSION_WAIT_TIMEOUT_MS = 5_000;

type Scope = NodeId | null;

export class FilesStore {
  // Authoritative projection state (raw core nodes, grouped by scope).
  private readonly nodesById = new Map<NodeId, CoreFileNode>();
  private readonly childIdsByScope = new Map<Scope, NodeId[]>();
  private readonly loadedScopes = new Set<Scope>();

  private readonly optimisticNodes = observable.map<NodeId, OptimisticNode>();
  private readonly pendingPathSet = observable.set<string>();
  /** Directory paths (excluding root) currently registered with the projector. */
  private readonly registeredPaths = new Set<string>();
  private readonly versionWaiters: VersionWaiter[] = [];

  private readonly viewData: FilesView = {
    nodes: new Map(),
    rootNodes: [],
    childrenById: new Map(),
    loadedPaths: new Set(),
    pathToId: new Map(),
  };

  private subscriptionId: string | null = null;
  private unsubscribe: (() => void) | null = null;
  private version = 0;
  private nextOptimisticId = -1;
  private viewRevision = 0;
  private started = false;
  private syncError: string | null = null;

  constructor(
    private readonly projectId: string,
    private readonly workspaceId: string,
    private readonly workspacePath: string
  ) {
    makeObservable<this, 'syncError' | 'viewRevision'>(this, {
      syncError: observable,
      viewRevision: observable,
      pendingPaths: computed,
      isLoading: computed,
      error: computed,
    });
  }

  get nodes(): Map<string, RenderableFileNode> {
    void this.viewRevision;
    return this.viewData.nodes;
  }

  get rootNodes(): RenderableFileNode[] {
    void this.viewRevision;
    return this.viewData.rootNodes;
  }

  get childrenById(): Map<NodeId | null, RenderableFileNode[]> {
    void this.viewRevision;
    return this.viewData.childrenById;
  }

  get loadedPaths(): Set<string> {
    void this.viewRevision;
    return this.viewData.loadedPaths;
  }

  get pendingPaths(): Set<string> {
    return this.pendingPathSet;
  }

  get isLoading(): boolean {
    void this.viewRevision;
    return !this.loadedScopes.has(null) && this.syncError === null;
  }

  get error(): string | undefined {
    void this.viewRevision;
    if (!this.loadedScopes.has(null) && this.syncError !== null) {
      return this.syncError ?? 'Failed to load file tree';
    }
    return undefined;
  }

  get tree(): {
    data: FilesData | null;
    loading: boolean;
    error?: string;
    load: () => Promise<void>;
  } {
    return {
      data: this.loadedScopes.has(null) ? this.view : null,
      loading: this.isLoading,
      error: this.error,
      load: () => this.resync(),
    };
  }

  get rootPath(): string {
    return normalizeFileTreePath(this.workspacePath);
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.openProjection();
  }

  async resync(): Promise<void> {
    this.teardownSubscription();
    this.clearVersionWaiters();
    runInAction(() => {
      this.resetState();
      this.pendingPathSet.clear();
      this.syncError = null;
      this.rebuildView();
    });
    this.started = true;
    await this.openProjection();
  }

  dispose(): void {
    this.teardownSubscription();
    for (const optimistic of this.optimisticNodes.values()) {
      if (optimistic.timer) clearTimeout(optimistic.timer);
    }
    this.clearVersionWaiters();
    runInAction(() => {
      this.resetState();
      this.optimisticNodes.clear();
      this.pendingPathSet.clear();
      this.syncError = null;
      this.rebuildView();
    });
    this.started = false;
  }

  reconcileVisibleScopes(expandedPaths: Set<string>): void {
    if (!this.subscriptionId) return;

    // Register only the directory scopes the user has expanded (and that are visible). Compaction
    // is driven entirely by the core-provided directory preview metadata, so collapsed chains render
    // without any extra registration; expanding a chain adds every segment to `expandedPaths`, and
    // the scopes load progressively as each ancestor resolves.
    const rows = buildFileTreeVisibleRows(
      this.viewData.rootNodes,
      expandedPaths,
      this.viewData.childrenById,
      this.viewData.loadedPaths
    );
    const desired = new Set<string>();
    for (const row of rows) {
      if (
        isExpandableFileTreeNode(row.node) &&
        row.node.path !== this.rootPath &&
        isChainExpanded(row.chain, expandedPaths)
      ) {
        desired.add(row.node.path);
      }
      for (const segment of row.chain) {
        if (
          isExpandableFileTreeNode(segment) &&
          segment.path !== this.rootPath &&
          expandedPaths.has(segment.path)
        ) {
          desired.add(segment.path);
        }
      }
    }

    for (const path of desired) {
      if (this.registeredPaths.has(path) || this.pendingPathSet.has(path)) continue;
      if (this.idForPath(path) === undefined) continue; // parent scope not loaded yet
      void this.registerDir(path);
    }
    for (const path of [...this.registeredPaths]) {
      if (!desired.has(path)) void this.unregisterDir(path);
    }
  }

  async registerDir(dirPath: string, force = false): Promise<void> {
    if (!this.subscriptionId) return;
    const path = this.resolveWorkspacePath(dirPath);
    if (!force && this.pendingPathSet.has(path)) return;
    if (!force && path !== this.rootPath && this.registeredPaths.has(path)) return;

    const dirId = path === this.rootPath ? null : this.idForPath(path);
    if (path !== this.rootPath && dirId === undefined) return;

    runInAction(() => {
      this.pendingPathSet.add(path);
    });
    try {
      const result = await rpc.workspace.fileTree.registerDir(
        this.projectId,
        this.workspaceId,
        this.subscriptionId,
        dirId ?? null
      );
      const succeeded = await this.awaitMutation(result);
      if (succeeded && path !== this.rootPath) this.registeredPaths.add(path);
    } finally {
      runInAction(() => {
        this.pendingPathSet.delete(path);
      });
    }
  }

  async unregisterDir(dirPath: string): Promise<void> {
    if (!this.subscriptionId) return;
    const path = this.resolveWorkspacePath(dirPath);
    if (path === this.rootPath) return;

    const dirId = this.idForPath(path);
    this.registeredPaths.delete(path);
    if (dirId === undefined) return;

    runInAction(() => {
      this.loadedScopes.delete(dirId);
      this.rebuildView();
    });
    await rpc.workspace.fileTree.unregisterDir(
      this.projectId,
      this.workspaceId,
      this.subscriptionId,
      dirId
    );
  }

  async revealFile(filePath: string, expandedPaths: Set<string>): Promise<void> {
    if (!this.subscriptionId) return;
    const path = this.resolveWorkspacePath(filePath);
    if (!path) return;

    const result = await rpc.workspace.fileTree.revealPath(
      this.projectId,
      this.workspaceId,
      this.subscriptionId,
      path
    );
    const succeeded = await this.awaitMutation(result);
    if (!succeeded) return;

    const workspaceRelativePath = relativePath(this.rootPath, path);
    const parts = workspaceRelativePath.split('/').filter(Boolean);
    runInAction(() => {
      for (let index = 1; index < parts.length; index += 1) {
        const ancestor = joinPath(this.rootPath, parts.slice(0, index).join('/'));
        expandedPaths.add(ancestor);
        this.registeredPaths.add(ancestor);
      }
    });
  }

  addOptimisticNodes(nodes: Array<{ path: string; type: 'file' | 'directory' }>): string[] {
    const inserted: string[] = [];

    runInAction(() => {
      for (const { path: inputPath, type } of nodes) {
        const path = this.resolveWorkspacePath(inputPath);
        if (
          !path ||
          this.viewData.nodes.has(path) ||
          this.optimisticNodeForPath(path) !== undefined
        )
          continue;

        const parentPath = parentPathFromPath(path) ?? this.rootPath;
        if (!this.viewData.loadedPaths.has(parentPath)) continue;

        let parentId: NodeId | null = null;
        if (parentPath !== this.rootPath) {
          const resolvedParentId = this.idForPath(parentPath);
          if (resolvedParentId === undefined) continue;
          parentId = resolvedParentId;
        }

        const id = this.nextOptimisticId;
        this.nextOptimisticId -= 1;
        this.optimisticNodes.set(id, {
          node: {
            id,
            path,
            name: basenameFromPath(path),
            parentId,
            type,
            childrenLoaded: false,
          },
        });
        inserted.push(path);
      }
      if (inserted.length > 0) this.rebuildView();
    });

    return inserted;
  }

  confirmOptimisticNodes(paths: string[]): void {
    runInAction(() => {
      for (const inputPath of paths) {
        const optimistic = this.optimisticNodeForPath(this.resolveWorkspacePath(inputPath));
        if (optimistic !== undefined) this.armOptimisticNodeExpiry(optimistic);
      }
    });
  }

  removeNode(inputPath: string): void {
    const path = this.resolveWorkspacePath(inputPath);
    const optimistic = this.optimisticNodeForPath(path);
    if (optimistic === undefined) return;
    runInAction(() => {
      this.removeOptimisticNode(optimistic);
    });
  }

  private async openProjection(): Promise<void> {
    const result = await rpc.workspace.fileTree.openProjection(this.projectId, this.workspaceId);
    if (!result.success) {
      runInAction(() => {
        this.syncError = fileTreeOperationErrorMessage(result.error);
      });
      return;
    }

    this.unsubscribe = events.on(fileTreeProjectionChannel, (payload) => {
      if (payload.workspaceId !== this.workspaceId) return;
      if (payload.subscriptionId !== this.subscriptionId) return;
      this.applyProjection(payload.version, payload.scopes);
    });

    runInAction(() => {
      this.subscriptionId = result.data.subscriptionId;
      this.version = result.data.version;
      this.syncError = null;
      for (const scope of result.data.scopes) this.applyScope(scope.scopeId, scope.entries);
      this.rebuildView();
      this.pruneResolvedOptimistic();
    });
  }

  private applyProjection(
    version: number,
    scopes: Array<{ scopeId: Scope; entries: CoreFileNode[] }>
  ): void {
    runInAction(() => {
      for (const scope of scopes) this.applyScope(scope.scopeId, scope.entries);
      this.version = Math.max(this.version, version);
      this.syncError = null;
      this.rebuildView();
      this.pruneResolvedOptimistic();
    });
    this.resolveVersionWaiters();
  }

  /** Replace a single scope's children wholesale, pruning vanished sub-scopes. */
  private applyScope(scopeId: Scope, entries: CoreFileNode[]): void {
    const previous = this.childIdsByScope.get(scopeId) ?? [];
    const nextIds = entries.map((entry) => entry.id);
    const nextSet = new Set(nextIds);
    for (const id of previous) {
      if (!nextSet.has(id)) this.pruneSubtree(id);
    }
    for (const node of entries) this.nodesById.set(node.id, node);
    this.childIdsByScope.set(scopeId, nextIds);
    this.loadedScopes.add(scopeId);
  }

  private pruneSubtree(id: NodeId): void {
    if (!this.nodesById.has(id)) return;
    const children = this.childIdsByScope.get(id);
    if (children) {
      for (const child of children) this.pruneSubtree(child);
    }
    this.childIdsByScope.delete(id);
    this.loadedScopes.delete(id);
    this.nodesById.delete(id);
  }

  private get view(): FilesView {
    void this.viewRevision;
    return this.viewData;
  }

  private idForPath(path: string): NodeId | undefined {
    return this.viewData.pathToId.get(path);
  }

  private optimisticNodeForPath(path: string): NodeId | undefined {
    for (const [id, optimistic] of this.optimisticNodes) {
      if (optimistic.node.path === path) return id;
    }
    return undefined;
  }

  private resolveWorkspacePath(path: string): string {
    const normalized = normalizeFileTreePath(path);
    if (isAbsolutePath(normalized)) return normalized;
    return normalized ? joinPath(this.rootPath, normalized) : this.rootPath;
  }

  private rebuildView(): void {
    const nodes = new Map<string, RenderableFileNode>();
    const childrenById = new Map<NodeId | null, RenderableFileNode[]>();
    const loadedPaths = new Set<string>();
    const pathToId = new Map<string, NodeId>();

    if (this.loadedScopes.has(null)) loadedPaths.add(this.rootPath);

    for (const node of this.nodesById.values()) {
      const renderNode = toRenderableFileNode(node);
      nodes.set(renderNode.path, renderNode);
      pathToId.set(renderNode.path, renderNode.id);
      pushChild(childrenById, renderNode);
      if (isExpandableFileTreeNode(renderNode) && this.loadedScopes.has(node.id)) {
        loadedPaths.add(renderNode.path);
      }
    }

    for (const { node } of this.optimisticNodes.values()) {
      if (pathToId.has(node.path)) continue;
      const renderNode = toRenderableFileNode(node);
      nodes.set(renderNode.path, renderNode);
      pushChild(childrenById, renderNode);
    }

    for (const [parentId, siblings] of childrenById) {
      childrenById.set(parentId, sortFileNodes(siblings));
    }

    this.viewData.nodes = nodes;
    this.viewData.childrenById = childrenById;
    this.viewData.loadedPaths = loadedPaths;
    this.viewData.pathToId = pathToId;
    this.viewData.rootNodes = childrenById.get(null) ?? [];
    this.bumpView();
  }

  private pruneResolvedOptimistic(): void {
    const ids = [...this.optimisticNodes]
      .filter(([, optimistic]) => this.viewData.pathToId.has(optimistic.node.path))
      .map(([id]) => id);
    if (ids.length === 0) return;
    for (const id of ids) {
      const optimistic = this.optimisticNodes.get(id);
      if (optimistic?.timer) clearTimeout(optimistic.timer);
      this.optimisticNodes.delete(id);
    }
    this.rebuildView();
  }

  private armOptimisticNodeExpiry(id: NodeId): void {
    const optimistic = this.optimisticNodes.get(id);
    if (!optimistic) return;
    if (optimistic.timer) clearTimeout(optimistic.timer);
    optimistic.timer = setTimeout(() => {
      runInAction(() => {
        this.removeOptimisticNode(id);
      });
    }, OPTIMISTIC_NODE_TTL_MS);
  }

  private removeOptimisticNode(id: NodeId): void {
    const optimistic = this.optimisticNodes.get(id);
    if (!optimistic) return;
    if (optimistic.timer) clearTimeout(optimistic.timer);
    this.optimisticNodes.delete(id);
    this.rebuildView();
  }

  private async awaitMutation(result: FileTreeProjectionVersionResult): Promise<boolean> {
    if (!result.success) {
      runInAction(() => {
        this.syncError = fileTreeOperationErrorMessage(result.error);
      });
      return false;
    }
    await this.waitForVersion(result.data.version);
    runInAction(() => {
      this.syncError = null;
    });
    return true;
  }

  private waitForVersion(target: number): Promise<void> {
    if (this.version >= target) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.removeVersionWaiter(waiter);
        resolve();
      }, VERSION_WAIT_TIMEOUT_MS);
      const waiter: VersionWaiter = { target, resolve, timer };
      this.versionWaiters.push(waiter);
    });
  }

  private resolveVersionWaiters(): void {
    if (this.versionWaiters.length === 0) return;
    const ready = this.versionWaiters.filter((waiter) => this.version >= waiter.target);
    for (const waiter of ready) {
      clearTimeout(waiter.timer);
      this.removeVersionWaiter(waiter);
      waiter.resolve();
    }
  }

  private removeVersionWaiter(waiter: VersionWaiter): void {
    const index = this.versionWaiters.indexOf(waiter);
    if (index !== -1) this.versionWaiters.splice(index, 1);
  }

  private clearVersionWaiters(): void {
    const waiters = this.versionWaiters.splice(0);
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve();
    }
  }

  private teardownSubscription(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    const subscriptionId = this.subscriptionId;
    this.subscriptionId = null;
    if (subscriptionId) {
      void rpc.workspace.fileTree.closeProjection(this.projectId, this.workspaceId, subscriptionId);
    }
    this.started = false;
  }

  private resetState(): void {
    this.nodesById.clear();
    this.childIdsByScope.clear();
    this.loadedScopes.clear();
    this.registeredPaths.clear();
    this.version = 0;
  }

  private bumpView(): void {
    this.viewRevision += 1;
  }
}

function pushChild(
  childrenById: Map<NodeId | null, RenderableFileNode[]>,
  node: RenderableFileNode
): void {
  const siblings = childrenById.get(node.parentId) ?? [];
  siblings.push(node);
  childrenById.set(node.parentId, siblings);
}

function parentPathFromPath(path: string): string | null {
  const index = path.lastIndexOf('/');
  if (index === -1) return null;
  if (index === 0) return '/';
  return path.slice(0, index);
}

function basenameFromPath(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? path : path.slice(index + 1);
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[a-zA-Z]:\//.test(path);
}

function joinPath(rootPath: string, childPath: string): string {
  return normalizeFileTreePath(`${rootPath}/${childPath}`);
}

function relativePath(rootPath: string, absPath: string): string {
  if (absPath === rootPath) return '';
  const prefix = rootPath.endsWith('/') ? rootPath : `${rootPath}/`;
  return absPath.startsWith(prefix) ? absPath.slice(prefix.length) : absPath;
}
