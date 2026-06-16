import type { IDisposable, Lease, LiveValue, Unsubscribe } from '../lib';
import type { Result } from '../lib/result';
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
} from './errors';
import type { ImageReadResult } from './models/diff';
import type { DiffTarget } from './models/diff-target';
import type { GitHeadModel } from './models/head';
import type { CommitFile, GitLogResult } from './models/log';
import type { GitRefsModel, GitRemotesModel } from './models/refs';
import type {
  GitChange,
  GitStatusFingerprint,
  GitStatusModel,
  GitStatusUntrackedMode,
} from './models/status';

export type GitRepoModelKind = 'refs' | 'remotes';
export type GitWorktreeModelKind = 'status' | 'head';

export type GitModelKind = GitRepoModelKind | GitWorktreeModelKind;

export type GitModelByKind = {
  status: GitStatusModel;
  head: GitHeadModel;
  refs: GitRefsModel;
  remotes: GitRemotesModel;
};

export type GitModelUpdate<K extends GitModelKind = GitModelKind> = {
  [Kind in K]: {
    kind: Kind;
    generation: number;
    sequence: number;
    model: GitModelByKind[Kind];
  };
}[K];

export type GitWorktreeUpdate = GitModelUpdate<GitWorktreeModelKind>;
export type GitRepoUpdate = GitModelUpdate<GitRepoModelKind>;

/**
 * Sequences of the models a mutation refreshed (read-your-writes): a client applying pushed
 * updates knows its cache caught up with this mutation once it has seen these sequence values.
 */
export type GitSequences = Partial<Record<GitModelKind, number>>;

export type GitWorktreeSnapshot = {
  status: LiveValue<GitStatusModel>;
  head: LiveValue<GitHeadModel>;
};

export type GitRepoSnapshot = {
  refs: LiveValue<GitRefsModel>;
  remotes: LiveValue<GitRemotesModel>;
};

export type SubscribedSnapshot<Snapshot> = {
  snapshot: Snapshot;
  unsubscribe: Unsubscribe;
};

export type CreateBranchOptions = {
  name: string;
  from?: string;
  syncWithRemote?: boolean;
  remote?: string;
};

export type FetchPrForReviewOptions = {
  prNumber: number;
  headRefName: string;
  headRepositoryUrl: string;
  localBranch: string;
  isFork: boolean;
  configuredRemote?: string;
};

export type GitLogOptions = {
  maxCount?: number;
  limit?: number;
  skip?: number;
  knownAheadCount?: number;
  preferredRemote?: string;
  base?: Extract<DiffTarget, { kind: 'branch' | 'commit' | 'tag' }>;
  head?: Extract<DiffTarget, { kind: 'branch' | 'commit' | 'tag' }>;
};

export type RepoLease = Lease<IGitRepository>;

export type WorktreeLease = Lease<IGitWorktree>;

export type GitRepositoryInfo = {
  kind: 'repository';
  rootPath: string;
  baseRef: string;
};

export type GitPathInspection = GitRepositoryInfo | { kind: 'not-repository'; path: string };

export type EnsureRepositoryOptions = {
  initIfMissing?: boolean;
};

export type EnsureRepositoryError =
  | { type: 'not-repository'; path: string }
  | { type: 'init-failed'; path: string; message: string };

export interface IGitRepository extends IDisposable {
  readonly gitCommonDir: string;
  readonly objectStoreDir: string;

  /** Read models for the repository. */
  getRefs(): Promise<GitRefsModel>;
  getRemotes(): Promise<GitRemotesModel>;

  /** Repository lifecycle operations. */
  getSnapshot(): Promise<GitRepoSnapshot>;
  refresh(): Promise<GitRepoSnapshot>;
  subscribe(cb: (update: GitRepoUpdate) => void): Unsubscribe;
  subscribeWithSnapshot(
    cb: (update: GitRepoUpdate) => void
  ): Promise<SubscribedSnapshot<GitRepoSnapshot>>;

  /** Repository git operations. */
  getDefaultBranch(remote?: string): Promise<string>;
  fetch(remote?: string): Promise<Result<{ sequences: GitSequences }, FetchError>>;
  addRemote(
    name: string,
    url: string
  ): Promise<Result<{ sequences: GitSequences }, GitCommandError>>;
  createBranch(
    options: CreateBranchOptions
  ): Promise<Result<{ sequences: GitSequences }, CreateBranchError>>;
  deleteBranch(
    branch: string,
    force?: boolean
  ): Promise<Result<{ sequences: GitSequences }, DeleteBranchError>>;
  fetchPrForReview(
    options: FetchPrForReviewOptions
  ): Promise<Result<{ sequences: GitSequences }, FetchPrForReviewError>>;
  publishBranch(
    branchName: string,
    remote?: string
  ): Promise<Result<{ output: string; sequences: GitSequences }, PushError>>;
  readBlobAtRef(ref: string, filePath: string): Promise<string | null>;
}

export interface IGitWorktree extends IDisposable {
  readonly worktree: string;
  readonly repository: IGitRepository;

  /** Read models for the worktree. */
  getStatus(): Promise<GitStatusModel>;
  getHead(): Promise<GitHeadModel>;

  /** Worktree lifecycle operations. */
  getSnapshot(): Promise<GitWorktreeSnapshot>;
  refresh(): Promise<GitWorktreeSnapshot>;
  subscribe(cb: (update: GitWorktreeUpdate) => void): Unsubscribe;
  subscribeWithSnapshot(
    cb: (update: GitWorktreeUpdate) => void
  ): Promise<SubscribedSnapshot<GitWorktreeSnapshot>>;

  /** Worktree git operations. */
  getStatusFingerprint(untracked: GitStatusUntrackedMode): Promise<GitStatusFingerprint>;
  isFileCleanlyTracked(filePath: string): Promise<boolean>;
  getChangedFiles(base: DiffTarget): Promise<GitChange[]>;
  getFileAtRef(filePath: string, ref: string): Promise<string | null>;
  getFileAtIndex(filePath: string): Promise<string | null>;
  getImageAtRef(filePath: string, ref: string): Promise<ImageReadResult>;
  getImageAtIndex(filePath: string): Promise<ImageReadResult>;
  getLog(options?: GitLogOptions): Promise<GitLogResult>;
  getCommitFiles(hash: string): Promise<CommitFile[]>;
  stage(paths: string[]): Promise<GitSequences>;
  stageAll(): Promise<GitSequences>;
  unstage(paths: string[]): Promise<GitSequences>;
  unstageAll(): Promise<GitSequences>;
  revert(paths: string[]): Promise<GitSequences>;
  revertAll(): Promise<GitSequences>;
  commit(message: string): Promise<Result<{ hash: string; sequences: GitSequences }, CommitError>>;
  push(remote?: string): Promise<Result<{ output: string; sequences: GitSequences }, PushError>>;
  pull(): Promise<Result<{ output: string; sequences: GitSequences }, PullError>>;
}

export interface IGitRuntime extends IDisposable {
  inspectPath(path: string): Promise<GitPathInspection>;
  ensureRepository(
    path: string,
    options?: EnsureRepositoryOptions
  ): Promise<Result<GitRepositoryInfo, EnsureRepositoryError>>;
  cloneRepository(
    repositoryUrl: string,
    targetPath: string
  ): Promise<Result<GitRepositoryInfo, CloneRepositoryError>>;
  openRepository(pathInsideRepo: string): Promise<RepoLease>;
  openWorktree(worktreePath: string): Promise<WorktreeLease>;
}
