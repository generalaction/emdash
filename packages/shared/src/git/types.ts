import type { IDisposable, Lease, LiveValue, Unsubscribe } from '../lib';
import type { Result } from '../lib/result';
import type {
  CommitError,
  CreateBranchError,
  DeleteBranchError,
  FetchError,
  FetchPrForReviewError,
  GitCommandError,
  PullError,
  PushError,
  RenameBranchError,
  SoftResetError,
} from './errors';
import type { DiffResult, ImageReadResult } from './models/diff';
import type { DiffTarget } from './models/diff-target';
import type { GitHeadModel } from './models/head';
import type { Commit, CommitFile, GitLogResult } from './models/log';
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
    seq: number;
    model: GitModelByKind[Kind];
  };
}[K];

export type GitWorktreeUpdate = GitModelUpdate<GitWorktreeModelKind>;
export type GitRepoUpdate = GitModelUpdate<GitRepoModelKind>;

/**
 * Seqs of the models a mutation refreshed (read-your-writes): a client applying pushed
 * updates knows its cache caught up with this mutation once it has seen these seqs.
 */
export type GitSeqs = Partial<Record<GitModelKind, number>>;

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

export interface IGitRepository extends IDisposable {
  readonly gitCommonDir: string;
  readonly objectStoreDir: string;
  getRefs(): Promise<GitRefsModel>;
  getRemotes(): Promise<GitRemotesModel>;
  getSnapshot(): Promise<GitRepoSnapshot>;
  refresh(): Promise<GitRepoSnapshot>;
  subscribe(cb: (update: GitRepoUpdate) => void): Unsubscribe;
  subscribeWithSnapshot(
    cb: (update: GitRepoUpdate) => void
  ): Promise<SubscribedSnapshot<GitRepoSnapshot>>;
  getDefaultBranch(remote?: string): Promise<string>;
  fetch(remote?: string): Promise<Result<{ seqs: GitSeqs }, FetchError>>;
  addRemote(name: string, url: string): Promise<Result<{ seqs: GitSeqs }, GitCommandError>>;
  createBranch(options: CreateBranchOptions): Promise<Result<{ seqs: GitSeqs }, CreateBranchError>>;
  renameBranch(
    oldBranch: string,
    newBranch: string
  ): Promise<Result<{ seqs: GitSeqs }, RenameBranchError>>;
  deleteBranch(
    branch: string,
    force?: boolean
  ): Promise<Result<{ seqs: GitSeqs }, DeleteBranchError>>;
  fetchPrForReview(
    options: FetchPrForReviewOptions
  ): Promise<Result<{ seqs: GitSeqs }, FetchPrForReviewError>>;
  publishBranch(
    branchName: string,
    remote?: string
  ): Promise<Result<{ output: string; seqs: GitSeqs }, PushError>>;
  readBlobAtRef(ref: string, filePath: string): Promise<string | null>;
}

export interface IGitWorktree extends IDisposable {
  readonly worktree: string;
  readonly repository: IGitRepository;
  getStatus(): Promise<GitStatusModel>;
  getHead(): Promise<GitHeadModel>;
  getSnapshot(): Promise<GitWorktreeSnapshot>;
  refresh(): Promise<GitWorktreeSnapshot>;
  subscribe(cb: (update: GitWorktreeUpdate) => void): Unsubscribe;
  subscribeWithSnapshot(
    cb: (update: GitWorktreeUpdate) => void
  ): Promise<SubscribedSnapshot<GitWorktreeSnapshot>>;
  getStatusFingerprint(untracked: GitStatusUntrackedMode): Promise<GitStatusFingerprint>;
  isFileCleanlyTracked(filePath: string): Promise<boolean>;
  getChangedFiles(base: DiffTarget): Promise<GitChange[]>;
  getFileDiff(filePath: string, base?: string): Promise<DiffResult>;
  getFileAtHead(filePath: string): Promise<string | null>;
  getFileAtRef(filePath: string, ref: string): Promise<string | null>;
  getFileAtIndex(filePath: string): Promise<string | null>;
  getImageAtRef(filePath: string, ref: string): Promise<ImageReadResult>;
  getImageAtIndex(filePath: string): Promise<ImageReadResult>;
  getCommitFileDiff(commitHash: string, filePath: string): Promise<DiffResult>;
  getLog(options?: GitLogOptions): Promise<GitLogResult>;
  getLatestCommit(): Promise<Commit | null>;
  getCommitFiles(hash: string): Promise<CommitFile[]>;
  stage(paths: string[]): Promise<GitSeqs>;
  unstage(paths: string[]): Promise<GitSeqs>;
  revert(paths: string[]): Promise<GitSeqs>;
  commit(message: string): Promise<Result<{ hash: string; seqs: GitSeqs }, CommitError>>;
  push(remote?: string): Promise<Result<{ output: string; seqs: GitSeqs }, PushError>>;
  pull(): Promise<Result<{ output: string; seqs: GitSeqs }, PullError>>;
  softReset(): Promise<Result<{ subject: string; body: string; seqs: GitSeqs }, SoftResetError>>;
}

export interface IGitRuntime extends IDisposable {
  openRepository(pathInsideRepo: string): Promise<RepoLease>;
  openWorktree(worktreePath: string): Promise<WorktreeLease>;
}
