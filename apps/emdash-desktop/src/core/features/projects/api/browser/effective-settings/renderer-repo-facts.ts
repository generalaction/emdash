import type { GitBranch, GitRemote, GitRemoteHead } from '@emdash/core/runtimes/git/api';
import type { RepoFacts, RepoRemoteFacts } from '@core/primitives/project-settings/api';
import { parseRepositoryRef } from '@core/primitives/repository/api';

/**
 * Maps the synced repository live model (`GitRepositoryStore` data) to the
 * blessed resolver's `RepoFacts` (spec: github-git-settings §2). Mirrors the
 * node-side loader (`features/projects/node/settings/repo-facts.ts`): remote
 * HEADs come from the refs state's `refs/remotes/<remote>/HEAD` symbolic refs.
 * When a remote's HEAD is unknown the resolver degrades to the well-known
 * branch candidates.
 */
export function buildRendererRepoFacts(args: {
  remotes: GitRemote[];
  branches: GitBranch[];
  remoteHeads: GitRemoteHead[];
}): RepoFacts {
  const { remotes, branches, remoteHeads } = args;
  const remoteFacts: RepoRemoteFacts[] = remotes.map((remote) => ({
    name: remote.name,
    host: parseRepositoryRef(remote.url)?.host ?? null,
    headBranch: remoteHeads.find((head) => head.remote === remote.name)?.branch ?? null,
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
