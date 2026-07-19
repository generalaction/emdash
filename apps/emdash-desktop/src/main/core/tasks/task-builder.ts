import type { GitBranchRef } from '@emdash/core/runtimes/git/api';
import type { WorkspaceOperationProgress } from '@emdash/core/runtimes/workspace/api';
import type { RuntimeResolveError } from '@emdash/core/services/runtime-broker/api';
import { ok, type Result } from '@emdash/shared';
import type { WorkspaceBootstrapStep } from '@core/features/workspaces/api';
import type { Task } from '@core/primitives/tasks/api';
import type { ConversationProvider } from '@main/core/conversations/types';
import type { Workspace } from '@main/core/workspaces/workspace';
import type { TaskProvider } from '../projects/project-provider';
import type { ProjectSettingsProvider } from '../projects/settings/provider';
import {
  buildTaskProviders,
  resolveTaskEnv,
  type WorkspaceType,
} from '../workspaces/workspace-factory';
import { taskProvisionEvents } from './task-provision-events';

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
  workspaceBranchName?: string,
  workspaceSourceBranch?: GitBranchRef
): Promise<Result<BuildTaskResult, RuntimeResolveError>> {
  const { taskEnvVars, tmuxEnabled, shellSetup } = await resolveTaskEnv(
    task,
    workspace,
    projectPath,
    settings
  );

  const providers = await buildTaskProviders(type, {
    projectId,
    taskId: task.id,
    workspaceId: workspace.id,
    taskPath: workspace.path,
    tmuxEnabled,
    shellSetup,
    taskEnvVars,
  });
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
