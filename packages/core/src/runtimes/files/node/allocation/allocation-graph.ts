import { ok, toPendingLease, type Lease, type PendingLease, type Result } from '@emdash/shared';
import { createResourceCache, type ResourceCache } from '@emdash/shared/concurrency';
import type { PortableRelativePath } from '#primitives/path/api';
import type { ContentKey, FileKey, FsError, RootKey, TreeKey } from '#runtimes/files/api';
import { FsException } from '#runtimes/files/node/api/errors';
import { ContentResource } from '#runtimes/files/node/content/content-resource';
import { RootResource, type RootChange } from '#runtimes/files/node/root/root-resource';
import { TreeResource } from '#runtimes/files/node/tree/tree-resource';
import type { IWatchService } from '#services/fs-watch/api';
import {
  contentIdentity,
  resolveAbsoluteFileLocation,
  resolveRootIdentity,
  treeIdentity,
  type FileLocation,
  type RootIdentity,
  type TreeIdentity,
  type ContentIdentity,
} from './identity';

const DEFAULT_IDLE_TTL_MS = 30_000;

// A children-scoped parent watch only serves per-file content updates, so events
// beneath direct subdirectories are ignored at the native watcher.
const CHILDREN_WATCH_IGNORE: readonly string[] = ['*/**'];

export type FilesAllocationGraphOptions = {
  watcher: IWatchService;
  watchIgnoreGlobs?: readonly string[];
  idleTtlMs?: number;
  maxContentBytes?: number;
  onError?: (context: string, error: unknown) => void;
};

export class FilesAllocationGraph {
  private readonly roots: ResourceCache<RootIdentity, RootResource>;
  private readonly trees: ResourceCache<TreeIdentity, TreeResource>;
  private readonly contents: ResourceCache<ContentIdentity, ContentResource>;
  private disposed = false;

  constructor(options: FilesAllocationGraphOptions) {
    const idleTtlMs = options.idleTtlMs ?? DEFAULT_IDLE_TTL_MS;
    const onError = options.onError ?? (() => {});
    this.roots = createResourceCache({
      key: (identity: RootIdentity) => identity.rootId,
      idleTtlMs,
      onError: (error, id) => onError(`files root ${id}`, error),
      create: async (identity, scope) => {
        const resource = await RootResource.create({
          identity,
          watcher: options.watcher,
          watchIgnoreGlobs:
            identity.watchScope === 'children' ? CHILDREN_WATCH_IGNORE : options.watchIgnoreGlobs,
          onError,
        });
        scope.add(() => resource.dispose());
        return resource;
      },
    });
    this.trees = createResourceCache({
      key: (identity: TreeIdentity) => identity.treeId,
      idleTtlMs,
      onError: (error, id) => onError(`files tree ${id}`, error),
      create: async (identity, scope) => {
        const rootLease = this.roots.acquire(identity.root);
        scope.add(() => rootLease.release());
        const resource = new TreeResource({
          identity,
          root: await rootLease.ready(),
          onError,
        });
        scope.add(() => resource.dispose());
        return resource;
      },
    });
    this.contents = createResourceCache({
      key: (identity: ContentIdentity) => identity.contentId,
      idleTtlMs,
      onError: (error, id) => onError(`files content ${id}`, error),
      create: async (identity, scope) => {
        const rootLease = this.roots.acquire(identity.root);
        scope.add(() => rootLease.release());
        const resource = new ContentResource({
          identity,
          root: await rootLease.ready(),
          maxBytes: options.maxContentBytes,
          onError,
        });
        scope.add(() => resource.dispose());
        return resource;
      },
    });
  }

  acquireTree(key: TreeKey): PendingLease<TreeResource> {
    return this.acquireResolved(resolveRootIdentity(key.root), (root) =>
      this.trees.acquire(treeIdentity(root, key))
    );
  }

  acquireContent(key: ContentKey): PendingLease<ContentResource> {
    return this.acquireResolved(this.resolveFileLocation(key), ({ root, relative }) =>
      this.contents.acquire(contentIdentity(root, relative))
    );
  }

  acquireRoot(key: RootKey): PendingLease<RootResource> {
    return this.acquireResolved(resolveRootIdentity(key.root), (identity) =>
      this.roots.acquire(identity)
    );
  }

  async useRoot<T>(key: RootKey, run: (root: RootResource) => Promise<T>): Promise<T> {
    const lease = this.acquireRoot(key);
    try {
      return await run(await lease.ready());
    } finally {
      await lease.release();
    }
  }

  /**
   * Runs an operation against the root resource and root-relative path a file
   * key resolves to — the registered root for root-scoped keys, the file's
   * parent directory for bare absolute paths. One code path for both modes.
   */
  async useFileLocation<T>(
    key: FileKey,
    run: (root: RootResource, relative: PortableRelativePath) => Promise<T>
  ): Promise<T> {
    const location = await this.resolveFileLocation(key);
    if (!location.success) throw new FsException(location.error);
    this.assertActive();
    const lease = this.roots.acquire(location.data.root);
    try {
      return await run(await lease.ready(), location.data.relative);
    } finally {
      await lease.release();
    }
  }

  notifyActiveRoot(root: RootResource, changes: RootChange[]): void {
    root.publishKnownChanges(changes);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.contents.dispose();
    await this.trees.dispose();
    await this.roots.dispose();
  }

  private async resolveFileLocation(key: FileKey): Promise<Result<FileLocation, FsError>> {
    if ('path' in key) return resolveAbsoluteFileLocation(key.path);
    const root = await resolveRootIdentity(key.root);
    return root.success ? ok({ root: root.data, relative: key.relative }) : root;
  }

  private acquireResolved<Resolved, Resource>(
    resolved: Promise<Result<Resolved, FsError>>,
    acquire: (value: Resolved) => PendingLease<Resource>
  ): PendingLease<Resource> {
    this.assertActive();
    return toPendingLease(
      resolved.then(async (result): Promise<Lease<Resource>> => {
        if (!result.success) throw new FsException(result.error);
        const resourceLease = acquire(result.data);
        try {
          return {
            value: await resourceLease.ready(),
            release: () => resourceLease.release(),
          };
        } catch (error) {
          await resourceLease.release();
          throw error;
        }
      })
    );
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('FilesAllocationGraph is disposed');
  }
}
