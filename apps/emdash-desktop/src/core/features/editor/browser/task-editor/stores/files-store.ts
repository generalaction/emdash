import { canonicalExclusionPatterns, DEFAULT_TREE_EXCLUDE } from '@emdash/core/primitives/lib/api';
import type { HostAbsolutePath, PortableRelativePath } from '@emdash/core/primitives/path/api';
import type { FsError } from '@emdash/core/runtimes/files/api';
import { protocolUpgradeMessage } from '@emdash/core/workspace-server';
import { err, ok, type Result } from '@emdash/shared';
import { createLiveModelReplica, type LiveModelReplica } from '@emdash/wire';
import { OptimisticLiveModel } from '@emdash/wire/util/mobx';
import { computed, makeObservable, observable, runInAction } from 'mobx';
import { getEditorClient } from '@core/features/editor/api/browser/client';
import {
  buildFileTreeVisibleRows,
  isExpandableFileTreeNode,
  normalizeFileTreePath,
  sortFileNodes,
  toRenderableFileNode,
  type FileNodeId,
  type RenderableFileNode,
} from '@core/features/editor/api/browser/file-tree/tree-utils';
import { fetchAppSettingsMeta } from '@core/features/settings/api/browser/app-settings-client';
import {
  absoluteRuntimePath,
  hostPathFromNative,
  nativePathFromHost,
  portablePath,
  relativePathWithin,
  resolveRelativePath,
} from '@core/primitives/desktop-runtime/api';
import { editorContract, type EditorFileTreeModel } from '../../../api';

type TreeModel = typeof editorContract.tree.model;
export type TreeMutationError =
  | FsError
  | {
      type: string;
      message?: string;
      path?: string;
      paths?: readonly string[];
      host?: unknown;
    }
  | { type: 'unavailable'; message: string };
type PendingUploadNode = { node: RenderableFileNode };
type ViewData = {
  nodes: Map<string, RenderableFileNode>;
  rootNodes: RenderableFileNode[];
  childrenById: Map<FileNodeId | null, RenderableFileNode[]>;
  loadedPaths: Set<string>;
  pathToId: Map<string, FileNodeId>;
};

export class FilesStore {
  private readonly root: HostAbsolutePath;
  private replica: LiveModelReplica<TreeModel> | null = null;
  private optimistic: OptimisticLiveModel<TreeModel> | null = null;
  private startPromise: Promise<void> | null = null;
  private started = false;
  private syncError: string | null = null;
  private bindVersion = 0;
  private exclusions = canonicalExclusionPatterns(DEFAULT_TREE_EXCLUDE);
  private exclusionsLoaded = false;
  private nextPendingUploadId = 1;

  private readonly pendingUploadNodes = observable.map<FileNodeId, PendingUploadNode>();
  private readonly pendingPathSet = observable.set<string>();

  constructor(
    private readonly projectId: string,
    private readonly workspaceId: string,
    private readonly workspacePath: string
  ) {
    this.root = hostPathFromNative(workspacePath);
    makeObservable<FilesStore, 'optimistic' | 'syncError' | 'viewData'>(this, {
      optimistic: observable.ref,
      syncError: observable,
      viewData: computed,
      pendingPaths: computed,
      isLoading: computed,
      error: computed,
    });
  }

  get nodes(): Map<string, RenderableFileNode> {
    return this.viewData.nodes;
  }

  get rootNodes(): RenderableFileNode[] {
    return this.viewData.rootNodes;
  }

  get childrenById(): Map<FileNodeId | null, RenderableFileNode[]> {
    return this.viewData.childrenById;
  }

  get loadedPaths(): Set<string> {
    return this.viewData.loadedPaths;
  }

  get pendingPaths(): Set<string> {
    return this.pendingPathSet;
  }

  get isLoading(): boolean {
    if (this.syncError !== null) return false;
    if (this.optimistic === null) return true;
    return this.tree?.entries['']?.childrenLoaded !== true;
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
    const optimistic = await this.requireOptimistic();
    await optimistic.refreshState('tree');
  }

  dispose(): void {
    this.started = false;
    this.bindVersion += 1;
    this.pendingUploadNodes.clear();
    this.pendingPathSet.clear();
    this.disposeRuntime();
  }

  setExclusions(patterns: readonly string[] | undefined): void {
    const next = canonicalExclusionPatterns(patterns ?? DEFAULT_TREE_EXCLUDE);
    this.exclusionsLoaded = true;
    if (this.exclusions.join('\0') === next.join('\0')) return;
    this.exclusions = next;
    if (!this.started) return;
    this.bindVersion += 1;
    this.disposeRuntime();
    this.startPromise = this.bindRuntime(this.bindVersion);
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
    const optimistic = await this.requireOptimistic();
    const absolute = this.resolveWorkspacePath(dirPath);
    if (this.pendingPathSet.has(absolute)) return;
    if (!force && this.loadedPaths.has(absolute)) return;
    runInAction(() => this.pendingPathSet.add(absolute));
    try {
      if (force) await optimistic.refreshState('tree');
      const invocation = await optimistic.mutations.expand({ path: this.relative(absolute) });
      if (invocation.result.success) await invocation.settled;
    } finally {
      runInAction(() => this.pendingPathSet.delete(absolute));
    }
  }

  async revealFile(filePath: string): Promise<Result<string[], TreeMutationError>> {
    try {
      const optimistic = await this.requireOptimistic();
      const absolute = this.resolveWorkspacePath(filePath);
      const relative = this.relative(absolute);
      const invocation = await optimistic.mutations.reveal({ path: relative });
      if (!invocation.result.success) {
        return invocation.result;
      }
      await invocation.settled;
      const segments = relative.split('/').filter(Boolean);
      const ancestors: string[] = [];
      for (let index = 1; index < segments.length; index += 1) {
        ancestors.push(this.absolute(portablePath(segments.slice(0, index).join('/'))));
      }
      return ok(ancestors);
    } catch (error) {
      return err(treeMutationError(error));
    }
  }

  createFile(path: string): Promise<Result<void, TreeMutationError>> {
    return this.runTreeMutation((optimistic) =>
      optimistic.mutations.createFile({ path: this.relative(this.resolveWorkspacePath(path)) })
    );
  }

  createDirectory(path: string): Promise<Result<void, TreeMutationError>> {
    return this.runTreeMutation((optimistic) =>
      optimistic.mutations.createDirectory({ path: this.relative(this.resolveWorkspacePath(path)) })
    );
  }

  deleteEntry(path: string, recursive = false): Promise<Result<void, TreeMutationError>> {
    return this.runTreeMutation((optimistic) =>
      optimistic.mutations.delete({
        path: this.relative(this.resolveWorkspacePath(path)),
        recursive,
      })
    );
  }

  rename(path: string, nextName: string): Promise<Result<void, TreeMutationError>> {
    const absolute = this.resolveWorkspacePath(path);
    const parent = parentPathFromPath(absolute) ?? this.rootPath;
    const nextPath = normalizeFileTreePath(`${parent}/${nextName}`);
    return this.runTreeMutation((optimistic) =>
      optimistic.mutations.rename({
        from: this.relative(absolute),
        to: this.relative(nextPath),
      })
    );
  }

  move(
    sourcePath: string,
    targetDirPath: string,
    newName?: string
  ): Promise<Result<void, TreeMutationError>> {
    const source = this.resolveWorkspacePath(sourcePath);
    const targetDir = this.resolveWorkspacePath(targetDirPath);
    const target = normalizeFileTreePath(`${targetDir}/${newName ?? basenameFromPath(source)}`);
    return this.runTreeMutation((optimistic) =>
      optimistic.mutations.move({
        from: this.relative(source),
        to: this.relative(target),
      })
    );
  }

  copy(
    sourcePath: string,
    targetDirPath: string,
    newName?: string
  ): Promise<Result<void, TreeMutationError>> {
    const source = this.resolveWorkspacePath(sourcePath);
    const targetDir = this.resolveWorkspacePath(targetDirPath);
    const target = normalizeFileTreePath(`${targetDir}/${newName ?? basenameFromPath(source)}`);
    return this.runTreeMutation((optimistic) =>
      optimistic.mutations.copy({
        from: this.relative(source),
        to: this.relative(target),
      })
    );
  }

  refresh(): Promise<Result<void, TreeMutationError>> {
    return this.runTreeMutation((optimistic) => optimistic.mutations.refresh(undefined));
  }

  addOptimisticNodes(nodes: Array<{ path: string; type: 'file' | 'directory' }>): string[] {
    const inserted: string[] = [];
    runInAction(() => {
      for (const candidate of nodes) {
        const absolute = this.resolveWorkspacePath(candidate.path);
        if (this.viewData.nodes.has(absolute) || this.pendingUploadNodeForPath(absolute)) continue;
        const parentPath = parentPathFromPath(absolute) ?? this.rootPath;
        if (!this.viewData.loadedPaths.has(parentPath)) continue;
        const parentId =
          parentPath === this.rootPath ? null : this.viewData.pathToId.get(parentPath);
        if (parentPath !== this.rootPath && parentId === undefined) continue;
        const name = basenameFromPath(absolute);
        const id = `pending-upload:${this.nextPendingUploadId++}`;
        this.pendingUploadNodes.set(id, {
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
    });
    return inserted;
  }

  confirmOptimisticNodes(_paths: string[]): void {
    // Uploads are procedure-based, so the pending node remains until the watcher-backed tree
    // contains the authoritative path. The computed view filters resolved pending uploads out.
  }

  removeNode(path: string): void {
    const id = this.pendingUploadNodeForPath(this.resolveWorkspacePath(path));
    if (id) runInAction(() => this.pendingUploadNodes.delete(id));
  }

  private get tree(): EditorFileTreeModel | null {
    return this.optimistic?.values.tree ?? null;
  }

  private get viewData(): ViewData {
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
    for (const { node } of this.pendingUploadNodes.values()) {
      if (nodes.has(node.path)) continue;
      const parentPath = parentPathFromPath(node.path) ?? this.rootPath;
      if (!loadedPaths.has(parentPath)) continue;
      nodes.set(node.path, node);
      pathToId.set(node.path, node.id);
      pushChild(childrenById, node);
    }
    for (const [parentId, children] of childrenById) {
      childrenById.set(parentId, sortFileNodes(children));
    }
    return {
      nodes,
      childrenById,
      loadedPaths,
      pathToId,
      rootNodes: childrenById.get(null) ?? [],
    };
  }

  private ensureStarted(): Promise<void> {
    this.startPromise ??= this.bindRuntime(this.bindVersion);
    return this.startPromise;
  }

  private async requireOptimistic(): Promise<OptimisticLiveModel<TreeModel>> {
    await this.ensureStarted();
    if (!this.optimistic) throw new Error(this.syncError ?? 'File tree is unavailable');
    return this.optimistic;
  }

  private async bindRuntime(version: number): Promise<void> {
    try {
      // Before the first bind, fetch the settings snapshot so we start with the
      // user's treeExclude rather than defaults. This eliminates the double-bind
      // that would otherwise occur when EditorFileTree calls setExclusions shortly
      // after construction.
      if (!this.exclusionsLoaded) {
        try {
          const meta = await fetchAppSettingsMeta('files');
          const patterns = meta?.value?.treeExclude;
          if (patterns) {
            const canonical = canonicalExclusionPatterns(patterns);
            this.exclusionsLoaded = true;
            this.exclusions = canonical;
          }
        } catch {
          // Fall back to defaults on any error (e.g. settings not yet loaded).
        }
        if (!this.started || version !== this.bindVersion) return;
      }

      const client = await getEditorClient();
      const replica = createLiveModelReplica(editorContract.tree.model, client.tree.model);
      const optimistic = new OptimisticLiveModel(
        editorContract.tree.model,
        {
          workspaceId: this.workspaceId,
          sessionId: this.workspaceId,
          exclusions: this.exclusions, // already canonical
        },
        replica
      );
      await optimistic.ready;
      if (!this.started || version !== this.bindVersion) {
        await optimistic.dispose();
        await replica.dispose();
        return;
      }
      runInAction(() => {
        this.replica = replica;
        this.optimistic = optimistic;
        this.syncError = null;
      });
      const expanded = await optimistic.mutations.expand({ path: portablePath('') });
      if (expanded.result.success) await expanded.settled;
      else this.setError(expanded.result.error);
    } catch (error) {
      if (version !== this.bindVersion) return;
      runInAction(() => {
        this.syncError = error instanceof Error ? error.message : String(error);
      });
    }
  }

  private async runTreeMutation(
    run: (optimistic: OptimisticLiveModel<TreeModel>) => Promise<{
      result: Result<unknown, TreeMutationError>;
      settled: Promise<void>;
    }>
  ): Promise<Result<void, TreeMutationError>> {
    try {
      const optimistic = await this.requireOptimistic();
      const invocation = await run(optimistic);
      if (!invocation.result.success) {
        return invocation.result;
      }
      await invocation.settled;
      return ok<void>();
    } catch (error) {
      return err(treeMutationError(error));
    }
  }

  private pendingUploadNodeForPath(path: string): FileNodeId | undefined {
    for (const [id, pending] of this.pendingUploadNodes) {
      if (pending.node.path === path) return id;
    }
    return undefined;
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

  private disposeRuntime(): void {
    const optimistic = this.optimistic;
    const replica = this.replica;
    runInAction(() => {
      this.optimistic = null;
      this.replica = null;
      this.syncError = null;
      this.startPromise = null;
    });
    void (async () => {
      try {
        await optimistic?.dispose();
      } finally {
        await replica?.dispose();
      }
    })();
  }
}

function treeMutationError(error: unknown): TreeMutationError {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('Unknown procedure')) {
    return { type: 'unavailable', message: protocolUpgradeMessage('upgrade-server') };
  }
  return { type: 'unavailable', message };
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
