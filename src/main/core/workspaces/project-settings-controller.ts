import { getEffectiveTaskSettings } from '@main/core/projects/settings/effective-task-settings';
import { workspaceRegistry } from '@main/core/workspaces/workspace-registry';
import { createRPCController } from '@shared/ipc/rpc';
import type { ProjectSettings } from '@shared/project-settings';

async function getSettings(workspaceId: string): Promise<ProjectSettings> {
  const workspace = workspaceRegistry.get(workspaceId);
  if (!workspace) {
    throw new Error(`Workspace ${workspaceId} not found`);
  }

  return getEffectiveTaskSettings({
    projectSettings: workspace.settings,
    taskFs: workspace.fs,
  });
}

export const projectSettingsController = createRPCController({
  getSettings,
});
