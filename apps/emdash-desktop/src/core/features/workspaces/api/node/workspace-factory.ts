import type { RuntimeResolveError } from '@emdash/core/services/runtime-broker/api';
import { err, ok, type Result } from '@emdash/shared';
import type { ConversationProvider } from '@core/features/conversations/api/node/types';
import { getEffectiveTaskSettings } from '@core/features/projects/api/node/settings/effective-task-settings';
import type { ProjectSettingsProvider } from '@core/features/projects/api/node/settings/provider';
import type { Workspace } from '@core/features/workspaces/api/node/workspace';
import { getTaskEnvVars } from '@core/features/workspaces/api/node/workspace-env';
import { remoteRuntimeUnavailable } from '@core/primitives/desktop-runtime/api/runtime-errors';
import type { Task } from '@core/primitives/tasks/api';

export type WorkspaceType = { kind: 'local' } | { kind: 'ssh'; connectionId: string };

export type TaskProviderOpts = {
  projectId: string;
  taskId: string;
  workspaceId: string;
  taskPath: string;
  tmuxEnabled: boolean;
  shellSetup?: string;
  taskEnvVars: Record<string, string>;
};

export async function buildTaskProviders(
  type: WorkspaceType,
  opts: TaskProviderOpts,
  createConversationProvider: (options: TaskProviderOpts) => ConversationProvider
): Promise<Result<{ conversations: ConversationProvider }, RuntimeResolveError>> {
  if (type.kind === 'ssh') {
    return err(remoteRuntimeUnavailable(type.connectionId, 'workspaces'));
  }
  return ok({
    conversations: createConversationProvider(opts),
  });
}

export async function resolveTaskEnv(
  task: Pick<Task, 'id' | 'name'>,
  workspace: Pick<Workspace, 'path' | 'files' | 'configPath'>,
  projectPath: string,
  settings: ProjectSettingsProvider
): Promise<{
  taskEnvVars: Record<string, string>;
  tmuxEnabled: boolean;
  shellSetup?: string;
}> {
  const projectSettings = await settings.get();
  const defaultBranch = await settings.getDefaultBranch();
  const taskLevelSettings = await getEffectiveTaskSettings({
    projectSettings: settings,
    taskFiles: workspace.files,
    taskConfigPath: workspace.configPath,
  });
  return {
    taskEnvVars: getTaskEnvVars({
      taskId: task.id,
      taskName: task.name,
      taskPath: workspace.path,
      projectPath,
      defaultBranch,
      portSeed: workspace.path,
    }),
    tmuxEnabled: projectSettings.tmux ?? false,
    shellSetup: taskLevelSettings.shellSetup ?? projectSettings.shellSetup,
  };
}
