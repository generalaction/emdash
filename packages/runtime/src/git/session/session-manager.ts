import path from 'node:path';
import type { BoundExec } from '@emdash/core/exec';
import {
  gitErr,
  toGitCommandError,
  type CheckoutKey,
  type GitCommandError,
  type RepositoryKey,
} from '@emdash/core/git';
import type { KeyedMutex } from '@emdash/core/lib';
import { realpathOrResolve, type IWatchService } from '@emdash/core/watch';
import { err, ok, type PendingLease, type Result } from '@emdash/shared';
import type { LiveSource } from '@emdash/wire';
import { createManagedSource, type ManagedSource } from '@emdash/wire/util';
import { GitCheckout } from '../checkout/git-checkout';
import { createCheckoutLiveHost, type CheckoutLiveHost } from '../checkout/live-models';
import { createCheckoutMutationHandlers } from '../checkout/mutations';
import { CheckoutResource } from '../checkout/resource';
import { GitRepository } from '../repository/git-repository';
import { createRepositoryLiveHost, type RepositoryLiveHost } from '../repository/live-models';
import { createRepositoryMutationHandlers } from '../repository/mutations';
import { RepositoryResource } from '../repository/resource';
import type { GitIdentity, GitOnError, GitSessionManagerOptions } from './identity';

export class GitSessionManager {
  readonly repositoryHost: RepositoryLiveHost;
  readonly checkoutHost: CheckoutLiveHost;

  private readonly repositories: ManagedSource<GitIdentity, RepositoryResource>;
  private readonly checkouts: ManagedSource<GitIdentity, CheckoutResource>;
  private readonly repositoryEntriesByKey = new Map<string, RepositoryResource>();
  private readonly checkoutEntriesByKey = new Map<string, CheckoutResource>();
  private readonly openRepositoryLeases = new Map<string, PendingLease<RepositoryResource>[]>();
  private readonly openCheckoutLeases = new Map<string, PendingLease<CheckoutResource>[]>();
  private readonly exec: BoundExec;
  private readonly watcher: IWatchService;
  private readonly objectStoreMutex: KeyedMutex;
  private readonly onError: GitOnError;

  constructor(options: GitSessionManagerOptions) {
    this.exec = options.exec;
    this.watcher = options.watcher;
    this.objectStoreMutex = options.objectStoreMutex;
    this.onError = options.onError ?? (() => {});
    this.repositoryHost = createRepositoryLiveHost(
      createRepositoryMutationHandlers((key) => this.requireRepositorySession(key))
    );
    this.checkoutHost = createCheckoutLiveHost(
      createCheckoutMutationHandlers((key) => this.requireCheckoutSession(key))
    );

    this.repositories = createManagedSource<GitIdentity, RepositoryResource>({
      key: (identity) => identity.gitCommonDir,
      graceMs: 0,
      onError: (error, key) => this.onError(`git repository ${key}`, error),
      create: async (identity, scope) => {
        const repository = await GitRepository.create({
          gitCommonDir: identity.gitCommonDir,
          objectStoreDir: identity.objectStoreDir,
          exec: this.exec.withCwd(identity.topLevel),
          objectStoreMutex: this.objectStoreMutex,
        });
        const resource = await RepositoryResource.create({
          key: { repositoryRoot: identity.topLevel },
          repository,
          host: this.repositoryHost,
          watcher: this.watcher,
          onError: this.onError,
        });
        this.repositoryEntriesByKey.set(resource.key.repositoryRoot, resource);
        scope.add(async () => {
          this.repositoryEntriesByKey.delete(resource.key.repositoryRoot);
          await resource.dispose();
          await repository.dispose();
        });
        return resource;
      },
    });

    this.checkouts = createManagedSource<GitIdentity, CheckoutResource>({
      key: (identity) => identity.topLevel,
      graceMs: 0,
      onError: (error, key) => this.onError(`git checkout ${key}`, error),
      create: async (identity, scope) => {
        const repositoryLease = this.repositories.acquire(identity);
        scope.add(() => repositoryLease.release());
        const repositoryResource = await repositoryLease.ready();
        const checkout = await GitCheckout.create({
          checkoutPath: identity.topLevel,
          gitDir: identity.gitDir,
          repository: repositoryResource.repository,
          exec: this.exec.withCwd(identity.topLevel),
        });
        const resource = await CheckoutResource.create({
          key: { checkoutPath: identity.topLevel },
          checkout,
          repository: repositoryResource,
          host: this.checkoutHost,
          watcher: this.watcher,
          onError: this.onError,
        });
        this.checkoutEntriesByKey.set(resource.key.checkoutPath, resource);
        scope.add(async () => {
          this.checkoutEntriesByKey.delete(resource.key.checkoutPath);
          await resource.dispose();
          await checkout.dispose();
        });
        return resource;
      },
    });
  }

  async startRepositorySession(
    pathInsideRepo: string
  ): Promise<Result<RepositoryKey, GitCommandError>> {
    const identity = await this.resolveIdentity(pathInsideRepo).catch((error) => error);
    if (identity instanceof Error) return err(toGitCommandError(identity));
    if (!isGitIdentity(identity)) return err(toGitCommandError(identity));

    const lease = this.repositories.acquire(identity);
    try {
      const resource = await lease.ready();
      retain(this.openRepositoryLeases, resource.key.repositoryRoot, lease);
      return ok(resource.key);
    } catch (error) {
      await lease.release();
      return err(toGitCommandError(error));
    }
  }

  async stopRepositorySession(key: RepositoryKey): Promise<void> {
    await releaseOne(this.openRepositoryLeases, key.repositoryRoot);
  }

  requireRepositorySession(key: RepositoryKey): Result<RepositoryResource, GitCommandError> {
    if (!this.openRepositoryLeases.has(key.repositoryRoot)) {
      return err(gitErr.notOpen('repository', key.repositoryRoot));
    }
    const resource = this.repositoryEntriesByKey.get(key.repositoryRoot);
    if (!resource) return err(gitErr.notOpen('repository', key.repositoryRoot));
    return ok(resource);
  }

  async startCheckoutSession(checkoutPath: string): Promise<Result<CheckoutKey, GitCommandError>> {
    const identity = await this.resolveIdentity(checkoutPath).catch((error) => error);
    if (identity instanceof Error) return err(toGitCommandError(identity));
    if (!isGitIdentity(identity)) return err(toGitCommandError(identity));

    const lease = this.checkouts.acquire(identity);
    try {
      const resource = await lease.ready();
      retain(this.openCheckoutLeases, resource.key.checkoutPath, lease);
      return ok(resource.key);
    } catch (error) {
      await lease.release();
      return err(toGitCommandError(error));
    }
  }

  async stopCheckoutSession(key: CheckoutKey): Promise<void> {
    await releaseOne(this.openCheckoutLeases, key.checkoutPath);
  }

  requireCheckoutSession(key: CheckoutKey): Result<CheckoutResource, GitCommandError> {
    if (!this.openCheckoutLeases.has(key.checkoutPath)) {
      return err(gitErr.notOpen('checkout', key.checkoutPath));
    }
    const resource = this.checkoutEntriesByKey.get(key.checkoutPath);
    if (!resource) return err(gitErr.notOpen('checkout', key.checkoutPath));
    return ok(resource);
  }

  checkoutFileDiffSource(key: CheckoutKey, filePath: string): LiveSource | null {
    const session = this.requireCheckoutSession(key);
    if (!session.success) return null;
    return session.data.fileDiffStaleness(filePath);
  }

  async readRepository<T>(
    key: RepositoryKey,
    read: (resource: RepositoryResource) => Promise<T> | T
  ): Promise<Result<T, GitCommandError>> {
    const session = this.requireRepositorySession(key);
    if (!session.success) return session;
    try {
      return ok(await read(session.data));
    } catch (error) {
      return err(toGitCommandError(error));
    }
  }

  async readCheckout<T>(
    key: CheckoutKey,
    read: (resource: CheckoutResource) => Promise<T> | T
  ): Promise<Result<T, GitCommandError>> {
    const session = this.requireCheckoutSession(key);
    if (!session.success) return session;
    try {
      return ok(await read(session.data));
    } catch (error) {
      return err(toGitCommandError(error));
    }
  }

  async dispose(): Promise<void> {
    await releaseAll(this.openCheckoutLeases);
    await releaseAll(this.openRepositoryLeases);
    await this.checkouts.dispose();
    await this.repositories.dispose();
    this.checkoutHost.dispose();
    this.repositoryHost.dispose();
  }

  private async resolveIdentity(pathInsideRepo: string): Promise<GitIdentity> {
    const cwd = path.resolve(pathInsideRepo);
    const exec = this.exec.withCwd(cwd);
    const [topLevel, gitDir, gitCommonDir, objectStoreDir] = await Promise.all([
      exec.exec(['rev-parse', '--show-toplevel']).then((result) => result.stdout.trim()),
      exec
        .exec(['rev-parse', '--path-format=absolute', '--git-dir'])
        .then((result) => result.stdout.trim()),
      exec
        .exec(['rev-parse', '--path-format=absolute', '--git-common-dir'])
        .then((result) => result.stdout.trim()),
      exec
        .exec(['rev-parse', '--path-format=absolute', '--git-path', 'objects'])
        .then((result) => result.stdout.trim()),
    ]);

    return {
      topLevel: realpathOrResolve(topLevel),
      gitDir: realpathOrResolve(gitDir),
      gitCommonDir: realpathOrResolve(gitCommonDir),
      objectStoreDir: realpathOrResolve(objectStoreDir),
    };
  }
}

function retain<T>(
  ledger: Map<string, PendingLease<T>[]>,
  key: string,
  lease: PendingLease<T>
): void {
  const leases = ledger.get(key);
  if (leases) leases.push(lease);
  else ledger.set(key, [lease]);
}

async function releaseOne<T>(ledger: Map<string, PendingLease<T>[]>, key: string): Promise<void> {
  const leases = ledger.get(key);
  const lease = leases?.pop();
  if (leases && leases.length === 0) ledger.delete(key);
  if (lease) await lease.release();
}

async function releaseAll<T>(ledger: Map<string, PendingLease<T>[]>): Promise<void> {
  const releases: Promise<void>[] = [];
  for (const leases of ledger.values()) {
    for (const lease of leases) releases.push(lease.release());
  }
  ledger.clear();
  await Promise.all(releases);
}

function isGitIdentity(value: unknown): value is GitIdentity {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Partial<GitIdentity>).topLevel === 'string' &&
    typeof (value as Partial<GitIdentity>).gitDir === 'string' &&
    typeof (value as Partial<GitIdentity>).gitCommonDir === 'string' &&
    typeof (value as Partial<GitIdentity>).objectStoreDir === 'string'
  );
}
