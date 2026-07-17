import { err, ok } from '@emdash/shared';
import type { ProjectSettingsLoadResult } from '@core/primitives/project-settings/api';
import { getEffectiveTaskSettings } from '@main/core/projects/settings/effective-task-settings';
import { workspaceRegistry } from '@main/core/workspaces/workspace-registry';

async function getSettings(workspaceId: string): Promise<ProjectSettingsLoadResult> {
  const workspace = workspaceRegistry.get(workspaceId);
  if (!workspace) {
    return err({ type: 'not_found', entity: 'workspace', workspaceId });
  }

  return ok(
    await getEffectiveTaskSettings({
      projectSettings: workspace.settings,
      taskFiles: workspace.files,
      taskConfigPath: workspace.configPath,
    })
  );
}

export const projectSettingsOperations = {
  getSettings,
};
