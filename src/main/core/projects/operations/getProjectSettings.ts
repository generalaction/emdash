import { type ProjectSettings } from '@shared/project-settings';
import { projectManager } from '../project-manager';

export async function getProjectSettings(projectId: string): Promise<ProjectSettings> {
  const project = projectManager.getProject(projectId);
  if (!project) {
    throw new Error(`Project ${projectId} not found`);
  }
  return project.settings.get();
}
