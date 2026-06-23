import path from 'node:path';
import type {
  FileNode,
  FileTreeError,
  FileTreeLease,
  FileTreeSequences,
  FileTreeSnapshot,
  FileTreeUpdate,
  IFileTree,
  IFileTreeRuntime,
  NodeId,
  SubscribedSnapshot,
} from '@emdash/core/file-tree';
import { LiveCollection, ResourceMap, type KeyedOp } from '@emdash/core/lib';
import { err, ok, type Result, type Unsubscribe } from '@emdash/shared';
import { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import { FileSystemError, FileSystemErrorCodes } from '@main/core/fs/types';
import type { FileEntry } from '@main/core/fs/types';
import type { SshClientProxy } from '@main/core/ssh/lifecycle/ssh-client-proxy';
import { log } from '@main/lib/logger';

const SSH_FILE_TREE_POLL_MS = 4_000;
const SSH_FILE_TREE_EXCLUDED_NAMES = new Set([
  '.git',
  'dist',
  'build',
  '.next',
  'out',
  '.turbo',
  'coverage',
  '.nyc_output',
  '.cache',
  'tmp',
  'temp',
  '.DS_Store',
  'Thumbs.db',
  '.vscode-test',
  '.idea',
  '__pycache__',
  '.pytest_cache',
  'venv',
  '.venv',
  'target',
  '.terraform',
  '.serverless',
  '.checkouts',
  'checkouts',
  '.conductor',
  '.cursor',
  '.claude',
  '.devin',
  '.amp',
  '.codex',
  '.aider',
  '.continue',
  '.cody',
  '.windsurf',
  'worktrees',
  '.worktrees',
  '.emdash',
  'node_modules',
]);

type LegacyListedEntry = {
  path: string;
  name: string;
  type: 'file' | 'directory';
};

/**
 * Legacy SSH compatibility layer for the core file-tree contract.
 *
 * This adapter deliberately does not reuse `@emdash/core`'s native `FileTree`.
 * Core owns the local, node:fs-backed implementation; this transitional layer
 * translates SSH/SFTP polling into the same public snapshot/update interface
 * until the core runtime can run where the remote workspace lives.
 */
export class LegacySshFileTreeRuntime implements IFileTreeRuntime {
  private readonly trees: ResourceMap<LegacySshFileTree>;
  private disposeRequested = false;

  constructor(private readonly proxy: SshClientProxy) {
    this.trees = new ResourceMap<LegacySshFileTree>({
      teardown: (_rootPath, tree) => tree.dispose(),
      onError: (context, error) =>
        log.warn('LegacySshFileTreeRuntime: teardown failed', {
          context,
          error: String(error),
        }),
    });
  }

  async open(rootPath: string): Promise<Result<FileTreeLease, FileTreeError>> {
    if (this.disposeRequested) throw new Error('LegacySshFileTreeRuntime disposed');
    const normalizedRoot = normalizeRemoteRootPath(rootPath);
    const lease = await this.trees.acquire(normalizedRoot, async () => {
      return new LegacySshFileTree(this.proxy, normalizedRoot, (context, error) =>
        log.warn('LegacySshFileTreeRuntime: background error', {
          context,
          error: String(error),
        })
      );
    });

    try {
      const ready = await lease.value.ready();
      if (!ready.success) {
        lease.release();
        return err(ready.error);
      }
      return ok(lease);
    } catch (error) {
      lease.release();
      throw error;
    }
  }

  async dispose(): Promise<void> {
    this.disposeRequested = true;
    this.trees.dispose();
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
      void this.refreshLoadedScopes().then(
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

  async expandDir(dirId: NodeId | null): Promise<Result<FileTreeSequences, FileTreeError>> {
    const ready = await this.ready();
    if (!ready.success) return err(ready.error);
    return this.loadDirectoryScope(dirId);
  }

  async revealPath(pathToReveal: string): Promise<Result<FileTreeSequences, FileTreeError>> {
    const ready = await this.ready();
    if (!ready.success) return err(ready.error);
    const normalized = normalizeRemoteRelPath(pathToReveal);
    if (!normalized.success) return normalized;

    const parts = normalized.data.split('/').filter(Boolean);
    let sequences: FileTreeSequences = {};
    for (let index = 0; index < parts.length; index += 1) {
      const relPath = parts.slice(0, index + 1).join('/');
      const node = this.getByPath(relPath);
      if (!node) return err({ type: 'not-found', path: relPath });
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
    const refreshed = await this.refreshLoadedScopes();
    if (!refreshed.success) return err(refreshed.error);
    return ok(this.collection.getCached());
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearInterval(this.pollTimer);
    this.collection.dispose();
  }

  private async refreshLoadedScopes(): Promise<Result<FileTreeSequences, FileTreeError>> {
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

    const dirPath = dirNode?.path ?? '';
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
    const normalized = normalizeRemoteRelPath(dirPath, { allowEmpty: true });
    if (!normalized.success) return normalized;

    try {
      const result = await this.fs.list(normalized.data, { includeHidden: true });
      const entries: LegacyListedEntry[] = [];
      for (const entry of result.entries) {
        const relPath = entry.path.replace(/\\/g, '/');
        if (isLegacySshExcludedPath(relPath)) continue;
        if (entry.type !== 'dir' && entry.type !== 'file') continue;
        entries.push(toListedEntry(entry));
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
    for (const scope of removedScopes)
      sequence = Math.max(sequence, this.collection.unloadScope(scope));
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

function toListedEntry(entry: FileEntry): LegacyListedEntry {
  const relPath = entry.path.replace(/\\/g, '/');
  return {
    path: relPath,
    name: path.posix.basename(relPath),
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

function normalizeRemoteRootPath(rootPath: string): string {
  const normalized = path.posix.normalize(rootPath.replace(/\\/g, '/'));
  return path.posix.isAbsolute(normalized) ? normalized : path.posix.resolve('/', normalized);
}

function normalizeRemoteRelPath(
  input: string,
  options: { allowEmpty?: boolean } = {}
): Result<string, FileTreeError> {
  if (input.includes('\0')) {
    return err({ type: 'invalid-path', path: input, message: 'Path contains a null byte' });
  }
  if (path.posix.isAbsolute(input) || path.win32.isAbsolute(input)) {
    return err({ type: 'invalid-path', path: input, message: 'Absolute paths are not allowed' });
  }

  const parts = input
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part.length > 0 && part !== '.');
  if (parts.includes('..')) {
    return err({
      type: 'invalid-path',
      path: input,
      message: 'Parent path segments are not allowed',
    });
  }

  const normalized = parts.join('/');
  if (!normalized && !options.allowEmpty) {
    return err({ type: 'invalid-path', path: input, message: 'Path must not be empty' });
  }
  return ok(normalized);
}

function isLegacySshExcludedPath(relPath: string): boolean {
  return relPath.split('/').some((segment) => SSH_FILE_TREE_EXCLUDED_NAMES.has(segment));
}

function mergeSequences(left: FileTreeSequences, right: FileTreeSequences): FileTreeSequences {
  return { tree: Math.max(left.tree ?? 0, right.tree ?? 0) || undefined };
}
