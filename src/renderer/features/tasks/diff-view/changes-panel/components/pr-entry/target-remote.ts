import type { Remote } from '@shared/git';
import {
  isGitHubDotCom,
  parseGitHubRepository,
  type GitHubRepositoryRef,
} from '@shared/github-repository';

export type GitHubTargetRemote = {
  remote: Remote;
  repository: GitHubRepositoryRef;
};

// The URL parser is intentionally permissive about host (Enterprise instances can use any
// domain), so callers that want to filter to "known GitHub remotes" must apply an explicit
// host check. For now this picker is github.com-only; broadening to user-authenticated
// Enterprise hosts is tracked as a follow-up.
export function getGitHubTargetRemotes(remotes: ReadonlyArray<Remote>): GitHubTargetRemote[] {
  return remotes
    .map((remote) => {
      const repository = parseGitHubRepository(remote.url);
      return repository && isGitHubDotCom(repository) ? { remote, repository } : null;
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
