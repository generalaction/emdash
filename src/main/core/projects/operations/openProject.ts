import { projectManager } from '@main/core/projects/project-manager';

export async function openProject(projectId: string): Promise<void> {
  await projectManager.openProjectById(projectId);
}
