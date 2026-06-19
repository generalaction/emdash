import type { GitHubApiAuthError } from '@main/core/github/services/github-api-auth-errors';
import {
  classifyGitHubApiError,
  type GitHubApiOperationError,
} from '@main/core/github/services/github-api-errors';
import type { RepositoryRefParseError } from '@shared/repository-ref';

export type PrSyncHostUnreachableError = {
  type: 'host_unreachable';
  host: string;
  reason: string;
};

export type PrSyncApiError = {
  type: 'api_error';
  message: string;
};

export type PrSyncCancelledError = {
  type: 'sync_cancelled';
  message: string;
};

export type PrSyncNotFoundOrNoAccessError = {
  type: 'not_found_or_no_access';
  host: string;
  message: string;
};

export type PrSyncEngineError =
  | RepositoryRefParseError
  | GitHubApiAuthError
  | GitHubApiOperationError
  | PrSyncCancelledError
  | PrSyncApiError;

export function isPrSyncHostUnreachable(
  error: PrSyncEngineError
): error is PrSyncHostUnreachableError {
  return error.type === 'host_unreachable';
}

export function toPrApiError(
  error: unknown,
  fallback: string,
  host?: string,
  nameWithOwner?: string
): PrSyncEngineError {
  return classifyGitHubApiError(error, { host, nameWithOwner, fallback });
}

export function prSyncEngineErrorMessage(error: PrSyncEngineError): string {
  switch (error.type) {
    case 'invalid-repository-ref':
      return `Invalid GitHub repository URL: "${error.input}"`;
    case 'auth_required':
    case 'account_not_found':
    case 'account_host_mismatch':
    case 'token_missing':
      return error.message;
    case 'not_found_or_no_access':
    case 'sso_required':
    case 'rate_limited':
    case 'forbidden':
      return error.message;
    case 'host_unreachable':
      return `Unable to reach ${error.host}: ${error.reason}`;
    case 'sync_cancelled':
    case 'api_error':
      return error.message;
  }
}
