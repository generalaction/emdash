import path from 'node:path';
import {
  classifyCloneRepositoryError,
  gitErrorMessage,
  toGitCommandError,
  TooManyFilesChangedError,
} from '@emdash/core/git';
import type {
  CloneRepositoryError,
  CommitError,
  CreateBranchError,
  DeleteBranchError,
  FetchError,
  FetchPrForReviewError,
  GitCommandError,
  PullError,
  PushError,
} from '@emdash/core/git';
import type {
  CreateBranchOptions,
  EnsureRepositoryError,
  EnsureRepositoryOptions,
  FetchPrForReviewOptions,
  GitLogOptions,
  GitPathInspection,
  GitRepositoryInfo,
  GitRepoSnapshot,
  GitRepoUpdate,
  GitSequences,
  GitWorktreeSnapshot,
  GitWorktreeUpdate,
  IGitRepository,
  IGitRuntime,
  IGitWorktree,
  SubscribedSnapshot,
} from '@emdash/core/git';
import type { ImageReadResult } from '@emdash/core/git';
import type { DiffTarget } from '@emdash/core/git';
import type { CommitFile, GitLogResult } from '@emdash/core/git';
import type { GitRefsModel, GitRemote, GitRemotesModel } from '@emdash/core/git';
import type { GitHeadModel } from '@emdash/core/git';
import type {
  GitChange,
  GitStatusFingerprint,
  GitStatusModel,
  GitStatusUntrackedMode,
} from '@emdash/core/git';
import { err, ok, type Lease, type Result, type Unsubscribe } from '@emdash/shared';
import { Result as ResultUtil } from '@emdash/shared/result';
import { createResourceCache, type ResourceCache } from '@emdash/wire/util';
import { SshExecutionContext } from '@main/core/execution-context/ssh-execution-context';
import { GitService } from '@main/core/git/legacy/git-service';
import type { SshClientProxy } from '@main/core/ssh/lifecycle/ssh-client-proxy';
import { log } from '@main/lib/logger';
import type { ImageReadResult as LegacyImageReadResult } from '@shared/core/git/types';
import { LegacySshFileSystem } from './ssh-file-system';

const STATUS_POLL_MS = 10_000;
const UNTRACKED_STATUS_POLL_MS = 30_000;
const HEAD_POLL_MS = 10_000;
const REFS_POLL_MS = 15_000;
const REMOTES_POLL_MS = 60_000;

type LegacyRepositoryResource = {
  repository: LegacySshGitRepository;
};

type LegacyRepositoryKey = {
  gitCommonDir: string;
  pathInsideRepo: string;
};

type LegacyWorktreeResource = {
  worktree: LegacySshGitWorktree;
};

/**
 * Legacy SSH compatibility layer. SSH projects still execute Git through the main
 * process until the shared Git runtime can run on the remote machine.
 */
export class LegacySshGitRuntime implements IGitRuntime {
  private readonly repositories: ResourceCache<LegacyRepositoryKey, LegacyRepositoryResource>;
  private readonly worktrees: ResourceCache<string, LegacyWorktreeResource>;

  constructor(
    private readonly proxy: SshClientProxy,
    private readonly connectionId: string
  ) {
    this.repositories = createResourceCache({
      key: (key: LegacyRepositoryKey) => key.gitCommonDir,
      label: 'legacy-ssh-git-repositories',
      onError: (error, key) =>
        log.warn('LegacySshGitRuntime: repository provisioning failed', {
          key,
          error: String(error),
        }),
      create: async (key, scope) => {
        const repository = new LegacySshGitRepository(
          this.createGit(key.pathInsideRepo),
          key.gitCommonDir
        );
        scope.add(() => repository.dispose());
        return { repository };
      },
    });
    this.worktrees = createResourceCache({
      key: (key: string) => key,
      label: 'legacy-ssh-git-worktrees',
      onError: (error, key) =>
        log.warn('LegacySshGitRuntime: worktree provisioning failed', {
          key,
          error: String(error),
        }),
      create: async (worktreePath, scope) => {
        const repositoryLease = await this.acquireRepository(worktreePath);
        scope.add(() => repositoryLease.release());
        const worktree = new LegacySshGitWorktree(
          this.createGit(worktreePath),
          worktreePath,
          repositoryLease.value.repository
        );
        scope.add(() => worktree.dispose());
        return { worktree };
      },
    });
  }

  async openRepository(pathInsideRepo: string): Promise<Lease<IGitRepository>> {
    const lease = await this.acquireRepository(pathInsideRepo);
    return {
      value: lease.value.repository,
      release: lease.release,
    };
  }

  async inspectPath(pathInsideRepo: string): Promise<GitPathInspection> {
    const git = this.createGit(pathInsideRepo);
    try {
      const info = await git.detectInfo();
      return info.isGitRepo
        ? { kind: 'repository', rootPath: info.rootPath, baseRef: info.baseRef }
        : { kind: 'not-repository', path: pathInsideRepo };
    } finally {
      git.dispose();
    }
  }

  async ensureRepository(
    pathInsideRepo: string,
    options: EnsureRepositoryOptions = {}
  ): Promise<Result<GitRepositoryInfo, EnsureRepositoryError>> {
    const git = this.createGit(pathInsideRepo);
    try {
      let info = await git.detectInfo();
      if (info.isGitRepo) {
        return ok({ kind: 'repository', rootPath: info.rootPath, baseRef: info.baseRef });
      }
      if (!options.initIfMissing) return err({ type: 'not-repository', path: pathInsideRepo });

      try {
        await git.initRepository();
      } catch (error) {
        return err({
          type: 'init-failed',
          path: pathInsideRepo,
          message: gitErrorMessage(error),
        });
      }

      info = await git.detectInfo();
      if (info.isGitRepo) {
        return ok({ kind: 'repository', rootPath: info.rootPath, baseRef: info.baseRef });
      }
      return err({
        type: 'init-failed',
        path: pathInsideRepo,
        message: 'Failed to initialize git repository',
      });
    } finally {
      git.dispose();
    }
  }

  async cloneRepository(
    repositoryUrl: string,
    targetPath: string
  ): Promise<Result<GitRepositoryInfo, CloneRepositoryError>> {
    const ctx = new SshExecutionContext(this.proxy, {
      root: path.posix.dirname(targetPath),
      connectionId: this.connectionId,
    });
    try {
      await ctx.exec('git', ['clone', repositoryUrl, targetPath]);
    } catch (error) {
      return err(classifyCloneRepositoryError(error, targetPath));
    }

    const inspected = await this.inspectPath(targetPath);
    if (inspected.kind === 'repository') return ok(inspected);
    return err({
      type: 'git_error',
      message: `Cloned path is not a git repository: ${targetPath}`,
    });
  }

  async openWorktree(worktreePath: string): Promise<Lease<IGitWorktree>> {
    const pending = this.worktrees.acquire(worktreePath);
    const resource = await pending.ready();
    return {
      value: resource.worktree,
      release: pending.release,
    };
  }

  async dispose(): Promise<void> {
    const worktreesDisposed = this.worktrees.dispose();
    const repositoriesDisposed = this.repositories.dispose();
    await worktreesDisposed;
    await repositoriesDisposed;
  }

  /**
   * Repositories are keyed by the resolved git common dir so all worktrees of one
   * repo (and the project root) share a single instance — one refs/remotes poll per
   * repo, and one sequence space the renderer can rely on.
   */
  private async acquireRepository(
    pathInsideRepo: string
  ): Promise<Lease<LegacyRepositoryResource>> {
    const gitCommonDir = await this.resolveGitCommonDir(pathInsideRepo);
    const pending = this.repositories.acquire({ gitCommonDir, pathInsideRepo });
    const resource = await pending.ready();
    return {
      value: resource,
      release: pending.release,
    };
  }

  private async resolveGitCommonDir(root: string): Promise<string> {
    const ctx = new SshExecutionContext(this.proxy, { root, connectionId: this.connectionId });
    const { stdout } = await ctx.exec('git', [
      'rev-parse',
      '--path-format=absolute',
      '--git-common-dir',
    ]);
    const resolved = stdout.trim();
    if (!resolved) throw new Error(`Could not resolve git common dir for ${root}`);
    return resolved;
  }

  private createGit(root: string): GitService {
    const fs = new LegacySshFileSystem(this.proxy);
    const ctx = new SshExecutionContext(this.proxy, { root, connectionId: this.connectionId });
    return new GitService(ctx, fs);
  }
}

class LegacySshGitRepository implements IGitRepository {
  readonly gitCommonDir: string;
  readonly objectStoreDir: string;

  private readonly refsModel: LegacyLiveModel<GitRefsModel>;
  private readonly remotesModel: LegacyLiveModel<GitRemotesModel>;
  private readonly timers: ReturnType<typeof setInterval>[];

  constructor(
    private readonly git: GitService,
    gitCommonDir: string
  ) {
    this.gitCommonDir = gitCommonDir;
    this.objectStoreDir = `${gitCommonDir}/objects`;
    this.refsModel = new LegacyLiveModel<GitRefsModel>({
      compute: async () => ok(await this.computeRefs()),
      onError: (error) => log.warn('LegacySshGitRepository: refs refresh failed', { error }),
      onUnexpectedError: (error) =>
        log.warn('LegacySshGitRepository: refs refresh failed', { error }),
    });
    this.remotesModel = new LegacyLiveModel<GitRemotesModel>({
      compute: async () => ok(await this.computeRemotes()),
      onError: (error) => log.warn('LegacySshGitRepository: remotes refresh failed', { error }),
      onUnexpectedError: (error) =>
        log.warn('LegacySshGitRepository: remotes refresh failed', { error }),
    });
    this.timers = [
      setInterval(() => this.refsModel.invalidate(), REFS_POLL_MS),
      setInterval(() => this.remotesModel.invalidate(), REMOTES_POLL_MS),
    ];
  }

  async getRefs(): Promise<GitRefsModel> {
    return (await this.refsModel.get()).value;
  }

  async getRemotes(): Promise<GitRemotesModel> {
    return (await this.remotesModel.get()).value;
  }

  async getSnapshot(): Promise<GitRepoSnapshot> {
    const [refs, remotes] = await Promise.all([this.refsModel.get(), this.remotesModel.get()]);
    return { refs, remotes };
  }

  async refresh(): Promise<GitRepoSnapshot> {
    const [refs, remotes] = await Promise.all([
      this.refsModel.refresh(),
      this.remotesModel.refresh(),
    ]);
    return { refs, remotes };
  }

  subscribe(cb: (update: GitRepoUpdate) => void): Unsubscribe {
    const refs = this.refsModel.subscribe(({ value, sequence, generation }) =>
      cb({ kind: 'refs', model: value, sequence, generation })
    );
    const remotes = this.remotesModel.subscribe(({ value, sequence, generation }) =>
      cb({ kind: 'remotes', model: value, sequence, generation })
    );
    return () => {
      refs();
      remotes();
    };
  }

  async subscribeWithSnapshot(
    cb: (update: GitRepoUpdate) => void
  ): Promise<SubscribedSnapshot<GitRepoSnapshot>> {
    const unsubscribe = this.subscribe(cb);
    try {
      return { snapshot: await this.getSnapshot(), unsubscribe };
    } catch (error) {
      unsubscribe();
      throw error;
    }
  }

  getDefaultBranch(remote?: string): Promise<string> {
    return this.git.getDefaultBranch(remote);
  }

  async fetch(remote?: string): Promise<Result<{ sequences: GitSequences }, FetchError>> {
    return await ResultUtil.fromAsync(this.git.fetch(remote)).map(async () => ({
      sequences: { refs: await this.refreshRefs() },
    }));
  }

  async addRemote(
    name: string,
    url: string
  ): Promise<Result<{ sequences: GitSequences }, GitCommandError>> {
    try {
      await this.git.addRemote(name, url);
      const remotes = await this.remotesModel.refresh();
      return ok({ sequences: { remotes: remotes.sequence } });
    } catch (error) {
      return err(toGitCommandError(error));
    }
  }

  async createBranch(
    options: CreateBranchOptions
  ): Promise<Result<{ sequences: GitSequences }, CreateBranchError>> {
    return await ResultUtil.fromAsync(
      this.git.createBranch(
        options.name,
        options.from ?? 'HEAD',
        options.syncWithRemote,
        options.remote
      )
    ).map(async () => ({ sequences: { refs: await this.refreshRefs() } }));
  }

  async deleteBranch(
    branch: string,
    force?: boolean
  ): Promise<Result<{ sequences: GitSequences }, DeleteBranchError>> {
    return await ResultUtil.fromAsync(this.git.deleteBranch(branch, force)).map(async () => ({
      sequences: { refs: await this.refreshRefs() },
    }));
  }

  async fetchPrForReview(
    options: FetchPrForReviewOptions
  ): Promise<Result<{ sequences: GitSequences }, FetchPrForReviewError>> {
    return await ResultUtil.fromAsync(
      this.git.fetchPrForReview(
        options.prNumber,
        options.headRefName,
        options.headRepositoryUrl,
        options.localBranch,
        options.isFork,
        options.configuredRemote
      )
    ).map(async () => {
      const [refs, remotes] = await Promise.all([
        this.refsModel.refresh(),
        this.remotesModel.refresh(),
      ]);
      return { sequences: { refs: refs.sequence, remotes: remotes.sequence } };
    });
  }

  async publishBranch(
    branchName: string,
    remote?: string
  ): Promise<Result<{ output: string; sequences: GitSequences }, PushError>> {
    return await ResultUtil.fromAsync(this.git.publishBranch(branchName, remote)).map(
      async (data) => ({ output: data.output, sequences: { refs: await this.refreshRefs() } })
    );
  }

  readBlobAtRef(ref: string, filePath: string): Promise<string | null> {
    return this.git.getFileAtRef(filePath, ref);
  }

  dispose(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.refsModel.dispose();
    this.remotesModel.dispose();
    this.git.dispose();
  }

  async refreshRefs(): Promise<number> {
    return (await this.refsModel.refresh()).sequence;
  }

  private async computeRefs(): Promise<GitRefsModel> {
    return { branches: await this.git.getBranches() };
  }

  private async computeRemotes(): Promise<GitRemotesModel> {
    return { remotes: (await this.git.getRemotes()) as GitRemote[] };
  }
}

type LegacyLiveModelSnapshot<T> = {
  value: T;
  sequence: number;
  generation: number;
};

class LegacyLiveModel<T> {
  private cached: LegacyLiveModelSnapshot<T> | undefined;
  private dirty = true;
  private sequence = 0;
  private generation = 0;
  private readonly subscribers = new Set<(snapshot: LegacyLiveModelSnapshot<T>) => void>();

  constructor(
    private readonly options: {
      compute: () => Promise<Result<T, unknown>>;
      onError?: (error: unknown) => void;
      onUnexpectedError?: (error: unknown) => void;
    }
  ) {}

  async get(): Promise<LegacyLiveModelSnapshot<T>> {
    if (!this.cached || this.dirty) return this.refresh();
    return this.cached;
  }

  async refresh(): Promise<LegacyLiveModelSnapshot<T>> {
    try {
      const result = await this.options.compute();
      if (!result.success) {
        this.options.onError?.(result.error);
        throw result.error;
      }
      this.sequence += 1;
      this.generation += 1;
      this.dirty = false;
      const snapshot = {
        value: result.data,
        sequence: this.sequence,
        generation: this.generation,
      };
      this.cached = snapshot;
      for (const subscriber of this.subscribers) subscriber(snapshot);
      return snapshot;
    } catch (error) {
      this.options.onUnexpectedError?.(error);
      throw error;
    }
  }

  invalidate(): void {
    this.dirty = true;
    if (this.cached) {
      void this.refresh().catch((error) => this.options.onUnexpectedError?.(error));
    }
  }

  getCached(): LegacyLiveModelSnapshot<T> | undefined {
    return this.cached;
  }

  subscribe(cb: (snapshot: LegacyLiveModelSnapshot<T>) => void): Unsubscribe {
    this.subscribers.add(cb);
    return () => {
      this.subscribers.delete(cb);
    };
  }

  dispose(): void {
    this.subscribers.clear();
  }
}

class LegacySshGitWorktree implements IGitWorktree {
  readonly worktree: string;
  readonly repository: LegacySshGitRepository;

  private readonly statusModel: LegacyLiveModel<GitStatusModel>;
  private readonly headModel: LegacyLiveModel<GitHeadModel>;
  private readonly timers: ReturnType<typeof setInterval>[];
  private fingerprints: Partial<Record<GitStatusUntrackedMode, string>> = {};

  constructor(
    private readonly git: GitService,
    worktreePath: string,
    repository: LegacySshGitRepository
  ) {
    this.worktree = worktreePath;
    this.repository = repository;
    this.statusModel = new LegacyLiveModel<GitStatusModel>({
      compute: async () => ok(await this.computeStatus()),
      onError: (error) => log.warn('LegacySshGitWorktree: status refresh failed', { error }),
      onUnexpectedError: (error) =>
        log.warn('LegacySshGitWorktree: status refresh failed', { error }),
    });
    this.headModel = new LegacyLiveModel<GitHeadModel>({
      compute: async () => ok(await this.computeHead()),
      onError: (error) => log.warn('LegacySshGitWorktree: head refresh failed', { error }),
      onUnexpectedError: (error) =>
        log.warn('LegacySshGitWorktree: head refresh failed', { error }),
    });
    this.timers = [
      setInterval(() => void this.pollStatus('no'), STATUS_POLL_MS),
      setInterval(() => void this.pollStatus('normal'), UNTRACKED_STATUS_POLL_MS),
      setInterval(() => this.headModel.invalidate(), HEAD_POLL_MS),
    ];
  }

  async getStatus(): Promise<GitStatusModel> {
    return (await this.statusModel.get()).value;
  }

  async getHead(): Promise<GitHeadModel> {
    return (await this.headModel.get()).value;
  }

  async getSnapshot(): Promise<GitWorktreeSnapshot> {
    const [status, head] = await Promise.all([this.statusModel.get(), this.headModel.get()]);
    return { status, head };
  }

  async refresh(): Promise<GitWorktreeSnapshot> {
    const [status, head] = await Promise.all([
      this.statusModel.refresh(),
      this.headModel.refresh(),
    ]);
    return { status, head };
  }

  invalidateStatus(): void {
    this.statusModel.invalidate();
  }

  subscribe(cb: (update: GitWorktreeUpdate) => void): Unsubscribe {
    const status = this.statusModel.subscribe(({ value, sequence, generation }) =>
      cb({ kind: 'status', model: value, sequence, generation })
    );
    const head = this.headModel.subscribe(({ value, sequence, generation }) =>
      cb({ kind: 'head', model: value, sequence, generation })
    );
    return () => {
      status();
      head();
    };
  }

  async subscribeWithSnapshot(
    cb: (update: GitWorktreeUpdate) => void
  ): Promise<SubscribedSnapshot<GitWorktreeSnapshot>> {
    const unsubscribe = this.subscribe(cb);
    try {
      return { snapshot: await this.getSnapshot(), unsubscribe };
    } catch (error) {
      unsubscribe();
      throw error;
    }
  }

  getStatusFingerprint(untracked: GitStatusUntrackedMode): Promise<GitStatusFingerprint> {
    return this.git.getStatusFingerprint(untracked);
  }

  isFileCleanlyTracked(filePath: string): Promise<boolean> {
    return this.git.isFileCleanlyTracked(this.toGitPath(filePath));
  }

  async getChangedFiles(base: DiffTarget): Promise<GitChange[]> {
    return (await this.git.getChangedFiles(base)).map((change) => this.toAbsChange(change));
  }

  getFileAtRef(filePath: string, ref: string): Promise<string | null> {
    return this.git.getFileAtRef(this.toGitPath(filePath), ref);
  }

  getFileAtIndex(filePath: string): Promise<string | null> {
    return this.git.getFileAtIndex(this.toGitPath(filePath));
  }

  async getImageAtRef(filePath: string, ref: string): Promise<ImageReadResult> {
    const gitPath = this.toGitPath(filePath);
    return mapImageReadResult(await this.git.getImageAtRef(gitPath, ref));
  }

  async getImageAtIndex(filePath: string): Promise<ImageReadResult> {
    return mapImageReadResult(await this.git.getImageAtIndex(this.toGitPath(filePath)));
  }

  getLog(options?: GitLogOptions): Promise<GitLogResult> {
    return this.git.getLog(options) as Promise<GitLogResult>;
  }

  getCommitFiles(hash: string): Promise<CommitFile[]> {
    return this.git.getCommitFiles(hash) as Promise<CommitFile[]>;
  }

  async stage(paths: string[]): Promise<Result<GitSequences, GitCommandError>> {
    try {
      await this.git.stageFiles(this.toGitPaths(paths));
      return ok(await this.refreshStatus());
    } catch (error) {
      return err(toGitCommandError(error));
    }
  }

  async stageAll(): Promise<Result<GitSequences, GitCommandError>> {
    try {
      await this.git.stageAllFiles();
      return ok(await this.refreshStatus());
    } catch (error) {
      return err(toGitCommandError(error));
    }
  }

  async unstage(paths: string[]): Promise<Result<GitSequences, GitCommandError>> {
    try {
      await this.git.unstageFiles(this.toGitPaths(paths));
      return ok(await this.refreshStatus());
    } catch (error) {
      return err(toGitCommandError(error));
    }
  }

  async unstageAll(): Promise<Result<GitSequences, GitCommandError>> {
    try {
      await this.git.unstageAllFiles();
      return ok(await this.refreshStatus());
    } catch (error) {
      return err(toGitCommandError(error));
    }
  }

  async revert(paths: string[]): Promise<Result<GitSequences, GitCommandError>> {
    try {
      await this.git.revertFiles(this.toGitPaths(paths));
      return ok(await this.refreshStatus());
    } catch (error) {
      return err(toGitCommandError(error));
    }
  }

  async revertAll(): Promise<Result<GitSequences, GitCommandError>> {
    try {
      await this.git.revertAllFiles();
      return ok(await this.refreshStatus());
    } catch (error) {
      return err(toGitCommandError(error));
    }
  }

  async commit(
    message: string
  ): Promise<Result<{ hash: string; sequences: GitSequences }, CommitError>> {
    return await ResultUtil.fromAsync(this.git.commit(message)).map(async (data) => ({
      hash: data.hash,
      sequences: await this.refreshAfterHistoryChange(),
    }));
  }

  async push(
    remote?: string
  ): Promise<Result<{ output: string; sequences: GitSequences }, PushError>> {
    return await ResultUtil.fromAsync(this.git.push(remote)).map(async (data) => ({
      output: data.output,
      sequences: await this.refreshAfterHistoryChange(),
    }));
  }

  async pull(): Promise<Result<{ output: string; sequences: GitSequences }, PullError>> {
    return await ResultUtil.fromAsync(this.git.pull()).map(async (data) => ({
      output: data.output,
      sequences: await this.refreshAfterHistoryChange(),
    }));
  }

  async dispose(): Promise<void> {
    for (const timer of this.timers) clearInterval(timer);
    this.statusModel.dispose();
    this.headModel.dispose();
    this.git.dispose();
  }

  private async computeStatus(): Promise<GitStatusModel> {
    try {
      const status = await this.git.getFullStatus();
      return {
        kind: 'ok',
        staged: status.staged.map((change) => this.toAbsChange(change)),
        unstaged: status.unstaged.map((change) => this.toAbsChange(change)),
        stagedAdded: status.totalAdded,
        stagedDeleted: status.totalDeleted,
      };
    } catch (error) {
      if (error instanceof TooManyFilesChangedError) return { kind: 'too-many-files' };
      // Transient failures (e.g. dropped SSH connection) must not masquerade as a
      // status; rethrowing keeps the last-good value and leaves the model dirty.
      throw error;
    }
  }

  private async computeHead(): Promise<GitHeadModel> {
    return this.git.getHeadInfo();
  }

  private toAbsChange(change: GitChange): GitChange {
    return { ...change, path: this.toAbsPath(change.path) };
  }

  private toAbsPath(filePath: string): string {
    if (path.posix.isAbsolute(filePath)) return path.posix.normalize(filePath);
    return path.posix.join(this.worktree, filePath);
  }

  private toGitPath(filePath: string): string {
    if (!path.posix.isAbsolute(filePath)) return filePath;
    return path.posix.relative(this.worktree, filePath);
  }

  private toGitPaths(paths: string[]): string[] {
    return paths.map((filePath) => this.toGitPath(filePath));
  }

  private async refreshStatus(): Promise<GitSequences> {
    const value = await this.statusModel.refresh();
    return { status: value.sequence };
  }

  private async refreshAfterHistoryChange(): Promise<GitSequences> {
    const [status, head, refs] = await Promise.all([
      this.statusModel.refresh(),
      this.headModel.refresh(),
      this.repository.refreshRefs(),
    ]);
    return { status: status.sequence, head: head.sequence, refs };
  }

  private async pollStatus(untracked: GitStatusUntrackedMode): Promise<void> {
    const fingerprint = await this.git.getStatusFingerprint(untracked).catch(() => null);
    if (!fingerprint) return;
    const previous = this.fingerprints[untracked];
    this.fingerprints[untracked] = fingerprint.hash;
    if (previous === undefined) {
      if (fingerprint.byteLength > 0 && this.statusModel.getCached()) this.statusModel.invalidate();
      return;
    }
    if (previous !== undefined && previous !== fingerprint.hash) {
      this.statusModel.invalidate();
    }
  }
}

type LegacySshGitStatusInvalidatable = IGitWorktree & {
  invalidateStatus(): void;
};

export function invalidateLegacySshGitWorktreeStatus(worktree: IGitWorktree): boolean {
  if (!isLegacySshGitStatusInvalidatable(worktree)) return false;
  worktree.invalidateStatus();
  return true;
}

function isLegacySshGitStatusInvalidatable(
  worktree: IGitWorktree
): worktree is LegacySshGitStatusInvalidatable {
  return worktree instanceof LegacySshGitWorktree;
}

function mapImageReadResult(result: LegacyImageReadResult): ImageReadResult {
  if (result.kind !== 'unavailable') return result;
  if (result.reason === 'ssh') return { kind: 'unavailable', reason: 'git-error' };
  switch (result.reason) {
    case 'unsupported':
    case 'too-large':
    case 'lfs-pointer':
    case 'git-error':
      return { kind: 'unavailable', reason: result.reason };
  }
}
