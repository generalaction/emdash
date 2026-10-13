import { isAbortError, isNetworkError } from '../../helpers/errors';
import type { PullRequestAuthError, PullRequestError } from '../../schemas';
import type { PullRequestOperationErrorType } from '../../types';

const integrationId = 'github';

function authRequiredHint(host: string): string {
  return host === 'github.com'
    ? 'Connect GitHub from account settings.'
    : `Run: gh auth login --hostname ${host}`;
}

export function mapGitHubAuthError(error: PullRequestAuthError): PullRequestError {
  switch (error.type) {
    case 'auth_required':
      return {
        type: 'auth_required',
        integrationId,
        host: error.host,
        hint: error.hint ?? authRequiredHint(error.host),
      };
    case 'account_not_found':
      return {
        type: 'account_not_found',
        integrationId,
        host: error.host,
        accountId: error.accountId,
        message: error.message,
      };
    case 'account_host_mismatch':
      return {
        type: 'account_host_mismatch',
        integrationId,
        host: error.host,
        accountId: error.accountId,
        accountHost: error.accountHost,
        message: error.message,
      };
    case 'token_missing':
      return {
        type: 'token_missing',
        integrationId,
        host: error.host,
        accountId: error.accountId,
        message: error.message,
      };
    // Fail closed (spec: github-git-settings §8): an unresolvable identity skips
    // the operation with a surfaced status — never a fallback identity.
    case 'account_unresolvable':
      return { type: 'account_not_found', integrationId, message: error.message };
    // Explicit "no account" is intent, not an error (§7 reporting matrix); the
    // renderer shows the quiet disabled state, this status only records that
    // the sync did not run.
    case 'integration_disabled':
      return { type: 'integration_disabled', integrationId, message: error.message };
  }
}

export function mapApiError(
  error: unknown,
  fallback: string,
  host: string,
  nameWithOwner?: string,
  operationType: PullRequestOperationErrorType = 'sync_failed'
): PullRequestError {
  if (isAbortError(error)) return { type: operationType, message: 'Operation cancelled' };
  const status = readStatus(error);
  const message = error instanceof Error ? error.message : fallback;
  if (status === 401) {
    return { type: 'auth_required', integrationId, host, hint: authRequiredHint(host) };
  }
  if (status === 404) {
    return {
      type: 'not_found_or_no_access',
      host,
      message: nameWithOwner
        ? `Repository ${nameWithOwner} was not found or is not accessible`
        : message,
    };
  }
  if (status === 403) {
    const resetAt = readHeader(error, 'x-ratelimit-reset');
    if (resetAt) {
      const resetTimestamp = Number(resetAt);
      return {
        type: 'rate_limited',
        host,
        message,
        resetAt: Number.isFinite(resetTimestamp)
          ? new Date(resetTimestamp * 1_000).toISOString()
          : undefined,
      };
    }
    const ssoUrl = readHeader(error, 'x-github-sso')?.match(/url=([^;,\s]+)/)?.[1];
    if (ssoUrl) return { type: 'sso_required', integrationId, host, message, ssoUrl };
    return { type: 'forbidden', host, message };
  }
  if (isNetworkError(error)) return { type: 'host_unreachable', host, reason: message };
  return { type: operationType, message: message || fallback };
}

function readStatus(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'status' in error
    ? Number((error as { status?: unknown }).status)
    : undefined;
}

function readHeader(error: unknown, key: string): string | undefined {
  if (typeof error !== 'object' || error === null || !('response' in error)) return undefined;
  const headers = (error as { response?: { headers?: Record<string, string> } }).response?.headers;
  return headers?.[key];
}
