import type {
  CreateBranchError,
  DeleteBranchError,
  FetchError,
  FetchPrForReviewError,
  GitHeadState,
  LocalBranch,
  PushError,
  RemoteBranch,
  RenameBranchError,
} from '@shared/core/git/git';
import type { Result } from '@shared/lib/result';

export interface RepositoryGitProvider {
  isFileCleanlyTracked(filePath: string): Promise<boolean>;
  getBranches(): Promise<(LocalBranch | RemoteBranch)[]>;
  getCurrentBranch(): Promise<string | null>;
  getHeadState(): Promise<GitHeadState>;
  getDefaultBranch(remote?: string): Promise<string>;
  getRemotes(): Promise<{ name: string; url: string }[]>;
  addRemote(name: string, url: string): Promise<void>;
  createBranch(
    name: string,
    from: string,
    syncWithRemote?: boolean,
    remote?: string
  ): Promise<Result<void, CreateBranchError>>;
  renameBranch(oldBranch: string, newBranch: string): Promise<Result<void, RenameBranchError>>;
  deleteBranch(branch: string, force?: boolean): Promise<Result<void, DeleteBranchError>>;
  fetchPrForReview(
    prNumber: number,
    headRefName: string,
    headRepositoryUrl: string,
    localBranch: string,
    isFork: boolean,
    configuredRemote?: string
  ): Promise<Result<void, FetchPrForReviewError>>;
  fetch(remote?: string): Promise<Result<void, FetchError>>;
  publishBranch(
    branchName: string,
    remote?: string
  ): Promise<Result<{ output: string }, PushError>>;
}
