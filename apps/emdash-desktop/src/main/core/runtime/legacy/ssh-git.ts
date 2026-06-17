import path from 'node:path';
import {
  classifyCloneRepositoryError,
  gitErrorMessage,
  TooManyFilesChangedError,
} from '@emdash/shared/git';
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
} from '@emdash/shared/git';
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
} from '@emdash/shared/git';
import type { ImageReadResult } from '@emdash/shared/git';
import type { DiffTarget } from '@emdash/shared/git';
import type { CommitFile, GitLogResult } from '@emdash/shared/git';
import type { GitRefsModel, GitRemote, GitRemotesModel } from '@emdash/shared/git';
import type { GitHeadModel } from '@emdash/shared/git';
import type {
  GitChange,
  GitStatusFingerprint,
  GitStatusModel,
  GitStatusUntrackedMode,
} from '@emdash/shared/git';
import {
  err,
  LiveModel,
  ok,
  ResourceMap,
  type Lease,
  type Result,
  type Unsubscribe,
} from '@emdash/shared/lib';
import { SshExecutionContext } from '@main/core/execution-context/ssh-execution-context';
import { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import { GitService } from '@main/core/git/legacy/git-service';
import type { SshClientProxy } from '@main/core/ssh/lifecycle/ssh-client-proxy';
import { log } from '@main/lib/logger';
import type {
  CommitError as LegacyCommitError,
  CreateBranchError as LegacyCreateBranchError,
  DeleteBranchError as LegacyDeleteBranchError,
  FetchError as LegacyFetchError,
  FetchPrForReviewError as LegacyFetchPrForReviewError,
  ImageReadResult as LegacyImageReadResult,
  PullError as LegacyPullError,
  PushError as LegacyPushError,
} from '@shared/core/git/types';

const STATUS_POLL_MS = 10_000;
const UNTRACKED_STATUS_POLL_MS = 30_000;
const HEAD_POLL_MS = 10_000;
const REFS_POLL_MS = 15_000;
const REMOTES_POLL_MS = 60_000;

type LegacyRepositoryResource = {
  repository: LegacySshGitRepository;
};

type LegacyWorktreeResource = {
  worktree: LegacySshGitWorktree;
  repositoryLease: Lease<LegacySshGitRepository>;
};

/**
 * Legacy SSH compatibility layer. SSH projects still execute Git through the main
 * process until the shared Git runtime can run on the remote machine.
 */
export class LegacySshGitRuntime implements IGitRuntime {
  private readonly repositories = new ResourceMap<LegacyRepositoryResource>({
    teardown: (_key, resource) => resource.repository.dispose(),
    onError: (context, error) =>
      log.warn('LegacySshGitRuntime: repository teardown failed', {
        context,
        error: String(error),
      }),
  });
  private readonly worktrees = new ResourceMap<LegacyWorktreeResource>({
    teardown: (_key, resource) => {
      resource.worktree.dispose();
      resource.repositoryLease.release();
    },
    onError: (context, error) =>
      log.warn('LegacySshGitRuntime: worktree teardown failed', { context, error: String(error) }),
  });

  constructor(private readonly proxy: SshClientProxy) {}

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
    const ctx = new SshExecutionContext(this.proxy, { root: path.posix.dirname(targetPath) });
    try {
      await ctx.exec('git', ['clone', repositoryUrl, targetPath]);
    } catch (error) {
      return err(classifyCloneRepositoryError(error, targetPath));
    }

    const inspected = await this.inspectPath(targetPath);
    if (inspected.kind === 'repository') return ok(inspected);
    return err({
      type: 'git-error',
      message: `Cloned path is not a git repository: ${targetPath}`,
    });
  }

  async openWorktree(worktreePath: string): Promise<Lease<IGitWorktree>> {
    const lease = await this.worktrees.acquire(worktreePath, async () => {
      const repositoryLease = await this.acquireRepository(worktreePath);
      const worktree = new LegacySshGitWorktree(
        this.createGit(worktreePath),
        worktreePath,
        repositoryLease.value.repository
      );
      return {
        worktree,
        repositoryLease: {
          value: repositoryLease.value.repository,
          release: repositoryLease.release,
        },
      };
    });
    return {
      value: lease.value.worktree,
      release: lease.release,
    };
  }

  dispose(): void {
    this.worktrees.dispose();
    this.repositories.dispose();
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
    return this.repositories.acquire(gitCommonDir, async () => ({
      repository: new LegacySshGitRepository(this.createGit(pathInsideRepo), gitCommonDir),
    }));
  }

  private async resolveGitCommonDir(root: string): Promise<string> {
    const ctx = new SshExecutionContext(this.proxy, { root });
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
    const fs = new SshFileSystem(this.proxy, root);
    const ctx = new SshExecutionContext(this.proxy, { root });
    return new GitService(ctx, fs);
  }
}

class LegacySshGitRepository implements IGitRepository {
  readonly gitCommonDir: string;
  readonly objectStoreDir: string;

  private readonly refsModel: LiveModel<GitRefsModel>;
  private readonly remotesModel: LiveModel<GitRemotesModel>;
  private readonly timers: ReturnType<typeof setInterval>[];

  constructor(
    private readonly git: GitService,
    gitCommonDir: string
  ) {
    this.gitCommonDir = gitCommonDir;
    this.objectStoreDir = `${gitCommonDir}/objects`;
    this.refsModel = new LiveModel<GitRefsModel>({
      compute: () => this.computeRefs(),
      onError: (error) => log.warn('LegacySshGitRepository: refs refresh failed', { error }),
    });
    this.remotesModel = new LiveModel<GitRemotesModel>({
      compute: () => this.computeRemotes(),
      onError: (error) => log.warn('LegacySshGitRepository: remotes refresh failed', { error }),
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
    const result = await this.git.fetch(remote);
    if (!result.success) return err(mapFetchError(result.error));
    return ok({ sequences: { refs: await this.refreshRefs() } });
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
    const result = await this.git.createBranch(
      options.name,
      options.from ?? 'HEAD',
      options.syncWithRemote,
      options.remote
    );
    if (!result.success) return err(mapCreateBranchError(result.error));
    return ok({ sequences: { refs: await this.refreshRefs() } });
  }

  async deleteBranch(
    branch: string,
    force?: boolean
  ): Promise<Result<{ sequences: GitSequences }, DeleteBranchError>> {
    const result = await this.git.deleteBranch(branch, force);
    if (!result.success) return err(mapDeleteBranchError(result.error));
    return ok({ sequences: { refs: await this.refreshRefs() } });
  }

  async fetchPrForReview(
    options: FetchPrForReviewOptions
  ): Promise<Result<{ sequences: GitSequences }, FetchPrForReviewError>> {
    const result = await this.git.fetchPrForReview(
      options.prNumber,
      options.headRefName,
      options.headRepositoryUrl,
      options.localBranch,
      options.isFork,
      options.configuredRemote
    );
    if (!result.success) return err(mapFetchPrForReviewError(result.error));
    const [refs, remotes] = await Promise.all([
      this.refsModel.refresh(),
      this.remotesModel.refresh(),
    ]);
    return ok({ sequences: { refs: refs.sequence, remotes: remotes.sequence } });
  }

  async publishBranch(
    branchName: string,
    remote?: string
  ): Promise<Result<{ output: string; sequences: GitSequences }, PushError>> {
    const result = await this.git.publishBranch(branchName, remote);
    if (!result.success) return err(mapPushError(result.error));
    return ok({ output: result.data.output, sequences: { refs: await this.refreshRefs() } });
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

class LegacySshGitWorktree implements IGitWorktree {
  readonly worktree: string;
  readonly repository: LegacySshGitRepository;

  private readonly statusModel: LiveModel<GitStatusModel>;
  private readonly headModel: LiveModel<GitHeadModel>;
  private readonly timers: ReturnType<typeof setInterval>[];
  private fingerprints: Partial<Record<GitStatusUntrackedMode, string>> = {};

  constructor(
    private readonly git: GitService,
    worktreePath: string,
    repository: LegacySshGitRepository
  ) {
    this.worktree = worktreePath;
    this.repository = repository;
    this.statusModel = new LiveModel<GitStatusModel>({
      compute: () => this.computeStatus(),
      onError: (error) => log.warn('LegacySshGitWorktree: status refresh failed', { error }),
    });
    this.headModel = new LiveModel<GitHeadModel>({
      compute: () => this.computeHead(),
      onError: (error) => log.warn('LegacySshGitWorktree: head refresh failed', { error }),
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
    return this.git.isFileCleanlyTracked(filePath);
  }

  getChangedFiles(base: DiffTarget): Promise<GitChange[]> {
    return this.git.getChangedFiles(base) as Promise<GitChange[]>;
  }

  getFileAtRef(filePath: string, ref: string): Promise<string | null> {
    return this.git.getFileAtRef(filePath, ref);
  }

  getFileAtIndex(filePath: string): Promise<string | null> {
    return this.git.getFileAtIndex(filePath);
  }

  async getImageAtRef(filePath: string, ref: string): Promise<ImageReadResult> {
    return mapImageReadResult(await this.git.getImageAtRef(filePath, ref));
  }

  async getImageAtIndex(filePath: string): Promise<ImageReadResult> {
    return mapImageReadResult(await this.git.getImageAtIndex(filePath));
  }

  getLog(options?: GitLogOptions): Promise<GitLogResult> {
    return this.git.getLog(options) as Promise<GitLogResult>;
  }

  getCommitFiles(hash: string): Promise<CommitFile[]> {
    return this.git.getCommitFiles(hash) as Promise<CommitFile[]>;
  }

  async stage(paths: string[]): Promise<GitSequences> {
    await this.git.stageFiles(paths);
    return this.refreshStatus();
  }

  async stageAll(): Promise<GitSequences> {
    await this.git.stageAllFiles();
    return this.refreshStatus();
  }

  async unstage(paths: string[]): Promise<GitSequences> {
    await this.git.unstageFiles(paths);
    return this.refreshStatus();
  }

  async unstageAll(): Promise<GitSequences> {
    await this.git.unstageAllFiles();
    return this.refreshStatus();
  }

  async revert(paths: string[]): Promise<GitSequences> {
    await this.git.revertFiles(paths);
    return this.refreshStatus();
  }

  async revertAll(): Promise<GitSequences> {
    await this.git.revertAllFiles();
    return this.refreshStatus();
  }

  async commit(
    message: string
  ): Promise<Result<{ hash: string; sequences: GitSequences }, CommitError>> {
    const result = await this.git.commit(message);
    if (!result.success) return err(mapCommitError(result.error));
    return ok({ hash: result.data.hash, sequences: await this.refreshAfterHistoryChange() });
  }

  async push(
    remote?: string
  ): Promise<Result<{ output: string; sequences: GitSequences }, PushError>> {
    const result = await this.git.push(remote);
    if (!result.success) return err(mapPushError(result.error));
    return ok({ output: result.data.output, sequences: await this.refreshAfterHistoryChange() });
  }

  async pull(): Promise<Result<{ output: string; sequences: GitSequences }, PullError>> {
    const result = await this.git.pull();
    if (!result.success) return err(mapPullError(result.error));
    return ok({ output: result.data.output, sequences: await this.refreshAfterHistoryChange() });
  }

  dispose(): void {
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
        staged: status.staged,
        unstaged: status.unstaged,
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
    if (previous !== undefined && previous !== fingerprint.hash) {
      this.statusModel.invalidate();
    }
  }
}

function toGitCommandError(error: unknown): GitCommandError {
  const message = gitErrorMessage(error);
  return { type: 'git-error', message };
}

function mapFetchError(error: LegacyFetchError): FetchError {
  switch (error.type) {
    case 'auth_failed':
      return { type: 'auth-failed', message: error.message };
    case 'remote_not_found':
      return { type: 'remote-not-found', message: error.message };
    case 'network_error':
    case 'error':
      return { type: 'git-error', message: error.message };
    case 'no_remote':
      return { type: 'remote-not-found', message: 'No remote configured' };
  }
}

function mapCommitError(error: LegacyCommitError): CommitError {
  switch (error.type) {
    case 'empty_message':
      return { type: 'empty-message', message: 'Commit message is empty' };
    case 'nothing_to_commit':
      return { type: 'nothing-to-commit', message: 'Nothing to commit' };
    case 'hook_failed':
    case 'error':
      return { type: 'git-error', message: error.message };
  }
}

function mapPushError(error: LegacyPushError): PushError {
  switch (error.type) {
    case 'auth_failed':
      return { type: 'auth-failed', message: error.message };
    case 'rejected':
      return { type: 'rejected', message: error.message };
    case 'no_remote':
      return { type: 'no-upstream', message: error.message ?? 'No remote configured' };
    case 'hook_rejected':
    case 'network_error':
    case 'error':
      return { type: 'git-error', message: error.message };
  }
}

function mapPullError(error: LegacyPullError): PullError {
  switch (error.type) {
    case 'auth_failed':
      return { type: 'auth-failed', message: error.message };
    case 'conflict':
      return { type: 'conflict', message: error.message };
    case 'no_upstream':
    case 'diverged':
    case 'network_error':
    case 'error':
      return { type: 'git-error', message: error.message };
  }
}

function mapCreateBranchError(error: LegacyCreateBranchError): CreateBranchError {
  switch (error.type) {
    case 'already_exists':
      return { type: 'already-exists', branch: error.name, message: 'Branch already exists' };
    case 'invalid_base':
      return {
        type: 'invalid-base',
        branch: '',
        from: error.from,
        message: 'Invalid branch base',
      };
    case 'invalid_name':
      return { type: 'invalid-name', branch: error.name, message: 'Invalid branch name' };
    case 'fetch_failed':
      return {
        type: 'fetch-failed',
        remote: error.remote,
        branch: error.branch,
        error: mapFetchError(error.error),
      };
    case 'error':
      return { type: 'git-error', message: error.message };
  }
}

function mapDeleteBranchError(error: LegacyDeleteBranchError): DeleteBranchError {
  switch (error.type) {
    case 'not_found':
      return { type: 'not-found', branch: error.branch, message: 'Branch not found' };
    case 'unmerged':
      return { type: 'not-merged', branch: error.branch, message: 'Branch is not merged' };
    case 'is_current':
    case 'error':
      return { type: 'git-error', message: 'message' in error ? error.message : error.type };
  }
}

function mapFetchPrForReviewError(error: LegacyFetchPrForReviewError): FetchPrForReviewError {
  switch (error.type) {
    case 'not_found':
      return { type: 'not-found', prNumber: error.prNumber, message: 'Pull request not found' };
    case 'error':
      return { type: 'git-error', message: error.message };
  }
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
