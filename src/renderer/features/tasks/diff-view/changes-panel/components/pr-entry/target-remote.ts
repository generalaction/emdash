import type { Remote } from '@shared/git';
import { parseGitHubRepository, type GitHubRepositoryRef } from '@shared/github-repository';

export type GitHubTargetRemote = {
  remote: Remote;
  repository: GitHubRepositoryRef;
};

export function getGitHubTargetRemotes(remotes: ReadonlyArray<Remote>): GitHubTargetRemote[] {
  return remotes
    .map((remote) => {
      const repository = parseGitHubRepository(remote.url);
      return repository ? { remote, repository } : null;
    })
    .filter((option): option is GitHubTargetRemote => option !== null);
}

export function resolveCreatePrTargetRemote({
  options,
  projectRemoteName,
  selectedRemoteName,
  fallbackRepositoryUrl,
}: {
  options: ReadonlyArray<GitHubTargetRemote>;
  projectRemoteName: string;
  selectedRemoteName?: string;
  fallbackRepositoryUrl?: string;
}): GitHubTargetRemote | undefined {
  const selected = selectedRemoteName
    ? options.find((option) => option.remote.name === selectedRemoteName)
    : undefined;
  if (selected) return selected;

  const projectRemote = options.find((option) => option.remote.name === projectRemoteName);
  if (projectRemote) return projectRemote;

  const fallbackRepository = parseGitHubRepository(fallbackRepositoryUrl);
  if (fallbackRepository) {
    const fallback = options.find(
      (option) => option.repository.repositoryUrl === fallbackRepository.repositoryUrl
    );
    if (fallback) return fallback;
  }

  return options[0];
}
