import { err, ok, type Result } from '@emdash/shared';
import { parseGitRemoteUrl } from '../../../integrations/helpers/git-remote';
import {
  assertRemoteHostMatchesInstance,
  RemoteHostMismatchError,
} from '../../../integrations/helpers/hosted-instance';
import type { GitHubCredentials } from '../../../integrations/impl/github/types';
import type { IntegrationError } from '../../../integrations/types';

export type GitHubRepository = {
  owner: string;
  repo: string;
  slug: string;
};

export function resolveGitHubRepository(
  credentials: GitHubCredentials,
  repositoryUrl: string | undefined
): Result<GitHubRepository, IntegrationError> {
  const remoteUrl = repositoryUrl?.trim();
  if (!remoteUrl) {
    return err({
      type: 'invalid_input',
      message: 'Repository URL is required.',
    });
  }

  const remote = parseGitRemoteUrl(remoteUrl);
  if (!remote) {
    return err({
      type: 'invalid_input',
      message: 'Unable to parse repository URL.',
    });
  }

  try {
    const host = new URL(credentials.apiBaseUrl).host;
    const expectedHost = host === 'api.github.com' ? 'github.com' : host;
    assertRemoteHostMatchesInstance(remote.host, `https://${expectedHost}`, 'GitHub');
  } catch (error) {
    if (error instanceof RemoteHostMismatchError) {
      return err({
        type: 'unsupported_host',
        message: error.message,
      });
    }

    return err({
      type: 'invalid_input',
      message: 'A valid GitHub API base URL is required.',
    });
  }

  const repository = parseGitHubRepositorySlug(remote.slug);
  if (!repository) {
    return err({
      type: 'invalid_input',
      message: 'Unable to extract owner/repo from remote URL.',
    });
  }

  return ok({
    ...repository,
    slug: `${repository.owner}/${repository.repo}`,
  });
}

function parseGitHubRepositorySlug(slug: string): Pick<GitHubRepository, 'owner' | 'repo'> | null {
  const parts = slug.split('/');
  if (parts.length !== 2) return null;

  const [owner, repo] = parts;
  if (!owner || !repo) return null;
  return { owner, repo };
}
