import { isGitHubDotComHost, normalizeRepositoryHost } from '@shared/repository-ref';

export function githubApiBaseUrlForHost(host: string): string {
  const normalizedHost = normalizeRepositoryHost(host);
  return isGitHubDotComHost(normalizedHost)
    ? 'https://api.github.com'
    : `https://${normalizedHost}/api/v3`;
}
