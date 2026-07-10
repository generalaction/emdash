import type { BoundExec } from '@emdash/core/exec';
import type { BoundFileDiffKey, CheckoutSelector, RepositorySelector } from '@emdash/core/git';
import { KeyedMutex } from '@emdash/core/lib';
import type { IWatchService } from '@emdash/core/watch';
import { toPendingLease, type Lease, type PendingLease, type Result } from '@emdash/shared';
import { createManagedSource, type ManagedSource } from '@emdash/wire/util';
import { GitCheckout } from '../checkout/git-checkout';
import { CanonicalGitIdentityResolver } from '../identity/resolver';
import {
  repositoryIdentityOf,
  type CheckoutId,
  type CheckoutIdentity,
  type GitIdentityResolver,
  type GitResolutionError,
  type RepositoryId,
  type RepositoryIdentity,
} from '../identity/types';
import { GitRepository } from '../repository/git-repository';
import { CheckoutMount, type CheckoutStateName } from './checkout-mount';
import type { CheckoutOperation, RepositoryOperation } from './effect-policy';
import type { GitExecution, RepositoryStateName } from './repository-mount';
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

export class RepositoryHandle {
  readonly id: RepositoryId;

  constructor(
    readonly selector: RepositorySelector,
    private readonly mount: RepositoryMount
  ) {
    this.id = mount.identity.repositoryId;
  }

  state(name: RepositoryStateName) {
    return this.mount.state(name);
  }

  query<T>(read: (repository: GitRepository) => Promise<T>): Promise<T> {
    return this.mount.query(read);
  }

  mutate<T, E>(
    operation: RepositoryOperation,
    mutationId: string | undefined,
    run: (repository: GitRepository) => Promise<Result<T, E>>,
    options?: { objectTransfer?: boolean }
  ): Promise<GitExecution<T, E>> {
    return this.mount.mutate(operation, mutationId, run, options);
  }

  runJob<T, E>(
    operation: RepositoryOperation,
    run: (repository: GitRepository) => Promise<Result<T, E>>,
    options?: { objectTransfer?: boolean }
  ): Promise<Result<T, E>> {
    return this.mount.runJob(operation, run, options);
  }
}

export class CheckoutHandle {
  readonly id: CheckoutId;
  readonly repositoryId: RepositoryId;

  constructor(
    readonly selector: CheckoutSelector,
    private readonly mount: CheckoutMount
  ) {
    this.id = mount.identity.checkoutId;
    this.repositoryId = mount.identity.repositoryId;
  }

  state(name: CheckoutStateName) {
    return this.mount.state(name);
  }

  acquireFileDiffStaleness(key: BoundFileDiffKey) {
    return this.mount.acquireFileDiffStaleness(key);
  }

  query<T>(read: (checkout: GitCheckout) => Promise<T>): Promise<T> {
    return this.mount.query(read);
  }

  mutate<T, E>(
    operation: CheckoutOperation,
    paths: 'all' | readonly string[],
    mutationId: string | undefined,
    run: (checkout: GitCheckout) => Promise<Result<T, E>>,
    options?: { objectTransfer?: boolean }
  ): Promise<GitExecution<T, E>> {
    return this.mount.mutate(operation, paths, mutationId, run, options);
  }

  runJob<T, E>(
    operation: CheckoutOperation,
    run: (checkout: GitCheckout) => Promise<Result<T, E>>,
    options?: { objectTransfer?: boolean }
  ): Promise<Result<T, E>> {
    return this.mount.runJob(operation, run, options);
  }
}

/** Canonical repository -> checkout allocation graph with parent retention and idle TTL. */
export class GitAllocationGraph {
  private readonly resolver: GitIdentityResolver;
  private readonly ownsResolver: boolean;
  private readonly repositories: ManagedSource<RepositoryIdentity, RepositoryMount>;
  private readonly checkouts: ManagedSource<CheckoutIdentity, CheckoutMount>;
  private readonly repositoryIdentities = new Map<RepositoryId, RepositoryIdentity>();
  private readonly checkoutIdentities = new Map<CheckoutId, CheckoutIdentity>();
  private readonly repositoryAliases = new Map<RepositoryId, Set<string>>();
  private readonly checkoutAliases = new Map<CheckoutId, Set<string>>();
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
        const repository = await GitRepository.create({ identity, exec: options.exec });
        let mount: RepositoryMount;
        try {
          mount = await RepositoryMount.create({
            identity,
            repository,
            watcher: options.watcher,
            objectStoreMutex,
            onError,
          });
        } catch (error) {
          await repository.dispose();
          throw error;
        }
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
        const checkout = await GitCheckout.create({
          identity,
          objectReader: repository.repository,
          exec: options.exec.withCwd(identity.checkoutRoot),
        });
        let mount: CheckoutMount;
        try {
          mount = await CheckoutMount.create({
            identity,
            checkout,
            repository,
            watcher: options.watcher,
            maxFileDiffStates: options.maxFileDiffStates,
            onError,
          });
        } catch (error) {
          await checkout.dispose();
          throw error;
        }
        scope.add(() => mount.dispose());
        return mount;
      },
    });
  }

  acquireRepository(selector: RepositorySelector): PendingLease<RepositoryHandle> {
    return this.acquireResolved(
      this.resolver.resolve(selector),
      (identity) => {
        const repositoryIdentity = repositoryIdentityOf(identity);
        this.repositoryIdentities.set(repositoryIdentity.repositoryId, repositoryIdentity);
        this.checkoutIdentities.set(identity.checkoutId, identity);
        rememberAlias(this.repositoryAliases, identity.repositoryId, selector.repository.path);
        return this.repositories.acquire(repositoryIdentity);
      },
      (mount) => new RepositoryHandle(selector, mount)
    );
  }

  acquireCheckout(selector: CheckoutSelector): PendingLease<CheckoutHandle> {
    return this.acquireResolved(
      this.resolver.resolve(selector),
      (identity) => {
        this.repositoryIdentities.set(identity.repositoryId, repositoryIdentityOf(identity));
        this.checkoutIdentities.set(identity.checkoutId, identity);
        rememberAlias(this.repositoryAliases, identity.repositoryId, selector.checkout.path);
        rememberAlias(this.checkoutAliases, identity.checkoutId, selector.checkout.path);
        return this.checkouts.acquire(identity);
      },
      (mount) => new CheckoutHandle(selector, mount)
    );
  }

  retainRepository(id: RepositoryId): PendingLease<RepositoryHandle> | null {
    const identity = this.repositoryIdentities.get(id);
    if (!identity) return null;
    const selector = { repository: { path: identity.gitCommonDir } };
    return mapPendingLease(
      this.repositories.acquire(identity),
      (mount) => new RepositoryHandle(selector, mount)
    );
  }

  retainCheckout(id: CheckoutId): PendingLease<CheckoutHandle> | null {
    const identity = this.checkoutIdentities.get(id);
    if (!identity) return null;
    const selector = { checkout: { path: identity.checkoutRoot } };
    return mapPendingLease(
      this.checkouts.acquire(identity),
      (mount) => new CheckoutHandle(selector, mount)
    );
  }

  invalidateAliases(id: RepositoryId | CheckoutId): void {
    const repositoryId = id as RepositoryId;
    const repository = this.repositoryIdentities.get(repositoryId);
    if (repository) {
      const aliases = this.repositoryAliases.get(repositoryId) ?? [repository.gitCommonDir];
      for (const path of aliases) this.resolver.invalidate({ repository: { path } });
      this.repositoryAliases.delete(repositoryId);
      this.repositoryIdentities.delete(id as RepositoryId);
    }
    const checkoutId = id as CheckoutId;
    const checkout = this.checkoutIdentities.get(checkoutId);
    if (checkout) {
      const aliases = this.checkoutAliases.get(checkoutId) ?? [checkout.checkoutRoot];
      for (const path of aliases) this.resolver.invalidate({ checkout: { path } });
      this.checkoutAliases.delete(checkoutId);
      this.checkoutIdentities.delete(checkoutId);
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.checkouts.dispose();
    await this.repositories.dispose();
    if (this.ownsResolver) this.resolver.dispose();
    this.checkoutIdentities.clear();
    this.repositoryIdentities.clear();
    this.checkoutAliases.clear();
    this.repositoryAliases.clear();
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

function mapPendingLease<T, U>(lease: PendingLease<T>, map: (value: T) => U): PendingLease<U> {
  return toPendingLease(
    lease.ready().then((value): Lease<U> => ({ value: map(value), release: lease.release }))
  );
}

function rememberAlias<Id>(aliases: Map<Id, Set<string>>, id: Id, path: string): void {
  const current = aliases.get(id);
  if (current) current.add(path);
  else aliases.set(id, new Set([path]));
}
