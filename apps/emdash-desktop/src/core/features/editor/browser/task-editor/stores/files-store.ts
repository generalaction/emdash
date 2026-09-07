import {
  canonicalExclusionPatterns,
  DEFAULT_TREE_EXCLUDE,
} from '@emdash/core/primitives/exclusion-policy/api';
import type { HostRef } from '@emdash/core/primitives/host/api';
import {
  encodeResourceUri,
  hostFileRef,
  type HostAbsolutePath,
  type PortableRelativePath,
  type ResourceUri,
} from '@emdash/core/primitives/path/api';
import type { FsError } from '@emdash/core/runtimes/files/api';
import { protocolUpgradeMessage } from '@emdash/core/workspace-server';
import { err, ok, type Result } from '@emdash/shared';
import { createScope, type Scope } from '@emdash/shared/concurrency';
import {
  createRequestScheduler,
  requestPriorities,
  type RequestScheduler,
} from '@emdash/shared/requests';
import { throwIfAborted, waitWithSignal } from '@emdash/shared/scheduling';
import {
  observe,
  optimistic,
  pin,
  remote,
  type OptimisticView,
  type RemoteModel,
} from '@emdash/wire/state';
import { computed, makeObservable, observable, reaction, runInAction } from 'mobx';
import {
  buildFileTreeVisibleRows,
  isExpandableFileTreeNode,
  normalizeFileTreePath,
  sortFileNodes,
  toRenderableFileNode,
  type FileNodeId,
  type RenderableFileNode,
} from '@core/features/editor/api/browser/file-tree/tree-utils';
import { filesWireContract, type FilesTreeModel } from '@core/features/files/api';
import { getFilesClient, type FilesClient } from '@core/features/files/api/browser/client';
import {
  classifyLiveRuntimeObservation,
  type LiveRuntimeObservation,
} from '@core/features/projects/api/browser/live-runtime-observation';
import type { ProjectHostAccess } from '@core/features/projects/api/browser/stores/project-context';
import { fetchAppSettingsMeta } from '@core/features/settings/api/browser/app-settings-client';
import {
  absoluteRuntimePath,
  hostFileRefFromNativePath,
  hostPathFromNative,
  nativePathFromHost,
  portablePath,
  relativePathWithin,
  resolveRelativePath,
} from '@core/primitives/desktop-runtime/api';

type TreeModel = typeof filesWireContract.tree.model;
type TreeRemote = RemoteModel<TreeModel>;
type TreeRemoteMember = ReturnType<TreeRemote>;
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
type DirectoryLoadPriority = 'foreground' | 'background';
type ViewData = {
  nodes: Map<string, RenderableFileNode>;
  rootNodes: RenderableFileNode[];
  childrenById: Map<FileNodeId | null, RenderableFileNode[]>;
  loadedPaths: Set<string>;
  pathToId: Map<string, FileNodeId>;
};

export class FilesStore {
  private readonly root: HostAbsolutePath;
  private readonly host: HostRef;
  /** The workspace root's serialized identity — the scope key for buffer restore and the tree. */
  readonly rootUri: ResourceUri;
  private treeRemote: TreeRemote | null = null;
  private treeModel: TreeRemoteMember | null = null;
  private treeScope: Scope | null = null;
  private optimistic: OptimisticView<FilesTreeModel> | null = null;
  private treeData: FilesTreeModel | null = null;
  private startPromise: Promise<void> | null = null;
  private started = false;
  private syncError: string | null = null;
  private bindVersion = 0;
  private exclusions = canonicalExclusionPatterns(DEFAULT_TREE_EXCLUDE);
  private exclusionsLoaded = false;
  private pendingRebind = false;
  private nextPendingUploadId = 1;
  private readonly disposeHostReaction: () => void;

  private readonly pendingUploadNodes = observable.map<FileNodeId, PendingUploadNode>();
  private readonly pendingPathSet = observable.set<string>();
  private readonly directoryLoadErrors = observable.map<string, TreeMutationError>();
  private readonly forcedDirectoryLoadPaths = new Set<string>();
  private treeHydrationScheduler: RequestScheduler | null = null;
  private treeHydrationAbort: AbortController | null = null;

  constructor(
    private readonly projectId: string,
    private readonly workspaceId: string,
    private readonly workspacePath: string,
    sshConnectionId?: string,
    readonly hostAccess?: ProjectHostAccess
  ) {
    // Workspace→root resolution happens here at the renderer edge (spec §2/§8):
    // the tree is keyed by the root's ResourceUri, never by workspaceId.
    const rootRef = hostFileRefFromNativePath(workspacePath, sshConnectionId);
    this.root = rootRef.path;
    this.host = rootRef.host;
    this.rootUri = encodeResourceUri(rootRef);
    makeObservable<FilesStore, 'optimistic' | 'treeData' | 'syncError' | 'viewData'>(this, {
      optimistic: observable.ref,
      treeData: observable.ref,
      syncError: observable,
      viewData: computed,
      pendingPaths: computed,
      isLoading: computed,
      error: computed,
      observation: computed,
    });
    this.disposeHostReaction = reaction(
      () => this.hostAccess?.state,
      (state) => {
        if (state === undefined || state.kind !== 'ready' || !this.started) return;
        if (this.pendingRebind) {
          this.pendingRebind = false;
          this.bindVersion += 1;
          this.disposeRuntime(true);
          void this.ensureStarted(true);
          return;
        }
        if (this.treeModel) {
          void this.refreshAfterRecovery(this.treeModel);
          return;
        }
        void this.ensureStarted(true);
      }
    );
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
    if (this.hostAccess?.liveAction.kind === 'disabled' && this.treeData === null) return false;
    if (this.syncError !== null) return false;
    if (this.directoryLoadErrors.has(this.rootPath)) return false;
    if (this.optimistic === null) return true;
    return this.tree?.entries['']?.childrenLoaded !== true;
  }

  get error(): string | undefined {
    if (this.syncError !== null) return this.syncError;
    if (this.tree?.entries['']?.childrenLoaded === true) return undefined;
    const rootError = this.directoryLoadErrors.get(this.rootPath);
    return rootError ? treeMutationErrorMessage(rootError) : undefined;
  }

  get observation(): LiveRuntimeObservation<FilesTreeModel> {
    return classifyLiveRuntimeObservation(
      this.hostAccess?.state ?? { kind: 'ready', hostGeneration: 0 },
      this.treeData ?? undefined
    );
  }

  get rootPath(): string {
    return normalizeFileTreePath(this.workspacePath);
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    if (this.hostAccess?.liveAction.kind === 'disabled') return;
    await this.ensureStarted();
  }

  async resync(): Promise<void> {
    const model = await this.requireModel();
    await model.states.tree.refresh();
  }

  dispose(): void {
    this.disposeHostReaction();
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
    if (this.hostAccess?.liveAction.kind === 'disabled') {
      this.pendingRebind = true;
      return;
    }
    this.bindVersion += 1;
    this.disposeRuntime();
    this.startPromise = this.bindRuntime(this.bindVersion);
  }

  reconcileVisibleScopes(expandedPaths: Set<string>): void {
    const missing = new Set<string>();
    for (const expandedPath of expandedPaths) {
      const node = this.viewData.nodes.get(normalizeFileTreePath(expandedPath));
      if (node && isExpandableFileTreeNode(node) && !this.loadedPaths.has(node.path)) {
        missing.add(node.path);
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
        missing.add(row.node.path);
      }
    }
    for (const path of [...missing].sort(compareDirectoryDepth)) {
      void this.requestDirectoryLoad(path, 'background');
    }
  }

  registerDir(dirPath: string, force = false): Promise<Result<void, TreeMutationError>> {
    return this.requestDirectoryLoad(dirPath, 'foreground', force);
  }

  async revealFile(
    filePath: string,
    options: { signal?: AbortSignal } = {}
  ): Promise<Result<string[], TreeMutationError>> {
    try {
      const model = await this.requireModel();
      throwIfAborted(options.signal, 'File reveal cancelled');
      const scheduler = this.treeHydrationScheduler;
      const abort = this.treeHydrationAbort;
      if (!scheduler || !abort || abort.signal.aborted) {
        return err({ type: 'unavailable', message: 'File tree is unavailable' });
      }
      const absolute = this.resolveWorkspacePath(filePath);
      const waiterSignal = options.signal
        ? AbortSignal.any([abort.signal, options.signal])
        : abort.signal;
      return await scheduler.submit(
        {
          key: `reveal:${absolute}`,
          priority: requestPriorities.interactive,
          run: (signal) => this.performFileReveal(model, absolute, signal),
        },
        { signal: waiterSignal }
      );
    } catch (error) {
      return err(treeMutationError(error));
    }
  }

  createFile(path: string): Promise<Result<void, TreeMutationError>> {
    return this.runFsMutation((client) => client.fs.createFile({ uri: this.uriFor(path) }));
  }

  createDirectory(path: string): Promise<Result<void, TreeMutationError>> {
    return this.runFsMutation((client) => client.fs.createDirectory({ uri: this.uriFor(path) }));
  }

  deleteEntry(path: string, recursive = false): Promise<Result<void, TreeMutationError>> {
    return this.runFsMutation((client) => client.fs.delete({ uri: this.uriFor(path), recursive }));
  }

  rename(path: string, nextName: string): Promise<Result<void, TreeMutationError>> {
    const absolute = this.resolveWorkspacePath(path);
    const parent = parentPathFromPath(absolute) ?? this.rootPath;
    const nextPath = normalizeFileTreePath(`${parent}/${nextName}`);
    return this.runFsMutation((client) =>
      client.fs.rename({ from: this.uriFor(absolute), to: this.uriFor(nextPath) })
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
    return this.runFsMutation((client) =>
      client.fs.move({ from: this.uriFor(source), to: this.uriFor(target) })
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
    return this.runFsMutation((client) =>
      client.fs.copy({ from: this.uriFor(source), to: this.uriFor(target) })
    );
  }

  refresh(): Promise<Result<void, TreeMutationError>> {
    return this.runTreeMutation((model) => model.mutations.refresh, undefined);
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

  private get tree(): FilesTreeModel | null {
    return this.treeData;
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

  private ensureStarted(refresh = false): Promise<void> {
    this.startPromise ??= this.bindRuntime(this.bindVersion, refresh);
    return this.startPromise;
  }

  private async requireModel(): Promise<TreeRemoteMember> {
    if (this.hostAccess?.liveAction.kind === 'disabled') {
      throw new Error('Live actions are unavailable for this Project.');
    }
    await this.ensureStarted();
    if (!this.treeModel) throw new Error(this.syncError ?? 'File tree is unavailable');
    return this.treeModel;
  }

  private async refreshAfterRecovery(model: TreeRemoteMember): Promise<void> {
    try {
      await model.states.tree.refresh();
      runInAction(() => {
        this.syncError = null;
        this.directoryLoadErrors.clear();
      });
      if (this.tree?.entries['']?.childrenLoaded !== true) {
        void this.requestDirectoryLoad(this.rootPath, 'background');
      }
    } catch (error) {
      if (this.tree?.entries['']?.childrenLoaded !== true) {
        runInAction(() => this.directoryLoadErrors.set(this.rootPath, treeMutationError(error)));
      }
    }
  }

  private async bindRuntime(version: number, refresh = false): Promise<void> {
    let scope: Scope | null = null;
    let treeRemote: TreeRemote | null = null;
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

      const client = await getFilesClient();
      const runtimeScope = createScope({ label: `files-store:${this.workspaceId}` });
      scope = runtimeScope;
      treeRemote = remote(filesWireContract.tree.model, client.tree.model, {
        scope: runtimeScope,
        lingerMs: 15_000,
      });
      const model = treeRemote({
        root: this.rootUri,
        sessionId: this.workspaceId,
        exclusions: this.exclusions,
      });
      pin(runtimeScope, [model.states.tree]);
      const view = optimistic(model.states.tree);
      await new Promise<void>((resolve, reject) => {
        let resolved = false;
        observe(
          view,
          (current) => {
            runInAction(() => {
              if (current.status === 'error') {
                reject(current.error);
                return;
              }
              if (!current.value) return;
              this.treeData = current.value;
              if (!resolved) {
                resolved = true;
                resolve();
              }
            });
          },
          { scope: runtimeScope }
        );
      });
      if (!this.started || version !== this.bindVersion) {
        await treeRemote.dispose();
        await scope.dispose();
        return;
      }
      const treeHydrationAbort = new AbortController();
      runtimeScope.add(() => {
        if (!treeHydrationAbort.signal.aborted) {
          treeHydrationAbort.abort(new Error('File tree runtime disposed'));
        }
      });
      const treeHydrationScheduler = createRequestScheduler({
        scope: runtimeScope,
        maxConcurrency: 1,
        label: 'tree-hydration',
      });
      runInAction(() => {
        this.treeScope = runtimeScope;
        this.treeRemote = treeRemote;
        this.treeModel = model;
        this.optimistic = view;
        this.treeHydrationAbort = treeHydrationAbort;
        this.treeHydrationScheduler = treeHydrationScheduler;
        this.syncError = null;
      });
      scope = null;
      treeRemote = null;
      if (refresh || this.tree?.entries['']?.childrenLoaded !== true) {
        void this.requestDirectoryLoad(this.rootPath, 'background', refresh);
      }
    } catch (error) {
      try {
        await treeRemote?.dispose();
      } finally {
        await scope?.dispose();
      }
      if (version !== this.bindVersion) return;
      runInAction(() => {
        this.syncError = error instanceof Error ? error.message : String(error);
      });
    }
  }

  private async runTreeMutation<Input>(
    mutation: (model: TreeRemoteMember) => (
      input: Input,
      options?: { mutationId?: string }
    ) => Promise<{
      result: Result<unknown, TreeMutationError>;
      settled: Promise<void>;
    }>,
    input: Input
  ): Promise<Result<void, TreeMutationError>> {
    try {
      const model = await this.requireModel();
      const invocation = await mutation(model)(input);
      if (!invocation.result.success) return invocation.result;
      await invocation.settled;
      return ok<void>();
    } catch (error) {
      return err(treeMutationError(error));
    }
  }

  /**
   * Stateless fs verbs keyed by the entry's ResourceUri (spec §3.4). The files
   * runtime reflects successful mutations into the live tree session at ack
   * time, so no renderer-side optimistic recipe is needed.
   */
  private async runFsMutation<T>(
    run: (client: FilesClient) => Promise<Result<T, TreeMutationError>>
  ): Promise<Result<void, TreeMutationError>> {
    if (this.hostAccess?.liveAction.kind === 'disabled') {
      return err({
        type: 'unavailable',
        message: 'Live actions are unavailable for this Project.',
      });
    }
    try {
      const client = await getFilesClient();
      const result = await run(client);
      return result.success ? ok<void>() : result;
    } catch (error) {
      return err(treeMutationError(error));
    }
  }

  private uriFor(path: string): ResourceUri {
    return encodeResourceUri(
      hostFileRef(this.host, hostPathFromNative(this.resolveWorkspacePath(path)))
    );
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

  private async performFileReveal(
    model: TreeRemoteMember,
    absolutePath: string,
    signal: AbortSignal
  ): Promise<Result<string[], TreeMutationError>> {
    try {
      throwIfAborted(signal, 'File reveal cancelled');
      const relative = this.relative(absolutePath);
      const invocation = await model.mutations.reveal({ path: relative }, { signal });
      if (!invocation.result.success) return invocation.result;
      await waitWithSignal(invocation.settled, signal, 'File reveal cancelled');
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

  private async requestDirectoryLoad(
    dirPath: string,
    priority: DirectoryLoadPriority,
    force = false
  ): Promise<Result<void, TreeMutationError>> {
    let absolute: string;
    try {
      absolute = this.resolveWorkspacePath(dirPath);
    } catch (error) {
      return Promise.resolve(err(treeMutationError(error)));
    }

    if (priority === 'foreground') {
      runInAction(() => this.directoryLoadErrors.delete(absolute));
    }
    if (!force && this.loadedPaths.has(absolute)) {
      runInAction(() => this.directoryLoadErrors.delete(absolute));
      return Promise.resolve(ok<void>());
    }
    if (priority === 'background' && this.directoryLoadErrors.has(absolute)) {
      return Promise.resolve(err(this.directoryLoadErrors.get(absolute)!));
    }

    if (!this.treeHydrationScheduler) {
      try {
        await this.ensureStarted();
      } catch (error) {
        return err(treeMutationError(error));
      }
    }
    const scheduler = this.treeHydrationScheduler;
    const abort = this.treeHydrationAbort;
    if (!scheduler || !abort || abort.signal.aborted) {
      return err({ type: 'unavailable', message: 'File tree is unavailable' });
    }

    if (force) this.forcedDirectoryLoadPaths.add(absolute);
    runInAction(() => this.pendingPathSet.add(absolute));

    try {
      const result = await scheduler.submit(
        {
          key: `directory:${absolute}`,
          priority:
            priority === 'foreground'
              ? requestPriorities.interactive
              : requestPriorities.background,
          run: (signal) => this.performDirectoryLoad(scheduler, abort, absolute, signal),
        },
        { signal: abort.signal }
      );
      if (
        force &&
        this.treeHydrationScheduler === scheduler &&
        !abort.signal.aborted &&
        this.forcedDirectoryLoadPaths.has(absolute)
      ) {
        return this.requestDirectoryLoad(absolute, 'foreground', true);
      }
      return result;
    } catch (error) {
      return err(treeMutationError(error));
    }
  }

  private async performDirectoryLoad(
    scheduler: RequestScheduler,
    abort: AbortController,
    path: string,
    signal: AbortSignal
  ): Promise<Result<void, TreeMutationError>> {
    const force = this.forcedDirectoryLoadPaths.delete(path);
    let result: Result<void, TreeMutationError>;
    try {
      const model = this.treeModel ?? (await this.requireModel());
      throwIfAborted(signal, 'Directory load cancelled');
      if (!force && this.loadedPaths.has(path)) {
        result = ok<void>();
      } else {
        if (force) {
          await model.states.tree.refresh();
          throwIfAborted(signal, 'Directory load cancelled');
        }
        const invocation = await model.mutations.expand({ path: this.relative(path) }, { signal });
        if (!invocation.result.success) {
          result = invocation.result;
        } else {
          await waitWithSignal(invocation.settled, signal, 'Directory load cancelled');
          result = ok<void>();
        }
      }
    } catch (error) {
      result = err(treeMutationError(error));
    }
    if (this.treeHydrationScheduler === scheduler && !abort.signal.aborted) {
      runInAction(() => {
        if (result.success) this.directoryLoadErrors.delete(path);
        else this.directoryLoadErrors.set(path, result.error);
        if (!this.forcedDirectoryLoadPaths.has(path)) this.pendingPathSet.delete(path);
      });
    }
    return result;
  }

  private cancelTreeHydration(): void {
    const scheduler = this.treeHydrationScheduler;
    const abort = this.treeHydrationAbort;
    this.treeHydrationScheduler = null;
    this.treeHydrationAbort = null;
    if (abort && !abort.signal.aborted) {
      abort.abort(new Error('File tree is unavailable'));
    }
    void scheduler?.dispose();
    this.forcedDirectoryLoadPaths.clear();
    runInAction(() => {
      this.pendingPathSet.clear();
      this.directoryLoadErrors.clear();
    });
  }

  private disposeRuntime(preserveData = false): void {
    const remote = this.treeRemote;
    const scope = this.treeScope;
    this.cancelTreeHydration();
    runInAction(() => {
      this.optimistic = null;
      if (!preserveData) this.treeData = null;
      this.treeModel = null;
      this.treeRemote = null;
      this.treeScope = null;
      this.syncError = null;
      this.startPromise = null;
    });
    void (async () => {
      try {
        await remote?.dispose();
      } finally {
        await scope?.dispose();
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

function treeMutationErrorMessage(error: TreeMutationError): string {
  if ('message' in error && error.message) return error.message;
  if ('path' in error && error.path) return `${error.type}: ${error.path}`;
  return error.type;
}

function compareDirectoryDepth(left: string, right: string): number {
  const depth = (path: string) => path.split('/').filter(Boolean).length;
  return depth(left) - depth(right) || left.localeCompare(right);
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
