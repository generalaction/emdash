import { clearStoredProjectIconForProject } from '../icons/storage';

export async function clearProjectIcon(projectId: string): Promise<void> {
  if (typeof projectId !== 'string' || !projectId.trim()) {
    throw new Error('projectId is required');
  }
  await clearStoredProjectIconForProject(projectId.trim());
}
