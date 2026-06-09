import type { GitSetup, WorkspaceLocation } from '@shared/core/tasks/tasks';
import type { WorkspaceSetupStep } from '@shared/core/workspaces/workspace-setup-steps';
import { parseRepositoryRef } from '@shared/repository-ref';

export type WorkspaceSetupSpec = WorkspaceSetupStep[];

export type CompileCtx = {
  /** Name of the remote used as the upstream base (e.g. "origin"). */
  baseRemote: string;
  /** Name of the remote to push new branches to (may equal baseRemote). */
  pushRemote: string;
};

/**
 * Derives the git remote name for a fork repository URL.
 * Mirrors the logic in `remoteNameForRepositoryUrl` from git-repo-utils (main-only).
 */
function forkRemoteName(repositoryUrl: string): string {
  const owner = parseRepositoryRef(repositoryUrl)?.owner;
  return owner?.split('/').filter(Boolean).join('-') || 'fork';
}

/**
 * Compiles a `WorkspaceSetupSpec` (ordered list of atomic git / filesystem steps)
 * from a stored `GitSetup` + `WorkspaceLocation` intent.
 *
 * Returns an empty spec when no setup is needed (e.g. workspace already has a
 * resolved path, the intent is `git.kind='none'`, or the workspace is BYOI).
 *
 * The spec is intentionally NOT stored — it is compiled fresh at provision time
 * so that step implementations can evolve independently of persisted intent.
 */
export function compileSetupSpec(
  git: GitSetup,
  workspace: WorkspaceLocation,
  ctx: CompileCtx
): WorkspaceSetupSpec {
  // BYOI workspaces are handled by a separate flow.
  if (workspace.host === 'byoi') return [];

  // If a concrete path is already stored, the workspace exists — nothing to set up.
  if (workspace.path) return [];

  // Project-root: no worktree needed.
  if (git.kind === 'none') return [];

  const steps: WorkspaceSetupStep[] = [];

  if (git.kind === 'use-branch') {
    steps.push({ kind: 'add-worktree', args: { branchName: git.branchName } });
    steps.push({ kind: 'copy-preserved-files', args: {} });
    return steps;
  }

  if (git.kind === 'create-branch') {
    const { branchName, fromBranch } = git;

    if (fromBranch.type === 'remote') {
      const remoteName = fromBranch.remote.name;
      const fromRef = `${remoteName}/${fromBranch.branch}`;

      steps.push({ kind: 'git-fetch', args: { remote: remoteName } });
      steps.push({
        kind: 'create-local-branch',
        args: { branchName, fromRef, noTrack: true },
      });
      steps.push({ kind: 'set-branch-base', args: { branchName, baseRef: fromRef } });
    } else {
      // Local source branch
      steps.push({
        kind: 'create-local-branch',
        args: { branchName, fromRef: fromBranch.branch, noTrack: true },
      });
      steps.push({
        kind: 'set-branch-base',
        args: { branchName, baseRef: fromBranch.branch },
      });
    }

    steps.push({ kind: 'add-worktree', args: { branchName } });
    steps.push({ kind: 'copy-preserved-files', args: {} });

    if (git.pushBranch) {
      steps.push({
        kind: 'push-branch',
        args: { branchName, remote: ctx.pushRemote, setUpstream: true },
      });
    }

    return steps;
  }

  if (git.kind === 'pr-branch') {
    const { headBranch, headRepositoryUrl, isFork, prNumber, taskBranch, pushBranch } = git;

    // The branch that will be checked out locally (PR head or task branch on top).
    const worktreeBranch = taskBranch ?? headBranch;

    if (isFork) {
      const remoteName = forkRemoteName(headRepositoryUrl);
      steps.push({ kind: 'ensure-remote', args: { name: remoteName, url: headRepositoryUrl } });
      steps.push({
        kind: 'git-fetch',
        args: {
          remote: remoteName,
          refspec: `${headBranch}:refs/heads/${headBranch}`,
          force: true,
        },
      });
      steps.push({
        kind: 'set-branch-tracking',
        args: { branchName: headBranch, remote: remoteName, remoteBranch: headBranch },
      });
    } else {
      steps.push({
        kind: 'git-fetch',
        args: {
          remote: ctx.baseRemote,
          refspec: `refs/pull/${prNumber}/head:refs/heads/${headBranch}`,
          force: true,
        },
      });
      steps.push({
        kind: 'set-branch-tracking',
        args: {
          branchName: headBranch,
          remote: ctx.baseRemote,
          remoteBranch: headBranch,
        },
      });
    }

    if (taskBranch) {
      steps.push({
        kind: 'create-local-branch',
        args: { branchName: taskBranch, fromRef: headBranch, noTrack: true },
      });
    }

    steps.push({ kind: 'add-worktree', args: { branchName: worktreeBranch } });
    steps.push({ kind: 'copy-preserved-files', args: {} });

    if (pushBranch && taskBranch) {
      steps.push({ kind: 'push-branch', args: { branchName: taskBranch, remote: ctx.pushRemote } });
    }

    return steps;
  }

  return [];
}
