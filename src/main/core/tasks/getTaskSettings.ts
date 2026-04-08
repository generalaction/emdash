import { projectManager } from '@main/core/projects/project-manager';
import type { ProjectSettings } from '@main/core/projects/settings/schema';
import { getEffectiveTaskSettings } from '@main/core/projects/settings/task-settings';

export async function getTaskSettings(projectId: string, taskId: string): Promise<ProjectSettings> {
  const project = projectManager.getProject(projectId);
  if (!project) {
    throw new Error(`Project ${projectId} not found`);
  }
  const task = project.getTask(taskId);
  if (!task) {
    throw new Error(`Task ${taskId} not found or not provisioned`);
  }

  return getEffectiveTaskSettings({
    projectSettings: project.settings,
    taskFs: task.workspace.fs,
  });
}
