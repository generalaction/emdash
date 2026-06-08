import { getEffectiveTaskSettings } from '@main/core/projects/settings/effective-task-settings';
import { workspaceRegistry } from '@main/core/workspaces/workspace-registry';
import type { ProjectSettings } from '@shared/core/project-settings/project-settings';
import { createRPCController } from '@shared/lib/ipc/rpc';

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
