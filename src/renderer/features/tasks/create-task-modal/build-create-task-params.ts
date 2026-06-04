import type { AgentProviderId } from '@shared/agent-provider-registry';
import type { CreateConversationParams } from '@shared/conversations';
import type { LocalProject, SshProject } from '@shared/projects';
import type { PullRequest } from '@shared/pull-requests';
import { getPrNumber, isForkPr } from '@shared/pull-requests';
import type { GitSetup, TaskLifecycleStatus } from '@shared/tasks';
import type { WorkspaceConfig, WorkspaceTarget } from '@shared/workspace-config';
import { nextDefaultConversationTitle } from '../conversations/conversation-title-utils';
import type { InitialConversationState } from './initial-conversation-section';
import { buildFinalPrompt } from './initial-conversation-text';
import type { CreateTaskState, LinkedType } from './use-create-task-state';

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

export function buildInitialConversation(
  taskId: string,
  projectId: string,
  state: InitialConversationState,
  getAutoApproveDefault: (provider: AgentProviderId) => boolean
): CreateConversationParams | undefined {
  const { provider } = state;
  if (!provider) return undefined;

  return {
    id: crypto.randomUUID(),
    projectId,
    taskId,
    provider,
    title: nextDefaultConversationTitle(provider, []),
    initialPrompt: buildFinalPrompt(state.issueContext, state.prompt),
    autoApprove: getAutoApproveDefault(provider),
  };
}

export function deriveInitialStatus(
  linkedType: LinkedType,
  linkedPR: PullRequest | null
): TaskLifecycleStatus | undefined {
  if (linkedType !== 'pr' || !linkedPR) return undefined;
  return linkedPR.status === 'open' && !linkedPR.isDraft ? 'review' : undefined;
}

export function buildWorkspaceConfig(
  state: CreateTaskState,
  isUnborn: boolean,
  projectData: LocalProject | SshProject | null,
  useBYOI: boolean
): WorkspaceConfig {
  const git = buildGitSetup(state, isUnborn);

  let workspace: WorkspaceTarget;
  if (useBYOI) {
    workspace = { kind: 'byoi' };
  } else if (git.kind === 'none') {
    // Unborn repo or no-worktree mode — use the project's repository-instance workspace.
    const workspaceId = projectData?.repositoryWorkspaceId ?? null;
    workspace = workspaceId
      ? { kind: 'repository-instance', workspaceId }
      : { kind: 'new-worktree' }; // fallback if repositoryWorkspaceId not yet set (pre-mount)
  } else {
    workspace = { kind: 'new-worktree' };
  }

  return { version: '2', git, workspace };
}
