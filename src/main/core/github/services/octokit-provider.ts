import { Octokit } from '@octokit/rest';
import { normalizeRepositoryHost } from '@shared/repository-ref';
import { err, ok, type Result } from '@shared/result';
import type { GitHubApiAuthError } from './github-api-auth-errors';
import { githubApiAuthService } from './github-api-auth-service';

const cachedOctokits = new Map<string, { octokit: Octokit; token: string }>();

function apiBaseUrlForHost(host: string): string {
  return host === 'github.com' ? 'https://api.github.com' : `https://${host}/api/v3`;
}

export class GitHubApiAuthErrorException extends Error {
  constructor(readonly authError: GitHubApiAuthError) {
    super(authError.message);
    this.name = 'GitHubApiAuthErrorException';
  }
}

export async function getOctokit(host: string): Promise<Result<Octokit, GitHubApiAuthError>> {
  const normalizedHost = normalizeRepositoryHost(host);
  const token = await githubApiAuthService.getToken(normalizedHost);
  if (!token.success) return err(token.error);

  const cached = cachedOctokits.get(normalizedHost);
  if (cached?.token === token.data) return ok(cached.octokit);

  const octokit = new Octokit({ auth: token.data, baseUrl: apiBaseUrlForHost(normalizedHost) });

  cachedOctokits.set(normalizedHost, { octokit, token: token.data });
  return ok(octokit);
}

export function clearOctokitCache(host?: string): void {
  if (host) {
    cachedOctokits.delete(normalizeRepositoryHost(host));
    return;
  }
  cachedOctokits.clear();
}
