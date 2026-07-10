import {
  gitErr,
  type CloneRepositoryError,
  type CreateBranchError,
  type DeleteBranchError,
  type FetchError,
  type FetchPrForReviewError,
} from '@emdash/core/git';
import type { Err } from '@emdash/shared';
import {
  commandFailure,
  gitFailure,
  isAuthFailed,
  isAuthRequired,
  isMissingObject,
  isNetworkFailure,
} from '../exec/errors';

export const repositoryFailures = {
  clone(error: unknown, targetPath: string): Err<CloneRepositoryError> {
    const failure = gitFailure(error);
    const message = failure.message.toLowerCase();
    if (
      message.includes('already exists and is not an empty directory') ||
      (message.includes('destination path') && message.includes('already exists'))
    ) {
      return gitErr.targetExists(targetPath, failure.message);
    }
    if (isAuthRequired(failure)) return gitErr.authRequired(failure.message);
    if (isAuthFailed(failure)) return gitErr.authFailed(failure.message);
    if (
      message.includes('repository not found') ||
      message.includes('does not appear to be a git repository') ||
      message.includes('not found')
    ) {
      return gitErr.remoteNotFound(failure.message);
    }
    return commandFailure(failure);
  },

  fetch(error: unknown, remote: string | undefined): Err<FetchError> {
    const failure = gitFailure(error);
    const message = failure.message.toLowerCase();
    if (
      message.includes('no remote repository specified') ||
      message.includes('no remote configured')
    ) {
      return gitErr.noRemote(failure.message);
    }
    if (isAuthRequired(failure)) return gitErr.authRequired(failure.message);
    if (isAuthFailed(failure)) return gitErr.authFailed(failure.message);
    if (isNetworkFailure(failure)) return gitErr.networkError(failure.message);
    if (
      message.includes('does not appear to be a git repository') ||
      message.includes('not found')
    ) {
      return gitErr.remoteNotFound(failure.message, remote);
    }
    return commandFailure(failure);
  },

  fetchPrForReview(error: unknown, prNumber: number): Err<FetchPrForReviewError> {
    const failure = gitFailure(error);
    const message = failure.message.toLowerCase();
    if (isAuthRequired(failure)) return gitErr.authRequired(failure.message);
    if (
      message.includes('not found') ||
      message.includes("couldn't find remote ref") ||
      message.includes('unknown revision')
    ) {
      return gitErr.prNotFound(prNumber, failure.message);
    }
    return commandFailure(failure);
  },

  createBranch(error: unknown, branch: string, from: string): Err<CreateBranchError> {
    const failure = gitFailure(error);
    const message = failure.message.toLowerCase();
    if (message.includes('already exists')) return gitErr.alreadyExists(branch, failure.message);
    if (message.includes('not a valid object name') || message.includes('invalid reference')) {
      return gitErr.invalidBase(branch, from, failure.message);
    }
    if (message.includes('not a valid branch name')) {
      return gitErr.invalidName(branch, failure.message);
    }
    return commandFailure(failure);
  },

  deleteBranch(error: unknown, branch: string): Err<DeleteBranchError> {
    const failure = gitFailure(error);
    const message = failure.message.toLowerCase();
    if (
      message.includes('checked out') ||
      message.includes('currently checked out') ||
      message.includes('cannot delete branch')
    ) {
      return gitErr.branchIsCurrent(branch, failure.message);
    }
    if (message.includes('not found')) return gitErr.branchNotFound(branch, failure.message);
    if (message.includes('not fully merged')) {
      return gitErr.branchNotMerged(branch, failure.message);
    }
    return commandFailure(failure);
  },

  isMissingBlob(error: unknown): boolean {
    return isMissingObject(gitFailure(error));
  },

  isNotRepository(error: unknown): boolean {
    const message = gitFailure(error).message.toLowerCase();
    return (
      message.includes('not a git repository') ||
      message.includes('not a git directory') ||
      message.includes('must be run in a work tree')
    );
  },

  isMissingRef(error: unknown): boolean {
    const failure = gitFailure(error);
    if (failure.exitCode !== 128) return false;
    const message = failure.message.toLowerCase();
    return (
      message.includes('needed a single revision') ||
      message.includes('unknown revision') ||
      message.includes('not a valid object name')
    );
  },

  isMissingSymbolicRef(error: unknown): boolean {
    const failure = gitFailure(error);
    return (
      failure.exitCode === 128 && failure.message.toLowerCase().includes('is not a symbolic ref')
    );
  },

  isRemoteUnavailable(error: unknown): boolean {
    const failure = gitFailure(error);
    const message = failure.message.toLowerCase();
    return (
      isAuthRequired(failure) ||
      isAuthFailed(failure) ||
      isNetworkFailure(failure) ||
      message.includes('no such remote') ||
      message.includes('no remote configured') ||
      message.includes('does not appear to be a git repository') ||
      message.includes('repository not found')
    );
  },

  isMissingUpstream(error: unknown): boolean {
    const message = gitFailure(error).message.toLowerCase();
    return (
      message.includes('requested upstream branch') ||
      message.includes('cannot set up tracking information') ||
      message.includes('does not exist')
    );
  },
} as const;
