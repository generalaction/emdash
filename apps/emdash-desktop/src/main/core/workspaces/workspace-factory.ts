import type { RuntimeResolveError } from '@emdash/core/services/runtime-broker/api';
import { err, ok, type Result } from '@emdash/shared';
import { remoteRuntimeUnavailable } from '@core/features/runtime-routing/api';
import type { Task } from '@core/primitives/tasks/api';
import { TuiConversationProvider } from '@main/core/conversations/tui-conversation-provider';
import type { ConversationProvider } from '@main/core/conversations/types';
import type { Workspace } from '@main/core/workspaces/workspace';
import { getEffectiveTaskSettings } from '../projects/settings/effective-task-settings';
import type { ProjectSettingsProvider } from '../projects/settings/provider';
import { getTaskEnvVars } from './workspace-env';

export type WorkspaceType = { kind: 'local' } | { kind: 'ssh'; connectionId: string };

type TaskProviderOpts = {
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
  opts: TaskProviderOpts
): Promise<Result<{ conversations: ConversationProvider }, RuntimeResolveError>> {
  if (type.kind === 'ssh') {
    return err(remoteRuntimeUnavailable(type.connectionId, 'workspaces'));
  }
  return ok({
    conversations: new TuiConversationProvider({
      projectId: opts.projectId,
      taskPath: opts.taskPath,
      taskId: opts.taskId,
      tmux: opts.tmuxEnabled,
      shellSetup: opts.shellSetup,
      taskEnvVars: opts.taskEnvVars,
    }),
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
