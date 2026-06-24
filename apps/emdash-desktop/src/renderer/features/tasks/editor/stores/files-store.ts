import type { FileNode as CoreFileNode, NodeId } from '@emdash/core/files';
import type { KeyedOp } from '@emdash/core/lib';
import { computed, makeObservable, observable, runInAction } from 'mobx';
import {
  normalizeFileTreePath,
  sortFileNodes,
  toRenderableFileNode,
  type RenderableFileNode,
} from '@renderer/features/tasks/file-tree/tree-utils';
import { events, rpc } from '@renderer/lib/ipc';
import {
  bindCollectionMirror,
  coalesce,
  CollectionMirror,
  type CollectionMirrorChange,
  type MirrorBinding,
  type MirrorBindingStatus,
} from '@renderer/lib/stores/live';
import type { FileTreeMutationResult, FileTreeSnapshotResult } from '@shared/core/fs/file-tree';
import {
  fileTreeOperationErrorMessage,
  type FileTreeOperationError,
} from '@shared/core/fs/file-tree-errors';
import { fileTreeUpdateChannel } from '@shared/core/fs/fsEvents';

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

const ROOT_SCOPE_PATH = '';
const OPTIMISTIC_NODE_TTL_MS = 15_000;

export class FilesStore {
  private readonly mirror: CollectionMirror<NodeId, CoreFileNode>;
  private readonly binding: MirrorBinding;
  private readonly baseNodes = new Map<NodeId, CoreFileNode>();
  private readonly basePathToId = new Map<string, NodeId>();
  private readonly viewNodesById = new Map<NodeId, RenderableFileNode>();
  private readonly viewData: FilesView = {
    nodes: new Map(),
    rootNodes: [],
    childrenById: new Map(),
    loadedPaths: new Set(),
    pathToId: new Map(),
  };
  private readonly optimisticNodes = observable.map<NodeId, OptimisticNode>();
  private readonly pendingPathSet = observable.set<string>();
  private nextOptimisticId = -1;
  private viewRevision = 0;
  private started = false;
  private syncError: string | null = null;

  constructor(
    private readonly projectId: string,
    private readonly workspaceId: string
  ) {
    this.mirror = new CollectionMirror<NodeId, CoreFileNode>({
      onApplied: (change) => this.applyMirrorChange(change),
    });

    const snapshot = coalesce(async (): Promise<FileTreeSnapshotResult> => {
      const result = await rpc.workspace.fileTree.getSnapshot(this.projectId, this.workspaceId);
      if (result.success) {
        runInAction(() => {
          this.syncError = null;
        });
      }
      return result;
    });

    this.binding = bindCollectionMirror<NodeId, CoreFileNode, FileTreeOperationError>({
      mirror: this.mirror,
      subscribe: (push) =>
        events.on(fileTreeUpdateChannel, (payload) => {
          if (payload.workspaceId !== this.workspaceId) return;
          push(payload.update);
        }),
      snapshot,
      onError: (error) => {
        runInAction(() => {
          this.syncError = fileTreeOperationErrorMessage(error);
        });
      },
      onUnexpectedError: (error) => {
        runInAction(() => {
          this.syncError = error instanceof Error ? error.message : String(error);
        });
      },
    });

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
    return !this.mirror.hasSnapshot && this.binding.status !== 'error';
  }

  get error(): string | undefined {
    if (!this.mirror.hasSnapshot && this.binding.status === 'error') {
      return this.syncError ?? 'Failed to load file tree';
    }
    return undefined;
  }

  get syncStatus(): MirrorBindingStatus {
    return this.binding.status;
  }

  get tree(): {
    data: FilesData | null;
    loading: boolean;
    error?: string;
    load: () => Promise<void>;
  } {
    return {
      data: this.mirror.hasSnapshot ? this.view : null,
      loading: this.isLoading,
      error: this.error,
      load: () => this.resync(),
    };
  }

  startWatching(): void {
    if (this.started) return;
    this.started = true;
    this.binding.start();
  }

  async resync(): Promise<void> {
    this.started = true;
    this.binding.start();
    await this.binding.resync();
  }

  dispose(): void {
    this.binding.dispose();
    this.mirror.dispose();
    for (const optimistic of this.optimisticNodes.values()) {
      if (optimistic.timer) clearTimeout(optimistic.timer);
    }
    runInAction(() => {
      this.baseNodes.clear();
      this.basePathToId.clear();
      this.clearViewData();
      this.optimisticNodes.clear();
      this.pendingPathSet.clear();
      this.syncError = null;
      this.bumpView();
    });
    this.started = false;
  }

  async loadDir(dirPath: string, force = false): Promise<void> {
    const path = normalizeFileTreePath(dirPath);
    if (!force && (this.loadedPaths.has(path) || this.pendingPathSet.has(path))) return;

    const dirId = this.idForPath(path);
    if (path && dirId === undefined) return;

    runInAction(() => {
      this.pendingPathSet.add(path);
    });
    try {
      const result = await rpc.workspace.fileTree.expandDir(
        this.projectId,
        this.workspaceId,
        dirId ?? null
      );
      await this.waitForTreeMutation(result);
    } finally {
      runInAction(() => {
        this.pendingPathSet.delete(path);
      });
    }
  }

  addOptimisticNodes(nodes: Array<{ relPath: string; type: 'file' | 'directory' }>): string[] {
    const inserted: string[] = [];

    runInAction(() => {
      for (const { relPath, type } of nodes) {
        const path = normalizeFileTreePath(relPath);
        if (!path || this.nodes.has(path) || this.optimisticNodeForPath(path)) continue;

        const parentPath = parentPathFromPath(path) ?? ROOT_SCOPE_PATH;
        if (!this.loadedPaths.has(parentPath)) continue;

        let parentId: NodeId | null = null;
        if (parentPath) {
          const resolvedParentId = this.idForPath(parentPath);
          if (resolvedParentId === undefined) continue;
          parentId = resolvedParentId;
        }

        const id = this.nextOptimisticId;
        this.nextOptimisticId -= 1;
        const node = {
          id,
          path,
          name: basenameFromPath(path),
          parentId,
          type,
          childrenLoaded: false,
        };
        this.optimisticNodes.set(id, {
          node,
        });
        if (!this.basePathToId.has(path)) this.addNodeToView(node);
        inserted.push(path);
      }
      if (inserted.length > 0) this.bumpView();
    });

    return inserted;
  }

  confirmOptimisticNodes(relPaths: string[]): void {
    runInAction(() => {
      for (const relPath of relPaths) {
        const optimistic = this.optimisticNodeForPath(normalizeFileTreePath(relPath));
        if (optimistic !== undefined) this.armOptimisticNodeExpiry(optimistic);
      }
    });
  }

  removeNode(relPath: string): void {
    const path = normalizeFileTreePath(relPath);
    const optimistic = this.optimisticNodeForPath(path);
    if (optimistic === undefined) return;
    runInAction(() => {
      this.removeOptimisticNode(optimistic);
    });
  }

  async revealFile(filePath: string, expandedPaths: Set<string>): Promise<void> {
    const path = normalizeFileTreePath(filePath);
    if (!path) return;

    const result = await rpc.workspace.fileTree.revealPath(this.projectId, this.workspaceId, path);
    const succeeded = await this.waitForTreeMutation(result);
    if (!succeeded) return;

    const parts = path.split('/').filter(Boolean);
    runInAction(() => {
      for (let index = 1; index < parts.length; index += 1) {
        expandedPaths.add(parts.slice(0, index).join('/'));
      }
    });
  }

  private get view(): FilesView {
    void this.viewRevision;
    return this.viewData;
  }

  private idForPath(path: string): NodeId | undefined {
    return this.view.pathToId.get(path);
  }

  private optimisticNodeForPath(path: string): NodeId | undefined {
    for (const [id, optimistic] of this.optimisticNodes) {
      if (optimistic.node.path === path) return id;
    }
    return undefined;
  }

  private applyMirrorChange(change: CollectionMirrorChange<NodeId, CoreFileNode>): void {
    if (change.kind === 'snapshot') {
      this.applyMirrorSnapshot(change.snapshot.entries);
    } else {
      this.applyMirrorDelta(change.update.ops);
    }
  }

  private applyMirrorSnapshot(entries: Array<[NodeId, CoreFileNode]>): void {
    this.baseNodes.clear();
    this.basePathToId.clear();
    this.clearViewData();
    this.viewData.loadedPaths.add(ROOT_SCOPE_PATH);

    for (const [id, node] of entries) {
      this.baseNodes.set(id, node);
      this.basePathToId.set(node.path, id);
      this.addNodeToView(node, { sort: false });
    }

    for (const [parentId, siblings] of this.viewData.childrenById) {
      this.viewData.childrenById.set(parentId, sortFileNodes(siblings));
    }
    this.refreshRootNodes();

    const authoritativePaths = new Set(entries.map(([, node]) => node.path));
    this.pruneOptimisticPaths(authoritativePaths);
    for (const optimistic of this.optimisticNodes.values()) {
      if (!this.basePathToId.has(optimistic.node.path)) this.addNodeToView(optimistic.node);
    }

    this.bumpView();
  }

  private applyMirrorDelta(ops: Array<KeyedOp<NodeId, CoreFileNode>>): void {
    let changed = false;
    for (const op of ops) {
      changed =
        op.op === 'put'
          ? this.applyBasePut(op.key, op.value) || changed
          : this.applyBaseDel(op.key) || changed;
    }
    if (changed) this.bumpView();
  }

  private applyBasePut(id: NodeId, node: CoreFileNode): boolean {
    const previous = this.baseNodes.get(id);
    if (previous) {
      this.basePathToId.delete(previous.path);
      this.removeNodeFromView(id);
    }

    const optimistic = this.optimisticNodeForPath(node.path);
    if (optimistic !== undefined) this.removeOptimisticNodeFromView(optimistic);

    this.baseNodes.set(id, node);
    this.basePathToId.set(node.path, id);
    this.addNodeToView(node);

    if (previous && previous.path !== node.path) {
      this.restoreOptimisticPath(previous.path);
    }

    return true;
  }

  private applyBaseDel(id: NodeId): boolean {
    const previous = this.baseNodes.get(id);
    if (!previous) return false;

    this.baseNodes.delete(id);
    this.basePathToId.delete(previous.path);
    this.removeNodeFromView(id);
    this.restoreOptimisticPath(previous.path);
    return true;
  }

  private pruneOptimisticPaths(paths: Set<string>): void {
    const ids = [...this.optimisticNodes]
      .filter(([, optimistic]) => paths.has(optimistic.node.path))
      .map(([id]) => id);
    for (const id of ids) this.removeOptimisticNodeFromView(id);
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
    if (this.removeOptimisticNodeFromView(id)) this.bumpView();
  }

  private removeOptimisticNodeFromView(id: NodeId): boolean {
    const optimistic = this.optimisticNodes.get(id);
    if (!optimistic) return false;
    if (optimistic?.timer) clearTimeout(optimistic.timer);
    this.optimisticNodes.delete(id);
    return this.removeNodeFromView(id);
  }

  private restoreOptimisticPath(path: string): boolean {
    if (this.basePathToId.has(path)) return false;
    const optimistic = this.optimisticNodeForPath(path);
    if (optimistic === undefined) return false;
    const entry = this.optimisticNodes.get(optimistic);
    if (!entry) return false;
    return this.addNodeToView(entry.node);
  }

  private addNodeToView(node: CoreFileNode, opts: { sort?: boolean } = {}): boolean {
    const renderNode = toRenderableFileNode(node);
    this.viewNodesById.set(renderNode.id, renderNode);
    this.viewData.nodes.set(renderNode.path, renderNode);
    this.viewData.pathToId.set(renderNode.path, renderNode.id);
    if (renderNode.type === 'directory' && renderNode.childrenLoaded) {
      this.viewData.loadedPaths.add(renderNode.path);
    }

    const siblings = this.viewData.childrenById.get(renderNode.parentId) ?? [];
    siblings.push(renderNode);
    this.viewData.childrenById.set(
      renderNode.parentId,
      opts.sort === false ? siblings : sortFileNodes(siblings)
    );
    if (renderNode.parentId === null) this.refreshRootNodes();
    return true;
  }

  private removeNodeFromView(id: NodeId): boolean {
    const node = this.viewNodesById.get(id);
    if (!node) return false;

    this.viewNodesById.delete(id);
    this.viewData.nodes.delete(node.path);
    this.viewData.pathToId.delete(node.path);
    if (node.type === 'directory') this.viewData.loadedPaths.delete(node.path);

    const siblings = this.viewData.childrenById.get(node.parentId);
    if (siblings) {
      const next = siblings.filter((sibling) => sibling.id !== id);
      if (next.length === 0) {
        this.viewData.childrenById.delete(node.parentId);
      } else {
        this.viewData.childrenById.set(node.parentId, next);
      }
    }
    if (node.parentId === null) this.refreshRootNodes();
    return true;
  }

  private clearViewData(): void {
    this.viewNodesById.clear();
    this.viewData.nodes.clear();
    this.viewData.rootNodes = [];
    this.viewData.childrenById.clear();
    this.viewData.loadedPaths.clear();
    this.viewData.pathToId.clear();
  }

  private refreshRootNodes(): void {
    this.viewData.rootNodes = this.viewData.childrenById.get(null) ?? [];
  }

  private bumpView(): void {
    this.viewRevision += 1;
  }

  private async waitForTreeMutation(result: FileTreeMutationResult): Promise<boolean> {
    if (!result.success) {
      runInAction(() => {
        this.syncError = fileTreeOperationErrorMessage(result.error);
      });
      return false;
    }

    const sequence = result.data.sequences.tree;
    if (sequence !== undefined) {
      try {
        await this.mirror.waitForSequence(sequence);
      } catch {
        await this.binding.resync();
      }
    }
    runInAction(() => {
      this.syncError = null;
    });
    return true;
  }
}

function parentPathFromPath(path: string): string | null {
  const index = path.lastIndexOf('/');
  return index === -1 ? null : path.slice(0, index);
}

function basenameFromPath(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? path : path.slice(index + 1);
}
