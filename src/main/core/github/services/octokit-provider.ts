import { Octokit } from '@octokit/rest';
import { apiBaseUrlForHost, GITHUB_DOT_COM_HOST } from '@shared/github-repository';
import { githubConnectionService } from './github-connection-service';

// Cache one Octokit per (host, token) pair so multiple Enterprise hosts can coexist and
// token rotation cleanly invalidates only the affected entry. Keyed on `${host}|${token}`.
const cache = new Map<string, Octokit>();

function cacheKey(host: string, token: string): string {
  return `${host}|${token}`;
}

export async function getOctokit(host: string = GITHUB_DOT_COM_HOST): Promise<Octokit> {
  const token = await githubConnectionService.getToken(host);
  if (!token) throw new Error('Not authenticated');
  const key = cacheKey(host, token);
  const cached = cache.get(key);
  if (cached) return cached;
  const octokit = new Octokit({
    auth: token,
    baseUrl: apiBaseUrlForHost(host),
  });
  cache.set(key, octokit);
  return octokit;
}

export function clearOctokitCache(): void {
  cache.clear();
}
