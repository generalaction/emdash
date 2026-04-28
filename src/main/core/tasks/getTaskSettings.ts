import type { ProjectSettings } from '@main/core/projects/settings/schema';
import { getEffectiveTaskSettings } from '@main/core/projects/settings/task-settings';
import { resolveTask } from '@main/core/projects/utils';
import { workspaceRegistry } from '@main/core/workspaces/workspace-registry';

export async function getTaskSettings(projectId: string, taskId: string): Promise<ProjectSettings> {
  const task = resolveTask(projectId, taskId);
  if (!task) {
    throw new Error(`Task ${taskId} not found or not provisioned`);
  }
  const workspace = workspaceRegistry.get(task.workspaceId);
  if (!workspace) {
    throw new Error(`Workspace ${task.workspaceId} not found`);
  }

  return getEffectiveTaskSettings({
    projectSettings: workspace.settings,
    taskFs: workspace.fs,
  });
}
