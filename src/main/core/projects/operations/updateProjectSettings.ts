import type { UpdateProjectSettingsError } from '@shared/projects';
import { err, type Result } from '@shared/result';
import { projectManager } from '../project-manager';
import type { ProjectSettings } from '../settings/schema';

export async function updateProjectSettings(
  projectId: string,
  settings: ProjectSettings
): Promise<Result<void, UpdateProjectSettingsError>> {
  const project = projectManager.getProject(projectId);
  if (!project) {
    return err({ type: 'project-not-found' });
  }
  return project.settings.update(settings);
}
