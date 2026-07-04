import { err, type Result } from '@emdash/shared';
import { type RemoteRepository, resolveRemoteRepository } from '../../helpers/repository-remote';
import type { IntegrationError } from '../../types';
import type { GitHubCredentials } from './types';

export type GitHubRepository = RemoteRepository;

export function resolveGitHubRepository(
  credentials: GitHubCredentials,
  repositoryUrl: string | undefined
): Result<GitHubRepository, IntegrationError> {
  let apiHost: string;
  try {
    apiHost = new URL(credentials.apiBaseUrl).host;
  } catch {
    return err({
      type: 'invalid_input',
      message: 'A valid GitHub API base URL is required.',
    });
  }

  const instanceHost = apiHost === 'api.github.com' ? 'github.com' : apiHost;
  return resolveRemoteRepository(repositoryUrl, `https://${instanceHost}`, 'GitHub');
}
