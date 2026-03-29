import { projectManager } from '@main/core/projects/project-manager';
import { projectSettingsSchema, type ProjectSettings } from '@main/core/projects/settings/schema';
import { log } from '@main/lib/logger';

export async function getTaskSettings(projectId: string, taskId: string): Promise<ProjectSettings> {
  const project = projectManager.getProject(projectId);
  if (!project) {
    throw new Error(`Project ${projectId} not found`);
  }
  const task = project.getTask(taskId);
  if (!task) {
    throw new Error(`Task ${taskId} not found or not provisioned`);
  }

  const exists = await task.fs.exists('.emdash.json');
  if (!exists) {
    return project.settings.get();
  }

  try {
    const { content } = await task.fs.read('.emdash.json');
    return projectSettingsSchema.parse(JSON.parse(content));
  } catch (err) {
    log.warn('Failed to parse task .emdash.json, falling back to project settings', err);
    return project.settings.get();
  }
}
