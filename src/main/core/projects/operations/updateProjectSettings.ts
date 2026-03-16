import { projectManager } from '../project-manager';
import { ProjectSettings } from '../settings/schema';

export async function updateProjectSettings(
  projectId: string,
  settings: ProjectSettings
): Promise<void> {
  const project = projectManager.getProject(projectId);
  if (!project) {
    throw new Error(`Project ${projectId} not found`);
  }
  await project.settings.update(settings);
}
