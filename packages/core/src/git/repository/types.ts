import type { IDisposable, Result } from '@emdash/shared';
import type {
  CreateBranchError,
  DeleteBranchError,
  FetchError,
  FetchPrForReviewError,
  GitCommandError,
  PushError,
} from '../api/errors';
import type { CheckoutInfo } from '../api/schemas';
import type { GitOpContext } from '../operation-context';
import type { GitRefsModel } from './models/refs';
import type { GitRemotesModel } from './models/remotes';
import type { GitStashesModel } from './models/stashes';
import type {
  AddCheckoutOptions,
  CreateBranchOptions,
  FetchPrForReviewOptions,
  TagOptions,
} from './schemas';

export interface IGitRepository extends IDisposable {
  readonly gitCommonDir: string;

  // -- Computed models --
  getRefs(): Promise<GitRefsModel>;
  getRemotes(): Promise<GitRemotesModel>;
  getStashes(): Promise<GitStashesModel>;

  // -- Checkout integration reads --
  readBlobAtRef(ref: string, filePath: string): Promise<string | null>;

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
