import { err, ok } from '@emdash/shared';
import { acquireWorkspaceRuntime } from '@core/features/workspaces/node/workspace-runtime-access';
import type { ProjectSettingsLoadResult } from '@core/primitives/project-settings/api';
import { projectManager } from '@main/core/projects/project-manager';
import { getEffectiveTaskSettings } from '@main/core/projects/settings/effective-task-settings';

async function getSettings(workspaceId: string): Promise<ProjectSettingsLoadResult> {
  const workspace = await acquireWorkspaceRuntime(workspaceId);
  if (!workspace) {
    return err({ type: 'not_found', entity: 'workspace', workspaceId });
  }

  try {
    const project = projectManager.getProject(workspace.identity.projectId);
    if (!project) {
      return err({ type: 'not_found', entity: 'workspace', workspaceId });
    }
    return ok(
      await getEffectiveTaskSettings({
        projectSettings: project.settings,
        taskFiles: workspace.files,
        taskConfigPath: project.configPathForDirectory(workspace.identity.path),
      })
    );
  } finally {
    await workspace.release();
  }
}

export const projectSettingsOperations = {
  getSettings,
};
