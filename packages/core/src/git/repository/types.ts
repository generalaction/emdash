import type { IDisposable, Result, Unsubscribe } from '@emdash/shared';
import type { BoundExec } from '../../exec';
import type { KeyedMutex } from '../../lib';
import type { LiveModelServer } from '../../live/model';
import type { IWatchService } from '../../watch';
import type {
  AddCheckoutOptions,
  CreateBranchOptions,
  FetchPrForReviewOptions,
  TagOptions,
} from '../api/commands';
import type {
  CreateBranchError,
  DeleteBranchError,
  FetchError,
  FetchPrForReviewError,
  GitCommandError,
  PushError,
} from '../api/errors';
import type { CheckoutInfo } from '../api/queries';
import type { GitOpContext } from '../transfer-progress';
import type { WorktreeWatchEffects } from '../watch/classifier';
import type { GitRefsModel } from './models/refs';
import type { GitRemotesModel } from './models/remotes';
import type { GitStashesModel } from './models/stashes';

export type GitRepositoryOptions = {
  gitCommonDir: string;
  objectStoreDir: string;
  exec: BoundExec;
  watcher: IWatchService;
  objectStoreMutex: KeyedMutex;
  onError?: (context: string, error: unknown) => void;
};

export type CheckoutWatchRegistration = {
  gitDir: string;
  worktree: string;
  onEffects: (effects: WorktreeWatchEffects) => void;
};

export interface IGitRepository extends IDisposable {
  readonly gitCommonDir: string;

  // -- Live models (contract: git.repository.refs / remotes / stashes) --
  readonly refs: LiveModelServer<GitRefsModel>;
  readonly remotes: LiveModelServer<GitRemotesModel>;
  readonly stashes: LiveModelServer<GitStashesModel>;

  /** Force an immediate recompute of all three models (bypasses debounce, joins single-flight). */
  refresh(): Promise<void>;

  // -- Checkout integration --
  registerCheckout(id: string, registration: CheckoutWatchRegistration): Unsubscribe;
  readBlobAtRef(ref: string, filePath: string): Promise<string | null>;
  onCheckoutMutation(effect: 'refs' | 'stashes'): Promise<void> | void;

  // -- Checkouts --
  listCheckouts(): Promise<CheckoutInfo[]>;
  addCheckout(options: AddCheckoutOptions): Promise<Result<CheckoutInfo, GitCommandError>>;
  removeCheckout(checkoutPath: string, force?: boolean): Promise<Result<void, GitCommandError>>;
  pruneCheckouts(): Promise<Result<void, GitCommandError>>;

  // -- Branches and tags --
  createBranch(options: CreateBranchOptions): Promise<Result<void, CreateBranchError>>;
  deleteBranch(branch: string, force?: boolean): Promise<Result<void, DeleteBranchError>>;
  renameBranch(oldName: string, newName: string): Promise<Result<void, GitCommandError>>;
  setUpstream(branch: string, upstream: string | null): Promise<Result<void, GitCommandError>>;
  createTag(options: TagOptions): Promise<Result<void, GitCommandError>>;
  deleteTag(name: string): Promise<Result<void, GitCommandError>>;

  // -- Remotes and network --
  addRemote(name: string, url: string): Promise<Result<void, GitCommandError>>;
  removeRemote(name: string): Promise<Result<void, GitCommandError>>;
  fetch(remote?: string, context?: GitOpContext): Promise<Result<void, FetchError>>;
  publishBranch(
    branchName: string,
    remote?: string,
    context?: GitOpContext
  ): Promise<Result<{ output: string }, PushError>>;
  getDefaultBranch(remote?: string): Promise<string>;
  fetchPrForReview(
    options: FetchPrForReviewOptions,
    context?: GitOpContext
  ): Promise<Result<void, FetchPrForReviewError>>;

  // -- Stashes --
  stashDrop(stashIndex: number): Promise<Result<void, GitCommandError>>;

  dispose(): Promise<void>;
}
