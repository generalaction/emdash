import { projectManager } from '../project-manager';
import { ProjectSettings } from '../settings/schema';

export async function getProjectSettings(projectId: string): Promise<ProjectSettings> {
  const project = projectManager.getProject(projectId);
  if (!project) {
    throw new Error(`Project ${projectId} not found`);
  }
  return project.settings.get();
}
