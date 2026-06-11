import path from 'node:path';
import type { BoundExec } from '../exec';
import {
  FileWatchService,
  FsService,
  realpathOrResolve,
  type IFileWatchService,
  type IFsService,
} from '../fs';
import { KeyedMutex, ResourceMap, type Lease } from '../lib';
import { createGitExec } from './git-env';
import { GitRepository, type GitOnError } from './git-repository';
import { GitWorktree } from './git-worktree';
import type { IGitRuntime, RepoLease, WorktreeLease } from './types';

type WorktreeResource = {
  worktree: GitWorktree;
  repositoryLease: Lease<GitRepository>;
};

type GitIdentity = {
  topLevel: string;
  gitDir: string;
  gitCommonDir: string;
  objectStoreDir: string;
};

export type GitRuntimeOptions = {
  fs?: IFsService;
  /**
   * File-watch service to use. Injected services are disposed by the injector;
   * when omitted, the runtime creates and disposes its own service.
   */
  watcher?: IFileWatchService;
  executable?: string;
  env?: NodeJS.ProcessEnv;
  exec?: BoundExec;
  onError?: GitOnError;
};

export class GitRuntime implements IGitRuntime {
  private readonly repositories: ResourceMap<GitRepository>;
  private readonly worktrees: ResourceMap<WorktreeResource>;
  private readonly mutex: KeyedMutex;
  private readonly exec: BoundExec;
  private readonly fs: IFsService;
  private readonly watcher: IFileWatchService;
  private readonly ownsWatcher: boolean;
  private readonly onError: GitOnError;
  private disposeRequested = false;

  constructor(options: GitRuntimeOptions = {}) {
    this.onError = options.onError ?? (() => {});
    this.ownsWatcher = !options.watcher;
    this.watcher = options.watcher ?? new FileWatchService({ onError: this.onError });
    this.fs = options.fs ?? new FsService();
    this.mutex = new KeyedMutex();
    this.exec =
      options.exec ??
      createGitExec({
        cwd: process.cwd(),
        executable: options.executable,
        env: options.env,
      });

    this.repositories = new ResourceMap<GitRepository>({
      teardown: (_key, repository) => {
        repository.dispose();
      },
      onError: this.onError,
      onEmpty: () => {
        void this.disposeIfIdle();
      },
    });
    this.worktrees = new ResourceMap<WorktreeResource>({
      teardown: (_key, resource) => {
        resource.worktree.dispose();
        resource.repositoryLease.release();
      },
      onError: this.onError,
      onEmpty: () => {
        void this.disposeIfIdle();
      },
    });
  }

  async openRepository(pathInsideRepo: string): Promise<RepoLease> {
    this.assertOpen();
    const identity = await this.resolveIdentity(pathInsideRepo);
    return this.acquireRepository(identity);
  }

  async openWorktree(worktreePath: string): Promise<WorktreeLease> {
    this.assertOpen();
    const identity = await this.resolveIdentity(worktreePath);
    const lease = await this.worktrees.acquire(identity.topLevel, async () => {
      const repositoryLease = await this.acquireRepository(identity);
      try {
        const worktree = new GitWorktree({
          worktree: identity.topLevel,
          gitDir: identity.gitDir,
          repository: repositoryLease.value,
          exec: this.exec.withCwd(identity.topLevel),
          fs: this.fs,
          watcher: this.watcher,
          onError: this.onError,
        });
        try {
          await worktree.ready();
        } catch (error) {
          worktree.dispose();
          throw error;
        }
        return { worktree, repositoryLease };
      } catch (error) {
        repositoryLease.release();
        throw error;
      }
    });
    return { value: lease.value.worktree, release: lease.release };
  }

  async dispose(): Promise<void> {
    this.disposeRequested = true;
    this.repositories.dispose();
    this.worktrees.dispose();
    await this.disposeIfIdle();
  }

  private async acquireRepository(identity: GitIdentity): Promise<Lease<GitRepository>> {
    return this.repositories.acquire(identity.gitCommonDir, async () => {
      const repository = new GitRepository({
        gitCommonDir: identity.gitCommonDir,
        objectStoreDir: identity.objectStoreDir,
        exec: this.exec.withCwd(identity.topLevel),
        watcher: this.watcher,
        objectStoreMutex: this.mutex,
        onError: this.onError,
      });
      try {
        await repository.ready();
      } catch (error) {
        repository.dispose();
        throw error;
      }
      return repository;
    });
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

  private assertOpen(): void {
    if (this.disposeRequested) {
      throw new Error('GitRuntime disposed');
    }
  }

  private async disposeIfIdle(): Promise<void> {
    if (!this.disposeRequested) return;
    if (!this.worktrees.idle || !this.repositories.idle) return;
    if (this.ownsWatcher) await this.watcher.dispose();
  }
}
