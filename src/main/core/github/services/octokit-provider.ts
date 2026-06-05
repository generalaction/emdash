import { Octokit } from '@octokit/rest';
import { log } from '@main/lib/logger';
import { normalizeRepositoryHost } from '@shared/repository-ref';
import { err, ok, type Result } from '@shared/result';
import type { GitHubApiAuthError } from './github-api-auth-errors';
import type { GitHubApiAuthContext } from './github-api-auth-service';
import { githubApiAuthService } from './github-api-auth-service-instance';
import { githubApiBaseUrlForHost } from './github-api-base-url';

const cachedOctokits = new Map<string, { octokit: Octokit; token: string }>();

const octokitLog = {
  debug: (...input: unknown[]) => log.debug('Octokit:', ...input),
  info: (...input: unknown[]) => log.debug('Octokit:', ...input),
  warn: (...input: unknown[]) => log.warn('Octokit:', ...input),
  error: (...input: unknown[]) => log.debug('Octokit request failed:', ...input),
};

export class GitHubApiAuthErrorException extends Error {
  constructor(readonly authError: GitHubApiAuthError) {
    super(authError.message);
    this.name = 'GitHubApiAuthErrorException';
  }
}

function cacheKeyFor(host: string, context: GitHubApiAuthContext): string {
  const accountId = context.accountId?.trim() || 'default';
  return `${host}:${accountId}`;
}

export async function getOctokit(
  host: string,
  context: GitHubApiAuthContext = {}
): Promise<Result<Octokit, GitHubApiAuthError>> {
  const normalizedHost = normalizeRepositoryHost(host);
  const token = await githubApiAuthService.getToken(normalizedHost, context);
  if (!token.success) return err(token.error);

  const cacheKey = cacheKeyFor(normalizedHost, context);
  const cached = cachedOctokits.get(cacheKey);
  if (cached?.token === token.data) return ok(cached.octokit);

  const octokit = new Octokit({
    auth: token.data,
    baseUrl: githubApiBaseUrlForHost(normalizedHost),
    log: octokitLog,
  });

  cachedOctokits.set(cacheKey, { octokit, token: token.data });
  return ok(octokit);
}

export function clearOctokitCache(host?: string): void {
  if (host) {
    const normalizedHost = normalizeRepositoryHost(host);
    for (const key of cachedOctokits.keys()) {
      if (key.startsWith(`${normalizedHost}:`)) cachedOctokits.delete(key);
    }
    return;
  }
  cachedOctokits.clear();
}
