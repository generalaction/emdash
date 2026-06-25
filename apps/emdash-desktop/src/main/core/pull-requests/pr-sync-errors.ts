import { match, P } from 'ts-pattern';
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
  return match(error)
    .with({ type: 'invalid-repository-ref' }, (e) => `Invalid GitHub repository URL: "${e.input}"`)
    .with(
      P.union(
        { type: 'auth_required' },
        { type: 'account_not_found' },
        { type: 'account_host_mismatch' },
        { type: 'token_missing' },
        { type: 'not_found_or_no_access' },
        { type: 'sso_required' },
        { type: 'rate_limited' },
        { type: 'forbidden' },
        { type: 'sync_cancelled' },
        { type: 'api_error' }
      ),
      (e) => e.message
    )
    .with({ type: 'host_unreachable' }, (e) => `Unable to reach ${e.host}: ${e.reason}`)
    .exhaustive();
}
