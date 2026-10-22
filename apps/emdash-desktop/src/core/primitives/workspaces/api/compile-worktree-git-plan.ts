import { normalizeRepositoryUrl } from '@root/src/core/services/pull-requests/api';
import { branchHeadRef, prHeadRef } from './pr-source-refs';
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
  /** Explicit background publication target; absent when publication is disabled. */
  publish?: { remote: string };
  /** Present only for PR-sourced configs; absent plans need no host-side git setup. */
  gitSetup?: {
    fetchBranch?: { remote: string; sourceRef: string };
    upstream?: { remote: string; mergeRef: string };
    breadcrumb?: { prUrl: string };
    followRef?: boolean;
  };
};

export type WorktreeGitPlanContext = {
  /**
   * The effective base remote from the blessed resolver; `null` when the
   * repository has no remotes. Only PR-sourced plans read it — they fetch PR
   * heads from it and cannot compile without one.
   */
  baseRemote: string | null;
  /** Effective project push remote; required when the config requests publication. */
  pushRemote: string | null;
};

/**
 * Compiles a workspace config's git half into the full worktree git plan: the verb's
 * branch/baseRef/publication fields plus the PR-preset `gitSetup` block (pr-workspace-model
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
        ...compilePublishTarget(git.pushBranch, context.pushRemote),
      };
    case 'use-branch':
      return { branch: git.branchName, baseRef: git.branchName };
    case 'pr-branch':
      return compilePrBranchPlan(git, context);
  }
}

type PrBranchGit = Extract<WorkspaceConfig['git'], { kind: 'pr-branch' }>;

function compilePrBranchPlan(git: PrBranchGit, context: WorktreeGitPlanContext): WorktreeGitPlan {
  const remote = context.baseRemote;
  if (remote === null) {
    throw new Error('Cannot compile a PR-sourced git plan: the repository has no git remotes.');
  }
  const prUrl = resolvePrUrl(git);
  const breadcrumb = prUrl !== undefined ? { breadcrumb: { prUrl } } : {};
  const prRef = prHeadRef(git.prNumber, git.provider);

  // pr-new-branch (either origin, uniform): base the task branch on the PR head; the
  // existing background push-branch step owns pushing and upstream tracking.
  if (git.taskBranch !== undefined) {
    return {
      branch: git.taskBranch,
      ...compilePublishTarget(git.pushBranch, context.pushRemote),
      gitSetup: {
        fetchBranch: { remote, sourceRef: prRef },
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
      branch: `${git.provider === 'gitlab' ? 'mr' : 'pr'}/${git.prNumber}/${git.headBranch}`,
      gitSetup: {
        fetchBranch: { remote, sourceRef: prRef },
        upstream: { remote, mergeRef: prRef },
        ...breadcrumb,
        followRef: true,
      },
    };
  }

  // checkout-pr, same-repo: the real branch with upstream tracking — commit and push
  // to the PR preserved. Branch reuse on collision is correct (same logical branch).
  const headRef = branchHeadRef(git.headBranch);
  return {
    branch: git.headBranch,
    gitSetup: {
      fetchBranch: { remote, sourceRef: headRef },
      upstream: { remote, mergeRef: headRef },
      ...breadcrumb,
      followRef: true,
    },
  };
}

function compilePublishTarget(
  requested: boolean | undefined,
  pushRemote: string | null
): Pick<WorktreeGitPlan, 'publish'> {
  if (requested !== true) return {};
  if (pushRemote === null) {
    throw new Error('Cannot publish the task branch because the repository has no push remote.');
  }
  return { publish: { remote: pushRemote } };
}

/**
 * Use the canonical request URL when stored. Same-repository configs can derive
 * it from the source repository; fork configs require the target request URL.
 */
function resolvePrUrl(git: PrBranchGit): string | undefined {
  if (git.prUrl) return git.prUrl;
  if (git.isFork || git.prNumber <= 0) return undefined;
  const repositoryUrl = normalizeRepositoryUrl(git.headRepositoryUrl);
  if (!repositoryUrl) return undefined;
  return git.provider === 'gitlab'
    ? `${repositoryUrl}/-/merge_requests/${git.prNumber}`
    : `${repositoryUrl}/pull/${git.prNumber}`;
}
