import type { AutomationRun } from '@emdash/core/runtimes/automations/api';
import type { ConversationConfig } from '@core/primitives/conversations/api';
import type { AutomationRunMeta, CreateTaskParams } from '@core/primitives/tasks/api';
import type { WorkspaceConfig } from '@core/primitives/workspaces/api';
import type { conversations } from '@core/services/app-db/node/schema';

function workspaceGitForRun(runtimeRun: AutomationRun): WorkspaceConfig['git'] {
  const workspace = runtimeRun.configSnapshot.workspace;
  if (workspace.kind !== 'worktree') return { kind: 'none' };
  if (workspace.git.kind === 'use-branch') {
    return { kind: 'use-branch', branchName: workspace.git.branchName };
  }
  return {
    kind: 'create-branch',
    branchName: runtimeRun.branchName ?? runtimeRun.generatedName,
    fromBranch: workspace.git.fromBranch,
    pushBranch: workspace.git.pushRemote !== null,
  };
}

function workspaceConfigForRun(runtimeRun: AutomationRun, workspaceId: string): WorkspaceConfig {
  return {
    version: '2',
    git: workspaceGitForRun(runtimeRun),
    workspace: { kind: 'repository-instance', workspaceId },
  };
}

export function storedWorkspaceConfigForRun(
  runtimeRun: AutomationRun,
  workspaceId: string
): WorkspaceConfig {
  return {
    version: '2',
    git: workspaceGitForRun(runtimeRun),
    workspace:
      runtimeRun.configSnapshot.workspace.kind === 'worktree'
        ? { kind: 'new-worktree' }
        : { kind: 'repository-instance', workspaceId },
  };
}

export function conversationForRun(
  runtimeRun: AutomationRun,
  projectId: string,
  taskId: string
): typeof conversations.$inferInsert | undefined {
  if (!runtimeRun.conversationId) return undefined;
  const agent = runtimeRun.configSnapshot.agent;
  const config: ConversationConfig =
    agent.type === 'acp'
      ? {
          version: '1',
          type: 'acp',
          ...(agent.start.model && { model: agent.start.model }),
          ...(agent.start.modeId && { modeId: agent.start.modeId }),
          initialQueue: agent.start.initialQueue,
        }
      : {
          version: '1',
          type: 'pty',
          autoApprove: agent.start.autoApprove,
          ...(agent.start.model && { model: agent.start.model }),
          initialPrompt: agent.start.initialPrompt,
        };
  return {
    id: runtimeRun.conversationId,
    projectId,
    taskId,
    title: agent.title ?? runtimeRun.configSnapshot.name,
    provider: agent.start.providerId,
    config,
    sessionId: runtimeRun.sessionId,
    isInitialConversation: true,
    type: agent.type === 'acp' ? 'acp' : 'pty',
    lastInteractedAt: new Date().toISOString(),
  };
}

export function automationRunMetaForRun(runtimeRun: AutomationRun): AutomationRunMeta {
  return {
    automationName: runtimeRun.configSnapshot.name,
    status: runtimeRun.status,
    scheduledAt: runtimeRun.scheduledAt,
    startedAt: runtimeRun.startedAt,
    finishedAt: runtimeRun.finishedAt,
  };
}

export function taskParamsForRun(
  runtimeRun: AutomationRun,
  projectId: string,
  taskId: string,
  workspaceId: string,
  conversation: ReturnType<typeof conversationForRun>
): CreateTaskParams {
  return {
    id: taskId,
    projectId,
    taskConfig: {
      version: '1',
      name: runtimeRun.generatedName,
      initialStatus: 'in_progress',
      ...(conversation && {
        initialConversation: {
          id: conversation.id,
          provider: conversation.provider ?? '',
          title: conversation.title,
          type: conversation.type === 'acp' ? 'acp' : 'pty',
        },
      }),
    },
    workspaceConfig: workspaceConfigForRun(runtimeRun, workspaceId),
  };
}
