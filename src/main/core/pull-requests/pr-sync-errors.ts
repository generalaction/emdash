import {
  githubApiAuthRequired,
  type GitHubApiAuthError,
} from '@main/core/github/services/github-api-auth-errors';
import type { RepositoryRefParseError } from '@shared/repository-ref';

export type PrSyncEngineError =
  | RepositoryRefParseError
  | GitHubApiAuthError
  | { type: 'host_unreachable'; host: string; reason: string }
  | { type: 'api_error'; message: string };

function isAuthStatus(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('status' in error)) return false;
  const status = Number((error as { status: unknown }).status);
  return status === 401 || status === 403;
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  const code = (error as { code: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function isNetworkConnectivityError(error: unknown): boolean {
  const text = errorText(error);
  const code = errorCode(error);
  return Boolean(
    code?.startsWith('ECONN') ||
    code === 'ETIMEDOUT' ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    /connect timeout|network error|fetch failed|socket hang up|dns|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|ECONNREFUSED/i.test(
      text
    )
  );
}

export function isPrSyncHostUnreachable(
  error: PrSyncEngineError
): error is Extract<PrSyncEngineError, { type: 'host_unreachable' }> {
  return error.type === 'host_unreachable';
}

export function toPrApiError(error: unknown, fallback: string, host?: string): PrSyncEngineError {
  if (host && isAuthStatus(error)) return githubApiAuthRequired(host);
  if (host && isNetworkConnectivityError(error)) {
    return { type: 'host_unreachable', host, reason: errorText(error) };
  }

  const ghErrors =
    error &&
    typeof error === 'object' &&
    'response' in error &&
    Array.isArray((error.response as { data?: { errors?: unknown[] } } | undefined)?.data?.errors)
      ? (error.response as { data: { errors: { message?: string }[] } }).data.errors
      : undefined;
  return {
    type: 'api_error',
    message: ghErrors?.[0]?.message ?? (error instanceof Error ? error.message : fallback),
  };
}

export function prSyncEngineErrorMessage(error: PrSyncEngineError): string {
  switch (error.type) {
    case 'invalid-repository-ref':
      return `Invalid GitHub repository URL: "${error.input}"`;
    case 'auth_required':
      return error.message;
    case 'host_unreachable':
      return `Unable to reach ${error.host}: ${error.reason}`;
    case 'api_error':
      return error.message;
  }
}
