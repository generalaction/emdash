import type { RepositorySelector } from '@emdash/core/runtimes/git/api';
import { log } from '@emdash/shared/logger';
import type { RepoFacts, RepoRemoteFacts } from '@core/primitives/project-settings/api';
import { parseRepositoryRef } from '@core/primitives/repository/api';
import type { GitRuntimeClient } from '@core/services/runtime-broker/api/clients';

/**
 * Repo-facts loader for the settings provider's lazy demotion migration
 * (spec: github-git-settings §10). Built from the git runtime's refs and
 * remotes live states only — no network calls, so `headBranch` is always
 * null and default-branch inference degrades to the well-known-branch chain.
 *
 * The successful result is memoized for the provider's lifetime: demotion is
 * a one-shot migration concern and must not turn every settings read into
 * git work. Failures are not memoized so the next read retries.
 */
export function createRepoFactsLoader(
  git: GitRuntimeClient,
  repository: RepositorySelector,
  hasRepository: boolean
): () => Promise<RepoFacts | null> {
  let memoized: Promise<RepoFacts | null> | undefined;

  return () => {
    if (!hasRepository) return Promise.resolve(null);
    if (memoized) return memoized;
    const pending = loadRepoFacts(git, repository).then((facts) => {
      if (facts === null) memoized = undefined;
      return facts;
    });
    memoized = pending;
    return pending;
  };
}

async function loadRepoFacts(
  git: GitRuntimeClient,
  repository: RepositorySelector
): Promise<RepoFacts | null> {
  try {
    const [remotesSnapshot, refsSnapshot] = await Promise.all([
      git.repository.model.state(repository, 'remotes').snapshot(),
      git.repository.model.state(repository, 'refs').snapshot(),
    ]);

    const branches = refsSnapshot.data.branches;
    const remotes: RepoRemoteFacts[] = remotesSnapshot.data.remotes.map((remote) => ({
      name: remote.name,
      host: parseRepositoryRef(remote.url)?.host ?? null,
      headBranch: null,
      branches: branches
        .filter((branch) => branch.type === 'remote' && branch.remote.name === remote.name)
        .map((branch) => branch.branch),
    }));

    return {
      remotes,
      localBranches: branches
        .filter((branch) => branch.type === 'local')
        .map((branch) => branch.branch),
    };
  } catch (error) {
    log.warn('Failed to load repo facts for settings migration', { error });
    return null;
  }
}
