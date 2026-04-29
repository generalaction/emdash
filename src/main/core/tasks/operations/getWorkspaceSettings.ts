import type { ProjectSettings } from '@main/core/projects/settings/schema';
import { getEffectiveTaskSettings } from '@main/core/projects/settings/task-settings';
import { resolveWorkspace } from '@main/core/projects/utils';

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
