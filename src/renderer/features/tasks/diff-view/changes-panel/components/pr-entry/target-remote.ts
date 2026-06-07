import type { Remote } from '@shared/core/git/git';
import { parseRepositoryRef, type RepositoryRef } from '@shared/repository-ref';

export type TargetRemote = {
  remote: Remote;
  repository: RepositoryRef;
};

export function getTargetRemotes(
  remotes: ReadonlyArray<Remote>,
  options: { host?: string } = {}
): TargetRemote[] {
  return remotes
    .map((remote) => {
      const repository = parseRepositoryRef(remote.url);
      return repository ? { remote, repository } : null;
    })
    .filter((option): option is TargetRemote => option !== null)
    .filter((option) => !options.host || option.repository.host === options.host);
}

export function resolveCreatePrTargetRemote({
  options,
  projectRemoteName,
  selectedRemoteName,
  fallbackRepositoryUrl,
}: {
  options: ReadonlyArray<TargetRemote>;
  projectRemoteName: string;
  selectedRemoteName?: string;
  fallbackRepositoryUrl?: string;
}): TargetRemote | undefined {
  const selected = selectedRemoteName
    ? options.find((option) => option.remote.name === selectedRemoteName)
    : undefined;
  if (selected) return selected;

  const projectRemote = options.find((option) => option.remote.name === projectRemoteName);
  if (projectRemote) return projectRemote;

  const fallbackRepository = parseRepositoryRef(fallbackRepositoryUrl);
  if (fallbackRepository) {
    const fallback = options.find(
      (option) => option.repository.repositoryUrl === fallbackRepository.repositoryUrl
    );
    if (fallback) return fallback;
  }

  return options[0];
}
