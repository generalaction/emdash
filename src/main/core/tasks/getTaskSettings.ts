import type { ProjectSettings } from '@main/core/projects/settings/schema';
import { getEffectiveTaskSettings } from '@main/core/projects/settings/task-settings';
import { taskManager } from '@main/core/projects/task-manager';
import { workspaceRegistry } from '@main/core/workspaces/workspace-registry';

export async function getTaskSettings(
  _projectId: string,
  taskId: string
): Promise<ProjectSettings> {
  if (!taskManager.getTask(taskId)) {
    throw new Error(`Task ${taskId} not found or not provisioned`);
  }
  const workspaceId = taskManager.getWorkspaceId(taskId);
  if (!workspaceId) {
    throw new Error(`Workspace ID for task ${taskId} not found`);
  }
  const workspace = workspaceRegistry.get(workspaceId);
  if (!workspace) {
    throw new Error(`Workspace ${workspaceId} not found`);
  }

  return getEffectiveTaskSettings({
    projectSettings: workspace.settings,
    taskFs: workspace.fs,
  });
}
