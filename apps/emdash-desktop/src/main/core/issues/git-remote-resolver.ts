import { parseRepositoryRef } from '@shared/repository-ref';

export type ParsedGitRemote = {
  host: string;
  slug: string;
};

export function parseGitRemoteUrl(remoteUrl: string): ParsedGitRemote | null {
  const ref = parseRepositoryRef(remoteUrl);
  return ref ? { host: ref.host, slug: ref.nameWithOwner } : null;
}

export function resolveRepositoryRemote(repositoryUrl: string | undefined): ParsedGitRemote {
  const remoteUrl = repositoryUrl?.trim();
  if (!remoteUrl) {
    throw new Error('Repository URL is required.');
  }

  const remote = parseGitRemoteUrl(remoteUrl);
  if (!remote) {
    throw new Error('Unable to parse repository URL.');
  }
  return remote;
}
