import { realpathSync } from 'node:fs';
import path from 'node:path';
import type { BoundExec } from '../exec';
import { FileWatchService, FsService, type IFileWatchService, type IFsService } from '../fs';
import { ResourceMap, type Lease } from '../lib';
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
  watch?: IFileWatchService;
  executable?: string;
  env?: NodeJS.ProcessEnv;
  exec?: BoundExec;
  onError?: GitOnError;
};

export class GitRuntime implements IGitRuntime {
  private readonly repositories: ResourceMap<GitRepository>;
  private readonly worktrees: ResourceMap<WorktreeResource>;
  private readonly objectStoreLocks = new Map<string, Promise<unknown>>();
  private readonly exec: BoundExec;
  private readonly fs: IFsService;
  private readonly watch: IFileWatchService;
  private readonly ownedWatch: FileWatchService | null;
  private readonly onError: GitOnError;
  private disposeRequested = false;

  constructor(options: GitRuntimeOptions = {}) {
    this.onError = options.onError ?? (() => {});
    const ownedWatch = options.watch ? null : new FileWatchService({ onError: this.onError });
    this.ownedWatch = ownedWatch;
    this.watch = options.watch ?? (ownedWatch as FileWatchService);
    this.fs = options.fs ?? new FsService();
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
          workTree: identity.topLevel,
          gitDir: identity.gitDir,
          repository: repositoryLease.value,
          exec: this.exec.withCwd(identity.topLevel),
          fs: this.fs,
          watch: this.watch,
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
        watch: this.watch,
        runObjectStoreWrite: (objectStoreDir, fn) => this.runObjectStoreWrite(objectStoreDir, fn),
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

  private async runObjectStoreWrite<T>(objectStoreDir: string, fn: () => Promise<T>): Promise<T> {
    const key = realpathOrResolve(objectStoreDir);
    const previous = this.objectStoreLocks.get(key) ?? Promise.resolve();

    let release: () => void = () => {};
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chained = previous.catch(() => {}).then(() => current);
    this.objectStoreLocks.set(key, chained);

    await previous.catch(() => {});
    try {
      return await fn();
    } finally {
      release();
      if (this.objectStoreLocks.get(key) === chained) {
        this.objectStoreLocks.delete(key);
      }
    }
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
    this.objectStoreLocks.clear();
    await this.ownedWatch?.dispose();
  }
}

function realpathOrResolve(filePath: string): string {
  try {
    return realpathSync.native(filePath);
  } catch {
    try {
      return realpathSync(filePath);
    } catch {
      return path.resolve(filePath);
    }
  }
}
