import path from 'node:path';
import {
  type FileChange,
  type FileChangeSubscription,
  type FileChangeUpdate,
  type FileChangeWatchOptions,
  type FileEntryType,
  type FileError,
  type FileNode,
  type FileTreeError,
  type FileTreeLease,
  type FileTreeSequences,
  type FileTreeSnapshot,
  type FileTreeUpdate,
  type IFileSystem,
  type IFileTree,
  type NodeId,
  type SubscribedSnapshot,
} from '@emdash/core/files';
import { LiveCollection, ResourceMap, type KeyedOp } from '@emdash/core/lib';
import { err, ok, type Result, type Unsubscribe } from '@emdash/shared';
import type { ClientChannel } from 'ssh2';
import type { IFilesRuntime } from '@main/core/runtime/types';
import { buildRemoteShellCommand } from '@main/core/ssh/lifecycle/remote-shell-profile';
import type { SshClientProxy } from '@main/core/ssh/lifecycle/ssh-client-proxy';
import { log } from '@main/lib/logger';
import { quoteShellArg } from '@main/utils/shellEscape';
import type { FileWatchEvent } from '@shared/core/fs/fs';
import { LegacySshFileSystem } from './ssh-file-system';
import { SshFileSystem } from './ssh-legacy-fs';
import { FileSystemError, FileSystemErrorCodes } from './ssh-legacy-fs-types';
import type { FileEntry } from './ssh-legacy-fs-types';
import {
  containsRemotePath,
  isIgnoredRemotePath,
  normalizeRemoteAbsolutePath,
  normalizeRemoteRootPath,
  toRemoteAbsolutePath,
} from './ssh-paths';
import { buildFindPruneExpression } from './ssh-remote-enumerate';

const SSH_FILE_TREE_POLL_MS = 4_000;
const SSH_FILE_CHANGE_POLL_MS = 4_000;

type LegacyListedEntry = {
  path: string;
  name: string;
  type: 'file' | 'directory';
};

type ChangeFeedHandle = {
  close(): void;
};

type LegacySshSnapshotEntry = {
  entryType: Exclude<FileEntryType, 'unknown'>;
  size: string;
  mtime: string;
};

/**
 * Transitional SSH file-domain adapter.
 *
 * It preserves the existing SFTP-backed tree listing and path-scoped polling
 * behavior until the core runtime can run inside the remote workspace server.
 */
export class LegacySshFilesRuntime implements IFilesRuntime {
  readonly path: IFilesRuntime['path'] = posixMachinePath;

  private readonly trees: ResourceMap<LegacySshFileTree>;
  private readonly changeFeeds = new Set<ChangeFeedHandle>();
  private disposeRequested = false;

  constructor(private readonly proxy: SshClientProxy) {
    this.trees = new ResourceMap<LegacySshFileTree>({
      teardown: (_rootPath, tree) => tree.dispose(),
      onError: (context, error) =>
        log.warn('LegacySshFilesRuntime: teardown failed', {
          context,
          error: String(error),
        }),
    });
  }

  async openTree(rootPath: string): Promise<Result<FileTreeLease, FileTreeError>> {
    const normalizedRoot = normalizeRemoteAbsolutePath(rootPath);
    if (!normalizedRoot.success) return err(normalizedRoot.error);
    if (this.disposeRequested) {
      return err({
        type: 'fs-error',
        path: normalizedRoot.data,
        message: 'LegacySshFilesRuntime disposed',
      });
    }

    const lease = await this.trees.acquire(normalizedRoot.data, async () => {
      return new LegacySshFileTree(this.proxy, normalizedRoot.data, (context, error) =>
        log.warn('LegacySshFilesRuntime: background error', {
          context,
          error: String(error),
        })
      );
    });

    try {
      const ready = await lease.value.ready();
      if (!ready.success) {
        await lease.release();
        return err(ready.error);
      }
      return ok(lease);
    } catch (error) {
      await lease.release();
      throw error;
    }
  }

  fileSystem(): Result<IFileSystem, FileError> {
    if (this.disposeRequested) {
      return err({
        type: 'fs-error',
        path: '',
        message: 'LegacySshFilesRuntime disposed',
      });
    }
    return ok(new LegacySshFileSystem(this.proxy));
  }

  async copyFile(src: string, dest: string): Promise<Result<void, FileError>> {
    const sourcePath = normalizeRemoteAbsolutePath(src);
    if (!sourcePath.success) return sourcePath;
    const destPath = normalizeRemoteAbsolutePath(dest);
    if (!destPath.success) return destPath;

    if (this.disposeRequested) {
      return err({
        type: 'fs-error',
        path: destPath.data,
        message: 'LegacySshFilesRuntime disposed',
      });
    }

    try {
      const destParent = path.posix.dirname(destPath.data);
      const result = await execRemoteBuffer(
        this.proxy,
        [
          `mkdir -p ${quoteShellArg(destParent)}`,
          `cp -p ${quoteShellArg(sourcePath.data)} ${quoteShellArg(destPath.data)}`,
        ].join(' && ')
      );
      if (result.exitCode !== 0) {
        return err({
          type: 'fs-error',
          path: destPath.data,
          message: result.stderr || `Remote copy exited with code ${result.exitCode}`,
        });
      }
      return ok<void>();
    } catch (error) {
      return err(toFileError(error, destPath.data));
    }
  }

  watchChanges(
    rootPath: string,
    cb: (update: FileChangeUpdate) => void,
    options: FileChangeWatchOptions = {}
  ): Result<FileChangeSubscription, FileError> {
    const normalizedRoot = normalizeRemoteAbsolutePath(rootPath);
    if (!normalizedRoot.success) return normalizedRoot;
    if (this.disposeRequested) {
      return err({
        type: 'fs-error',
        path: normalizedRoot.data,
        message: 'LegacySshFilesRuntime disposed',
      });
    }

    const paths = normalizeWatchedPaths(normalizedRoot.data, options.paths);
    if (!paths.success) return paths;

    if (watchesWholeRoot(normalizedRoot.data, paths.data)) {
      const feed = new LegacySshRecursiveChangeFeed(
        this.proxy,
        normalizedRoot.data,
        cb,
        (context, error) =>
          log.warn('LegacySshFilesRuntime: background error', {
            context,
            error: String(error),
          }),
        options.debounceMs ?? SSH_FILE_CHANGE_POLL_MS
      );
      this.changeFeeds.add(feed);

      let unsubscribed = false;
      const unsubscribe = () => {
        if (unsubscribed) return;
        unsubscribed = true;
        this.changeFeeds.delete(feed);
        feed.close();
      };

      return ok({
        ready: () => feed.ready(),
        unsubscribe,
      });
    }

    const fs = new SshFileSystem(this.proxy, '/');
    const watcher = fs.watch(
      (events) => {
        const changes = eventsToChanges('/', events);
        if (changes.length > 0) cb({ kind: 'changes', changes });
      },
      { debounceMs: options.debounceMs }
    );
    watcher.update(paths.data);
    this.changeFeeds.add(watcher);

    let unsubscribed = false;
    const unsubscribe = () => {
      if (unsubscribed) return;
      unsubscribed = true;
      this.changeFeeds.delete(watcher);
      watcher.close();
    };

    return ok({
      ready: async () => ok<void>(),
      unsubscribe,
    });
  }

  async dispose(): Promise<void> {
    if (this.disposeRequested) return;
    this.disposeRequested = true;
    for (const feed of this.changeFeeds) feed.close();
    this.changeFeeds.clear();
    await this.trees.dispose();
  }
}

const posixMachinePath: IFilesRuntime['path'] = {
  join: (...parts) => path.posix.join(...parts),
  dirname: (value) => path.posix.dirname(value),
  basename: (value) => path.posix.basename(value),
  isAbsolute: (value) => path.posix.isAbsolute(value),
  relative: (from, to) => path.posix.relative(from, to),
  contains: (parent, child) => {
    const rel = path.posix.relative(parent, child);
    return rel === '' || (rel !== '..' && !rel.startsWith('../') && !path.posix.isAbsolute(rel));
  },
};

class LegacySshRecursiveChangeFeed implements ChangeFeedHandle {
  private snapshot: Map<string, LegacySshSnapshotEntry> | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private pollInFlight = false;
  private closed = false;
  private readonly readyPromise: Promise<Result<void, FileError>>;

  constructor(
    private readonly proxy: SshClientProxy,
    private readonly rootPath: string,
    private readonly cb: (update: FileChangeUpdate) => void,
    private readonly onError: (context: string, error: unknown) => void,
    private readonly pollIntervalMs: number
  ) {
    this.readyPromise = this.initialize();
  }

  ready(): Promise<Result<void, FileError>> {
    return this.readyPromise;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
  }

  private async initialize(): Promise<Result<void, FileError>> {
    const scanned = await this.scan();
    if (!scanned.success) return err(scanned.error);
    if (this.closed) return ok<void>();

    this.snapshot = scanned.data;
    this.timer = setInterval(() => {
      void this.poll();
    }, this.pollIntervalMs);
    return ok<void>();
  }

  private async poll(): Promise<void> {
    if (this.closed || this.pollInFlight) return;

    this.pollInFlight = true;
    try {
      const scanned = await this.scan();
      if (this.closed) return;
      if (!scanned.success) {
        this.onError(`ssh file changes scan ${this.rootPath}`, scanned.error);
        this.cb({ kind: 'resync' });
        return;
      }

      if (!this.snapshot) {
        this.snapshot = scanned.data;
        return;
      }

      const changes = diffRecursiveSnapshots(this.snapshot, scanned.data);
      this.snapshot = scanned.data;
      if (changes.length > 0) this.cb({ kind: 'changes', changes });
    } finally {
      this.pollInFlight = false;
    }
  }

  private async scan(): Promise<Result<Map<string, LegacySshSnapshotEntry>, FileError>> {
    try {
      const result = await execRemoteBuffer(
        this.proxy,
        buildRecursiveSnapshotCommand(this.rootPath)
      );
      if (result.exitCode !== 0) {
        return err({
          type: 'fs-error',
          path: this.rootPath,
          message: result.stderr || `Remote file snapshot exited with code ${result.exitCode}`,
        });
      }
      return ok(parseRecursiveSnapshot(this.rootPath, result.stdout));
    } catch (error) {
      return err(toFileError(error, this.rootPath));
    }
  }
}

class LegacySshFileTree implements IFileTree {
  readonly rootPath: string;
  private readonly collection = new LiveCollection<NodeId, FileNode, FileTreeError>({
    scopeOf: (node) => node.parentId,
  });
  private readonly fs: SshFileSystem;
  private readonly pathToId = new Map<string, NodeId>();
  private readonly nodes = new Map<NodeId, FileNode>();
  private readonly childrenByParent = new Map<NodeId | null, Set<NodeId>>();
  private readonly scopeLoads = new Map<
    NodeId | null,
    Promise<Result<FileTreeSequences, FileTreeError>>
  >();
  private readonly pollTimer: ReturnType<typeof setInterval>;
  private nextId = 1;
  private disposed = false;
  private readyPromise: Promise<Result<void, FileTreeError>> | null = null;

  constructor(
    proxy: SshClientProxy,
    rootPath: string,
    private readonly onError: (context: string, error: unknown) => void
  ) {
    this.rootPath = rootPath;
    this.fs = new SshFileSystem(proxy, rootPath);
    this.pollTimer = setInterval(() => {
      if (this.collection.subscriberCount === 0) return;
      void this.refreshRegisteredScopes().then(
        (result) => {
          if (!result.success) this.onError(`ssh file-tree refresh ${this.rootPath}`, result.error);
        },
        (error) => this.onError(`ssh file-tree refresh ${this.rootPath}`, error)
      );
    }, SSH_FILE_TREE_POLL_MS);
  }

  async ready(): Promise<Result<void, FileTreeError>> {
    if (this.readyPromise) return this.readyPromise;

    const readyPromise = (async (): Promise<Result<void, FileTreeError>> => {
      const loaded = await this.loadDirectoryScope(null);
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

  async registerDir(dirId: NodeId | null): Promise<Result<FileTreeSequences, FileTreeError>> {
    const ready = await this.ready();
    if (!ready.success) return err(ready.error);
    // The caller (FileTreeProjector) is the sole ref-count authority, so a register is just
    // "load this scope if it isn't already loaded"; the poller keeps a loaded scope fresh.
    if (this.collection.isScopeLoaded(dirId)) return ok({});
    return this.loadDirectoryScope(dirId);
  }

  async unregisterDir(dirId: NodeId | null): Promise<Result<FileTreeSequences, FileTreeError>> {
    const ready = await this.ready();
    if (!ready.success) return err(ready.error);
    // Root stays pinned for the tree's lifetime; everything else unloads on unregister.
    if (dirId === null) return ok({});
    const sequence = this.collection.unloadScope(dirId);
    return ok(sequence === 0 ? {} : { tree: sequence });
  }

  async revealPath(pathToReveal: string): Promise<Result<FileTreeSequences, FileTreeError>> {
    const ready = await this.ready();
    if (!ready.success) return err(ready.error);
    const normalized = normalizeRemoteAbsolutePath(pathToReveal);
    if (!normalized.success) return normalized;
    if (!containsRemotePath(this.rootPath, normalized.data)) {
      return err({
        type: 'invalid-path',
        path: pathToReveal,
        message: 'Path is outside the file-tree root',
      });
    }

    const relPath = path.posix.relative(this.rootPath, normalized.data);
    const parts = relPath.split('/').filter(Boolean);
    let sequences: FileTreeSequences = {};
    for (let index = 0; index < parts.length; index += 1) {
      const absPath = normalizeRemoteRootPath(
        path.posix.join(this.rootPath, ...parts.slice(0, index + 1))
      );
      const node = this.getByPath(absPath);
      if (!node) return err({ type: 'not-found', path: absPath });
      const shouldExpand = index < parts.length - 1 || node.type === 'directory';
      if (!shouldExpand) continue;
      if (node.type !== 'directory') {
        return err({ type: 'not-directory', id: node.id, path: node.path });
      }
      const expanded = await this.loadDirectoryScope(node.id);
      if (!expanded.success) return expanded;
      sequences = mergeSequences(sequences, expanded.data);
    }
    return ok(sequences);
  }

  async refresh(): Promise<Result<FileTreeSnapshot, FileTreeError>> {
    const refreshed = await this.refreshRegisteredScopes();
    if (!refreshed.success) return err(refreshed.error);
    return ok(this.collection.getCached());
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    clearInterval(this.pollTimer);
    this.collection.dispose();
  }

  private async refreshRegisteredScopes(): Promise<Result<FileTreeSequences, FileTreeError>> {
    const scopes = this.collection.loadedScopes();
    let sequences: FileTreeSequences = {};
    for (const scope of scopes) {
      if (scope !== null && !this.nodes.has(scope)) continue;
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
    void loading.finally(() => {
      if (this.scopeLoads.get(scope) === loading) this.scopeLoads.delete(scope);
    });
    return loading;
  }

  private async loadDirectoryScopeInternal(
    scope: NodeId | null
  ): Promise<Result<FileTreeSequences, FileTreeError>> {
    const dirNode = scope === null ? null : this.nodes.get(scope);
    if (scope !== null && !dirNode) return err({ type: 'not-found', id: scope });
    if (dirNode && dirNode.type !== 'directory') {
      return err({ type: 'not-directory', id: dirNode.id, path: dirNode.path });
    }

    const dirPath = dirNode?.path ?? this.rootPath;
    const listed = await this.listChildren(dirPath);
    if (!listed.success) return listed;

    const listedPaths = new Set(listed.data.map((entry) => entry.path));
    let sequence = this.removeMissingChildren(scope, listedPaths);
    const nodes = listed.data.map((entry) =>
      this.upsertNode(entry, scope, this.getByPath(entry.path)?.childrenLoaded)
    );
    const loaded = await this.collection.loadScope(scope, async () =>
      ok(nodes.map((node) => [node.id, node] as const))
    );
    if (!loaded.success) return loaded;
    sequence = Math.max(sequence, loaded.data);

    if (dirNode && !dirNode.childrenLoaded) {
      const updated = { ...dirNode, childrenLoaded: true };
      this.setNode(updated);
      sequence = Math.max(sequence, this.collection.put(updated.id, updated));
    }

    return ok(sequence === 0 ? {} : { tree: sequence });
  }

  private async listChildren(dirPath: string): Promise<Result<LegacyListedEntry[], FileTreeError>> {
    const normalized = normalizeRemoteAbsolutePath(dirPath);
    if (!normalized.success) return normalized;
    if (!containsRemotePath(this.rootPath, normalized.data)) {
      return err({
        type: 'invalid-path',
        path: dirPath,
        message: 'Path is outside the file-tree root',
      });
    }

    try {
      const result = await this.fs.list(normalized.data, { includeHidden: true });
      const entries: LegacyListedEntry[] = [];
      for (const entry of result.entries) {
        const absPath = toRemoteAbsolutePath(this.rootPath, entry.path);
        if (isIgnoredRemotePath(this.rootPath, absPath)) continue;
        if (entry.type !== 'dir' && entry.type !== 'file') continue;
        entries.push(toListedEntry(this.rootPath, entry));
      }
      entries.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      return ok(entries);
    } catch (error) {
      return err(toFileTreeError(error, normalized.data));
    }
  }

  private removeMissingChildren(parentId: NodeId | null, listedPaths: Set<string>): number {
    const missing = this.childrenOf(parentId)
      .filter((node) => !listedPaths.has(node.path))
      .map((node) => node.id);
    return this.removeSubtrees(missing);
  }

  private removeSubtrees(rootIds: NodeId[]): number {
    const ops: Array<KeyedOp<NodeId, FileNode>> = [];
    const removedScopes: NodeId[] = [];
    for (const rootId of rootIds) {
      const removed = this.removeSubtree(rootId);
      for (const node of removed) {
        ops.push({ op: 'del', key: node.id });
        if (node.type === 'directory') removedScopes.push(node.id);
      }
    }

    let sequence = this.collection.apply(ops);
    for (const scope of removedScopes) {
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

  private getByPath(path: string): FileNode | undefined {
    const id = this.pathToId.get(path);
    return id === undefined ? undefined : this.nodes.get(id);
  }

  private upsertNode(
    entry: LegacyListedEntry,
    parentId: NodeId | null,
    childrenLoaded?: boolean
  ): FileNode {
    const existingId = this.pathToId.get(entry.path);
    const id = existingId ?? this.nextId++;
    const previous = this.nodes.get(id);
    const node: FileNode = {
      id,
      path: entry.path,
      name: entry.name,
      parentId,
      type: entry.type,
      childrenLoaded:
        entry.type === 'directory' ? (childrenLoaded ?? previous?.childrenLoaded ?? false) : false,
    };
    this.setNode(node);
    return node;
  }

  private setNode(node: FileNode): void {
    const previous = this.nodes.get(node.id);
    if (previous) {
      this.pathToId.delete(previous.path);
      this.removeChild(previous.parentId, node.id);
    }
    this.pathToId.set(node.path, node.id);
    this.addChild(node.parentId, node.id);
    this.nodes.set(node.id, node);
  }

  private removeSubtree(rootId: NodeId): FileNode[] {
    const removed: FileNode[] = [];
    const visit = (id: NodeId) => {
      const node = this.nodes.get(id);
      if (!node) return;
      for (const child of this.childrenOf(id)) visit(child.id);
      this.removeNode(id);
      removed.push(node);
    };
    visit(rootId);
    return removed;
  }

  private removeNode(id: NodeId): void {
    const node = this.nodes.get(id);
    if (!node) return;
    this.pathToId.delete(node.path);
    this.removeChild(node.parentId, id);
    this.nodes.delete(id);
  }

  private childrenOf(parentId: NodeId | null): FileNode[] {
    const ids = this.childrenByParent.get(parentId);
    if (!ids) return [];
    const children: FileNode[] = [];
    for (const id of ids) {
      const node = this.nodes.get(id);
      if (node) children.push(node);
    }
    return children;
  }

  private addChild(parentId: NodeId | null, id: NodeId): void {
    let children = this.childrenByParent.get(parentId);
    if (!children) {
      children = new Set();
      this.childrenByParent.set(parentId, children);
    }
    children.add(id);
  }

  private removeChild(parentId: NodeId | null, id: NodeId): void {
    const children = this.childrenByParent.get(parentId);
    if (!children) return;
    children.delete(id);
    if (children.size === 0) this.childrenByParent.delete(parentId);
  }
}

function normalizeWatchedPaths(
  rootPath: string,
  paths: string[] | undefined
): Result<string[], FileError> {
  if (!paths || paths.length === 0) return ok([rootPath]);

  const normalizedPaths: string[] = [];
  for (const pathValue of paths) {
    if (pathValue.includes('\0')) {
      return err({ type: 'invalid-path', path: pathValue, message: 'Path contains a null byte' });
    }

    const normalized = normalizeRemoteAbsolutePath(pathValue);
    if (!normalized.success) return normalized;

    if (!containsRemotePath(rootPath, normalized.data)) {
      return err({
        type: 'invalid-path',
        path: pathValue,
        message: 'Path is outside the watch root',
      });
    }

    normalizedPaths.push(normalized.data);
  }

  return ok(normalizedPaths);
}

function watchesWholeRoot(rootPath: string, paths: string[]): boolean {
  return paths.includes(rootPath);
}

function eventsToChanges(rootPath: string, events: FileWatchEvent[]): FileChange[] {
  const changes: FileChange[] = [];
  for (const event of events) {
    const eventPath = toRemoteAbsolutePath(rootPath, event.path);
    if (isIgnoredRemotePath(rootPath, eventPath)) continue;
    if (event.type === 'rename') {
      if (event.oldPath) {
        const oldPath = toRemoteAbsolutePath(rootPath, event.oldPath);
        if (!isIgnoredRemotePath(rootPath, oldPath)) {
          changes.push({ kind: 'delete', path: oldPath, entryType: event.entryType });
        }
      }
      changes.push({ kind: 'create', path: eventPath, entryType: event.entryType });
      continue;
    }
    changes.push({
      kind: event.type === 'modify' ? 'update' : event.type,
      path: eventPath,
      entryType: event.entryType,
    });
  }
  return changes;
}

function diffRecursiveSnapshots(
  previous: Map<string, LegacySshSnapshotEntry>,
  next: Map<string, LegacySshSnapshotEntry>
): FileChange[] {
  const changes: FileChange[] = [];

  for (const [entryPath, entry] of next) {
    const previousEntry = previous.get(entryPath);
    if (!previousEntry) {
      changes.push({ kind: 'create', path: entryPath, entryType: entry.entryType });
      continue;
    }
    if (snapshotEntryChanged(previousEntry, entry)) {
      changes.push({ kind: 'update', path: entryPath, entryType: entry.entryType });
    }
  }

  for (const [entryPath, entry] of previous) {
    if (!next.has(entryPath)) {
      changes.push({ kind: 'delete', path: entryPath, entryType: entry.entryType });
    }
  }

  return changes;
}

function snapshotEntryChanged(
  previous: LegacySshSnapshotEntry,
  next: LegacySshSnapshotEntry
): boolean {
  return (
    previous.entryType !== next.entryType ||
    previous.size !== next.size ||
    previous.mtime !== next.mtime
  );
}

async function execRemoteBuffer(
  proxy: SshClientProxy,
  command: string
): Promise<{ stdout: Buffer; stderr: string; exitCode: number }> {
  const profile = await proxy.getRemoteShellProfile();
  const fullCommand = buildRemoteShellCommand(profile, command);

  return new Promise((resolve, reject) => {
    proxy.exec(fullCommand, (err, stream) => {
      if (err) {
        reject(err);
        return;
      }

      readExecStream(stream, resolve, reject);
    });
  });
}

function readExecStream(
  stream: ClientChannel,
  resolve: (value: { stdout: Buffer; stderr: string; exitCode: number }) => void,
  reject: (reason?: unknown) => void
): void {
  const stdout: Buffer[] = [];
  let stderr = '';
  let settled = false;

  stream.on('data', (chunk: Buffer) => {
    stdout.push(Buffer.from(chunk));
  });
  stream.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });
  stream.on('close', (exitCode: number | null) => {
    if (settled) return;
    settled = true;
    resolve({
      stdout: Buffer.concat(stdout),
      stderr: stderr.trim(),
      exitCode: exitCode ?? -1,
    });
  });
  stream.on('error', (error: Error) => {
    if (settled) return;
    settled = true;
    reject(error);
  });
}

function buildRecursiveSnapshotCommand(rootPath: string): string {
  const pruneExpression = buildFindPruneExpression();
  const snapshotScript = `
stat_style=$1
shift
for p do
  rel=\${p#./}
  [ "$rel" = "." ] && continue
  if [ -d "$p" ]; then kind=directory; else kind=file; fi
  if [ "$stat_style" = gnu ]; then
    meta=$(stat -c '%s %Y' -- "$p" 2>/dev/null) || continue
  else
    meta=$(stat -f '%z %m' -- "$p" 2>/dev/null) || continue
  fi
  size=\${meta%% *}
  mtime=\${meta#* }
  printf '%s\\0%s\\0%s\\0%s\\0' "$kind" "$size" "$mtime" "$rel"
done
`.trim();

  return [
    `cd ${quoteShellArg(rootPath)} || exit 1`,
    "if stat -c '%s %Y' . >/dev/null 2>&1; then stat_style=gnu; elif stat -f '%z %m' . >/dev/null 2>&1; then stat_style=bsd; else exit 2; fi",
    `find . ${pruneExpression}\\( -type f -o -type d \\) -exec sh -c ${quoteShellArg(
      snapshotScript
    )} sh "$stat_style" {} +`,
  ].join('\n');
}

function parseRecursiveSnapshot(
  rootPath: string,
  stdout: Buffer
): Map<string, LegacySshSnapshotEntry> {
  const entries = new Map<string, LegacySshSnapshotEntry>();
  const fields = stdout.toString('utf8').split('\0');

  for (let index = 0; index + 3 < fields.length; index += 4) {
    const entryType = parseSnapshotEntryType(fields[index]);
    if (!entryType) continue;

    const size = fields[index + 1];
    const mtime = fields[index + 2];
    const absPath = toRemoteAbsolutePath(rootPath, fields[index + 3]);
    if (isIgnoredRemotePath(rootPath, absPath)) continue;

    entries.set(absPath, {
      entryType,
      size,
      mtime,
    });
  }

  return entries;
}

function parseSnapshotEntryType(raw: string): Exclude<FileEntryType, 'unknown'> | null {
  if (raw === 'file' || raw === 'directory') return raw;
  return null;
}

function toListedEntry(rootPath: string, entry: FileEntry): LegacyListedEntry {
  const absPath = toRemoteAbsolutePath(rootPath, entry.path);
  return {
    path: absPath,
    name: path.posix.basename(absPath),
    type: entry.type === 'dir' ? 'directory' : 'file',
  };
}

function toFileTreeError(error: unknown, relPath: string): FileTreeError {
  if (error instanceof FileSystemError) {
    if (error.code === FileSystemErrorCodes.NOT_FOUND) return { type: 'not-found', path: relPath };
    if (error.code === FileSystemErrorCodes.NOT_DIRECTORY) {
      return { type: 'not-directory', path: relPath };
    }
    if (
      error.code === FileSystemErrorCodes.INVALID_PATH ||
      error.code === FileSystemErrorCodes.PATH_ESCAPE
    ) {
      return { type: 'invalid-path', path: relPath, message: error.message };
    }
    return { type: 'fs-error', path: relPath, message: error.message };
  }
  return { type: 'fs-error', path: relPath, message: String(error) };
}

function toFileError(error: unknown, path: string): FileError {
  if (error instanceof FileSystemError) {
    if (
      error.code === FileSystemErrorCodes.INVALID_PATH ||
      error.code === FileSystemErrorCodes.PATH_ESCAPE
    ) {
      return { type: 'invalid-path', path, message: error.message };
    }
    return { type: 'fs-error', path, message: error.message };
  }
  return { type: 'fs-error', path, message: String(error) };
}

function mergeSequences(left: FileTreeSequences, right: FileTreeSequences): FileTreeSequences {
  return { tree: Math.max(left.tree ?? 0, right.tree ?? 0) || undefined };
}
