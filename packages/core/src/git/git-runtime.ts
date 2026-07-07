import path from 'node:path';
import { err, ok, type Lease, type Result } from '@emdash/shared';
import type { BoundExec } from '../exec';
import { KeyedMutex, ResourceMap } from '../lib';
import { WatchService, realpathOrResolve, type IWatchService } from '../watch';
import type { EnsureRepositoryOptions } from './api/commands';
import type { CloneRepositoryError, EnsureRepositoryError } from './api/errors';
import type { GitPathInspection, GitRepositoryInfo } from './api/queries';
import { computeBaseRef } from './base-ref';
import { GitCheckout } from './checkout/git-checkout';
import {
  classifyCloneRepositoryError,
  gitErrorMessage,
  isNotRepositoryInspectionError,
} from './errors';
import { createGitExec } from './git-env';
import { GitRepository } from './repository/git-repository';
import { execGitWithProgress, type GitOpContext } from './transfer-progress';
import type { CheckoutLease, GitOnError, IGitRuntime, RepoLease } from './types';

type CheckoutResource = {
  checkout: GitCheckout;
  repositoryLease: Lease<GitRepository>;
};

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

export class GitRuntime implements IGitRuntime {
  private readonly repositories: ResourceMap<GitRepository>;
  private readonly checkouts: ResourceMap<CheckoutResource>;
  private readonly mutex: KeyedMutex;
  private readonly exec: BoundExec;
  private readonly watcher: IWatchService;
  private readonly ownsWatcher: boolean;
  private readonly onError: GitOnError;
  private disposeRequested = false;

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

    this.repositories = new ResourceMap<GitRepository>({
      teardown: async (_key, repository) => {
        await repository.dispose();
      },
      onError: this.onError,
      onEmpty: () => {
        void this.disposeIfIdle();
      },
    });
    this.checkouts = new ResourceMap<CheckoutResource>({
      teardown: async (_key, resource) => {
        await resource.checkout.dispose();
        await resource.repositoryLease.release();
      },
      onError: this.onError,
      onEmpty: () => {
        void this.disposeIfIdle();
      },
    });
  }

  async inspectPath(pathToInspect: string): Promise<GitPathInspection> {
    this.assertOpen();
    return this.inspectResolvedPath(path.resolve(pathToInspect));
  }

  async ensureRepository(
    pathToInspect: string,
    options: EnsureRepositoryOptions = {}
  ): Promise<Result<GitRepositoryInfo, EnsureRepositoryError>> {
    this.assertOpen();
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
    this.assertOpen();
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
    this.assertOpen();
    const identity = await this.resolveIdentity(pathInsideRepo);
    return this.acquireRepository(identity);
  }

  async openCheckout(checkoutPath: string): Promise<CheckoutLease> {
    this.assertOpen();
    const identity = await this.resolveIdentity(checkoutPath);
    const lease = await this.checkouts.acquire(identity.topLevel, async () => {
      const repositoryLease = await this.acquireRepository(identity);
      try {
        const checkout = await GitCheckout.create({
          checkoutPath: identity.topLevel,
          gitDir: identity.gitDir,
          repository: repositoryLease.value,
          exec: this.exec.withCwd(identity.topLevel),
          watcher: this.watcher,
          onError: this.onError,
        });
        return { checkout, repositoryLease };
      } catch (error) {
        await repositoryLease.release();
        throw error;
      }
    });
    return { value: lease.value.checkout, release: lease.release };
  }

  async dispose(): Promise<void> {
    this.disposeRequested = true;
    const repositoriesDisposed = this.repositories.dispose();
    const checkoutsDisposed = this.checkouts.dispose();
    await checkoutsDisposed;
    await repositoriesDisposed;
    await this.disposeIfIdle();
  }

  private async acquireRepository(identity: GitIdentity): Promise<Lease<GitRepository>> {
    return this.repositories.acquire(identity.gitCommonDir, () =>
      GitRepository.create({
        gitCommonDir: identity.gitCommonDir,
        objectStoreDir: identity.objectStoreDir,
        exec: this.exec.withCwd(identity.topLevel),
        watcher: this.watcher,
        objectStoreMutex: this.mutex,
        onError: this.onError,
      })
    );
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

  private assertOpen(): void {
    if (this.disposeRequested) {
      throw new Error('GitRuntime disposed');
    }
  }

  private async disposeIfIdle(): Promise<void> {
    if (!this.disposeRequested) return;
    if (!this.checkouts.idle || !this.repositories.idle) return;
    if (this.ownsWatcher) await this.watcher.dispose();
  }
}
