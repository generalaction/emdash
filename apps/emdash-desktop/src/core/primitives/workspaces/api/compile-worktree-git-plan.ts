import { normalizeRepositoryUrl } from '@root/src/core/services/pull-requests/api';
import type { WorkspaceConfig } from './workspace-config';

/**
 * The compiled git half of one `createWorktree` verb call. Structurally mirrors the
 * registry contract's `gitSetup` block (`WorkspaceGitSetup` in
 * `@emdash/core/runtimes/workspace-registry/api`) as a plain serializable object, so
 * the same output can drive both the verb input and the create-task preview.
 */
export type WorktreeGitPlan = {
  branch: string;
  /** Omitted when `gitSetup.fetchBranch` materializes the branch instead. */
  baseRef?: string;
  pushBranch: boolean;
  /** Present only for PR-sourced configs; absent plans need no host-side git setup. */
  gitSetup?: {
    fetchBranch?: { remote: string; sourceRef: string };
    upstream?: { remote: string; mergeRef: string };
    breadcrumb?: { prUrl: string };
    followRef?: boolean;
  };
};

export type WorktreeGitPlanContext = {
  /** The project's base remote (default 'origin'); the remote PR heads fetch from. */
  baseRemote: string;
};

/**
 * Compiles a workspace config's git half into the full worktree git plan: the verb's
 * branch/baseRef/push fields plus the PR-preset `gitSetup` block (pr-workspace-model
 * spec, per-case compilation). Pure and portable — callable from both the renderer
 * (preview) and node (provisioning), so preview and execution cannot drift.
 *
 * The host resolves an existing local branch itself, so `baseRef` only matters when
 * the branch is being created, and is omitted entirely when `fetchBranch`
 * materializes the branch. `kind: 'none'` configs have no git plan by construction;
 * callers own that refusal.
 */
export function compileWorktreeGitPlan(
  git: Exclude<WorkspaceConfig['git'], { kind: 'none' }>,
  context: WorktreeGitPlanContext
): WorktreeGitPlan {
  switch (git.kind) {
    case 'create-branch':
      return {
        branch: git.branchName,
        baseRef:
          git.fromBranch.type === 'remote'
            ? `${git.fromBranch.remote.name}/${git.fromBranch.branch}`
            : git.fromBranch.branch,
        pushBranch: git.pushBranch === true,
      };
    case 'use-branch':
      return { branch: git.branchName, baseRef: git.branchName, pushBranch: false };
    case 'pr-branch':
      return compilePrBranchPlan(git, context);
  }
}

type PrBranchGit = Extract<WorkspaceConfig['git'], { kind: 'pr-branch' }>;

function compilePrBranchPlan(git: PrBranchGit, context: WorktreeGitPlanContext): WorktreeGitPlan {
  const remote = context.baseRemote;
  const prUrl = resolvePrUrl(git);
  const breadcrumb = prUrl !== undefined ? { breadcrumb: { prUrl } } : {};
  const prHeadRef = `refs/pull/${git.prNumber}/head`;

  // pr-new-branch (either origin, uniform): base the task branch on the PR head; the
  // existing background push-branch step owns pushing and upstream tracking.
  if (git.taskBranch !== undefined) {
    return {
      branch: git.taskBranch,
      pushBranch: git.pushBranch === true,
      gitSetup: {
        fetchBranch: { remote, sourceRef: prHeadRef },
        ...breadcrumb,
        followRef: true,
      },
    };
  }

  // checkout-pr, fork: review-first. Fetch the PR ref into a namespaced branch (bare
  // <headBranch> could silently reuse an unrelated local branch); pointing the
  // upstream mergeRef at the PR ref makes @{u} divergence compute while the forge
  // itself rejects pushes.
  if (git.isFork) {
    return {
      branch: `pr/${git.prNumber}/${git.headBranch}`,
      pushBranch: false,
      gitSetup: {
        fetchBranch: { remote, sourceRef: prHeadRef },
        upstream: { remote, mergeRef: prHeadRef },
        ...breadcrumb,
        followRef: true,
      },
    };
  }

  // checkout-pr, same-repo: the real branch with upstream tracking — commit and push
  // to the PR preserved. Branch reuse on collision is correct (same logical branch).
  const headRef = `refs/heads/${git.headBranch}`;
  return {
    branch: git.headBranch,
    pushBranch: false,
    gitSetup: {
      fetchBranch: { remote, sourceRef: headRef },
      upstream: { remote, mergeRef: headRef },
      ...breadcrumb,
      followRef: true,
    },
  };
}

/**
 * The canonical PR identity for the breadcrumb: the stored `prUrl` when present, else
 * derived on read for pre-prUrl configs (migration ticket: construct from the
 * repository URL). Derivation only works for same-repo PRs — a fork config's only
 * repository URL is the fork's, not the PR's home — so old fork configs compile
 * without a breadcrumb (status-quo association via branch matching).
 */
function resolvePrUrl(git: PrBranchGit): string | undefined {
  if (git.prUrl) return git.prUrl;
  if (git.isFork || git.prNumber <= 0) return undefined;
  const repositoryUrl = normalizeRepositoryUrl(git.headRepositoryUrl);
  if (!repositoryUrl) return undefined;
  return `${repositoryUrl}/pull/${git.prNumber}`;
}
