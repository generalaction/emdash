import type { GitBranch, GitRemote } from '@emdash/core/runtimes/git/api';
import type { RepoFacts, RepoRemoteFacts } from '@core/primitives/project-settings/api';
import { parseRepositoryRef } from '@core/primitives/repository/api';

/** Remote HEAD known renderer-side, from the repository store's default-branch lookup. */
export type RendererRemoteHead = { remote: string; branch: string };

/**
 * Maps the synced repository live model (`GitRepositoryStore` data) to the
 * blessed resolver's `RepoFacts` (spec: github-git-settings §2). Mirrors the
 * node-side loader (`features/projects/node/settings/repo-facts.ts`) with one
 * addition: the renderer may know the remote HEAD of one remote. When it is
 * unavailable the resolver degrades to the well-known branch candidates.
 */
export function buildRendererRepoFacts(args: {
  remotes: GitRemote[];
  branches: GitBranch[];
  remoteHead: RendererRemoteHead | null;
}): RepoFacts {
  const { remotes, branches, remoteHead } = args;
  const remoteFacts: RepoRemoteFacts[] = remotes.map((remote) => ({
    name: remote.name,
    host: parseRepositoryRef(remote.url)?.host ?? null,
    headBranch: remoteHead && remoteHead.remote === remote.name ? remoteHead.branch : null,
    branches: branches
      .filter((branch) => branch.type === 'remote' && branch.remote.name === remote.name)
      .map((branch) => branch.branch),
  }));
  return {
    remotes: remoteFacts,
    localBranches: branches
      .filter((branch) => branch.type === 'local')
      .map((branch) => branch.branch),
  };
}
