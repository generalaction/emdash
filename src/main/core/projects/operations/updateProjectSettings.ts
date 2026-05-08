import type { ProjectSettings } from '@shared/project-settings';
import type { UpdateProjectSettingsError } from '@shared/projects';
import { err, type Result } from '@shared/result';
import { projectManager } from '../project-manager';

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
