import path from 'node:path';
import { err, ok, type Result } from '@emdash/shared';
import { createLiveModelHost, type LiveModelHost } from '@emdash/wire';
import { createManagedSource, type ManagedSource } from '@emdash/wire/util';
import type { BoundExec } from '../exec';
import { KeyedMutex } from '../lib';
import { WatchService, realpathOrResolve, type IWatchService } from '../watch';
import type { EnsureRepositoryOptions } from './api/commands';
import type { CloneRepositoryError, EnsureRepositoryError } from './api/errors';
import type { GitPathInspection, GitRepositoryInfo } from './api/queries';
import { computeBaseRef } from './base-ref';
import { gitCheckoutContract } from './checkout/contract';
import { GitCheckout } from './checkout/git-checkout';
import { CheckoutLiveEntry, createCheckoutMutationHandlers } from './checkout/live';
import {
  classifyCloneRepositoryError,
  gitErrorMessage,
  isNotRepositoryInspectionError,
} from './errors';
import { createGitExec } from './git-env';
import { gitRepositoryContract } from './repository/api/contract';
import { GitRepository } from './repository/git-repository';
import { createRepositoryMutationHandlers, RepositoryLiveEntry } from './repository/live';
import { execGitWithProgress, type GitOpContext } from './transfer-progress';
import type {
  CheckoutLease,
  CheckoutLiveLease,
  GitOnError,
  IGitWireRuntime,
  RepositoryLiveLease,
  RepoLease,
} from './types';

type GitIdentity = {
  topLevel: string;
  gitDir: string;
  gitCommonDir: string;
  objectStoreDir: string;
};

export type GitRuntimeOptions = {
  watcher?: IWatchService;
  executable?: string;
  env?: NodeJS.ProcessEnv;
  exec?: BoundExec;
  onError?: GitOnError;
};

export class GitRuntime implements IGitWireRuntime {
  readonly repositoryHost: LiveModelHost<typeof gitRepositoryContract.model>;
  readonly checkoutHost: LiveModelHost<typeof gitCheckoutContract.model>;

  private readonly repositories: ManagedSource<GitIdentity, RepositoryLiveEntry>;
  private readonly checkouts: ManagedSource<GitIdentity, CheckoutLiveEntry>;
  private readonly repositoryEntriesByKey = new Map<string, RepositoryLiveEntry>();
  private readonly checkoutEntriesByKey = new Map<string, CheckoutLiveEntry>();
  private readonly mutex: KeyedMutex;
  private readonly exec: BoundExec;
  private readonly watcher: IWatchService;
  private readonly ownsWatcher: boolean;
  private readonly onError: GitOnError;

  constructor(options: GitRuntimeOptions = {}) {
    this.onError = options.onError ?? (() => {});
    this.ownsWatcher = !options.watcher;
    this.watcher = options.watcher ?? new WatchService({ onError: this.onError });
    this.mutex = new KeyedMutex();
    this.exec =
      options.exec ??
      createGitExec({
        cwd: process.cwd(),
        executable: options.executable,
        env: options.env,
      });
    this.repositoryHost = createLiveModelHost(gitRepositoryContract.model, {
      mutations: createRepositoryMutationHandlers((key) =>
        this.repositoryEntriesByKey.get(key.repositoryRoot)
      ),
    });
    this.checkoutHost = createLiveModelHost(gitCheckoutContract.model, {
      mutations: createCheckoutMutationHandlers((key) =>
        this.checkoutEntriesByKey.get(key.checkoutPath)
      ),
    });

    // One `GitRepository` per common git dir; one `GitCheckout` per working
    // tree. `graceMs` is 0 so the last release tears the resource (and its
    // watch handles) down synchronously — `dispose()` then awaits any in-flight
    // teardown. Each checkout's scope holds a lease on its backing repository,
    // so the repository outlives every checkout that depends on it.
    this.repositories = createManagedSource<GitIdentity, RepositoryLiveEntry>({
      key: (identity) => identity.gitCommonDir,
      onError: (error, key) => this.onError(`git repository ${key}`, error),
      create: async (identity, scope) => {
        const repository = await GitRepository.create({
          gitCommonDir: identity.gitCommonDir,
          objectStoreDir: identity.objectStoreDir,
          exec: this.exec.withCwd(identity.topLevel),
          objectStoreMutex: this.mutex,
        });
        const entry = await RepositoryLiveEntry.create({
          key: { repositoryRoot: identity.topLevel },
          repository,
          host: this.repositoryHost,
          watcher: this.watcher,
          onError: this.onError,
        });
        this.repositoryEntriesByKey.set(entry.key.repositoryRoot, entry);
        scope.add(async () => {
          this.repositoryEntriesByKey.delete(entry.key.repositoryRoot);
          await entry.dispose();
          await repository.dispose();
        });
        return entry;
      },
    });
    this.checkouts = createManagedSource<GitIdentity, CheckoutLiveEntry>({
      key: (identity) => identity.topLevel,
      onError: (error, key) => this.onError(`git checkout ${key}`, error),
      create: async (identity, scope) => {
        const repositoryLease = this.repositories.acquire(identity);
        scope.add(() => repositoryLease.release());
        const repositoryEntry = await repositoryLease.ready();
        const checkout = await GitCheckout.create({
          checkoutPath: identity.topLevel,
          gitDir: identity.gitDir,
          repository: repositoryEntry.repository,
          exec: this.exec.withCwd(identity.topLevel),
        });
        const entry = await CheckoutLiveEntry.create({
          key: { checkoutPath: identity.topLevel },
          checkout,
          repository: repositoryEntry,
          host: this.checkoutHost,
          watcher: this.watcher,
          onError: this.onError,
        });
        this.checkoutEntriesByKey.set(entry.key.checkoutPath, entry);
        scope.add(async () => {
          this.checkoutEntriesByKey.delete(entry.key.checkoutPath);
          await entry.dispose();
          await checkout.dispose();
        });
        return entry;
      },
    });
  }

  async inspectPath(pathToInspect: string): Promise<GitPathInspection> {
    return this.inspectResolvedPath(path.resolve(pathToInspect));
  }

  async ensureRepository(
    pathToInspect: string,
    options: EnsureRepositoryOptions = {}
  ): Promise<Result<GitRepositoryInfo, EnsureRepositoryError>> {
    const resolvedPath = path.resolve(pathToInspect);
    const inspected = await this.inspectResolvedPath(resolvedPath);
    if (inspected.kind === 'repository') return ok(inspected);
    if (inspected.kind === 'inspect-failed') {
      return err({ type: 'inspect-failed', path: inspected.path, message: inspected.message });
    }
    if (!options.initIfMissing) {
      return err({ type: 'not-repository', path: inspected.path });
    }

    try {
      await this.exec.withCwd(resolvedPath).exec(['init']);
    } catch (error) {
      return err({ type: 'init-failed', path: resolvedPath, message: gitErrorMessage(error) });
    }

    const initialized = await this.inspectResolvedPath(resolvedPath);
    if (initialized.kind === 'repository') return ok(initialized);
    if (initialized.kind === 'inspect-failed') {
      return err({
        type: 'inspect-failed',
        path: initialized.path,
        message: initialized.message,
      });
    }
    return err({
      type: 'init-failed',
      path: resolvedPath,
      message: 'Failed to initialize git repository',
    });
  }

  async cloneRepository(
    repositoryUrl: string,
    targetPath: string,
    context: GitOpContext = {}
  ): Promise<Result<GitRepositoryInfo, CloneRepositoryError>> {
    const resolvedTargetPath = path.resolve(targetPath);
    try {
      await execGitWithProgress(
        this.exec.withCwd(path.dirname(resolvedTargetPath)),
        ['clone', '--progress', repositoryUrl, resolvedTargetPath],
        context
      );
    } catch (error) {
      if (context.signal?.aborted) throw error;
      return err(classifyCloneRepositoryError(error, resolvedTargetPath));
    }

    const inspected = await this.inspectResolvedPath(resolvedTargetPath);
    if (inspected.kind === 'repository') return ok(inspected);
    if (inspected.kind === 'inspect-failed') {
      return err({ type: 'git_error', message: inspected.message });
    }
    return err({
      type: 'git_error',
      message: `Cloned path is not a git repository: ${resolvedTargetPath}`,
    });
  }

  async openRepository(pathInsideRepo: string): Promise<RepoLease> {
    const lease = await this.openRepositoryLive(pathInsideRepo);
    return { value: lease.value.repository, release: lease.release };
  }

  async openRepositoryLive(pathInsideRepo: string): Promise<RepositoryLiveLease> {
    const identity = await this.resolveIdentity(pathInsideRepo);
    const lease = this.repositories.acquire(identity);
    const value = await lease.ready();
    return { value, release: lease.release };
  }

  async openCheckout(checkoutPath: string): Promise<CheckoutLease> {
    const lease = await this.openCheckoutLive(checkoutPath);
    return { value: lease.value.checkout, release: lease.release };
  }

  async openCheckoutLive(checkoutPath: string): Promise<CheckoutLiveLease> {
    const identity = await this.resolveIdentity(checkoutPath);
    const lease = this.checkouts.acquire(identity);
    const value = await lease.ready();
    return { value, release: lease.release };
  }

  async dispose(): Promise<void> {
    // Checkouts depend on repositories, so tear checkouts down first; each
    // checkout scope releases its repository lease as part of teardown.
    await this.checkouts.dispose();
    await this.repositories.dispose();
    this.checkoutHost.dispose();
    this.repositoryHost.dispose();
    if (this.ownsWatcher) await this.watcher.dispose();
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

  private async inspectResolvedPath(resolvedPath: string): Promise<GitPathInspection> {
    const exec = (args: string[]) => this.exec.exec(['-C', resolvedPath, ...args]);
    try {
      const { stdout } = await exec(['rev-parse', '--is-inside-work-tree']);
      if (stdout.trim() !== 'true') return { kind: 'not-repository', path: resolvedPath };
    } catch (error) {
      if (isNotRepositoryInspectionError(error)) {
        return { kind: 'not-repository', path: resolvedPath };
      }
      return {
        kind: 'inspect-failed',
        path: resolvedPath,
        message: gitErrorMessage(error),
      };
    }

    let remoteName: string | undefined;
    try {
      const { stdout } = await exec(['remote']);
      const remotes = stdout.trim().split('\n').filter(Boolean);
      remoteName = remotes.includes('origin') ? 'origin' : remotes[0];
    } catch {}

    let branch: string | undefined;
    try {
      const { stdout } = await exec(['branch', '--show-current']);
      branch = stdout.trim() || undefined;
    } catch {}

    if (!branch && remoteName) {
      try {
        const { stdout } = await exec(['remote', 'show', remoteName]);
        const match = /HEAD branch:\s*(\S+)/.exec(stdout);
        branch = match?.[1] ?? undefined;
      } catch {}
    }

    let rootPath = resolvedPath;
    try {
      const { stdout } = await exec(['rev-parse', '--show-toplevel']);
      const trimmed = stdout.trim();
      if (trimmed) rootPath = realpathOrResolve(trimmed);
    } catch {}

    return {
      kind: 'repository',
      rootPath,
      baseRef: computeBaseRef(undefined, remoteName, branch),
    };
  }
}
