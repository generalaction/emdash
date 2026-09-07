import type { GitBranchRef } from '@emdash/core/runtimes/git/api';
import type { RuntimeResolveError } from '@emdash/core/services/runtime-broker/api';
import { ok, type Result } from '@emdash/shared';
import type { ConversationProvider } from '@core/features/conversations/api/node/types';
import type { TaskProvider } from '@core/features/projects/api/node/project-provider';
import type { Workspace } from '@core/features/workspaces/api/node/workspace';
import {
  buildTaskProviders,
  type TaskProviderOpts,
} from '@core/features/workspaces/api/node/workspace-factory';
import type { Task } from '@core/primitives/tasks/api';
import type { TaskSessionLaunchContextResolver } from './task-session-launch-context';

export type BuildTaskResult = {
  taskProvider: TaskProvider;
  conversationProvider: ConversationProvider;
};

export async function buildTaskFromWorkspace(
  task: Task,
  workspace: Workspace,
  projectId: string,
  launchContexts: Pick<TaskSessionLaunchContextResolver, 'bind'>,
  createConversationProvider: (options: TaskProviderOpts) => ConversationProvider,
  workspaceBranchName?: string,
  workspaceSourceBranch?: GitBranchRef
): Promise<Result<BuildTaskResult, RuntimeResolveError>> {
  const providers = await buildTaskProviders(
    {
      host: workspace.host,
      files: workspace.files,
      tuiAgents: workspace.tuiAgents,
      projectId,
      taskId: task.id,
      workspaceId: workspace.id,
      taskPath: workspace.path,
      launchContextSource: launchContexts.bind({
        projectId,
        taskId: task.id,
        workspaceId: workspace.id,
      }),
    },
    createConversationProvider
  );
  if (!providers.success) return providers;
  const { conversations: conversationProvider } = providers.data;
  const taskProvider: TaskProvider = {
    taskId: task.id,
    taskBranch: workspaceBranchName,
    sourceBranch: workspaceSourceBranch,
    conversations: conversationProvider,
  };
  return ok({ taskProvider, conversationProvider });
}
