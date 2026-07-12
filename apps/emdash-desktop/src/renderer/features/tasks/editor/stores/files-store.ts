import { filesContract, type FileTreeModel } from '@emdash/core/files';
import type { HostAbsolutePath, PortableRelativePath } from '@emdash/core/path';
import { createLiveModelReplica, type LiveModelReplica, type ReplicaInstance } from '@emdash/wire';
import { createImmutableMobxStore } from '@emdash/wire/util/mobx';
import { computed, makeObservable, observable, runInAction } from 'mobx';
import {
  buildFileTreeVisibleRows,
  isExpandableFileTreeNode,
  normalizeFileTreePath,
  sortFileNodes,
  toRenderableFileNode,
  type FileNodeId,
  type RenderableFileNode,
} from '@renderer/features/tasks/file-tree/tree-utils';
import { getFilesRuntimeClient } from '@renderer/lib/runtime/files-client';
import {
  absoluteRuntimePath,
  hostPathFromNative,
  nativePathFromHost,
  portablePath,
  relativePathWithin,
  resolveRelativePath,
} from '@shared/core/runtime/paths';

type TreeModel = typeof filesContract.tree.model;
type OptimisticNode = { node: RenderableFileNode; timer?: ReturnType<typeof setTimeout> };

const OPTIMISTIC_NODE_TTL_MS = 15_000;

export class FilesStore {
  private readonly root: HostAbsolutePath;
  private replica: LiveModelReplica<TreeModel> | null = null;
  private model: ReplicaInstance<TreeModel> | null = null;
  private releaseModel: (() => Promise<void>) | null = null;
  private startPromise: Promise<void> | null = null;
  private started = false;
  private syncError: string | null = null;
  private viewRevision = 0;
  private nextOptimisticId = 1;

  private readonly optimisticNodes = observable.map<FileNodeId, OptimisticNode>();
  private readonly pendingPathSet = observable.set<string>();
  private readonly viewData = {
    nodes: new Map<string, RenderableFileNode>(),
    rootNodes: [] as RenderableFileNode[],
    childrenById: new Map<FileNodeId | null, RenderableFileNode[]>(),
    loadedPaths: new Set<string>(),
    pathToId: new Map<string, FileNodeId>(),
  };

  constructor(
    private readonly projectId: string,
    private readonly workspaceId: string,
    private readonly workspacePath: string
  ) {
    this.root = hostPathFromNative(workspacePath);
    makeObservable<FilesStore, 'model' | 'syncError' | 'viewRevision'>(this, {
      model: observable.ref,
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

  get childrenById(): Map<FileNodeId | null, RenderableFileNode[]> {
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
    return this.model === null && this.syncError === null;
  }

  get error(): string | undefined {
    return this.syncError ?? undefined;
  }

  get rootPath(): string {
    return normalizeFileTreePath(this.workspacePath);
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.ensureStarted();
  }

  async resync(): Promise<void> {
    await this.ensureStarted();
    await this.model?.states.tree.refresh();
  }

  dispose(): void {
    this.started = false;
    for (const optimistic of this.optimisticNodes.values()) {
      if (optimistic.timer) clearTimeout(optimistic.timer);
    }
    this.optimisticNodes.clear();
    this.pendingPathSet.clear();
    const release = this.releaseModel;
    const replica = this.replica;
    this.releaseModel = null;
    this.replica = null;
    this.model = null;
    this.rebuildView();
    void (async () => {
      try {
        await release?.();
      } finally {
        await replica?.dispose();
      }
    })();
  }

  reconcileVisibleScopes(expandedPaths: Set<string>): void {
    for (const expandedPath of expandedPaths) {
      const node = this.viewData.nodes.get(normalizeFileTreePath(expandedPath));
      if (node && isExpandableFileTreeNode(node) && !this.loadedPaths.has(node.path)) {
        void this.registerDir(node.path);
      }
    }
    const rows = buildFileTreeVisibleRows(
      this.rootNodes,
      expandedPaths,
      this.childrenById,
      this.loadedPaths
    );
    for (const row of rows) {
      if (
        isExpandableFileTreeNode(row.node) &&
        expandedPaths.has(row.node.path) &&
        !this.loadedPaths.has(row.node.path)
      ) {
        void this.registerDir(row.node.path);
      }
    }
  }

  async registerDir(dirPath: string, force = false): Promise<void> {
    const model = await this.requireModel();
    const absolute = this.resolveWorkspacePath(dirPath);
    if (this.pendingPathSet.has(absolute)) return;
    if (!force && this.loadedPaths.has(absolute)) return;
    runInAction(() => this.pendingPathSet.add(absolute));
    try {
      if (force) await model.states.tree.refresh();
      const invocation = await model.mutations.expand({ path: this.relative(absolute) });
      if (invocation.result.success) await invocation.settled;
      else this.setError(invocation.result.error);
    } finally {
      runInAction(() => this.pendingPathSet.delete(absolute));
    }
  }

  async revealFile(filePath: string, expandedPaths: Set<string>): Promise<void> {
    const model = await this.requireModel();
    const absolute = this.resolveWorkspacePath(filePath);
    const relative = this.relative(absolute);
    const invocation = await model.mutations.reveal({ path: relative });
    if (!invocation.result.success) {
      this.setError(invocation.result.error);
      return;
    }
    await invocation.settled;
    const segments = relative.split('/').filter(Boolean);
    runInAction(() => {
      for (let index = 1; index < segments.length; index += 1) {
        expandedPaths.add(this.absolute(portablePath(segments.slice(0, index).join('/'))));
      }
    });
  }

  addOptimisticNodes(nodes: Array<{ path: string; type: 'file' | 'directory' }>): string[] {
    const inserted: string[] = [];
    runInAction(() => {
      for (const candidate of nodes) {
        const absolute = this.resolveWorkspacePath(candidate.path);
        if (this.viewData.nodes.has(absolute) || this.optimisticNodeForPath(absolute)) continue;
        const parentPath = parentPathFromPath(absolute) ?? this.rootPath;
        if (!this.viewData.loadedPaths.has(parentPath)) continue;
        const parentId =
          parentPath === this.rootPath ? null : this.viewData.pathToId.get(parentPath);
        if (parentPath !== this.rootPath && parentId === undefined) continue;
        const name = basenameFromPath(absolute);
        const id = `optimistic:${this.nextOptimisticId++}`;
        this.optimisticNodes.set(id, {
          node: {
            id,
            path: absolute,
            name,
            parentId: parentId ?? null,
            parentPath,
            depth: this.relative(absolute).split('/').length - 1,
            type: candidate.type,
            childrenLoaded: false,
            isHidden: name.startsWith('.'),
            extension:
              candidate.type === 'file' && name.includes('.') ? name.split('.').pop() : undefined,
          },
        });
        inserted.push(absolute);
      }
      if (inserted.length > 0) this.rebuildView();
    });
    return inserted;
  }

  confirmOptimisticNodes(paths: string[]): void {
    runInAction(() => {
      for (const path of paths) {
        const id = this.optimisticNodeForPath(this.resolveWorkspacePath(path));
        if (id) this.armOptimisticNodeExpiry(id);
      }
    });
  }

  removeNode(path: string): void {
    const id = this.optimisticNodeForPath(this.resolveWorkspacePath(path));
    if (!id) return;
    runInAction(() => this.removeOptimisticNode(id));
  }

  private ensureStarted(): Promise<void> {
    this.startPromise ??= this.bindRuntime();
    return this.startPromise;
  }

  private async requireModel(): Promise<ReplicaInstance<TreeModel>> {
    await this.ensureStarted();
    if (!this.model) throw new Error(this.syncError ?? 'File tree is unavailable');
    return this.model;
  }

  private async bindRuntime(): Promise<void> {
    try {
      const client = await getFilesRuntimeClient();
      const replica = createLiveModelReplica(filesContract.tree.model, client.tree.model, {
        stores: { tree: createImmutableMobxStore },
        onChange: {
          tree: () => {
            runInAction(() => {
              this.syncError = null;
              this.rebuildView();
              this.pruneResolvedOptimistic();
            });
          },
        },
      });
      const lease = replica.acquire({ root: this.root, sessionId: this.workspaceId });
      const model = await lease.ready();
      if (!this.started) {
        await lease.release();
        await replica.dispose();
        return;
      }
      runInAction(() => {
        this.replica = replica;
        this.releaseModel = () => lease.release();
        this.model = model;
        this.syncError = null;
        this.rebuildView();
      });
      const expanded = await model.mutations.expand({ path: portablePath('') });
      if (expanded.result.success) await expanded.settled;
      else this.setError(expanded.result.error);
    } catch (error) {
      runInAction(() => {
        this.syncError = error instanceof Error ? error.message : String(error);
      });
    }
  }

  private get tree(): FileTreeModel | null {
    return this.model?.states.tree.current() ?? null;
  }

  private rebuildView(): void {
    const nodes = new Map<string, RenderableFileNode>();
    const childrenById = new Map<FileNodeId | null, RenderableFileNode[]>();
    const loadedPaths = new Set<string>();
    const pathToId = new Map<string, FileNodeId>();
    const tree = this.tree;
    if (tree) {
      const rootEntry = tree.entries[''];
      if (rootEntry?.childrenLoaded) loadedPaths.add(this.rootPath);
      for (const entry of Object.values(tree.entries)) {
        if (entry.path === '') continue;
        const node = toRenderableFileNode(entry, this.rootPath);
        nodes.set(node.path, node);
        pathToId.set(node.path, node.id);
        pushChild(childrenById, node);
        if (entry.childrenLoaded) loadedPaths.add(node.path);
      }
    }
    for (const { node } of this.optimisticNodes.values()) {
      if (nodes.has(node.path)) continue;
      nodes.set(node.path, node);
      pushChild(childrenById, node);
    }
    for (const [parentId, children] of childrenById) {
      childrenById.set(parentId, sortFileNodes(children));
    }
    this.viewData.nodes = nodes;
    this.viewData.childrenById = childrenById;
    this.viewData.loadedPaths = loadedPaths;
    this.viewData.pathToId = pathToId;
    this.viewData.rootNodes = childrenById.get(null) ?? [];
    this.viewRevision += 1;
  }

  private pruneResolvedOptimistic(): void {
    for (const [id, optimistic] of this.optimisticNodes) {
      if (!this.viewData.pathToId.has(optimistic.node.path)) continue;
      if (optimistic.timer) clearTimeout(optimistic.timer);
      this.optimisticNodes.delete(id);
    }
  }

  private optimisticNodeForPath(path: string): FileNodeId | undefined {
    for (const [id, optimistic] of this.optimisticNodes) {
      if (optimistic.node.path === path) return id;
    }
    return undefined;
  }

  private armOptimisticNodeExpiry(id: FileNodeId): void {
    const optimistic = this.optimisticNodes.get(id);
    if (!optimistic) return;
    if (optimistic.timer) clearTimeout(optimistic.timer);
    optimistic.timer = setTimeout(() => {
      runInAction(() => this.removeOptimisticNode(id));
    }, OPTIMISTIC_NODE_TTL_MS);
  }

  private removeOptimisticNode(id: FileNodeId): void {
    const optimistic = this.optimisticNodes.get(id);
    if (!optimistic) return;
    if (optimistic.timer) clearTimeout(optimistic.timer);
    this.optimisticNodes.delete(id);
    this.rebuildView();
  }

  private resolveWorkspacePath(input: string): string {
    return normalizeFileTreePath(nativePathFromHost(absoluteRuntimePath(this.root, input)));
  }

  private relative(absolutePath: string): PortableRelativePath {
    return relativePathWithin(this.root, hostPathFromNative(absolutePath));
  }

  private absolute(relativePath: PortableRelativePath): string {
    return normalizeFileTreePath(nativePathFromHost(resolveRelativePath(this.root, relativePath)));
  }

  private setError(error: unknown): void {
    runInAction(() => {
      this.syncError =
        typeof error === 'object' && error && 'message' in error
          ? String(error.message)
          : String(error);
    });
  }
}

function pushChild(
  childrenById: Map<FileNodeId | null, RenderableFileNode[]>,
  node: RenderableFileNode
): void {
  const children = childrenById.get(node.parentId) ?? [];
  children.push(node);
  childrenById.set(node.parentId, children);
}

function parentPathFromPath(path: string): string | null {
  const index = path.lastIndexOf('/');
  if (index < 0) return null;
  return index === 0 ? '/' : path.slice(0, index);
}

function basenameFromPath(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}
