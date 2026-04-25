import type { OpenProjectError } from '@shared/projects';
import type { Result } from '@shared/result';
import { projectManager } from '@main/core/projects/project-manager';

export async function openProject(projectId: string): Promise<Result<void, OpenProjectError>> {
  return projectManager.openProjectById(projectId);
}
