import type { IDisposable, Result, Unsubscribe } from '@emdash/shared';
import type { BoundExec } from '../../exec';
import type { LiveModelServer } from '../../live/model';
import type { IWatchService } from '../../watch';
import type {
  CommitOptions,
  MergeOptions,
  RebaseOptions,
  PushOptions,
  ResetMode,
  StashPushOptions,
  SwitchOptions,
  GitLogOptions,
} from '../api/commands';
import type {
  CommitError,
  GitCommandError,
  MergeError,
  PullError,
  PushError,
  RebaseError,
  SwitchError,
} from '../api/errors';
import type {
  Commit,
  ConflictVersions,
  DiffTarget,
  FileDiff,
  FileDiffStalenessEvent,
  GitChange,
  CommitFile,
  GitLogResult,
  ImageReadResult,
  BlameResult,
} from '../api/queries';
import type { IGitRepository } from '../repository/types';
import type { GitHeadModel } from './models/head';
import type { CheckoutStatusModel } from './models/status';

export type CheckoutRepository = Pick<
  IGitRepository,
  'gitCommonDir' | 'registerCheckout' | 'readBlobAtRef' | 'onCheckoutMutation'
>;

export type GitCheckoutOptions = {
  checkoutPath: string;
  gitDir: string;
  repository: CheckoutRepository;
  exec: BoundExec;
  watcher: IWatchService;
  onError?: (context: string, error: unknown) => void;
};

export interface IGitCheckout extends IDisposable {
  /** Absolute working-tree path; the routing key used by the runtime's ResourceMap. */
  readonly checkoutPath: string;

  // -- Live models (contract: git.checkout.status / git.checkout.head) --
  readonly status: LiveModelServer<CheckoutStatusModel>;
  readonly head: LiveModelServer<GitHeadModel>;

  /** Force an immediate recompute of both models (bypasses debounce, joins single-flight). */
  refresh(): Promise<void>;

  // -- Staging --
  stage(paths: string[]): Promise<Result<void, GitCommandError>>;
  unstage(paths: string[]): Promise<Result<void, GitCommandError>>;
  stageAll(): Promise<Result<void, GitCommandError>>;
  unstageAll(): Promise<Result<void, GitCommandError>>;
  revert(paths: string[]): Promise<Result<void, GitCommandError>>;
  revertAll(): Promise<Result<void, GitCommandError>>;
  clean(options?: { paths?: string[]; force?: boolean }): Promise<Result<void, GitCommandError>>;
  stageHunk(path: string, hunkHeader: string): Promise<Result<void, GitCommandError>>;
  unstageHunk(path: string, hunkHeader: string): Promise<Result<void, GitCommandError>>;
  discardHunk(path: string, hunkHeader: string): Promise<Result<void, GitCommandError>>;

  // -- Commit / history-changing operations --
  commit(message: string, options?: CommitOptions): Promise<Result<{ hash: string }, CommitError>>;
  switch(options: SwitchOptions): Promise<Result<void, SwitchError>>;
  reset(ref: string, mode?: ResetMode): Promise<Result<void, GitCommandError>>;
  merge(options: MergeOptions): Promise<Result<void, MergeError>>;
  mergeContinue(message?: string): Promise<Result<void, MergeError>>;
  mergeAbort(): Promise<Result<void, GitCommandError>>;
  rebase(options: RebaseOptions): Promise<Result<void, RebaseError>>;
  rebaseContinue(): Promise<Result<void, RebaseError>>;
  rebaseAbort(): Promise<Result<void, GitCommandError>>;
  rebaseSkip(): Promise<Result<void, GitCommandError>>;
  cherryPick(commits: string[], noCommit?: boolean): Promise<Result<void, MergeError>>;
  revertCommit(commit: string, noCommit?: boolean): Promise<Result<void, MergeError>>;

  // -- Sync --
  push(options?: PushOptions): Promise<Result<{ output: string }, PushError>>;
  pull(): Promise<Result<{ output: string }, PullError>>;
  sync(): Promise<Result<{ output: string }, PushError>>;

  // -- Stash (mutations run here; the stashes model lives on the repository) --
  stashPush(options?: StashPushOptions): Promise<Result<void, GitCommandError>>;
  stashApply(stashIndex?: number): Promise<Result<void, GitCommandError>>;
  stashPop(stashIndex?: number): Promise<Result<void, GitCommandError>>;

  // -- Diff / conflict reads --
  getFileDiff(path: string, base?: DiffTarget): Promise<Result<FileDiff, GitCommandError>>;
  subscribeFileDiff(
    path: string,
    base: DiffTarget | undefined,
    cb: (event: FileDiffStalenessEvent) => void
  ): Unsubscribe;
  getChangedFiles(base: DiffTarget): Promise<GitChange[]>;
  getConflictVersions(path: string): Promise<Result<ConflictVersions, GitCommandError>>;

  // -- Content / history reads --
  getFileAtRef(filePath: string, ref: string): Promise<string | null>;
  getFileAtIndex(filePath: string): Promise<string | null>;
  getImageAtRef(filePath: string, ref: string): Promise<ImageReadResult>;
  getImageAtIndex(filePath: string): Promise<ImageReadResult>;
  getLog(options?: GitLogOptions): Promise<GitLogResult>;
  getCommit(hash: string): Promise<Commit | null>;
  getCommitFiles(hash: string): Promise<CommitFile[]>;
  blame(path: string, ref?: string): Promise<Result<BlameResult, GitCommandError>>;
}
