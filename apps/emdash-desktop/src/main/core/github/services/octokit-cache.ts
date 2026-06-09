import type { Octokit } from '@octokit/rest';
import { normalizeRepositoryHost } from '@shared/repository-ref';
import type { GitHubApiAuthContext } from './github-api-auth-service';

const cachedOctokits = new Map<string, { octokit: Octokit; token: string }>();

function cacheKeyFor(host: string, context: GitHubApiAuthContext): string {
  const accountId = context.accountId?.trim() || 'default';
  return `${host}:${accountId}`;
}

export function getCachedOctokit(host: string, context: GitHubApiAuthContext) {
  return cachedOctokits.get(cacheKeyFor(host, context));
}

export function setCachedOctokit(
  host: string,
  context: GitHubApiAuthContext,
  value: { octokit: Octokit; token: string }
): void {
  cachedOctokits.set(cacheKeyFor(host, context), value);
}

export function clearOctokitCache(host?: string, accountId?: string): void {
  if (host) {
    const normalizedHost = normalizeRepositoryHost(host);
    if (accountId) {
      cachedOctokits.delete(cacheKeyFor(normalizedHost, { accountId }));
      return;
    }
    for (const key of cachedOctokits.keys()) {
      if (key.startsWith(`${normalizedHost}:`)) cachedOctokits.delete(key);
    }
    return;
  }
  cachedOctokits.clear();
}
