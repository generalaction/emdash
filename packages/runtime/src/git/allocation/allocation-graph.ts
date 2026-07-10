import type { BoundExec } from '@emdash/core/exec';
import type { CheckoutSelector, RepositorySelector } from '@emdash/core/git';
import { KeyedMutex } from '@emdash/core/lib';
import type { IWatchService } from '@emdash/core/services/fs-watch/api';
import { toPendingLease, type Lease, type PendingLease, type Result } from '@emdash/shared';
import { createManagedSource, type ManagedSource } from '@emdash/wire/util';
import { GitCheckout } from '../checkout/git-checkout';
import { GitRepository } from '../repository/git-repository';
import { CheckoutMount } from './checkout-mount';
import { CheckoutHandle, RepositoryHandle } from './handles';
import {
  repositoryIdentityOf,
  type CheckoutIdentity,
  type GitIdentityResolver,
  type GitResolutionError,
  type RepositoryIdentity,
} from './identity';
import { CanonicalGitIdentityResolver } from './identity-resolver';
import { RepositoryMount } from './repository-mount';

const DEFAULT_IDLE_TTL_MS = 30_000;

export type GitAllocationGraphOptions = Readonly<{
  exec: BoundExec;
  watcher: IWatchService;
  identityResolver?: GitIdentityResolver;
  objectStoreMutex?: KeyedMutex;
  idleTtlMs?: number;
  aliasTtlMs?: number;
  maxFileDiffStates?: number;
  onError?: (context: string, error: unknown) => void;
}>;

export class GitResolutionException extends Error {
  constructor(readonly resolution: GitResolutionError) {
    super(resolution.message);
    this.name = 'GitResolutionException';
  }
}

/** Canonical repository -> checkout allocation graph with parent retention and idle TTL. */
export class GitAllocationGraph {
  private readonly resolver: GitIdentityResolver;
  private readonly ownsResolver: boolean;
  private readonly repositories: ManagedSource<RepositoryIdentity, RepositoryMount>;
  private readonly checkouts: ManagedSource<CheckoutIdentity, CheckoutMount>;
  private disposed = false;

  constructor(private readonly options: GitAllocationGraphOptions) {
    const idleTtlMs = options.idleTtlMs ?? DEFAULT_IDLE_TTL_MS;
    const objectStoreMutex = options.objectStoreMutex ?? new KeyedMutex();
    const onError = options.onError ?? (() => {});
    this.ownsResolver = !options.identityResolver;
    this.resolver =
      options.identityResolver ??
      new CanonicalGitIdentityResolver({ exec: options.exec, aliasTtlMs: options.aliasTtlMs });

    this.repositories = createManagedSource({
      key: (identity: RepositoryIdentity) => identity.repositoryId,
      graceMs: idleTtlMs,
      onError: (error, id) => onError(`git repository ${id}`, error),
      create: async (identity, scope) => {
        const repository = new GitRepository({ identity, exec: options.exec });
        const mount = await RepositoryMount.create({
          identity,
          repository,
          watcher: options.watcher,
          objectStoreMutex,
          onError,
        });
        scope.add(() => mount.dispose());
        return mount;
      },
    });

    this.checkouts = createManagedSource({
      key: (identity: CheckoutIdentity) => identity.checkoutId,
      graceMs: idleTtlMs,
      onError: (error, id) => onError(`git checkout ${id}`, error),
      create: async (identity, scope) => {
        const repositoryLease = this.repositories.acquire(repositoryIdentityOf(identity));
        scope.add(() => repositoryLease.release());
        const repository = await repositoryLease.ready();
        const checkout = new GitCheckout({
          identity,
          objectReader: repository.repository,
          exec: options.exec.withCwd(identity.checkoutRoot),
        });
        const mount = await CheckoutMount.create({
          identity,
          checkout,
          repository,
          watcher: options.watcher,
          maxFileDiffStates: options.maxFileDiffStates,
          onError,
        });
        scope.add(() => mount.dispose());
        return mount;
      },
    });
  }

  acquireRepository(selector: RepositorySelector): PendingLease<RepositoryHandle> {
    return this.acquireResolved(
      this.resolver.resolve(selector),
      (identity) => this.repositories.acquire(repositoryIdentityOf(identity)),
      (mount) => new RepositoryHandle(selector, mount)
    );
  }

  acquireCheckout(selector: CheckoutSelector): PendingLease<CheckoutHandle> {
    return this.acquireResolved(
      this.resolver.resolve(selector),
      (identity) => this.checkouts.acquire(identity),
      (mount) => new CheckoutHandle(selector, mount)
    );
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.checkouts.dispose();
    await this.repositories.dispose();
    if (this.ownsResolver) this.resolver.dispose();
  }

  private acquireResolved<Mount, Handle>(
    resolved: Promise<Result<CheckoutIdentity, GitResolutionError>>,
    acquire: (identity: CheckoutIdentity) => PendingLease<Mount>,
    handle: (mount: Mount) => Handle
  ): PendingLease<Handle> {
    this.assertActive();
    return toPendingLease(
      resolved.then(async (result): Promise<Lease<Handle>> => {
        if (!result.success) throw new GitResolutionException(result.error);
        const mountLease = acquire(result.data);
        const mount = await mountLease.ready();
        return { value: handle(mount), release: () => mountLease.release() };
      })
    );
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('GitAllocationGraph is disposed');
  }
}
