import { workspaceKey } from '@shared/workspace-key';
import type { ProjectSettings } from '@main/core/projects/settings/schema';
import { getEffectiveTaskSettings } from '@main/core/projects/settings/task-settings';
import { resolveTask, resolveWorkspace } from '@main/core/projects/utils';

export async function getTaskSettings(projectId: string, taskId: string): Promise<ProjectSettings> {
  const task = resolveTask(projectId, taskId);
  if (!task) {
    throw new Error(`Task ${taskId} not found or not provisioned`);
  }
  const wsId = workspaceKey(task.taskBranch);
  const workspace = resolveWorkspace(projectId, wsId);
  if (!workspace) {
    throw new Error(`Workspace ${wsId} not found in project ${projectId}`);
  }

  return getEffectiveTaskSettings({
    projectSettings: workspace.settings,
    taskFs: workspace.fs,
  });
}
