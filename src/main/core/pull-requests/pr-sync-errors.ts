import type { GitHubApiAuthError } from '@main/core/github/services/github-api-auth-service';
import { isGitHubDotComHost, type RepositoryRefParseError } from '@shared/repository-ref';

export type PrSyncEngineError =
  | RepositoryRefParseError
  | GitHubApiAuthError
  | { type: 'api_error'; message: string };

function isAuthStatus(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('status' in error)) return false;
  const status = Number((error as { status: unknown }).status);
  return status === 401 || status === 403;
}

function authRequiredForHost(host: string): GitHubApiAuthError {
  if (isGitHubDotComHost(host)) {
    return { type: 'auth_required', host, message: 'GitHub authentication required.' };
  }
  const hint = `Run: gh auth login --hostname ${host}`;
  return {
    type: 'auth_required',
    host,
    message: `GitHub Enterprise authentication required for ${host}. ${hint}`,
    hint,
  };
}

export function toPrApiError(error: unknown, fallback: string, host?: string): PrSyncEngineError {
  if (host && isAuthStatus(error)) return authRequiredForHost(host);

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
    case 'api_error':
      return error.message;
  }
}
