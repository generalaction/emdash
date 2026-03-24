import { projectManager } from '@main/core/projects/project-manager';

export function getTearingDownTaskIds(projectId: string): string[] {
  const project = projectManager.getProject(projectId);
  if (!project) return [];
  return project.getTearingDownTaskIds();
}
