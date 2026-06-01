import type { LocalProject, SshProject } from '@shared/projects';
import type { PullRequest } from '@shared/pull-requests';
import { getPrNumber, isForkPr } from '@shared/pull-requests';
import type { GitSetup, WorkspaceLocation } from '@shared/tasks';
import type { CreateTaskState } from './use-create-task-state';

/**
 * Builds a `GitSetup` from the current create-task modal state.
 * Maps UI concepts (checkout mode, branch selection) to the explicit
 * git operations the provisioner will execute.
 */
export function buildGitSetup(state: CreateTaskState, isUnborn: boolean): GitSetup {
  const { linkedType, linkedPR, checkoutMode, branchSelection, branchNameState } = state;

  if (linkedType === 'pr' && linkedPR) {
    return buildGitSetupFromPR(
      linkedPR,
      checkoutMode,
      branchNameState.branchName,
      branchSelection.pushBranch
    );
  }

  return buildGitSetupFromBranch(state, isUnborn);
}

function buildGitSetupFromPR(
  pr: PullRequest,
  checkoutMode: 'checkout' | 'new-branch',
  taskBranchName: string,
  pushBranch: boolean
): GitSetup {
  const prNumber = getPrNumber(pr) ?? 0;
  const headBranch = pr.headRefName;
  const headRepositoryUrl = pr.headRepositoryUrl;
  const isFork = isForkPr(pr);

  if (checkoutMode === 'checkout') {
    return {
      kind: 'pr-branch',
      prNumber,
      headBranch,
      headRepositoryUrl,
      isFork,
    };
  }

  return {
    kind: 'pr-branch',
    prNumber,
    headBranch,
    headRepositoryUrl,
    isFork,
    taskBranch: taskBranchName,
    pushBranch,
  };
}

function buildGitSetupFromBranch(state: CreateTaskState, isUnborn: boolean): GitSetup {
  const { branchSelection, branchNameState } = state;

  if (isUnborn || !branchSelection.createBranchAndWorktree) {
    return { kind: 'none' };
  }

  if (!branchSelection.selectedBranch) {
    return { kind: 'none' };
  }

  return {
    kind: 'create-branch',
    branchName: branchNameState.branchName,
    fromBranch: branchSelection.selectedBranch,
    pushBranch: branchSelection.pushBranch,
  };
}

/**
 * Builds a `WorkspaceLocation` from project data and the BYOI flag.
 */
export function buildWorkspaceLocation(
  projectData: LocalProject | SshProject | null,
  useBYOI: boolean
): WorkspaceLocation {
  if (useBYOI) {
    return { host: 'byoi' };
  }

  if (projectData?.type === 'ssh') {
    return { host: 'project-ssh' };
  }

  return { host: 'local' };
}
