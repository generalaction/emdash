import { Octokit } from '@octokit/rest';
import { githubConnectionService } from './github-connection-service';

let cachedOctokit: Octokit | null = null;
let cachedToken: string | null = null;

export async function getOctokit(): Promise<Octokit> {
  const token = await githubConnectionService.getToken();
  if (!token) throw new Error('Not authenticated');
  if (token !== cachedToken) {
    cachedOctokit = new Octokit({ auth: token });
    cachedToken = token;
  }
  return cachedOctokit!;
}

export function clearOctokitCache(): void {
  cachedOctokit = null;
  cachedToken = null;
}
