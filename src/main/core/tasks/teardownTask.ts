import { projectManager } from '../projects/project-manager';

export async function teardownTask(projectId: string, taskId: string) {
  const project = projectManager.getProject(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);
  return await project.tasks.teardownTask(taskId);
}
