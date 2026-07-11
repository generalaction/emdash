import type { ContentKey, FsError, RootKey, TreeKey } from '@emdash/core/files';
import type { IWatchService } from '@emdash/core/services/fs-watch/api';
import { toPendingLease, type Lease, type PendingLease, type Result } from '@emdash/shared';
import { createManagedSource, type ManagedSource } from '@emdash/wire/util';
import { FsException } from '../api/errors';
import { ContentResource } from '../content/content-resource';
import { RootResource, type RootChange } from '../root/root-resource';
import { TreeResource } from '../tree/tree-resource';
import {
  contentIdentity,
  resolveRootIdentity,
  treeIdentity,
  type ContentIdentity,
  type RootIdentity,
  type TreeIdentity,
} from './identity';

const DEFAULT_IDLE_TTL_MS = 30_000;

export type FilesAllocationGraphOptions = {
  watcher: IWatchService;
  idleTtlMs?: number;
  maxContentBytes?: number;
  onError?: (context: string, error: unknown) => void;
};

export class FilesAllocationGraph {
  private readonly roots: ManagedSource<RootIdentity, RootResource>;
  private readonly trees: ManagedSource<TreeIdentity, TreeResource>;
  private readonly contents: ManagedSource<ContentIdentity, ContentResource>;
  private disposed = false;

  constructor(options: FilesAllocationGraphOptions) {
    const graceMs = options.idleTtlMs ?? DEFAULT_IDLE_TTL_MS;
    const onError = options.onError ?? (() => {});
    this.roots = createManagedSource({
      key: (identity: RootIdentity) => identity.rootId,
      graceMs,
      onError: (error, id) => onError(`files root ${id}`, error),
      create: async (identity, scope) => {
        const resource = await RootResource.create({ identity, watcher: options.watcher });
        scope.add(() => resource.dispose());
        return resource;
      },
    });
    this.trees = createManagedSource({
      key: (identity: TreeIdentity) => identity.treeId,
      graceMs,
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
    this.contents = createManagedSource({
      key: (identity: ContentIdentity) => identity.contentId,
      graceMs,
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
    return this.acquireResolved(resolveRootIdentity(key.root), (root) =>
      this.contents.acquire(contentIdentity(root, key))
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

  private acquireResolved<Resource>(
    resolved: Promise<Result<RootIdentity, FsError>>,
    acquire: (identity: RootIdentity) => PendingLease<Resource>
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
