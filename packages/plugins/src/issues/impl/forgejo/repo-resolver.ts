import { err, ok, type Result } from '@emdash/shared';
import { parseGitRemoteUrl } from '../../../integrations/helpers/git-remote';
import {
  assertRemoteHostMatchesInstance,
  RemoteHostMismatchError,
} from '../../../integrations/helpers/hosted-instance';
import type { ForgejoCredentials } from '../../../integrations/impl/forgejo/types';
import type { IntegrationError } from '../../../integrations/types';

export type ForgejoRepository = {
  owner: string;
  repo: string;
  repoName: string;
};

export function resolveForgejoRepository(
  credentials: ForgejoCredentials,
  repositoryUrl: string | undefined
): Result<ForgejoRepository, IntegrationError> {
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
    assertRemoteHostMatchesInstance(remote.host, credentials.instanceUrl, 'Forgejo');
  } catch (error) {
    if (error instanceof RemoteHostMismatchError) {
      return err({
        type: 'unsupported_host',
        message: error.message,
      });
    }

    return err({
      type: 'invalid_input',
      message: 'A valid Forgejo instance URL is required.',
    });
  }

  const repository = parseForgejoRepositorySlug(remote.slug);
  if (!repository) {
    return err({
      type: 'invalid_input',
      message: 'Unable to extract owner/repo from remote URL.',
    });
  }

  return ok({
    ...repository,
    repoName: repository.repo,
  });
}

function parseForgejoRepositorySlug(
  slug: string
): Pick<ForgejoRepository, 'owner' | 'repo'> | null {
  const parts = slug.split('/');
  if (parts.length !== 2) return null;

  const [owner, repo] = parts;
  if (!owner || !repo) return null;
  return { owner, repo };
}
