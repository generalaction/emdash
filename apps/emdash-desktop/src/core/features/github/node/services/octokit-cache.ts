import type { Octokit } from '@octokit/rest';
import { normalizeRepositoryHost } from '@core/primitives/repository/api';

const cachedOctokits = new Map<string, { octokit: Octokit; token: string; apiBaseUrl: string }>();

function cacheKeyFor(host: string, accountId: string): string {
  return `${host}:${accountId}`;
}

export function getCachedOctokit(host: string, accountId: string) {
  return cachedOctokits.get(cacheKeyFor(host, accountId));
}

export function setCachedOctokit(
  host: string,
  accountId: string,
  value: { octokit: Octokit; token: string; apiBaseUrl: string }
): void {
  cachedOctokits.set(cacheKeyFor(host, accountId), value);
}

export function clearOctokitCache(host?: string, accountId?: string): void {
  if (host) {
    const normalizedHost = normalizeRepositoryHost(host);
    if (accountId) {
      cachedOctokits.delete(cacheKeyFor(normalizedHost, accountId));
      return;
    }
    for (const key of cachedOctokits.keys()) {
      if (key.startsWith(`${normalizedHost}:`)) cachedOctokits.delete(key);
    }
    return;
  }
  cachedOctokits.clear();
}
