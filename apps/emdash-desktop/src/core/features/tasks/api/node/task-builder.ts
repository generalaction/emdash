import type { GitBranchRef } from '@emdash/core/runtimes/git/api';
import type { WorkspaceOperationProgress } from '@emdash/core/runtimes/workspace/api';
import type { RuntimeResolveError } from '@emdash/core/services/runtime-broker/api';
import { ok, type Result } from '@emdash/shared';
import type { ConversationProvider } from '@core/features/conversations/api/node/types';
import type { TaskProvider } from '@core/features/projects/api/node/project-provider';
import type { ProjectSettingsProvider } from '@core/features/projects/api/node/settings/provider';
import type { WorkspaceBootstrapStep } from '@core/features/workspaces/api';
import type { Workspace } from '@core/features/workspaces/api/node/workspace';
import {
  buildTaskProviders,
  resolveTaskEnv,
  type TaskProviderOpts,
  type WorkspaceType,
} from '@core/features/workspaces/api/node/workspace-factory';
import type { Task } from '@core/primitives/tasks/api';
import { taskProvisionEvents } from '../../node/task-provision-events';

export function emitTaskProvisionProgress(data: {
  taskId: string;
  projectId: string;
  step: WorkspaceBootstrapStep;
  message: string;
  operation?: WorkspaceOperationProgress;
}): void {
  taskProvisionEvents.emitProgress(data);
}

export type BuildTaskResult = {
  taskProvider: TaskProvider;
  conversationProvider: ConversationProvider;
};

/**
 * Shared tail of the provision flow — builds a TaskProvider from an already-acquired
 * workspace. Works for both local and SSH transports.
 *
 * Returns the task provider and conversation provider.
 *
 * `workspaceBranchName` and `workspaceSourceBranch` are sourced from the
 * workspace row (not the task row), and flow through to `TaskProvider` for
 * PTY env var population.
 */
export async function buildTaskFromWorkspace(
  task: Task,
  workspace: Workspace,
  type: WorkspaceType,
  projectId: string,
  projectPath: string,
  settings: ProjectSettingsProvider,
  createConversationProvider: (options: TaskProviderOpts) => ConversationProvider,
  workspaceBranchName?: string,
  workspaceSourceBranch?: GitBranchRef
): Promise<Result<BuildTaskResult, RuntimeResolveError>> {
  const { taskEnvVars, tmuxEnabled, shellSetup } = await resolveTaskEnv(
    task,
    workspace,
    projectPath,
    settings
  );

  const providers = await buildTaskProviders(
    type,
    {
      projectId,
      taskId: task.id,
      workspaceId: workspace.id,
      taskPath: workspace.path,
      tmuxEnabled,
      shellSetup,
      taskEnvVars,
    },
    createConversationProvider
  );
  if (!providers.success) return providers;
  const { conversations: conversationProvider } = providers.data;

  const taskProvider: TaskProvider = {
    taskId: task.id,
    taskBranch: workspaceBranchName,
    sourceBranch: workspaceSourceBranch,
    taskEnvVars,
    conversations: conversationProvider,
  };

  return ok({ taskProvider, conversationProvider });
}
