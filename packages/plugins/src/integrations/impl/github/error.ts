import { toIntegrationError } from '../../helpers/error';
import type { IntegrationError } from '../../types';

export const GITHUB_API_ERROR_MESSAGES = {
  AUTH_FAILED: 'GitHub authentication failed. Check your credentials.',
  MISSING_PERMISSIONS: 'GitHub credentials were accepted but are missing required permissions.',
  SSO_REQUIRED: 'GitHub requires single sign-on authorization for this organization.',
  RATE_LIMITED: 'GitHub API rate limit exceeded. Please try again shortly.',
  NOT_FOUND: 'GitHub resource was not found or you do not have access.',
} as const;

/**
 * GitHub-aware refinement of the shared status-code mapper: Octokit request
 * errors carry response headers that distinguish SSO enforcement and rate
 * limiting from plain permission failures, which a bare 403 cannot.
 */
export function toGitHubIntegrationError(
  error: unknown,
  fallback = 'GitHub request failed.'
): IntegrationError {
  const status = getStatus(error);
  const headers = getResponseHeaders(error);

  if (status === 401) {
    return { type: 'auth_failed', message: GITHUB_API_ERROR_MESSAGES.AUTH_FAILED };
  }

  if (status === 403 && typeof headers['x-github-sso'] === 'string') {
    const ssoUrl = /url=([^;]+)/i.exec(headers['x-github-sso'])?.[1];
    return {
      type: 'sso_required',
      message: GITHUB_API_ERROR_MESSAGES.SSO_REQUIRED,
      ...(ssoUrl ? { ssoUrl } : {}),
    };
  }

  if (status === 429 || (status === 403 && headerValue(headers, 'x-ratelimit-remaining') === '0')) {
    const resetAt = rateLimitResetAt(headers);
    return {
      type: 'rate_limited',
      message: GITHUB_API_ERROR_MESSAGES.RATE_LIMITED,
      ...(resetAt ? { resetAt } : {}),
    };
  }

  if (status === 403) {
    return { type: 'auth_failed', message: GITHUB_API_ERROR_MESSAGES.MISSING_PERMISSIONS };
  }

  if (status === 404) {
    return { type: 'not_found_or_no_access', message: GITHUB_API_ERROR_MESSAGES.NOT_FOUND };
  }

  return toIntegrationError(error, 'GitHub', fallback);
}

function getStatus(error: unknown): number | undefined {
  if (!(error instanceof Error) || !('status' in error)) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

function getResponseHeaders(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error) || !('response' in error)) return {};
  const response = (error as { response?: { headers?: unknown } }).response;
  if (!response?.headers || typeof response.headers !== 'object') return {};
  return response.headers as Record<string, unknown>;
}

function headerValue(headers: Record<string, unknown>, name: string): string | undefined {
  const value = headers[name];
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return undefined;
}

function rateLimitResetAt(headers: Record<string, unknown>): string | undefined {
  const reset = Number(headerValue(headers, 'x-ratelimit-reset'));
  if (!Number.isFinite(reset) || reset <= 0) return undefined;
  return new Date(reset * 1000).toISOString();
}
