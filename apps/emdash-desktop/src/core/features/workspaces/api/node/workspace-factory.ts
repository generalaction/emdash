import type { HostRef } from '@emdash/core/primitives/host/api';
import type { RuntimeResolveError } from '@emdash/core/services/runtime-broker/api';
import { ok, type Result } from '@emdash/shared';
import type { ConversationProvider } from '@core/features/conversations/api/node/types';
import {
  resolveProjectEffectiveSettings,
  type RepoFactsSource,
} from '@core/features/projects/api/node/settings/effective-settings';
import { getEffectiveTaskSettings } from '@core/features/projects/api/node/settings/effective-task-settings';
import type { ProjectSettingsProvider } from '@core/features/projects/api/node/settings/provider';
import type { Workspace } from '@core/features/workspaces/api/node/workspace';
import { getTaskEnvVars } from '@core/features/workspaces/api/node/workspace-env';
import type { Task } from '@core/primitives/tasks/api';
import type { TuiAgentsRuntimeClient } from '@core/services/runtime-broker/api/clients';
import type { FilesClientScope } from '@core/services/runtime-broker/node/files';
import { hostDefaultShellSetup } from '@core/services/runtime-broker/node/host-settings';

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
  workspace: Pick<Workspace, 'path' | 'files' | 'configPath' | 'hostSettings'>,
  projectPath: string,
  settings: ProjectSettingsProvider,
  repoFacts: RepoFactsSource
): Promise<{
  taskEnvVars: Record<string, string>;
  tmuxEnabled: boolean;
  shellSetup?: string;
}> {
  const projectSettings = await settings.get();
  // Effective default branch through the blessed resolver (spec:
  // github-git-settings §2); null (unresolvable) omits the env var.
  const effective = await resolveProjectEffectiveSettings({ settings, repoFacts });
  const defaultBranch = effective.defaultBranch.value?.branch ?? null;
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
    // Workspace .emdash.json overrides the per-host default (host-settings runtime);
    // the per-project DB shellSetup field was retired.
    shellSetup:
      taskLevelSettings.shellSetup ?? (await hostDefaultShellSetup(workspace.hostSettings)),
  };
}
