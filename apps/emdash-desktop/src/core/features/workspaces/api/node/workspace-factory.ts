import type { HostRef } from '@emdash/core/primitives/host/api';
import type { RuntimeResolveError } from '@emdash/core/services/runtime-broker/api';
import { ok, type Result } from '@emdash/shared';
import type { ConversationProvider } from '@core/features/conversations/api/node/types';
import { getEffectiveTaskSettings } from '@core/features/projects/api/node/settings/effective-task-settings';
import type { ProjectSettingsProvider } from '@core/features/projects/api/node/settings/provider';
import type { Workspace } from '@core/features/workspaces/api/node/workspace';
import { getTaskEnvVars } from '@core/features/workspaces/api/node/workspace-env';
import type { Task } from '@core/primitives/tasks/api';
import type { TuiAgentsRuntimeClient } from '@core/services/runtime-broker/api/clients';
import type { FilesClientScope } from '@core/services/runtime-broker/node/files';

export type WorkspaceType = { kind: 'local' } | { kind: 'ssh'; connectionId: string };

export type TaskProviderOpts = {
  host: HostRef;
  files: FilesClientScope;
  tuiAgents: TuiAgentsRuntimeClient;
  projectId: string;
  taskId: string;
  workspaceId: string;
  taskPath: string;
  tmuxEnabled: boolean;
  shellSetup?: string;
  taskEnvVars: Record<string, string>;
};

export async function buildTaskProviders(
  opts: TaskProviderOpts,
  createConversationProvider: (options: TaskProviderOpts) => ConversationProvider
): Promise<Result<{ conversations: ConversationProvider }, RuntimeResolveError>> {
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
