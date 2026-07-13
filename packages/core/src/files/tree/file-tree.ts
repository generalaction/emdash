import path from 'node:path';
import { err, ok, type Result, type Unsubscribe } from '@emdash/shared';
import { KeyedMutex, LiveCollection, type KeyedOp } from '../../lib';
import type { IWatchService, WatchEvent, WatchHandle } from '../../services/fs-watch/api';
import { createRootPathPolicy, type RootPathPolicy } from '../path-policy';
import { createTreeDirectoryReader, type TreeDirectoryReader } from './directory-reader';
import { classifyFileTreeFsError, type FileTreeError, type FileTreeOnError } from './errors';
import { probeDirectoryWithReader } from './list';
import {
  isExpandableFileNode,
  type DirectoryPreview,
  type FileNode,
  type NodeId,
} from './models/tree';
import { FileTreeStore, type FileTreeStoreRemoval } from './tree-store';
import type {
  FileTreeSequences,
  FileTreeSnapshot,
  FileTreeUpdate,
  IFileTree,
  SubscribedSnapshot,
} from './types';
import { classifyFileTreeWatchEvents } from './watch/classifier';

const WATCH_DEBOUNCE_MS = 100;
const REVALIDATE_INTERVAL_MS = 5 * 60_000;

export type FileTreeOptions = {
  rootPath: string;
  watcher: IWatchService;
  onError?: FileTreeOnError;
};

export class FileTree implements IFileTree {
  readonly rootPath: string;
  private readonly collection = new LiveCollection<NodeId, FileNode, FileTreeError>({
    scopeOf: (node) => node.parentId,
  });
  private readonly store = new FileTreeStore();
  private readonly pathPolicy: RootPathPolicy;
  private readonly directoryReader: TreeDirectoryReader;
  private readonly onError: FileTreeOnError;
  private readonly mutationMutex = new KeyedMutex();
  private readonly revalidateTimer: ReturnType<typeof setInterval> | null;
  private readonly watch: WatchHandle;
  private readonly scopeLoads = new Map<
    NodeId | null,
    Promise<Result<FileTreeSequences, FileTreeError>>
  >();
  private disposed = false;
  private readyPromise: Promise<Result<void, FileTreeError>> | null = null;

  constructor(options: FileTreeOptions) {
    this.rootPath = path.resolve(options.rootPath);
    const policy = createRootPathPolicy(this.rootPath);
    if (!policy.success) throw new Error(policy.error.message);
    this.pathPolicy = policy.data;
    this.directoryReader = createTreeDirectoryReader(this.pathPolicy);
    this.onError = options.onError ?? (() => {});
    this.watch = options.watcher.watch(
      this.rootPath,
      (events) => {
        void this.runMutation(() => this.applyWatchEvents(events)).catch((error) =>
          this.onError(`file-tree watch ${this.rootPath}`, error)
        );
      },
      {
        debounceMs: WATCH_DEBOUNCE_MS,
        onResync: () => {
          void this.runMutation(() => this.resync()).catch((error) =>
            this.onError(`file-tree resync ${this.rootPath}`, error)
          );
        },
      }
    );
    const interval = REVALIDATE_INTERVAL_MS;
    this.revalidateTimer =
      interval > 0
        ? setInterval(() => {
            if (this.collection.subscriberCount === 0) return;
            void this.runMutation(() => {
              if (this.disposed || this.collection.subscriberCount === 0) {
                return Promise.resolve(ok<FileTreeSequences>({}));
              }
              return this.refreshRegisteredScopes();
            }).then(
              (result) => {
                if (!result.success)
                  this.onError(`file-tree refresh ${this.rootPath}`, result.error);
              },
              (error) => this.onError(`file-tree refresh ${this.rootPath}`, error)
            );
          }, interval)
        : null;
  }

  async ready(): Promise<Result<void, FileTreeError>> {
    if (this.readyPromise) return this.readyPromise;

    const readyPromise = (async (): Promise<Result<void, FileTreeError>> => {
      try {
        await this.watch.ready();
      } catch (error) {
        return err(classifyFileTreeFsError(error, ''));
      }
      const loaded = await this.runMutation(() => this.loadDirectoryScope(null));
      if (!loaded.success) return err(loaded.error);
      return ok<void>();
    })().catch((error): Result<void, FileTreeError> => {
      if (this.readyPromise === readyPromise) {
        this.readyPromise = null;
      }
      throw error;
    });
    this.readyPromise = readyPromise;
    return readyPromise;
  }

  async getSnapshot(): Promise<Result<FileTreeSnapshot, FileTreeError>> {
    const ready = await this.ready();
    if (!ready.success) return err(ready.error);
    return ok(this.collection.getCached());
  }

  subscribe(cb: (update: FileTreeUpdate) => void): Unsubscribe {
    return this.collection.subscribe(cb);
  }

  async subscribeWithSnapshot(
    cb: (update: FileTreeUpdate) => void
  ): Promise<Result<SubscribedSnapshot<FileTreeSnapshot>, FileTreeError>> {
    const unsubscribe = this.subscribe(cb);
    const snapshot = await this.getSnapshot();
    if (!snapshot.success) {
      unsubscribe();
      return err(snapshot.error);
    }
    return ok({ snapshot: snapshot.data, unsubscribe });
  }

  async refresh(): Promise<Result<FileTreeSnapshot, FileTreeError>> {
    return this.runMutation(async () => {
      const refreshed = await this.refreshRegisteredScopes();
      if (!refreshed.success) return err(refreshed.error);
      return ok(this.collection.getCached());
    });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    if (this.revalidateTimer) clearInterval(this.revalidateTimer);
    await this.watch.release();
    this.collection.dispose();
  }

  async registerDir(dirId: NodeId | null): Promise<Result<FileTreeSequences, FileTreeError>> {
    const ready = await this.ready();
    if (!ready.success) return err(ready.error);
    return this.runMutation(() =>
      this.collection.isScopeLoaded(dirId)
        ? Promise.resolve(ok<FileTreeSequences>({}))
        : this.loadDirectoryScope(dirId)
    );
  }

  async unregisterDir(dirId: NodeId | null): Promise<Result<FileTreeSequences, FileTreeError>> {
    const ready = await this.ready();
    if (!ready.success) return err(ready.error);
    return this.runMutation(() => Promise.resolve(this.unloadScopeUnlessRoot(dirId)));
  }

  private unloadScopeUnlessRoot(scope: NodeId | null): Result<FileTreeSequences, FileTreeError> {
    // Root stays pinned for the tree's lifetime; everything else unloads on unregister.
    if (scope === null) return ok({});
    let sequence = this.collection.unloadScope(scope);
    sequence = Math.max(sequence, this.collectGarbage());
    return ok(sequence === 0 ? {} : { tree: sequence });
  }

  private collectGarbage(): number {
    const loaded = new Set<NodeId | null>(this.collection.loadedScopes());
    return this.applyRemoval(this.store.pruneToReachable(loaded));
  }

  async revealPath(pathToReveal: string): Promise<Result<FileTreeSequences, FileTreeError>> {
    const ready = await this.ready();
    if (!ready.success) return err(ready.error);
    return this.runMutation(async () => {
      const relativeParts = this.pathPolicy.relativeParts(pathToReveal);
      if (!relativeParts.success) return err(relativeParts.error);
      const parts = relativeParts.data;
      let sequences: FileTreeSequences = {};
      for (let index = 0; index < parts.length; index += 1) {
        const absPath = path.join(this.rootPath, ...parts.slice(0, index + 1));
        const node = this.store.getByPath(absPath);
        if (!node) return err({ type: 'not-found', path: absPath });
        const shouldExpand = index < parts.length - 1 || isExpandableFileNode(node);
        if (!shouldExpand) continue;
        if (!isExpandableFileNode(node)) {
          return err({ type: 'not-directory', id: node.id, path: node.path });
        }
        const expanded = await this.loadDirectoryScope(node.id);
        if (!expanded.success) return expanded;
        sequences = mergeSequences(sequences, expanded.data);
      }
      return ok(sequences);
    });
  }

  private async refreshRegisteredScopes(): Promise<Result<FileTreeSequences, FileTreeError>> {
    const scopes = this.collection.loadedScopes();
    let sequences: FileTreeSequences = {};
    for (const scope of scopes) {
      if (scope !== null && !this.store.get(scope)) continue;
      const refreshed = await this.loadDirectoryScope(scope);
      if (!refreshed.success) {
        const recovered = this.recoverMissingLoadedScope(scope, refreshed.error);
        if (!recovered.success) return err(recovered.error);
        sequences = mergeSequences(sequences, recovered.data);
        continue;
      }
      sequences = mergeSequences(sequences, refreshed.data);
    }
    return ok(sequences);
  }

  private async loadDirectoryScope(
    scope: NodeId | null
  ): Promise<Result<FileTreeSequences, FileTreeError>> {
    const existing = this.scopeLoads.get(scope);
    if (existing) return existing;

    const loading = this.loadDirectoryScopeInternal(scope);
    this.scopeLoads.set(scope, loading);
    const clearLoading = () => {
      if (this.scopeLoads.get(scope) === loading) this.scopeLoads.delete(scope);
    };
    void loading.then(clearLoading, clearLoading);
    return loading;
  }

  private async loadDirectoryScopeInternal(
    scope: NodeId | null
  ): Promise<Result<FileTreeSequences, FileTreeError>> {
    const dirNode = scope === null ? null : this.store.get(scope);
    if (scope !== null && !dirNode) return err({ type: 'not-found', id: scope });
    if (dirNode && !isExpandableFileNode(dirNode)) {
      return err({ type: 'not-directory', id: dirNode.id, path: dirNode.path });
    }

    const dirPath = dirNode?.path ?? this.rootPath;
    const listed = await this.directoryReader.readChildren(dirPath, {
      includeDevIno: !this.store.isUnderSymlinkTraversal(scope),
      sort: true,
    });
    if (!listed.success) return listed;
    if (this.disposed) return ok({});
    const listedEntries = listed.data.kind === 'entries' ? listed.data.entries : [];

    const listedPaths = new Set(listedEntries.map((entry) => entry.path));
    let sequence = this.removeMissingChildren(scope, listedPaths);

    const nodes = await Promise.all(
      listedEntries.map(async (entry) => {
        const node = this.store.upsert(
          entry,
          scope,
          this.store.getByPath(entry.path)?.childrenLoaded
        );
        if (entry.type !== 'directory') return node;
        const probe = await probeDirectoryWithReader(this.directoryReader, entry.path);
        const annotated: FileNode = {
          ...node,
          directoryPreview: {
            childCount: probe.childCount,
            singleChildDirectoryChain: probe.singleChildDirectoryChain,
          },
        };
        this.store.setNode(annotated);
        return annotated;
      })
    );
    if (this.disposed) return ok({});
    const loaded = await this.collection.loadScope(scope, async () =>
      ok(nodes.map((node) => [node.id, node] as const))
    );
    if (!loaded.success) return loaded;
    if (this.disposed) return ok({});
    sequence = Math.max(sequence, loaded.data);

    if (dirNode && !dirNode.childrenLoaded) {
      const updated = { ...dirNode, childrenLoaded: true };
      this.store.setNode(updated);
      sequence = Math.max(sequence, this.collection.put(updated.id, updated));
    }

    return ok(sequence === 0 ? {} : { tree: sequence });
  }

  private removeMissingChildren(parentId: NodeId | null, listedPaths: Set<string>): number {
    return this.applyRemoval(this.store.removeMissingChildren(parentId, listedPaths));
  }

  private removeSubtrees(rootIds: NodeId[]): number {
    return this.applyRemoval(this.store.removeSubtrees(rootIds));
  }

  private applyRemoval(removal: FileTreeStoreRemoval): number {
    if (removal.ops.length === 0 && removal.unloadedScopes.length === 0) return 0;
    let sequence = this.collection.apply(removal.ops);
    for (const scope of removal.unloadedScopes) {
      sequence = Math.max(sequence, this.collection.unloadScope(scope));
    }
    return sequence;
  }

  private recoverMissingLoadedScope(
    scope: NodeId | null,
    error: FileTreeError
  ): Result<FileTreeSequences, FileTreeError> {
    if (scope === null || (error.type !== 'not-found' && error.type !== 'not-directory')) {
      return err(error);
    }

    const sequence = this.removeSubtrees([scope]);
    return ok(sequence === 0 ? {} : { tree: sequence });
  }

  private async applyWatchEvents(events: WatchEvent[]): Promise<void> {
    if (this.disposed) return;
    const classification = await classifyFileTreeWatchEvents(events, {
      pathPolicy: this.pathPolicy,
      directoryReader: this.directoryReader,
      store: this.store,
      isScopeLoaded: (scope) => this.collection.isScopeLoaded(scope),
    });
    this.collection.apply(classification.ops);
    for (const scope of classification.unloadedScopes) this.collection.unloadScope(scope);
    await this.reannotateCompaction(events, classification.ops);
  }

  private async reannotateCompaction(
    events: WatchEvent[],
    ops: Array<KeyedOp<NodeId, FileNode>>
  ): Promise<void> {
    const targets = new Set<NodeId>();
    for (const op of ops) {
      if (op.op === 'put' && op.value.type === 'directory') targets.add(op.value.id);
    }
    for (const event of events) {
      if (event.kind === 'update') continue;
      const head = this.nearestTrackedDir(event.path);
      if (head !== undefined) targets.add(head);
    }
    if (targets.size === 0) return;

    const changeOps: Array<KeyedOp<NodeId, FileNode>> = [];
    for (const id of targets) {
      const node = this.store.get(id);
      if (!node || node.type !== 'directory') continue;
      const probe = await probeDirectoryWithReader(this.directoryReader, node.path);
      const nextPreview: DirectoryPreview = {
        childCount: probe.childCount,
        singleChildDirectoryChain: probe.singleChildDirectoryChain,
      };
      if (directoryPreviewsEqual(node.directoryPreview, nextPreview)) {
        continue;
      }
      const updated: FileNode = {
        ...node,
        directoryPreview: nextPreview,
      };
      this.store.setNode(updated);
      changeOps.push({ op: 'put', key: id, value: updated });
    }
    if (changeOps.length > 0) this.collection.apply(changeOps);
  }

  private nearestTrackedDir(eventPath: string): NodeId | undefined {
    const absPath = this.pathPolicy.absoluteFromWatchEvent(eventPath);
    if (!absPath) return undefined;
    let current = path.dirname(absPath);
    while (current !== this.rootPath && this.pathPolicy.contains(current)) {
      const node = this.store.getByPath(current);
      if (node && isExpandableFileNode(node)) return node.id;
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return undefined;
  }

  private async resync(): Promise<void> {
    if (this.disposed) return;
    const refreshed = await this.refreshRegisteredScopes();
    if (!refreshed.success) {
      this.onError(`file-tree resync ${this.rootPath}`, refreshed.error);
      return;
    }
    this.collection.resetWithNewGeneration(
      this.store.entries().map((node) => [node.id, node] as const)
    );
  }

  private runMutation<T>(fn: () => Promise<T>): Promise<T> {
    return this.mutationMutex.runExclusive('tree', fn);
  }
}

function mergeSequences(left: FileTreeSequences, right: FileTreeSequences): FileTreeSequences {
  return { tree: Math.max(left.tree ?? 0, right.tree ?? 0) || undefined };
}

function directoryPreviewsEqual(
  left: DirectoryPreview | undefined,
  right: DirectoryPreview | undefined
): boolean {
  if (!left || !right) return left === right;
  if (left.childCount !== right.childCount) return false;
  const a = left.singleChildDirectoryChain;
  const b = right.singleChildDirectoryChain;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index].path !== b[index].path || a[index].name !== b[index].name) return false;
  }
  return true;
}
