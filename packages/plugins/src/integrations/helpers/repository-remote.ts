import { err, ok, type Result } from '@emdash/shared';
import type { IntegrationError } from '../types';
import { parseGitRemoteUrl, type ParsedGitRemote } from './git-remote';
import { checkRemoteHostMatchesInstance } from './hosted-instance';

export type RemoteRepository = {
  owner: string;
  repo: string;
  slug: string;
};

/** Parse a repository URL and verify it targets the configured instance host. */
export function resolveInstanceRemote(
  repositoryUrl: string | undefined,
  instanceUrl: string,
  providerName: string
): Result<ParsedGitRemote, IntegrationError> {
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

  const hostMatch = checkRemoteHostMatchesInstance(remote.host, instanceUrl, providerName);
  if (!hostMatch.success) return err(hostMatch.error);

  return ok(remote);
}

/** Resolve an `owner/repo` repository from a remote URL on the configured instance. */
export function resolveRemoteRepository(
  repositoryUrl: string | undefined,
  instanceUrl: string,
  providerName: string
): Result<RemoteRepository, IntegrationError> {
  const remote = resolveInstanceRemote(repositoryUrl, instanceUrl, providerName);
  if (!remote.success) return err(remote.error);

  const parts = remote.data.slug.split('/');
  const [owner, repo] = parts;
  if (parts.length !== 2 || !owner || !repo) {
    return err({
      type: 'invalid_input',
      message: 'Unable to extract owner/repo from remote URL.',
    });
  }

  return ok({ owner, repo, slug: `${owner}/${repo}` });
}
