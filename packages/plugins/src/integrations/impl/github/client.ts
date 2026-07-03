import { Octokit } from '@octokit/rest';
import type { IntegrationCredentials } from '../../host';

export type GitHubCredentials = {
  accessToken: string;
  apiBaseUrl: string;
};

export const GITHUB_DOTCOM_API_BASE_URL = 'https://api.github.com';

export function readGitHubCredentials(credentials: IntegrationCredentials): GitHubCredentials {
  const accessToken =
    typeof credentials.accessToken === 'string' ? credentials.accessToken.trim() : '';
  if (!accessToken) throw new Error('GitHub access token is required.');

  const apiBaseUrl =
    typeof credentials.apiBaseUrl === 'string' && credentials.apiBaseUrl.trim()
      ? credentials.apiBaseUrl.trim().replace(/\/+$/, '')
      : GITHUB_DOTCOM_API_BASE_URL;

  return { accessToken, apiBaseUrl };
}

export function createGitHubClient(credentials: GitHubCredentials): Octokit {
  return new Octokit({ auth: credentials.accessToken, baseUrl: credentials.apiBaseUrl });
}

/**
 * Service host for an API base URL: api.github.com maps back to github.com,
 * GHES instances use `https://<host>/api/v3` so the URL host is the instance.
 */
export function githubServiceHostForApiBaseUrl(apiBaseUrl: string): string {
  try {
    const host = new URL(apiBaseUrl).host;
    return host === 'api.github.com' ? 'github.com' : host;
  } catch {
    return 'github.com';
  }
}
