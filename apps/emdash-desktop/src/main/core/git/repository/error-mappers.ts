import type {
  CreateBranchError as SharedCreateBranchError,
  DeleteBranchError as SharedDeleteBranchError,
  FetchError as SharedFetchError,
  FetchPrForReviewError as SharedFetchPrForReviewError,
  PushError as SharedPushError,
} from '@emdash/core/git';
import type {
  CreateBranchError,
  DeleteBranchError,
  FetchError,
  FetchPrForReviewError,
  PushError,
} from '@shared/core/git/types';

export function mapFetchError(error: SharedFetchError): FetchError {
  switch (error.type) {
    case 'auth-failed':
      return { type: 'auth_failed', message: error.message };
    case 'remote-not-found':
      return { type: 'remote_not_found', message: error.message };
    case 'git-error':
      return { type: 'error', message: error.message };
  }
}

export function mapPushError(error: SharedPushError): PushError {
  switch (error.type) {
    case 'auth-failed':
      return { type: 'auth_failed', message: error.message };
    case 'rejected':
      return { type: 'rejected', message: error.message };
    case 'no-upstream':
      return { type: 'no_remote', message: error.message };
    case 'git-error':
      return { type: 'error', message: error.message };
  }
}

export function mapCreateBranchError(error: SharedCreateBranchError): CreateBranchError {
  switch (error.type) {
    case 'already-exists':
      return { type: 'already_exists', name: error.branch };
    case 'invalid-base':
      return { type: 'invalid_base', from: error.from };
    case 'invalid-name':
      return { type: 'invalid_name', name: error.branch };
    case 'fetch-failed':
      return {
        type: 'fetch_failed',
        remote: error.remote,
        branch: error.branch,
        error: mapFetchError(error.error),
      };
    case 'git-error':
      return { type: 'error', message: error.message };
  }
}

export function mapDeleteBranchError(error: SharedDeleteBranchError): DeleteBranchError {
  switch (error.type) {
    case 'not-found':
      return { type: 'not_found', branch: error.branch };
    case 'not-merged':
      return { type: 'unmerged', branch: error.branch };
    case 'git-error':
      return { type: 'error', message: error.message };
  }
}

export function mapFetchPrForReviewError(
  error: SharedFetchPrForReviewError
): FetchPrForReviewError {
  switch (error.type) {
    case 'not-found':
      return { type: 'not_found', prNumber: error.prNumber };
    case 'git-error':
      return { type: 'error', message: error.message };
  }
}
