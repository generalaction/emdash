import { getEffectiveTaskSettings } from '@main/core/projects/settings/effective-task-settings';
import { resolveWorkspace } from '@main/core/projects/utils';
import type { ProjectSettings } from '@shared/project-settings';

export async function getWorkspaceSettings(
  projectId: string,
  workspaceId: string
): Promise<ProjectSettings> {
  const workspace = resolveWorkspace(projectId, workspaceId);
  if (!workspace) {
    throw new Error(`Workspace ${workspaceId} not found in project ${projectId}`);
  }

  return getEffectiveTaskSettings({
    projectSettings: workspace.settings,
    taskFs: workspace.fs,
  });
}
